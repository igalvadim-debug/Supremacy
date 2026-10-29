#!/usr/bin/env node
// iptv-server.mjs — Linux-сервер IPTV Player.
//
// Заменяет нативную Android-часть (WebServer.java / IptvNativePlugin.java) на Node.js:
//   * отдаёт собранное веб-приложение (dist/) и статику (assets/, vendor/);
//   * реализует API пульта Remote Supremacy (/api/remote, GET+POST) — команды буферизуются
//     («Remote-Pulse») и забираются страницей плеера через /native/pulse; страница отвечает
//     снимком состояния из window.RemoteAPI.handle() (см. src/index.ts);
//   * файловая папка /files (плейлисты .m3u/.m3u8 и EPG .xml/.xml.gz) — по образцу FileStore.java;
//   * EPG-мост (индекс XMLTV): /native/epg/load|lookup|schedule — по образцу EpgIndex.java;
//   * воспроизведение внешнего плеером: mpv (при наличии, с IPC для pause/resume), иначе ffplay.
//
// Использование:
//   node scripts/iptv-server.mjs [--port 8080] [--host 0.0.0.0] [--data DIR] [--root DIR] [--no-open]
// Переменные окружения: IPTV_DATA_DIR, IPTV_DIST_DIR, IPTV_PLAYER (mpv|ffplay|auto|off), IPTV_PORT.
//
// Модуль можно импортировать в тестах: startServer(options) возвращает { port, close }.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/* ================= константы (по образцу Java-версии) ================= */
export const MAX_UPLOAD_BYTES = 400L * 1024L * 1024L;   // FileStore.MAX_BYTES
export const MAX_READ_BYTES = 30L * 1024L * 1024L;      // IptvNativePlugin.MAX_PLAYLIST_BYTES
export const PULSE_TIMEOUT_MS = 6000;                   // как latch.await(6 s) в callJs()
const BACK_MS = 3 * 24 * 3600 * 1000;                   // окно EPG: назад
const FWD_MS = 36 * 3600 * 1000;                        // окно EPG: вперёд
const MAX_PER_CHANNEL = 800;
const EPG_TTL_MS = 6 * 3600 * 1000;                     // epgLoad: не перечитывать 6 часов при том же sig
const SUFFIXES = ['fullhd', 'fhd', 'uhd', '4k', 'hd', 'sd'];
const UA = 'IPTVPlayer/1.0 (Linux)';

/* ================= утилиты ================= */

