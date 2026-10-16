package com.iptv.player;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/** Нативная часть: файловый сервер, папка «Загрузки/IPTV Player», телепрограмма (EPG). */
@CapacitorPlugin(name = "IptvNative")
public class IptvNativePlugin extends Plugin {
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static final long MAX_PLAYLIST_BYTES = 30L * 1024L * 1024L;

    private FileStore store;
    private WebServer server;
    private final EpgIndex epg = new EpgIndex();
    private final AtomicBoolean epgBusy = new AtomicBoolean(false);

    @Override
    public void load() {
        store = new FileStore(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
    }

    // ---------- автозапуск (SharedPreferences — читает и BootReceiver) ----------
    private static final String PREFS = "iptv_prefs";
    private static final String KEY_AUTOSTART = "autoStart";

    @PluginMethod
    public void getAutoStart(PluginCall call) {
        boolean on = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTOSTART, true);
        JSObject r = new JSObject();
        r.put("on", on);
        call.resolve(r);
    }

    @PluginMethod
    public void setAutoStart(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", Boolean.TRUE));
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_AUTOSTART, on).apply();
        JSObject r = new JSObject();
        r.put("on", on);
        call.resolve(r);
    }

    // ---------- файловый сервер ----------
    private JSObject serverStatus() {
        JSObject r = new JSObject();
        boolean on = server != null && server.isRunning();
        r.put("running", on);
        r.put("port", on ? server.getPort() : 0);
        JSArray addr = new JSArray();
        for (String a : WebServer.addresses()) addr.put(a);
        r.put("addresses", addr);
        return r;
    }

    @PluginMethod
    public synchronized void serverStart(PluginCall call) {
        try {
            if (server == null) server = new WebServer(getContext(), store, this::callJs);
            server.start(call.getInt("port", 0));
            call.resolve(serverStatus());
        } catch (Exception e) {
            call.reject("Не удалось запустить сервер: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void serverStop(PluginCall call) {
        if (server != null) server.stop();
        call.resolve(serverStatus());
    }

    @PluginMethod
    public void serverStatus(PluginCall call) {
        call.resolve(serverStatus());
    }

    // ---------- мост в JS (для пульта Remote Supremacy) ----------
    /** Вызывает RemoteAPI.handle(cmd) в WebView и возвращает JSON-результат. Выполняется на UI-потоке. */
    private String callJs(String cmdJson) {
        if (getBridge() == null || getBridge().getWebView() == null || getActivity() == null) {
            return "{\"error\":\"webview unavailable\"}";
        }
        final android.webkit.WebView wv = getBridge().getWebView();
        final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
        final String[] out = new String[1];
        final String expr = "window.RemoteAPI ? RemoteAPI.handle(JSON.parse(" + jsQuote(cmdJson) + ")) : null";
        getActivity().runOnUiThread(() -> {
            try {
                wv.evaluateJavascript(expr, value -> {
                    out[0] = value;
                    latch.countDown();
                });
            } catch (Exception e) {
                latch.countDown();
            }
        });
        try {
            if (!latch.await(6, java.util.concurrent.TimeUnit.SECONDS)) {
                return "{\"error\":\"timeout\"}";
            }
        } catch (InterruptedException e) {
            return "{\"error\":\"interrupted\"}";
        }
        String v = out[0];
        if (v == null || v.isEmpty() || "null".equals(v)) return "{}";
        return v;
    }

    private static String jsQuote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    // ---------- файлы ----------
    @PluginMethod
    public void listFiles(PluginCall call) {
        try {
            JSArray arr = new JSArray();
            for (FileStore.Item it : store.list()) {
                JSObject o = new JSObject();
                o.put("name", it.name);
                o.put("size", it.size);
                o.put("modified", it.modified);
                arr.put(o);
            }
            JSObject r = new JSObject();
            r.put("files", arr);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Не удалось получить список файлов: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String name = FileStore.clean(call.getString("name", ""));
        if (name == null) {
            call.reject("Не указано имя файла");
            return;
        }
        try (InputStream in = store.open(name)) {
            if (in == null) {
                call.reject("Файл не найден: " + name);
                return;
            }
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_PLAYLIST_BYTES) {
                    call.reject("Файл слишком большой для плейлиста");
                    return;
                }
                bo.write(buf, 0, n);
            }
            JSObject r = new JSObject();
            r.put("text", new String(bo.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Не удалось прочитать файл: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String name = FileStore.clean(call.getString("name", ""));
        String text = call.getString("text", "");
        if (name == null || !FileStore.allowed(name)) {
            call.reject("Неверное имя файла");
            return;
        }
        try {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            long saved = store.write(name, new java.io.ByteArrayInputStream(bytes), bytes.length);
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("size", saved);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Не удалось записать файл: " + e.getMessage());
        }
    }
    @PluginMethod
    public void deleteFile(PluginCall call) {
        String name = FileStore.clean(call.getString("name", ""));
        boolean ok = name != null && store.delete(name);
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    // ---------- кэш ----------
    private static long dirSize(java.io.File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long s = 0;
        java.io.File[] kids = f.listFiles();
        if (kids != null) for (java.io.File k : kids) s += dirSize(k);
        return s;
    }

    private static void deleteTree(java.io.File f) {
        if (f == null || !f.exists()) return;
        java.io.File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (java.io.File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** Чистит кэш WebView и папку кэша приложения. Плейлисты, избранное и настройки не затрагиваются. */
    @PluginMethod
    public void clearCache(final PluginCall call) {
        final android.app.Activity act = getActivity();
        new Thread(() -> {
            try {
                java.io.File cache = getContext().getCacheDir();
                long before = dirSize(cache);
                if (act != null && getBridge() != null && getBridge().getWebView() != null) {
                    final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
                    act.runOnUiThread(() -> {
                        try {
                            getBridge().getWebView().clearCache(true);
                        } catch (Exception ignored) {
                            // WebView недоступен — чистим только папку
                        }
                        latch.countDown();
                    });
                    latch.await(5, java.util.concurrent.TimeUnit.SECONDS);
                }
                java.io.File[] kids = cache.listFiles();
                if (kids != null) for (java.io.File k : kids) deleteTree(k);
                long after = dirSize(cache);
                JSObject r = new JSObject();
                r.put("freed", Math.max(0L, before - after));
                call.resolve(r);
            } catch (Throwable t) {
                call.reject("Не удалось очистить кэш: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
            }
        }, "iptv-clear-cache").start();
    }
    // ---------- EPG ----------
    private JSObject epgStatusObj(boolean skipped) {
        JSObject r = new JSObject();
        r.put("loaded", epg.loaded);
        r.put("channels", epg.channels);
        r.put("programmes", epg.programmes);
        r.put("loadedAt", epg.loadedAt);
        r.put("source", epg.source);
        r.put("sig", epg.sig);
        r.put("skipped", skipped);
        return r;
    }

    private static Set<String> toSet(JSArray arr, boolean normalize) {
        Set<String> out = new HashSet<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            String v = arr.optString(i, "");
            if (normalize) v = EpgIndex.norm(v);
            if (v != null && !v.isEmpty()) out.add(v);
        }
        return out;
    }

    private static InputStream openUrl(String urlStr) throws IOException {
        String u = urlStr;
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(90000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "*/*");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("перенаправление без адреса");
                u = new URL(new URL(u), loc).toString();
                continue;
            }
            if (code != 200) {
                c.disconnect();
                throw new IOException("сервер ответил HTTP " + code);
            }
            return c.getInputStream();
        }
        throw new IOException("слишком много перенаправлений");
    }

    @PluginMethod
    public void epgLoad(final PluginCall call) {
        final String source = call.getString("source", "");
        final String name = call.getString("name", "");
        final String url = call.getString("url", "");
        final String sig = call.getString("sig", "");
        final boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        final Set<String> ids = toSet(call.getArray("ids"), false);
        final Set<String> names = toSet(call.getArray("names"), true);

        if (!force && epg.loaded && sig.equals(epg.sig) && System.currentTimeMillis() - epg.loadedAt < 6L * 3600L * 1000L) {
            call.resolve(epgStatusObj(true));
            return;
        }
        if (!epgBusy.compareAndSet(false, true)) {
            call.reject("EPG уже загружается");
            return;
        }
        new Thread(() -> {
            InputStream in = null;
            try {
                String desc;
                if ("url".equals(source)) {
                    if (url.isEmpty()) throw new IOException("не указана ссылка на EPG");
                    in = openUrl(url);
                    desc = url;
                } else {
                    String clean = FileStore.clean(name);
                    in = clean == null ? null : store.open(clean);
                    if (in == null) throw new IOException("файл EPG не найден: " + name);
                    desc = "файл " + clean;
                }
                boolean filter = !ids.isEmpty() || !names.isEmpty();
                epg.load(in, filter ? ids : null, filter ? names : null, desc, sig);
                call.resolve(epgStatusObj(false));
            } catch (Throwable t) {
                call.reject("Не удалось загрузить EPG: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
            } finally {
                if (in != null) {
                    try {
                        in.close();
                    } catch (IOException ignored) {
                        // уже закрыт
                    }
                }
                epgBusy.set(false);
            }
        }, "iptv-epg").start();
    }

    @PluginMethod
    public void epgStatus(PluginCall call) {
        call.resolve(epgStatusObj(false));
    }

    private static JSObject progJson(EpgIndex.Prog p, boolean withDesc) {
        JSObject o = new JSObject();
        o.put("s", p.s);
        o.put("e", p.e);
        o.put("t", p.t);
        if (withDesc && p.d != null) o.put("d", p.d);
        return o;
    }

    @PluginMethod
    public void epgLookup(PluginCall call) {
        JSArray items = call.getArray("items");
        JSArray res = new JSArray();
        long now = System.currentTimeMillis();
        if (items != null && epg.loaded) {
            for (int i = 0; i < items.length(); i++) {
                try {
                    JSONObject o = items.getJSONObject(i);
                    EpgIndex.Prog[] np = epg.nowNext(o.optString("id", ""), o.optString("name", ""), o.optString("alt", ""), now);
                    if (np == null || (np[0] == null && np[1] == null)) continue;
                    JSObject r = new JSObject();
                    r.put("i", i);
                    if (np[0] != null) r.put("n", progJson(np[0], false));
                    if (np[1] != null) r.put("x", progJson(np[1], false));
                    res.put(r);
                } catch (Exception ignored) {
                    // пропускаем некорректный элемент
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("results", res);
        call.resolve(ret);
    }

    @PluginMethod
    public void epgSchedule(PluginCall call) {
        int limit = Math.max(1, Math.min(1000, call.getInt("limit", 400)));
        EpgIndex.Schedule sc = epg.loaded
                ? epg.schedule(call.getString("id", ""), call.getString("name", ""), call.getString("alt", ""), System.currentTimeMillis(), limit)
                : new EpgIndex.Schedule();
        JSArray arr = new JSArray();
        List<EpgIndex.Prog> list = sc.programs;
        for (EpgIndex.Prog p : list) arr.put(progJson(p, true));
        JSObject ret = new JSObject();
        ret.put("programs", arr);
        ret.put("channel", sc.channelName);
        call.resolve(ret);
    }
}
