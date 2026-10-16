package com.iptv.player;

import android.util.Xml;

import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/** Индекс телепрограммы (XMLTV): потоковый разбор xml / xml.gz, хранится только нужное окно времени и нужные каналы. */
class EpgIndex {
    static class Prog {
        long s;
        long e;
        String t;
        String d;
    }

    static class Schedule {
        String channelName = "";
        List<Prog> programs = new ArrayList<>();
    }

    private static final long BACK_MS = 3L * 24L * 3600L * 1000L;
    private static final long FWD_MS = 36L * 3600L * 1000L;
    private static final int MAX_PER_CHANNEL = 800;
    private static final String[] SUFFIXES = {"fullhd", "fhd", "uhd", "4k", "hd", "sd"};

    private final Object lock = new Object();
    private HashMap<String, ArrayList<Prog>> progs = new HashMap<>();
    private HashMap<String, String> nameToId = new HashMap<>();
    private HashMap<String, String> idToName = new HashMap<>();

    volatile boolean loaded;
    volatile int channels;
    volatile int programmes;
    volatile long loadedAt;
    volatile String source = "";
    volatile String sig = "";

    /** Нормализация названия канала для сопоставления: без скобок, регистра, пробелов и суффиксов качества. */
    static String norm(String s) {
        if (s == null) return "";
        String x = s.toLowerCase(Locale.ROOT).replaceAll("\\([^)]*\\)|\\[[^\\]]*\\]", " ");
        x = x.replaceAll("[^\\p{L}\\p{Nd}]+", "");
        boolean cut = true;
        while (cut && x.length() > 3) {
            cut = false;
            for (String suf : SUFFIXES) {
                if (x.length() - suf.length() >= 2 && x.endsWith(suf)) {
                    x = x.substring(0, x.length() - suf.length());
                    cut = true;
                    break;
                }
            }
        }
        return x;
    }

    void load(InputStream raw, Set<String> wantIds, Set<String> wantNames, String src, String signature) throws Exception {
        BufferedInputStream bin = new BufferedInputStream(raw, 65536);
        bin.mark(4);
        int b1 = bin.read();
        int b2 = bin.read();
        bin.reset();
        InputStream in = (b1 == 0x1f && b2 == 0x8b) ? new GZIPInputStream(bin, 65536) : bin;

        XmlPullParser p = Xml.newPullParser();
        p.setInput(in, null);

        long now = System.currentTimeMillis();
        long minEnd = now - BACK_MS;
        long maxStart = now + FWD_MS;
        boolean filter = wantIds != null && wantNames != null;

        HashMap<String, ArrayList<Prog>> np = new HashMap<>();
        HashMap<String, String> n2i = new HashMap<>();
        HashMap<String, String> i2n = new HashMap<>();
        HashSet<String> accepted = new HashSet<>();

        int ev = p.getEventType();
        while (ev != XmlPullParser.END_DOCUMENT) {
            if (ev == XmlPullParser.START_TAG) {
                String tag = p.getName();
                if ("channel".equals(tag)) {
                    String id = p.getAttributeValue(null, "id");
                    ArrayList<String> names = new ArrayList<>();
                    int depth = p.getDepth();
                    while (true) {
                        ev = p.next();
                        if (ev == XmlPullParser.END_DOCUMENT) break;
                        if (ev == XmlPullParser.END_TAG && p.getDepth() == depth) break;
                        if (ev == XmlPullParser.START_TAG && "display-name".equals(p.getName())) {
                            String nm = p.nextText();
                            if (nm != null && !nm.trim().isEmpty()) names.add(nm.trim());
                        }
                    }
                    if (id != null) {
                        boolean ok = !filter || wantIds.contains(id);
                        if (!ok) {
                            for (String nm : names) {
                                if (wantNames.contains(norm(nm))) {
                                    ok = true;
                                    break;
                                }
                            }
                        }
                        if (ok) {
                            accepted.add(id);
                            for (String nm : names) {
                                String k = norm(nm);
                                if (!k.isEmpty() && !n2i.containsKey(k)) n2i.put(k, id);
                            }
                            if (!names.isEmpty()) i2n.put(id, names.get(0));
                        }
                    }
                } else if ("programme".equals(tag)) {
                    String ch = p.getAttributeValue(null, "channel");
                    long s = parseTime(p.getAttributeValue(null, "start"));
                    long e = parseTime(p.getAttributeValue(null, "stop"));
                    boolean ok = ch != null && s > 0 && e > s && e >= minEnd && s <= maxStart
                            && (!filter || accepted.contains(ch) || wantIds.contains(ch));
                    String title = null;
                    String desc = null;
                    int depth = p.getDepth();
                    while (true) {
                        ev = p.next();
                        if (ev == XmlPullParser.END_DOCUMENT) break;
                        if (ev == XmlPullParser.END_TAG && p.getDepth() == depth) break;
                        if (ev == XmlPullParser.START_TAG && ok) {
                            String n = p.getName();
                            if ("title".equals(n) && title == null) title = p.nextText();
                            else if ("desc".equals(n) && desc == null) desc = p.nextText();
                        }
                    }
                    if (ok && title != null && !title.trim().isEmpty()) {
                        Prog pr = new Prog();
                        pr.s = s;
                        pr.e = e;
                        pr.t = title.trim();
                        if (desc != null) {
                            String dd = desc.trim();
                            pr.d = dd.length() > 400 ? dd.substring(0, 400) + "…" : dd;
                        }
                        ArrayList<Prog> list = np.get(ch);
                        if (list == null) {
                            list = new ArrayList<>();
                            np.put(ch, list);
                        }
                        list.add(pr);
                    }
                }
            }
            ev = p.next();
        }

        int total = 0;
        for (ArrayList<Prog> list : np.values()) {
            Collections.sort(list, (a, b) -> Long.compare(a.s, b.s));
            while (list.size() > MAX_PER_CHANNEL) list.remove(list.size() - 1);
            total += list.size();
        }
        synchronized (lock) {
            progs = np;
            nameToId = n2i;
            idToName = i2n;
        }
        channels = np.size();
        programmes = total;
        loadedAt = System.currentTimeMillis();
        source = src;
        sig = signature;
        loaded = true;
    }