/** Безопасное имя файла: без путей и запрещённых символов (аналог FileStore.clean). */
export function cleanName(raw) {
  if (raw == null) return null;
  let n = String(raw);
  const i = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
  if (i >= 0) n = n.slice(i + 1);
  n = n.replace(/[\\/:*?"<>|\p{Cntrl}]/gu, '_').trim();
  if (n.length > 120) n = n.slice(-120);
  if (!n || n === '.' || n === '..') return null;
  return n;
}

/** Допустимые расширения хранилища (аналог FileStore.allowed). */
export function allowedName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return n.endsWith('.m3u') || n.endsWith('.m3u8') || n.endsWith('.xml') || n.endsWith('.xml.gz');
}

/** MIME для загрузки файла (аналог FileStore.mimeFor). */
export function mimeForDownload(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith('.gz')) return 'application/gzip';
  if (n.endsWith('.m3u8')) return 'application/x-mpegurl';
  if (n.endsWith('.m3u')) return 'audio/x-mpegurl';
  if (n.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

/** MIME статики; для ES-модулей критичен JS-тип (аналог WebServer.staticMime). */
export function staticMime(p) {
  const x = String(p).toLowerCase();
  if (x.endsWith('.js') || x.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (x.endsWith('.css')) return 'text/css; charset=utf-8';
  if (x.endsWith('.map') || x.endsWith('.json')) return 'application/json; charset=utf-8';
  if (x.endsWith('.svg')) return 'image/svg+xml';
  if (x.endsWith('.png')) return 'image/png';
  if (x.endsWith('.jpg') || x.endsWith('.jpeg')) return 'image/jpeg';
  if (x.endsWith('.gif')) return 'image/gif';
  if (x.endsWith('.ico')) return 'image/x-icon';
  if (x.endsWith('.woff2')) return 'font/woff2';
  if (x.endsWith('.woff')) return 'font/woff';
  if (x.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

/** Локальные IPv4-адресы (без loopback), приоритет частотных сетей — как WebServer.addresses(). */
export function localAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  const rank = (ip) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
  out.sort((x, y) => rank(x) - rank(y));
  return out;
}

/** Разбор query-строки в объект (последнее значение выигрывает). */
export function parseQuery(q) {
  const m = {};
  if (!q) return m;
  for (const part of String(q).split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i >= 0 ? part.slice(0, i) : part;
    const v = i >= 0 ? part.slice(i + 1) : '';
    try { m[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')); }
    catch (e) { /* пропускаем повреждённый параметр */ }
  }
  return m;
}

/** Нормализация названия канала для сопоставления EPG (аналог EpgIndex.norm). */
export function normName(s) {
  if (s == null) return '';
  let x = String(s).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  x = x.replace(/[^\p{L}\p{Nd}]+/gu, '');
  let cut = true;
  while (cut && x.length > 3) {
    cut = false;
    for (const suf of SUFFIXES) {
      if (x.length - suf.length >= 2 && x.endsWith(suf)) { x = x.slice(0, x.length - suf.length); cut = true; break; }
    }
  }
  return x;
}

/** Время XMLTV «20261008120000 +0200» → unix ms; -1 при ошибке (аналог EpgIndex.parseTime). */
export function parseXmltvTime(v) {
  if (!v) return -1;
  let s = String(v).trim();
  const sp = s.indexOf(' ');
  const dt = sp > 0 ? s.slice(0, sp) : s;
  const tz = sp > 0 ? s.slice(sp + 1).trim().replace(':', '') : '';
  if (dt.length < 12) return -1;
  const y = +dt.slice(0, 4), mo = +dt.slice(4, 6), d = +dt.slice(6, 8);
  const h = +dt.slice(8, 10), mi = +dt.slice(10, 12);
  const sec = dt.length >= 14 ? +dt.slice(12, 14) : 0;
  if ([y, mo, d, h, mi].some((x) => !Number.isFinite(x))) return -1;
  let offMin = 0;
  if (/^[+-]\d{4}$/.test(tz)) offMin = (tz[0] === '-' ? -1 : 1) * (+tz.slice(1, 3) * 60 + +tz.slice(3, 5));
  return Date.UTC(y, mo - 1, d, h, mi, sec) - offMin * 60000;
}

/** Потоговый разбор XMLTV: возвращает [{id, names[]}] и [{c,s,e,t,d}] (аналог EpgIndex.load). */
export function parseXmltv(xml) {
  const channels = [];
  const programmes = [];
  const stack = [];
  let curChannel = null, channelNames = null, inDisplayName = false;
  let prog = null, progTitle = null, progDesc = null, inTitle = false, inDesc = false;
  const textBuf = () => (stack.length ? stack[stack.length - 1].text : '');
  const pushText = (t) => { if (stack.length) stack[stack.length - 1].text += t; };

  const attrsOf = (tagOpen) => {
    const attrs = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
    let mm;
    while ((mm = re.exec(tagOpen))) {
      if (mm[1] !== undefined) attrs[mm[1].toLowerCase()] = mm[2];
      else attrs[mm[3].toLowerCase()] = mm[4];
    }
    return attrs;
  };
  const endElement = (name) => {
    const top = stack[stack.length - 1];
    if (!top || top.name !== name) return;
    const entry = stack.pop();
    const text = entry.text.trim();
    if (inDisplayName && name === 'display-name' && text) channelNames.push(text);
    if (name === 'channel' && curChannel) { channels.push(curChannel); curChannel = null; channelNames = null; inDisplayName = false; }
    if (inTitle && name === 'title' && prog && !progTitle) progTitle = text;
    if (inDesc && name === 'desc' && prog && !progDesc) progDesc = text;
    if (name === 'programme' && prog) {
      if (progTitle && progTitle.trim()) {
        programmes.push({ c: prog.c, s: prog.s, e: prog.e, t: progTitle.trim(), d: progDesc ? progDesc.trim() : null });
      }
      prog = null; progTitle = null; progDesc = null; inTitle = false; inDesc = false;
    }
    if (entry.name === 'channel') inDisplayName = false;
    if (entry.name === 'programme') { inTitle = false; inDesc = false; }
  };
  const startElement = (name, attrs, selfClose) => {
    stack.push({ name, text: '' });
    if (name === 'channel' && !curChannel) {
      channelNames = [];
      curChannel = { id: attrs['id'] || '', names: channelNames };
      if (selfClose) { channels.push(curChannel); curChannel = null; }
    } else if (name === 'programme' && !prog) {
      prog = { c: attrs['channel'] || '', s: parseXmltvTime(attrs['start']), e: parseXmltvTime(attrs['stop']) };
      if (selfClose) { prog = null; }
    }
    if (name === 'display-name') inDisplayName = true;
    if (name === 'title') inTitle = true;
    if (name === 'desc') inDesc = true;
  };

  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
  let last = 0, mm;
  while ((mm = re.exec(xml))) {
    if (mm.index > last) pushText(xml.slice(last, mm.index));
    last = re.lastIndex;
    if (mm[0][1] === '/' || mm[0].startsWith('</')) { endElement(mm[1]); continue; }
    if (mm[2]) { startElement(mm[2], attrsOf(mm[3] || ''), mm[4] === '/'); continue; }
    // комментарии / PI / CDATA — текст не добавляем
  }
  if (last < xml.length) pushText(xml.slice(last));
  return { channels, programmes };
}

/** Индекс телепрограммы в памяти (Linux-аналог EpgIndex.java). */
export class EpgIndex {
  constructor() {
    this.loaded = false; this.channels = 0; this.programmes = 0; this.loadedAt = 0;
    this.source = ''; this.sig = '';
    this.progs = new Map();      // id -> Prog[] (отсортированы по s)
    this.nameToId = new Map();   // norm(display-name) -> id
    this.idToName = new Map();   // id -> первое display-name
  }
  /** Собирает индекс из текста XMLTV; wantIds/wantNames — фильтры (как в нативной версии). */
  load(xml, wantIds, wantNames, src, signature) {
    const parsed = parseXmltv(xml);
    const now = Date.now(), minEnd = now - BACK_MS, maxStart = now + FWD_MS;
    const filter = wantIds != null && wantNames != null;
    const idSet = new Set(wantIds || []), nameSet = new Set(wantNames || []);
    const accepted = new Set();
    const progs = new Map(), nameToId = new Map(), idToName = new Map();
    for (const ch of parsed.channels) {
      if (!ch.id) continue;
      let ok = !filter || idSet.has(ch.id);
      if (!ok) for (const nm of ch.names) if (nameSet.has(normName(nm))) { ok = true; break; }
      if (!ok) continue;
      accepted.add(ch.id);
      for (const nm of ch.names) {
        const k = normName(nm);
        if (k && !nameToId.has(k)) nameToId.set(k, ch.id);
      }
      if (ch.names.length) idToName.set(ch.id, ch.names[0]);
    }
    let total = 0;
    for (const p of parsed.programmes) {
      const ok = p.c && p.s > 0 && p.e > p.s && p.e >= minEnd && p.s <= maxStart &&
        (!filter || accepted.has(p.c) || idSet.has(p.c));
      if (!ok || !p.t) continue;
      let list = progs.get(p.c);
      if (!list) { list = []; progs.set(p.c, list); }
      list.push({ s: p.s, e: p.e, t: p.t, d: p.d ? (p.d.length > 400 ? p.d.slice(0, 400) + '…' : p.d) : null });
    }
    for (const list of progs.values()) {
      list.sort((a, b) => a.s - b.s);
      if (list.length > MAX_PER_CHANNEL) list.length = MAX_PER_CHANNEL;
      total += list.size !== undefined ? list.size : list.length;
    }
    this.progs = progs; this.nameToId = nameToId; this.idToName = idToName;
    this.channels = progs.size; this.programmes = total;
    this.loadedAt = Date.now(); this.source = src || ''; this.sig = signature || '';
    this.loaded = true;
  }
  reset() {
    this.loaded = false; this.channels = 0; this.programmes = 0; this.loadedAt = 0;
    this.source = ''; this.sig = '';
    this.progs = new Map(); this.nameToId = new Map(); this.idToName = new Map();
  }
  resolve(id, name, alt) {
    if (id && this.progs.has(id)) return id;
    let k = normName(name);
    if (k) { const r = this.nameToId.get(k); if (r && this.progs.has(r)) return r; }
    k = normName(alt);
    if (k) { const r = this.nameToId.get(k); if (r && this.progs.has(r)) return r; }
    return null;
  }
  /** [текущая|null, следующая|null]; null, если канал не найден. */
  nowNext(id, name, alt, now) {
    const ch = this.resolve(id, name, alt);
    if (!ch) return null;
    const list = this.progs.get(ch);
    if (!list) return null;
    let cur = null, next = null;
    for (let i = 0; i < list.length; i++) {
      const pr = list[i];
      if (pr.e <= now) continue;
      if (pr.s <= now) { cur = pr; if (i + 1 < list.length) next = list[i + 1]; }
      else { next = pr; }
      break;
    }
    return [cur, next];
  }
  /** Ближайшие передачи канала, начиная с текущей. */
  schedule(id, name, alt, now, limit) {
    const sc = { channelName: '', programs: [] };
    const ch = this.resolve(id, name, alt);
    if (!ch) return sc;
    sc.channelName = this.idToName.get(ch) || '';
    const list = this.progs.get(ch) || [];
    for (const pr of list) {
      if (pr.e >= now) { sc.programs.push(pr); if (sc.programs.length >= limit) break; }
    }
    return sc;
  }
}

/* ================= внешний плеер (mpv / ffplay) ================= */

/** Открывает сокет Unix-IPC mpv (обёртка над async-итератором net.Socket). */
async function connectIpc(sockPath) {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ipc timeout')), 3000);
    const onOk = () => { clearTimeout(t); sock.off('error', onErr); res(); };
    const onErr = () => { clearTimeout(t); rej(new Error('ipc unavailable')); };
    sock.once('connect', onOk);
    sock.once('error', onErr);
    sock.connect(sockPath);
  });
  let buf = '';
  const pending = new Map();
  let seq = 0;
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch (e) { continue; }
      const cb = obj.request_id != null ? pending.get(obj.request_id) : null;
      if (cb) { pending.delete(obj.request_id); cb(obj.error === 'success' || obj.error === 'idle'); }
    }
  });
  const send = (cmdArr) => new Promise((res) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); res(false); }, 2000);
    pending.set(id, (ok) => { clearTimeout(timer); res(ok); });
    sock.write(JSON.stringify({ command: cmdArr, request_id: id }) + '\n');
  });
  const close = () => { try { sock.destroy(); } catch (e) { /* ignore */ } };
  return { send, close };
}

