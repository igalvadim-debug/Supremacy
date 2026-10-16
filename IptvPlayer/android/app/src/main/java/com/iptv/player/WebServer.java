package com.iptv.player;

import android.content.Context;
import android.net.Uri;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Небольшой HTTP-сервер: загрузка, список, скачивание и удаление плейлистов и EPG по Wi-Fi. */
class WebServer {
    /** Мост в WebView (JS): получает команду JSON, возвращает результат JSON. */
    interface Remote {
        String call(String cmdJson);
    }

    private final Context ctx;
    private final FileStore store;
    private final Remote remote;
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private volatile boolean running;
    private int port;

    WebServer(Context context, FileStore store, Remote remote) {
        this.ctx = context.getApplicationContext();
        this.store = store;
        this.remote = remote;
    }

    String remoteCall(String cmdJson) {
        if (remote == null) return "{\"error\":\"remote unavailable\"}";
        try {
            String r = remote.call(cmdJson);
            return (r == null || r.isEmpty()) ? "{}" : r;
        } catch (Exception e) {
            return "{\"error\":" + jstr(String.valueOf(e.getMessage())) + "}";
        }
    }

    boolean isRunning() {
        return running;
    }

    int getPort() {
        return port;
    }

    /** Запускает сервер на заданном порту, а если он занят или не задан, то на случайном свободном. */
    synchronized int start(int preferred) throws IOException {
        if (running) return port;
        ServerSocket ss = null;
        IOException last = null;
        Random rnd = new Random();
        for (int i = 0; i < 15 && ss == null; i++) {
            int p = (i == 0 && preferred >= 1024 && preferred <= 65535) ? preferred : 20000 + rnd.nextInt(40000);
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p));
                ss = s;
            } catch (IOException e) {
                last = e;
            }
        }
        if (ss == null) throw last != null ? last : new IOException("нет свободного порта");
        serverSocket = ss;
        port = ss.getLocalPort();
        running = true;
        pool = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "iptv-http");
            t.setDaemon(true);
            return t;
        });
        final ServerSocket fss = ss;
        Thread acceptor = new Thread(() -> {
            while (running) {
                try {
                    final Socket s = fss.accept();
                    pool.execute(() -> handle(s));
                } catch (IOException e) {
                    if (!running) break;
                } catch (RejectedExecutionException e) {
                    break;
                }
            }
        }, "iptv-http-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return port;
    }

    synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
            // уже закрыт
        }
        if (pool != null) pool.shutdownNow();
        serverSocket = null;
        pool = null;
    }

    static List<String> addresses() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            while (en != null && en.hasMoreElements()) {
                NetworkInterface ni = en.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // сеть недоступна
        }
        Collections.sort(out, (x, y) -> Integer.compare(rank(x), rank(y)));
        return out;
    }

    private static int rank(String ip) {
        if (ip.startsWith("192.168.")) return 0;
        if (ip.startsWith("10.")) return 1;
        if (ip.startsWith("172.")) return 2;
        return 3;
    }

    // ---------- обработка запросов ----------
    private void handle(Socket s) {
        try {
            s.setSoTimeout(60000);
            s.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(s.getInputStream(), 16384);
            OutputStream out = new BufferedOutputStream(s.getOutputStream(), 16384);
            process(in, out);
            out.flush();
        } catch (Exception ignored) {
            // клиент отключился
        } finally {
            try {
                s.close();
            } catch (IOException ignored) {
                // уже закрыт
            }
        }
    }

    private void process(InputStream in, OutputStream out) throws IOException {
        String reqLine = readLine(in);
        if (reqLine == null || reqLine.isEmpty()) return;
        String[] rp = reqLine.split(" ");
        if (rp.length < 2) {
            sendBytes(out, 400, "Bad Request", "text/plain; charset=utf-8", "bad request".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        String method = rp[0].toUpperCase(Locale.ROOT);
        String target = rp[1];
        Map<String, String> h = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int i = line.indexOf(':');
            if (i > 0) h.put(line.substring(0, i).trim().toLowerCase(Locale.ROOT), line.substring(i + 1).trim());
        }
        String path = target;
        String query = "";
        int qi = target.indexOf('?');
        if (qi >= 0) {
            path = target.substring(0, qi);
            query = target.substring(qi + 1);
        }
        Map<String, String> q = parseQuery(query);

        if (method.equals("OPTIONS")) {
            sendBytes(out, 204, "No Content", "text/plain", new byte[0], null);
        } else if (method.equals("GET") && (path.equals("/") || path.equals("/index.html"))) {
            servePage(out);
        } else if (method.equals("GET") && path.equals("/api/files")) {
            sendJson(out, 200, "OK", filesJson());
        } else if (method.equals("GET") && path.startsWith("/files/")) {
            download(out, Uri.decode(path.substring(7)));
        } else if (method.equals("POST") && path.equals("/api/upload")) {
            upload(in, out, h, q.get("name"));
        } else if (method.equals("DELETE") && path.equals("/api/files")) {
            deleteFile(out, q.get("name"));
        } else if (method.equals("GET") && (path.equals("/remote") || path.equals("/remote/"))) {
            serveAsset(out, "public/remote.html", "Страница пульта не найдена в приложении (пересоберите APK).");
        } else if (method.equals("GET") && path.equals("/api/remote")) {
            sendJson(out, 200, "OK", remoteCall(getQueryJson(q)));
        } else if (method.equals("POST") && path.equals("/api/remote")) {
            remoteCallPost(in, out, h);
        } else if (method.equals("GET") && (path.startsWith("/assets/") || path.startsWith("/vendor/"))) {
            serveStatic(out, "public" + path);
        } else {
            sendBytes(out, 404, "Not Found", "text/plain; charset=utf-8", "не найдено".getBytes(StandardCharsets.UTF_8), null);
        }
    }

    private void servePage(OutputStream out) throws IOException {
        byte[] body;
        try (InputStream is = ctx.getAssets().open("public/server-page.html")) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            body = bo.toByteArray();
        } catch (IOException e) {
            body = "<h1>IPTV Player</h1><p>Страница сервера не найдена в приложении.</p>".getBytes(StandardCharsets.UTF_8);
        }
        sendBytes(out, 200, "OK", "text/html; charset=utf-8", body, null);
    }

    private void serveAsset(OutputStream out, String asset, String fallback) throws IOException {
        byte[] body;
        try (InputStream is = ctx.getAssets().open(asset)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            body = bo.toByteArray();
        } catch (IOException e) {
            body = ("<h1>IPTV Player</h1><p>" + fallback + "</p>").getBytes(StandardCharsets.UTF_8);
        }
        sendBytes(out, 200, "OK", "text/html; charset=utf-8", body, null);
    }

    /**
     * Отдаёт статические ресурсы страниц (JS/CSS/шрифты) из assets: Vite-сборка ссылается на /assets/*.js,
     * без этого маршрута скрипты страницы и пульта не загружались (страница висела на «Загрузка…»).
     * Запросы с «..» отклоняются как 404 (защита от выхода за пределы assets).
     */
    private void serveStatic(OutputStream out, String assetPath) throws IOException {
        byte[] body = null;
        if (assetPath.indexOf("..") < 0) {
            try (InputStream is = ctx.getAssets().open(assetPath)) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                body = bo.toByteArray();
            } catch (IOException ignored) {
                // ресурса нет — вернём 404 ниже
            }
        }
        if (body == null) {
            sendBytes(out, 404, "Not Found", "text/plain; charset=utf-8", "не найдено".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        sendBytes(out, 200, "OK", staticMime(assetPath), body, null);
    }

    /** MIME-тип статики по расширению (для ES-модулей критичен JS-тип, иначе браузер не исполнит скрипт). */
    private static String staticMime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".map") || p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    /** Собирает JSON-команду из query-параметров (cmd + остальные как есть). */
    private static String getQueryJson(Map<String, String> q) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : q.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(jstr(e.getKey())).append(':').append(jstr(e.getValue()));
        }
        return sb.append('}').toString();
    }

    private void remoteCallPost(InputStream in, OutputStream out, Map<String, String> h) throws IOException {
        long len;
        try {
            len = Long.parseLong((h.getOrDefault("content-length", "0")).trim());
        } catch (NumberFormatException e) {
            len = -1;
        }
        if (len < 0 || len > 8L * 1024L * 1024L) {
            sendJson(out, 400, "Bad Request", "{\"error\":\"bad length\"}");
            return;
        }
        byte[] buf = new byte[(int) len];
        int off = 0;
        while (off < len) {
            int n = in.read(buf, off, (int) (len - off));
            if (n < 0) break;
            off += n;
        }
        sendJson(out, 200, "OK", remoteCall(new String(buf, 0, off, StandardCharsets.UTF_8)));
    }

    private String filesJson() {
        StringBuilder sb = new StringBuilder("{\"files\":[");
        boolean first = true;
        for (FileStore.Item it : store.list()) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(jstr(it.name)).append(",\"size\":").append(it.size)
                    .append(",\"modified\":").append(it.modified).append('}');
        }
        sb.append("],\"max\":").append(FileStore.MAX_BYTES).append('}');
        return sb.toString();
    }

    private void download(OutputStream out, String name) throws IOException {
        String clean = FileStore.clean(name);
        FileStore.Item it = clean == null ? null : store.find(clean);
        InputStream fin = it == null ? null : store.open(clean);
        if (it == null || fin == null) {
            sendBytes(out, 404, "Not Found", "text/plain; charset=utf-8", "файл не найден".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        try {
            String ascii = clean.replaceAll("[^\\x20-\\x7E]", "_").replace("\"", "_");
            String enc = URLEncoder.encode(clean, "UTF-8").replace("+", "%20");
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 200 OK\r\n");
            sb.append("Content-Type: ").append(FileStore.mimeFor(clean)).append("\r\n");
            sb.append("Content-Length: ").append(it.size).append("\r\n");
            sb.append("Content-Disposition: attachment; filename=\"").append(ascii).append("\"; filename*=UTF-8''").append(enc).append("\r\n");
            sb.append("Connection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            byte[] buf = new byte[65536];
            int n;
            while ((n = fin.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            try {
                fin.close();
            } catch (IOException ignored) {
                // закрыт
            }
        }
    }

    private void upload(InputStream in, OutputStream out, Map<String, String> h, String rawName) throws IOException {
        String name = FileStore.clean(rawName);
        if (name == null || !FileStore.allowed(name)) {
            sendJson(out, 400, "Bad Request", "{\"ok\":false,\"error\":\"Допустимы только файлы .m3u, .m3u8, .xml и .xml.gz\"}");
            return;
        }
        String cl = h.get("content-length");
        if (cl == null) {
            sendJson(out, 411, "Length Required", "{\"ok\":false,\"error\":\"Не указан размер файла\"}");
            return;
        }
        long len;
        try {
            len = Long.parseLong(cl.trim());
        } catch (NumberFormatException e) {
            sendJson(out, 400, "Bad Request", "{\"ok\":false,\"error\":\"Неверный размер файла\"}");
            return;
        }
        if (len < 0 || len > FileStore.MAX_BYTES) {
            sendJson(out, 413, "Payload Too Large", "{\"ok\":false,\"error\":\"Файл слишком большой\"}");
            return;
        }
        String expect = h.get("expect");
        if (expect != null && expect.toLowerCase(Locale.ROOT).contains("100-continue")) {
            out.write("HTTP/1.1 100 Continue\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        }
        try {
            long saved = store.write(name, in, len);
            sendJson(out, 200, "OK", "{\"ok\":true,\"name\":" + jstr(name) + ",\"size\":" + saved + "}");
        } catch (IOException e) {
            sendJson(out, 500, "Internal Server Error", "{\"ok\":false,\"error\":" + jstr(String.valueOf(e.getMessage())) + "}");
        }
    }

    private void deleteFile(OutputStream out, String rawName) throws IOException {
        String name = FileStore.clean(rawName);
        boolean ok = name != null && store.delete(name);
        sendJson(out, ok ? 200 : 404, ok ? "OK" : "Not Found", "{\"ok\":" + ok + "}");
    }

    // ---------- утилиты ----------
    private static void sendJson(OutputStream out, int code, String reason, String json) throws IOException {
        sendBytes(out, code, reason, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8), null);
    }

    private static void sendBytes(OutputStream out, int code, String reason, String type, byte[] body, String extra) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        sb.append("Content-Type: ").append(type).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Connection: close\r\nCache-Control: no-store\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\n");
        if (extra != null) sb.append(extra);
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (body.length > 0) out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(128);
        int c = 0;
        int n = 0;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
            if (++n > 16384) throw new IOException("строка запроса слишком длинная");
        }
        if (c == -1 && buf.size() == 0) return null;
        return new String(buf.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> m = new HashMap<>();
        if (query == null || query.isEmpty()) return m;
        for (String part : query.split("&")) {
            int i = part.indexOf('=');
            String k = i >= 0 ? part.substring(0, i) : part;
            String v = i >= 0 ? part.substring(i + 1) : "";
            try {
                m.put(URLDecoder.decode(k, "UTF-8"), URLDecoder.decode(v, "UTF-8"));
            } catch (Exception ignored) {
                // пропускаем повреждённый параметр
            }
        }
        return m;
    }

    private static String jstr(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
                    else sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }
}