    private String resolve(String id, String name, String alt) {
        if (id != null && !id.isEmpty() && progs.containsKey(id)) return id;
        String k = norm(name);
        if (!k.isEmpty()) {
            String r = nameToId.get(k);
            if (r != null && progs.containsKey(r)) return r;
        }
        k = norm(alt);
        if (!k.isEmpty()) {
            String r = nameToId.get(k);
            if (r != null && progs.containsKey(r)) return r;
        }
        return null;
    }

    /** Текущая и следующая передачи: [текущая или null, следующая или null]; null, если канал не найден. */
    Prog[] nowNext(String id, String name, String alt, long now) {
        synchronized (lock) {
            String ch = resolve(id, name, alt);
            if (ch == null) return null;
            ArrayList<Prog> list = progs.get(ch);
            if (list == null) return null;
            Prog cur = null;
            Prog next = null;
            for (int i = 0; i < list.size(); i++) {
                Prog pr = list.get(i);
                if (pr.e <= now) continue;
                if (pr.s <= now) {
                    cur = pr;
                    if (i + 1 < list.size()) next = list.get(i + 1);
                } else {
                    next = pr;
                }
                break;
            }
            return new Prog[]{cur, next};
        }
    }

    /** Ближайшие передачи канала, начиная с текущей. */
    Schedule schedule(String id, String name, String alt, long now, int limit) {
        Schedule sc = new Schedule();
        synchronized (lock) {
            String ch = resolve(id, name, alt);
            if (ch == null) return sc;
            String nm = idToName.get(ch);
            sc.channelName = nm != null ? nm : "";
            ArrayList<Prog> list = progs.get(ch);
            if (list == null) return sc;
            for (Prog pr : list) {
                sc.programs.add(pr);
                if (sc.programs.size() >= limit) break;
            }
        }
        return sc;
    }

    // ---------- время XMLTV: 20261008120000 +0200 ----------
    static long parseTime(String v) {
        if (v == null) return -1;
        v = v.trim();
        int sp = v.indexOf(' ');
        String dt = sp > 0 ? v.substring(0, sp) : v;
        String tz = sp > 0 ? v.substring(sp + 1).trim().replace(":", "") : "";
        if (dt.length() < 12) return -1;
        try {
            int y = Integer.parseInt(dt.substring(0, 4));
            int mo = Integer.parseInt(dt.substring(4, 6));
            int d = Integer.parseInt(dt.substring(6, 8));
            int h = Integer.parseInt(dt.substring(8, 10));
            int mi = Integer.parseInt(dt.substring(10, 12));
            int sc = dt.length() >= 14 ? Integer.parseInt(dt.substring(12, 14)) : 0;
            long t = daysFromCivil(y, mo, d) * 86400L + h * 3600L + mi * 60L + sc;
            if (tz.length() >= 5 && (tz.charAt(0) == '+' || tz.charAt(0) == '-')) {
                long off = Integer.parseInt(tz.substring(1, 3)) * 3600L + Integer.parseInt(tz.substring(3, 5)) * 60L;
                t -= (tz.charAt(0) == '-') ? -off : off;
            }
            return t * 1000L;
        } catch (Exception e) {
            return -1;
        }
    }

    private static long daysFromCivil(int y, int m, int d) {
        y -= m <= 2 ? 1 : 0;
        long era = (y >= 0 ? y : y - 399) / 400;
        long yoe = y - era * 400;
        long doy = (153L * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }
}