export class ExternalPlayer {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.state = 'idle';       // idle | buffering | playing | paused | ended | error
    this.message = '';
    this.status = 0;           // код завершения процесса
    this.proc = null;
    this.ipc = null;
    this.ipcPath = '';
    this._watchdog = null;
    this._session = 0;
  }
  _setState(s, message, status) {
    this.state = s;
    this.message = message || '';
    if (status !== undefined) this.status = status; else if (s !== 'error') this.status = 0;
  }
  _armWatchdog(session) {
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (session === this._session && this.state === 'buffering') this._setState('playing');
    }, 5000);
  }
  _cleanupProcess() {
    if (this.ipc) { try { this.ipc.close(); } catch (e) { /* ignore */ } this.ipc = null; }
    if (this.proc) {
      const p = this.proc; this.proc = null;
      try { p.kill('SIGTERM'); } catch (e) { /* уже завершён */ }
      try { p.unref(); } catch (e) { /* ignore */ }
    }
    if (this.ipcPath) { try { fs.unlinkSync(this.ipcPath); } catch (e) { /* нет файла */ } this.ipcPath = ''; }
  }
  /** Запускает url внешним плеером; mpv предпочитается из-за IPC (pause/resume). */
  async play(url, bufferMs, preferredBin) {
    if (!url) throw new Error('не указан url');
    const session = ++this._session;
    this._cleanupProcess();
    this._setState('buffering');
    const bin = preferredBin === 'ffplay' ? 'ffplay' : 'mpv';
    try {
      if (bin === 'mpv') {
        const ipcPath = path.join(this.dataDir, 'mpv-ipc-' + process.pid + '-' + session + '.sock');
        const proc = spawn('mpv', [
          '--no-video' , '--really-quiet', '--force-window=no',
          '--input-ipc-server=' + ipcPath,
          '--cache=yes', '--demuxer-max-bytes=' + Math.max(1 << 20, (bufferMs || 1500) * 1000),
          url
        ], { stdio: 'ignore' });
        this.proc = proc; this.ipcPath = ipcPath;
        proc.on('exit', (code) => {
          if (session !== this._session) return;
          this._setState(code === 0 || code == null ? 'ended' : 'error', code ? 'плеер завершился с кодом ' + code : '', code == null ? 0 : code);
          this._cleanupProcess();
        });
        proc.on('error', () => {
          if (session !== this._session) return;
          this._setState('error', 'mpv не найден в PATH');
        });
        // ждём IPC-сокет (появляется после старта mpv), затем подключаемся
        const appeared = await new Promise((res) => {
          let tries = 0;
          const t = setInterval(() => {
            if (fs.existsSync(ipcPath)) { clearInterval(t); res(true); }
            else if (++tries > 20 || session !== this._session) { clearInterval(t); res(false); }
          }, 100);
        });
        if (session !== this._session) return { ok: false };
        if (appeared) {
          try {
            const sock = net.createConnection();
            this.ipc = await connectIpc(sock);
            const st = await this.ipc.send(['get_property', 'pausing']);
            if (st) this._setState('playing');
          } catch (e) { this.ipc = null; }
        }
        if (this.state === 'buffering') this._armWatchdog(session);
      } else {
        const args = ['-nodisp', '-loglevel', 'quiet', '-autoexit'];
        if (bufferMs) args.push('-fflags', '+genpts');
        args.push(url);
        const proc = spawn('ffplay', args, { stdio: 'ignore' });
        this.proc = proc;
        proc.on('exit', (code) => {
          if (session !== this._session) return;
          this._setState(code === 0 || code == null ? 'ended' : 'error', '', code == null ? 0 : code);
        });
        proc.on('error', () => {
          if (session !== this._session) return;
          this._setState('error', 'ffplay не найден в PATH');
        });
        this._armWatchdog(session);
      }
      return { ok: true };
    } catch (e) {
      this._setState('error', String(e && e.message || e));
      throw e;
    }
  }
  async pause() {
    if (this.ipc) { const ok = await this.ipc.send(['set_property', 'pause', true]); if (ok) { this._setState('paused'); return; } }
    if (this.proc) { try { this.proc.kill('SIGSTOP'); } catch (e) { /* ignore */ } }
    this._setState('paused');
  }
  async resume() {
    if (this.ipc) { const ok = await this.ipc.send(['set_property', 'pause', false]); if (ok) { this._setState('playing'); return; } }
    if (this.proc) { try { this.proc.kill('SIGCONT'); } catch (e) { /* ignore */ } }
    this._setState('playing');
  }
  stop() {
    this._session++;
    clearTimeout(this._watchdog);
    this._cleanupProcess();
    this._setState('idle');
  }
  getState() { return { state: this.state, message: this.message, status: this.status }; }
}

