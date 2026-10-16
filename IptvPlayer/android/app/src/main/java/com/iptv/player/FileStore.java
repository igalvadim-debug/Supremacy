package com.iptv.player;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Хранилище файлов плейлистов и EPG: папка «Загрузки/IPTV Player».
 * Android 10+ работает через MediaStore (разрешения не нужны, видны файлы, созданные самим приложением),
 * на более старых версиях используется папка приложения в «Загрузках».
 */
class FileStore {
    static final String SUBDIR = "IPTV Player";
    static final String REL_PATH = Environment.DIRECTORY_DOWNLOADS + "/" + SUBDIR + "/";
    static final long MAX_BYTES = 400L * 1024L * 1024L;

    static class Item {
        String name;
        long size;
        long modified;
    }

    private final Context ctx;

    FileStore(Context context) {
        ctx = context.getApplicationContext();
    }

    static boolean allowed(String name) {
        if (name == null) return false;
        String n = name.toLowerCase(Locale.ROOT);
        return n.endsWith(".m3u") || n.endsWith(".m3u8") || n.endsWith(".xml") || n.endsWith(".xml.gz");
    }

    /** Безопасное имя файла: без путей и запрещённых символов. */
    static String clean(String raw) {
        if (raw == null) return null;
        String n = raw;
        int i = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (i >= 0) n = n.substring(i + 1);
        n = n.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        if (n.isEmpty() || n.equals(".") || n.equals("..")) return null;
        return n;
    }

    static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".gz")) return "application/gzip";
        int dot = n.lastIndexOf('.');
        String ext = dot >= 0 ? n.substring(dot + 1) : "";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m != null ? m : "application/octet-stream";
    }

    // ---------- список ----------
    List<Item> list() {
        List<Item> out = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    new String[]{MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED},
                    MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[]{REL_PATH},
                    MediaStore.MediaColumns.DATE_MODIFIED + " DESC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        Item it = new Item();
                        it.name = c.getString(0);
                        it.size = c.getLong(1);
                        it.modified = c.getLong(2) * 1000L;
                        if (it.name != null && allowed(it.name)) out.add(it);
                    }
                }
            }
        } else {
            File[] fs = legacyDir().listFiles();
            if (fs != null) {
                for (File f : fs) {
                    if (f.isFile() && allowed(f.getName())) {
                        Item it = new Item();
                        it.name = f.getName();
                        it.size = f.length();
                        it.modified = f.lastModified();
                        out.add(it);
                    }
                }
            }
            out.sort((a, b) -> Long.compare(b.modified, a.modified));
        }
        return out;
    }

    Item find(String name) {
        if (name == null) return null;
        for (Item it : list()) {
            if (it.name.equals(name)) return it;
        }
        return null;
    }

    // ---------- чтение ----------
    InputStream open(String name) throws IOException {
        if (name == null) return null;
        if (Build.VERSION.SDK_INT >= 29) {
            Uri u = findUri(name);
            if (u == null) return null;
            return ctx.getContentResolver().openInputStream(u);
        }
        File f = new File(legacyDir(), name);
        return f.isFile() ? new FileInputStream(f) : null;
    }

    // ---------- запись ----------
    long write(String name, InputStream in, long len) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            Uri old = findUri(name);
            if (old != null) cr.delete(old, null, null);
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(name));
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, REL_PATH);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("не удалось создать файл");
            long total;
            try (OutputStream out = cr.openOutputStream(uri, "w")) {
                if (out == null) throw new IOException("не удалось открыть файл для записи");
                total = copy(in, out, len);
            } catch (IOException | RuntimeException e) {
                try {
                    cr.delete(uri, null, null);
                } catch (Exception ignored) {
                    // файл уже недоступен
                }
                throw e;
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            return total;
        }
        File dir = legacyDir();
        File tmp = new File(dir, name + ".part");
        File dst = new File(dir, name);
        long total;
        try (OutputStream out = new FileOutputStream(tmp)) {
            total = copy(in, out, len);
        } catch (IOException | RuntimeException e) {
            tmp.delete();
            throw e;
        }
        if (dst.exists()) dst.delete();
        if (!tmp.renameTo(dst)) {
            tmp.delete();
            throw new IOException("не удалось сохранить файл");
        }
        return total;
    }

    boolean delete(String name) {
        if (name == null) return false;
        if (Build.VERSION.SDK_INT >= 29) {
            Uri u = findUri(name);
            return u != null && ctx.getContentResolver().delete(u, null, null) > 0;
        }
        File f = new File(legacyDir(), name);
        return f.isFile() && f.delete();
    }

    // ---------- вспомогательное ----------
    private Uri findUri(String name) {
        try (Cursor c = ctx.getContentResolver().query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                new String[]{REL_PATH, name}, null)) {
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, c.getLong(0));
            }
        }
        return null;
    }

    private File legacyDir() {
        File base = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (base == null) base = ctx.getFilesDir();
        File d = new File(base, SUBDIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static long copy(InputStream in, OutputStream out, long len) throws IOException {
        byte[] buf = new byte[65536];
        long left = len;
        long total = 0;
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) throw new IOException("соединение прервано до конца файла");
            out.write(buf, 0, n);
            left -= n;
            total += n;
        }
        out.flush();
        return total;
    }
}