/* ================= файловое хранилище (аналог FileStore.java) ================= */

export class FileStore {
  constructor(dir) { this.dir = dir; }
  p(name) { return path.join(this.dir, name); }
  list() {
    let fs_;
    try { fs_ = fs.readdirSync(this.dir, { withFileTypes: true }); } catch (e) { return []; }
    const out = [];
    for (const d of fs_) {
      if (!d.isFile() || !allowedName(d.name)) continue;
      try {
        const st = fs.statSync(this.p(d.name));
        out.push({ name: d.name, size: st.size, modified: st.mtimeMs });
      } catch (e) { /* файл исчез */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  find(name) {
    try {
      const st = fs.statSync(this.p(name));
      if (!st.isFile()) return null;
      return { name, size: st.size, modified: st.mtimeMs };
    } catch (e) { return null; }
  }
  open(name) {
    try { return fs.createReadStream(this.p(name)); } catch (e) { return null; }
  }
  async write(name, source, declaredLen) {
    if (!allowedName(name)) throw new Error('Допустимы только файлы .m3u, .m3u8, .xml и .xml.gz');
    if (declaredLen != null && (declaredLen < 0 || declaredLen > MAX_UPLOAD_BYTES)) throw new Error('Файл слишком большой');
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = this.p('.' + name + '.part-' + Date.now());
    let written = 0;
    const ws = fs.createWriteStream(tmp);
    try {
      await new Promise((res, rej) => {
        source.on('data', (c) => {
          written += c.length;
          if (written > MAX_UPLOAD_BYTES) { rej(new Error('Файл слишком большой')); source.destroy(); return; }
          if (!ws.write(c)) { /* backpressure обрабатывается drain ниже */ }
        });
        source.on('end', () => ws.end(() => res()));
        source.on('error', rej);
        ws.on('error', rej);
      });
      await fsp.rename(tmp, this.p(name));
      return written;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (x) { /* нет файла */ }
      throw e;
    }
  }
  async writeText(name, text) {
    if (!allowedName(name)) throw new Error('Неверное имя файла');
    await fsp.mkdir(this.dir, { recursive: true });
    const buf = Buffer.from(String(text), 'utf8');
    await fsp.writeFile(this.p(name), buf);
    return buf.length;
  }
  async delete(name) {
    try { await fsp.unlink(this.p(name)); return true; } catch (e) { return false; }
  }
  async readText(name) {
    const st = this.find(name);
    if (!st) throw new Error('Файл не найден: ' + name);
    if (st.size > MAX_READ_BYTES) throw new Error('Файл слишком большой для плейлиста');
    let buf = await fsp.readFile(this.p(name));
    if (name.toLowerCase().endsWith('.gz')) buf = zlib.gunzipSync(buf);
    return buf.toString('utf8');
  }
}

/* ================= сервер ================= */

/**
 * Создаёт сервер. options: { root?, dist?, filesDir?, stateFile?, webPort?, nativePort?, playerMode? ('auto'|'off'|'mpv'|'ffplay') }
 * Возвращает { handler, pulseQueue, store, epg, player, web:{running,port}, loadState, saveState, close }.
 */
export function createServer(options = {}) {
  const root = path.resolve(options.root || PROJECT_ROOT);
  const dist = path.resolve(options.dist || path.join(root, 'dist'));
  const filesDir = path.resolve(options.filesDir || path.join(os.homedir?.() || root, '.iptv-player', 'files'));
  const stateFile = path.resolve(options.stateFile || path.join(os.homedir?.() || root, '.iptv-player', 'state.json'));
  const store = new FileStore(filesDir);
  const epg = new EpgIndex();
  const player = new ExternalPlayer(path.dirname(stateFile));
  const playerMode = options.playerMode || process.env.IPTV_PLAYER || 'auto';
  const usePlayer = playerMode !== 'off';
  const pulseQueue = [];   // команды пульта; страница забирает их через /native/pulse
  const pendingPulse = new Map(); // id выданной команды -> entry (ждёт результат от страницы)
  let pulseIdSeq = 0;

  let web = { running: true, port: Number(options.webPort || 0), addresses: localAddresses() };

  /* ---- состояние, переживающее перезапуск (аналог SharedPreferences) ---- */
  let persisted = { autostart: true, serverOn: true, serverPort: Number(options.nativePort || web.port || 8080) };
  function loadState() {
    try {
      const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (j && typeof j === 'object') persisted = Object.assign(persisted, j);
    } catch (e) { /* первое использование */ }
    return persisted;
  }
  function saveState() {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(persisted));
    } catch (e) { /* каталог недоступен — работаем без персистентности */ }
  }
  loadState();

  function statusObj() {
    return { running: web.running, port: web.running ? web.port : 0, addresses: web.addresses.slice() };
  }

  function pickPlayerBin() {
    if (playerMode === 'ffplay') return 'ffplay';
    return 'mpv'; // mpv предпочтителен (IPC); при его отсутствии процесс умрёт с error-событием
  }

  /* ---------- remote-pulse: команды /api/remote → очередь → /native/pulse ---------- */
  /** Ставит команду в очередь и ждёт ответа страницы плеера (или таймаута, как latch в callJs). */
  function enqueuePulse(cmd) {
    return new Promise((resolve) => {
      const entry = { cmd, done: false };
      entry.promise = new Promise((res) => {
        entry.settle = (v) => { if (!entry.done) { entry.done = true; res(v); } };
      });
      // связываем внешний resolve с внутренним settle
      entry.promise.then(resolve);
      pulseQueue.push(entry);
      const timer = setTimeout(() => {
        const i = pulseQueue.indexOf(entry);
        if (i >= 0) pulseQueue.splice(i, 1);
        for (const [id, e] of pendingPulse) if (e === entry) pendingPulse.delete(id);
        entry.settle({ ok: false, error: 'нет связи со страницей плеера' });
      }, PULSE_TIMEOUT_MS);
      entry.promise.then(() => clearTimeout(timer));
    });
  }

  /* ---------- ответы ---------- */
  function send(res, code, type, body, extraHeaders) {
    const headers = Object.assign({
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }, extraHeaders || {});
    res.writeHead(code, headers);
    res.end(body);
  }
  const sendJson = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(obj), 'utf8'));
  const sendErr = (res, code, message) => sendJson(res, code, { ok: false, error: message });

  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let len = 0;
      req.on('data', (c) => {
        len += c.length;
        if (len > max) { reject(new Error('слишком большое тело запроса')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function parseJsonBody(req) {
    const buf = await readBody(req, 8 * 1024 * 1024);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('некорректный JSON'); }
  }

  /* ---------- статика ---------- */
  function serveStaticFile(res, absPath) {
    let data;
    try { data = fs.readFileSync(absPath); }
    catch (e) { send(res, 404, 'text/plain; charset=utf-8', 'не найдено'); return; }
    send(res, 200, staticMime(absPath), data);
  }
  function servePage(res, page) {
    // dist — приоритет (сборка npm run build); dev — исходники Vite (index.html подключает /src/…)
    const candidates = [path.join(dist, page), path.join(root, page)];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        let html = fs.readFileSync(c, 'utf8');
        if (page === 'index.html') html = injectBridge(html);
        send(res, 200, 'text/html; charset=utf-8', html);
        return;
      }
    }
    send(res, 404, 'text/plain; charset=utf-8', 'не найдено');
  }
  /** Вставляет linux-bridge.js и window.IPTV_BRIDGE в страницу плеера (см. global.d.ts). */
  function injectBridge(html) {
    let bridgeSrc = '';
    try { bridgeSrc = fs.readFileSync(path.join(root, 'scripts', 'linux-bridge.js'), 'utf8'); }
    catch (e) { bridgeSrc = '/* linux-bridge.js не найден */'; }
    const port = web.port || 8080;
    const head = '<script>window.IPTV_BRIDGE={playerBase:"http://127.0.0.1:' + port + '/"};</script>\n' +
      '<script>' + bridgeSrc.replace(/<\/script>/gi, '<\\/script>') + '</script>';
    if (/<head>/i.test(html)) return html.replace(/<head>/i, '<head>\n' + head);
    return head + '\n' + html;
  }

  /* ---------- native API ---------- */
  async function handleNative(req, res, method, pathname, query) {
    const seg = pathname.split('/').filter(Boolean); // ['native', ...]
    const key = seg.slice(1).join('/');

    if (method === 'OPTIONS') { send(res, 204, 'text/plain', ''); return; }

    /* --- файлы --- */
    if (key === 'files' && method === 'GET') { sendJson(res, 200, { files: store.list(), max: MAX_UPLOAD_BYTES }); return; }
    if (key.startsWith('files/')) {
      const name = cleanName(decodeURIComponent(seg[2] || ''));
      if (!name) { sendErr(res, 400, 'Не указано имя файла'); return; }
      if (method === 'GET') {
        let text;
        try { text = await store.readText(name); }
        catch (e) { sendErr(res, 404, e.message); return; }
        sendJson(res, 200, { text });
        return;
      }
      if (method === 'PUT') {
        const body = await parseJsonBody(req);
        try {
          const size = await store.writeText(name, body.text != null ? body.text : '');
          sendJson(res, 200, { ok: true, size });
        } catch (e) { sendErr(res, 400, e.message); }
        return;
      }
      if (method === 'DELETE') {
        const ok = await store.delete(name);
        sendJson(res, ok ? 200 : 404, 'application/json; charset=utf-8', JSON.stringify({ ok }));
        return;
      }
    }

    /* --- сервер (на Linux всегда запущен; статус — для UI) --- */
    if (key === 'server/status') { sendJson(res, 200, statusObj()); return; }
    if (key === 'server/start' && method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      const p = parseInt(body.port, 10);
      if (p >= 1024 && p <= 65535) { persisted.serverPort = p; persisted.serverOn = true; saveState(); }
      sendJson(res, 200, statusObj());
      return;
    }
    if (key === 'server/stop' && method === 'POST') {
      persisted.serverOn = false; saveState();
      sendJson(res, 200, statusObj());
      return;
    }

    /* --- автозапуск / кэш --- */
    if (key === 'autostart' && method === 'GET') { sendJson(res, 200, { on: !!persisted.autostart }); return; }
    if (key === 'autostart' && method === 'POST') {
      const body = await parseJsonBody(req);
      persisted.autostart = !!body.on; saveState();
      sendJson(res, 200, { on: persisted.autostart });
      return;
    }
    if (key === 'cache/clear' && method === 'POST') {
      // чистим только временные файлы (сокеты mpv и т.п.) — настройки и загрузки не трогаем
      let freed = 0;
      try {
        for (const f of fs.readdirSync(path.dirname(stateFile))) {
          if (!f.startsWith('mpv-ipc-')) continue;
          const fp = path.join(path.dirname(stateFile), f);
          try { freed += fs.statSync(fp).size; fs.unlinkSync(fp); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      sendJson(res, 200, { freed });
      return;
    }

    /* --- плеер --- */
    if (key === 'player/state') { sendJson(res, 200, player.getState()); return; }
    if (key === 'player/play' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.url) { sendErr(res, 400, 'не указан url'); return; }
      if (!usePlayer) { sendJson(res, 200, { ok: false, error: 'внешний плеер отключён (--player off)' }); return; }
      try { await player.play(String(body.url), Number(body.bufferMs) || 1500, pickPlayerBin()); sendJson(res, 200, { ok: true }); }
      catch (e) { sendErr(res, 500, e.message); }
      return;
    }
    if (key === 'player/pause' && method === 'POST') { await player.pause(); sendJson(res, 200, { ok: true }); return; }
    if (key === 'player/resume' && method === 'POST') { await player.resume(); sendJson(res, 200, { ok: true }); return; }
    if (key === 'player/stop' && method === 'POST') { player.stop(); sendJson(res, 200, { ok: true }); return; }

    /* --- remote-pulse: клиент забирает команды пульта и возвращает результаты --- */
    if (key === 'pulse' && method === 'GET') {
      const limit = Math.max(1, Math.min(50, parseInt(query.limit, 10) || 10));
      const taken = pulseQueue.splice(0, limit);
      const commands = [];
      for (const entry of taken) {
        const id = ++pulseIdSeq;
        pendingPulse.set(id, entry);
        // если страница так и не ответит — таймаут enqueuePulse очистит очередь и pendingPulse
        commands.push({ id, cmd: entry.cmd });
      }
      sendJson(res, 200, { ok: true, commands });
      return;
    }
    if (key === 'result' && method === 'POST') {
      // страница плеера отвечает на забранные команды: [{ id, result }]
      const body = await parseJsonBody(req);
      const list = Array.isArray(body) ? body : (Array.isArray(body.results) ? body.results : []);
      for (const r of list) {
        if (!r || r.id == null) continue;
        const entry = pendingPulse.get(Number(r.id));
        if (entry) { pendingPulse.delete(Number(r.id)); entry.settle(r.result && typeof r.result === 'object' ? r.result : { ok: false, error: 'пустой ответ' }); }
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    /* --- EPG --- */
    if (key === 'epg/load' && method === 'POST') {
      const body = await parseJsonBody(req);
      const force = !!body.force;
      if (!force && epg.loaded && String(body.sig || '') === epg.sig && Date.now() - epg.loadedAt < EPG_TTL_MS) {
        sendJson(res, 200, epgStatus(true)); return;
      }
      let xml = '';
      try {
        if (body.source === 'file' && body.name) {
          const nm = cleanName(String(body.name));
          if (!nm) throw new Error('Неверное имя файла EPG');
          xml = await store.readText(nm);
        } else if (body.url) {
          xml = await fetchText(String(body.url));
        } else throw new Error('не указана ссылка на EPG');
        epg.load(xml, Array.isArray(body.ids) ? body.ids : [], Array.isArray(body.names) ? body.names.map(normName) : [], 
          body.source === 'file' ? String(body.name || '') : String(body.url || ''), String(body.sig || ''));
        sendJson(res, 200, epgStatus(false));
      } catch (e) {
        sendErr(res, 500, 'Не удалось загрузить EPG: ' + (e.message || String(e)));
      }
      return;
    }
    if (key === 'epg/status') { sendJson(res, 200, epgStatus(false)); return; }
    if (key === 'epg/lookup' && method === 'POST') {
      const body = await parseJsonBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      const results = [];
      const now = Date.now();
      if (epg.loaded) {
        for (let i = 0; i < items.length; i++) {
          try {
            const o = items[i] || {};
            const np = epg.nowNext(String(o.id || ''), String(o.name || ''), String(o.alt || ''), now);
            if (!np || (!np[0] && !np[1])) continue;
            const r = { i };
            if (np[0]) r.n = progJson(np[0], false);
            if (np[1]) r.x = progJson(np[1], false);
            results.push(r);
          } catch (e) { /* пропускаем некорректный элемент */ }
        }
      }
      sendJson(res, 200, { results });
      return;
    }
    if (key === 'epg/schedule' && method === 'GET') {
      const limit = Math.max(1, Math.min(1000, parseInt(query.limit, 10) || 400));
      const sc = epg.loaded
        ? epg.schedule(String(query.id || ''), String(query.name || ''), String(query.alt || ''), Date.now(), limit)
        : { channelName: '', programs: [] };
      sendJson(res, 200, { programs: sc.programs.map((p) => progJson(p, true)), channel: sc.channelName });
      return;
    }

    sendErr(res, 404, 'не найдено');
  }
  function epgStatus(skipped) {
    return { loaded: epg.loaded, channels: epg.channels, programmes: epg.programmes, loadedAt: epg.loadedAt, source: epg.source, sig: epg.sig, skipped: !!skipped };
  }
  function progJson(p, withDesc) {
    const o = { s: p.s, e: p.e, t: p.t };
    if (withDesc && p.d) o.d = p.d;
    return o;
  }

  /** GET внешнего URL (для EPG по ссылке); максимум 6 редиректов, как openUrl() в Java. */
  async function fetchText(urlStr) {
    let u = urlStr;
    for (let i = 0; i < 6; i++) {
      const resp = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, 'Accept': '*/*' } });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) throw new Error('перенаправление без адреса');
        u = new URL(loc, u).toString();
        continue;
      }
      if (resp.status !== 200) throw new Error('сервер ответил HTTP ' + resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString('utf8');
      return buf.toString('utf8');
    }
    throw new Error('слишком много перенаправлений');
  }

  /* ---------- главный обработчик ---------- */
  async function handler(req, res) {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const target = req.url || '/';
      const qi = target.indexOf('?');
      const pathname = qi >= 0 ? target.slice(0, qi) : target;
      const query = parseQuery(qi >= 0 ? target.slice(qi + 1) : '');

      if (method === 'OPTIONS') { send(res, 204, 'text/plain', ''); return; }

      // страницы
      if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) { servePage(res, 'index.html'); return; }
      if (method === 'GET' && (pathname === '/remote' || pathname === '/remote/')) { servePage(res, 'remote.html'); return; }

      // API пульта (совместимо с Android WebServer.java)
      if (pathname === '/api/files' && method === 'GET') { sendJson(res, 200, { files: store.list(), max: MAX_UPLOAD_BYTES }); return; }
      if (pathname === '/api/files' && method === 'DELETE') {
        const name = cleanName(query.name || '');
        const ok = name ? await store.delete(name) : false;
        sendJson(res, ok ? 200 : 404, 'application/json; charset=utf-8', JSON.stringify({ ok }));
        return;
      }
      if (pathname === '/api/upload' && method === 'POST') {
        const name = cleanName(query.name || '');
        if (!name || !allowedName(name)) { sendErr(res, 400, 'Допустимы только файлы .m3u, .m3u8, .xml и .xml.gz'); return; }
        const cl = req.headers['content-length'];
        if (cl == null) { sendErr(res, 411, 'Не указан размер файла'); return; }
        const len = parseInt(cl, 10);
        if (!Number.isFinite(len) || len < 0) { sendErr(res, 400, 'Неверный размер файла'); return; }
        if (len > MAX_UPLOAD_BYTES) { sendErr(res, 413, 'Файл слишком большой'); return; }
        try {
          const saved = await store.write(name, req, len);
          sendJson(res, 200, { ok: true, name, size: saved });
        } catch (e) { sendErr(res, e.message === 'Файл слишком большой' ? 413 : 500, e.message); }
        return;
      }
      if (pathname.startsWith('/files/') && method === 'GET') {
        const name = cleanName(decodeURIComponent(pathname.slice(7)));
        const item = name ? store.find(name) : null;
        if (!item) { send(res, 404, 'text/plain; charset=utf-8', 'файл не найден'); return; }
        const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '_');
        const enc = encodeURIComponent(name).replace(/%20/g, '%20');
        send(res, 200, mimeForDownload(name), fs.readFileSync(store.p(name)), {
          'Content-Disposition': 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + enc,
          'Content-Length': String(item.size)
        });
        return;
      }
      if (pathname === '/api/remote' && (method === 'GET' || method === 'POST')) {
        let cmd;
        if (method === 'GET') {
          cmd = {};
          for (const k of Object.keys(query)) if (k !== 'undefined') cmd[k] = query[k];
        } else {
          try { cmd = await parseJsonBody(req); } catch (e) { sendErr(res, 400, 'bad length'); return; }
        }
        // Remote-Pulse: команда уходит в очередь, её заберёт страница плеера и выполнит через RemoteAPI.handle
        const answer = await enqueuePulse(cmd);
        sendJson(res, 200, answer);
        return;
      }

      // native API для linux-bridge.js
      if (pathname.startsWith('/native/')) { await handleNative(req, res, method, pathname, query); return; }

      // статика сборки
      if (method === 'GET' && (pathname.startsWith('/assets/') || pathname.startsWith('/vendor/'))) {
        const rel = pathname.replace(/^\/+/, '');
        if (rel.includes('..')) { send(res, 404, 'text/plain; charset=utf-8', 'не найдено'); return; }
        const abs = path.join(dist, rel);
        if (!abs.startsWith(dist)) { send(res, 404, 'text/plain; charset=utf-8', 'не найдено'); return; }
        serveStaticFile(res, abs);
        return;
      }
      if (method === 'GET' && pathname === '/linux-bridge.js') { serveStaticFile(res, path.join(root, 'scripts', 'linux-bridge.js')); return; }

      send(res, 404, 'text/plain; charset=utf-8', 'не найдено');
    } catch (e) {
      try { sendErr(res, 500, String((e && e.message) || e)); } catch (x) { /* соединение закрыто */ }
    }
  }

  const server = http.createServer(handler);

  /** Привязка к порту: предпочтительный, иначе случайный свободный (как start(preferred) в WebServer.java). */
  function listen(preferred) {
    return new Promise((resolve, reject) => {
      const tryPort = (p, attempt) => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && attempt < 14) { tryPort(20000 + Math.floor(Math.random() * 40000), attempt + 1); return; }
          reject(err);
        });
        server.listen(p, host, () => {
          web = { running: true, port: server.address().port, addresses: localAddresses() };
          resolve(web.port);
        });
      };
      tryPort(Number(preferred) || 0, 0);
    });
  }
  let host = options.host || '0.0.0.0';

  async function close() {
    player.stop();
    await new Promise((res) => server.close(() => res()));
  }

  return { handler, listen, close, store, epg, player, pulseQueue, get web() { return web; }, set host(h) { host = h; }, get host() { return host; }, loadState, saveState, statusObj, persisted };
}

/** Поднимает сервер и запускает цикл pulse-поллинга. Возвращает { port, close }. */
export async function startServer(options = {}) {
  const srv = createServer(options);
  if (options.host) srv.host = options.host;
  const port = await srv.listen(options.port ?? srv.persisted.serverPort ?? 8080);
  return { port, close: () => srv.close(), srv };
}

/* ================= CLI ================= */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const portArg = opt('--port') || process.env.IPTV_PORT;
  const hostArg = opt('--host') || '0.0.0.0';
  const srv = createServer({
    filesDir: opt('--data') || process.env.IPTV_DATA_DIR,
    dist: opt('--root') || process.env.IPTV_DIST_DIR,
    playerMode: opt('--player') || process.env.IPTV_PLAYER || 'auto',
    webPort: portArg ? Number(portArg) : 8080
  });
  srv.host = hostArg;
  srv.listen(portArg ? Number(portArg) : srv.persisted.serverPort || 8080).then((port) => {
    console.log('IPTV Player (Linux): http://localhost:' + port + '/');
    console.log('Пульт:              http://localhost:' + port + '/remote');
    console.log('Файлы хранятся в:   ' + srv.store.dir);
    const ips = srv.statusObj().addresses;
    if (ips.length) console.log('Доступен в сети:    ' + ips.map((a) => 'http://' + a + ':' + port).join(', '));
  }).catch((e) => {
    console.error('Не удалось запустить сервер: ' + e.message);
    process.exit(1);
  });
  process.on('SIGINT', () => { srv.close().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { srv.close().then(() => process.exit(0)); });
}
