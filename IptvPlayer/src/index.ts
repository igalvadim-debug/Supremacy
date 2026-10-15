/* eslint-disable */
// @ts-nocheck /* Наследованный vanilla-код: строгая проверка типов отключена на уровне файла. */
// Plan für die schrittweise Typisierung: siehe MIGRATION.md; der Build (vite build) läuft unverändert.
(function () {
'use strict';

/* ================= Константы ================= */
var DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var LS_URL = 'iptv.playlistUrl', LS_LAST = 'iptv.lastChannel', LS_FAVS = 'iptv.favs', LS_GROUP = 'iptv.group';
var LS_BUF = 'iptv.bufferMs', LS_AUTO = 'iptv.autoReload', LS_HOURS = 'iptv.reloadHours', LS_RELOADED = 'iptv.lastReload';
var LS_ENTRY = 'iptv.entry', LS_SRV = 'iptv.serverOn', LS_PORT = 'iptv.serverPort', LS_EPG = 'iptv.epgOn', LS_EPGFILE = 'iptv.epgFile';
var PAGE_SIZE = 300;
var GROUP_ALL = '', GROUP_FAV = '\u0001', GROUP_NONE = '\u0002';
var HTTP_HEADERS = {
  'User-Agent': DESKTOP_UA,
  'Referer': 'https://google.com',
  'Accept': '*/*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
};

/* ================= Элементы ================= */
function $(id) { return document.getElementById(id); }
var urlInput = $('urlInput'), loadBtn = $('loadBtn'), fileInput = $('fileInput'), searchInput = $('searchInput');
var reloadBtn = $('reloadBtn'), settingsBtn = $('settingsBtn'), libBtn = $('libBtn');
var countEl = $('count'), statusEl = $('status'), grid = $('grid'), gridPane = $('gridPane'), groupBar = $('groupBar');
var videoBox = $('videoBox'), video = $('video');
var videoMsg = $('videoMsg'), nowTitle = $('nowTitle'), nowGroup = $('nowGroup');
var nowEpg = $('nowEpg'), nowEpgNow = $('nowEpgNow'), nowEpgNext = $('nowEpgNext'), nowEpgBar = $('nowEpgBar');
var osd = $('osd'), osdNum = $('osdNum'), osdName = $('osdName'), osdGroup = $('osdGroup'), osdState = $('osdState');
var osdEpg = $('osdEpg'), osdEpgNow = $('osdEpgNow'), osdEpgNext = $('osdEpgNext'), osdEpgBar = $('osdEpgBar');
var guide = $('guide'), guideTitle = $('guideTitle'), guideList = $('guideList');
var favsPanel = $('favs'), favsTitle = $('favsTitle'), favsList = $('favsList');
var pinpadEl = $('pinpad'), pinTitle = $('pinTitle'), pinDots = $('pinDots'), pinGrid = $('pinGrid'), pinCancel = $('pinCancel');
var settingsEl = $('settings'), bufRange = $('bufRange'), bufNum = $('bufNum'), bufVal = $('bufVal');
var autoChk = $('autoChk'), hoursNum = $('hoursNum'), lastReloadEl = $('lastReload'), toastEl = $('toast');
var epgChk = $('epgChk'), epgInfoEl = $('epgInfo'), srvChk = $('srvChk'), srvAddr = $('srvAddr'), autoStartChk = $('autoStartChk');
var libraryEl = $('library'), libList = $('libList'), fileList = $('fileList'), srvBtn = $('srvBtn'), srvInfo = $('srvInfo');

/* ================= Утилиты ================= */
/** Reads a stored value, returning an empty string for missing keys or storage errors. */
function lsGet(key) { try { return window.localStorage.getItem(key) || ''; } catch (e) { return ''; } }
/** Stores a value, silently ignoring storage errors. */
function lsSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* хранилище недоступно */ } }
/** Parses a base-10 integer, uses def if parsing fails, and clamps to the inclusive min/max bounds. */
function toInt(v, def, min, max) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = def;
  return Math.max(min, Math.min(max, n));
}
function mk(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = kind || ''; }
/** Returns the Russian noun form for a channel count. */
function plural(n) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'канал';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'канала';
  return 'каналов';
}
function nativeHttp() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
}
function appPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null;
}
// Собственный нативный плагин (файловый сервер, папка «Загрузки», EPG). В обычном браузере его нет.
var nativeP;
/** Returns the cached IptvNative bridge, or null if unavailable or registration throws. */
function native() {
  if (nativeP !== undefined) return nativeP;
  nativeP = null;
  try {
    var C = window.Capacitor;
    if (C) nativeP = (C.Plugins && C.Plugins.IptvNative) || (C.registerPlugin ? C.registerPlugin('IptvNative') : null);
  } catch (e) { nativeP = null; }
  return nativeP;
}
var nativePlayerP;
/** Returns the cached IptvPlayer bridge, or null if unavailable or registration throws. */
function playerPlugin() {
  if (nativePlayerP !== undefined) return nativePlayerP;
  nativePlayerP = null;
  try {
    var C = window.Capacitor;
    if (C) nativePlayerP = (C.Plugins && C.Plugins.IptvPlayer) || (C.registerPlugin ? C.registerPlugin('IptvPlayer') : null);
  } catch (e) { nativePlayerP = null; }
  return nativePlayerP;
}
var toastTimer = null;
/** Shows a message for ms milliseconds; a missing or zero duration uses 2,200 ms. */
function showToast(text, ms) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
}
function isText(el) { return !!el && el.tagName === 'INPUT' && el.type === 'text'; }
/** Formats a Unix timestamp in milliseconds as a Russian hour/minute string in the local time zone. */
function fmtTime(ms) { return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
/** Formats a Unix timestamp in milliseconds as a Russian day/month and time in the local time zone. */
function fmtDateTime(ms) { return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
/** Formats bytes with Russian unit labels, using powers of 1,024 and one decimal above the byte range. */
function fmtSize(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1048576).toFixed(1) + ' МБ';
}
/** Returns a URL hostname and final path segment, or the original input if URL parsing fails. */
function niceUrlName(url) {
  try {
    var u = new URL(url), last = u.pathname.split('/').filter(Boolean).pop() || '';
    return u.hostname + (last ? '/' + last : '');
  } catch (e) { return url; }
}
function errMsg(err) { return (err && err.message) ? err.message : String(err); }

/* ================= Настройки, избранное, EPG-состояние ================= */
var settings = {
  bufferMs: toInt(lsGet(LS_BUF), 1500, 0, 7000),
  autoReload: lsGet(LS_AUTO) !== '0',
  reloadHours: toInt(lsGet(LS_HOURS), 24, 1, 168)
};
var favs = new Set();
try {
  var arr = JSON.parse(lsGet(LS_FAVS) || '[]');
  if (Array.isArray(arr)) arr.forEach(function (u) { favs.add(String(u)); });
} catch (e) { /* повреждённые данные — начинаем с пустого списка */ }
function saveFavs() { lsSet(LS_FAVS, JSON.stringify(Array.from(favs))); }
function isFav(ch) { return favs.has(ch.url); }

var epg = { enabled: lsGet(LS_EPG) !== '0', file: lsGet(LS_EPGFILE), status: 'none', info: null, err: '', loading: false, pending: '', cache: new Map() };
var headerEpgUrl = '';
var headerCatchup = { mode: '', source: '', days: 0 };
var srv = { running: false, port: 0, addresses: [] };
var blockedGroups = new Set();
try { (JSON.parse(lsGet('iptv.blocked') || '[]')).forEach(function (k) { blockedGroups.add(String(k)); }); } catch (e) { /* ignore */ }
function saveBlocked() { lsSet('iptv.blocked', JSON.stringify(Array.from(blockedGroups))); }
var parentPin = lsGet('iptv.pin') || '';
var pinUnlocked = false;

/* ================= Состояние ================= */
var state = { channels: [], view: [], groups: [], group: lsGet(LS_GROUP), current: null, entry: null, mode: 'menu', renderCount: PAGE_SIZE };
var cardMap = new Map();
var focusedEl = null, osdTimer = null, searchTimer = null, epgTimer = null, epgReloadTimer = null, libTimer = null;
var hls = null, playToken = 0, nativeErrHandler = null, playFailed = false, userPaused = false, loading = false;
var gating = false, hasPlayed = false, swipedAt = 0, lpFired = false, lastAutoTry = 0, filesSig = '';

/* ================= Библиотека плейлистов (IndexedDB) ================= */
var libDb = null;
/**
 * Opens or reuses the playlist database, creating its store on the first open.
 * @returns A promise for the database; rejects when IndexedDB is unavailable or opening fails.
 */
function dbOpen() {
  return new Promise(function (resolve, reject) {
    if (libDb) { resolve(libDb); return; }
    if (!window.indexedDB) { reject(new Error('IndexedDB недоступна')); return; }
    var rq = window.indexedDB.open('iptv-lib', 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore('playlists', { keyPath: 'id' }); };
    rq.onsuccess = function () { libDb = rq.result; resolve(libDb); };
    rq.onerror = function () { reject(rq.error); };
  });
}
/**
 * Runs fn with the playlist store in the requested IndexedDB transaction mode.
 * @returns A promise for the returned request's result after commit, or undefined if fn returns no request.
 *   Database-open, transaction, and callback errors reject the promise.
 */
function dbTx(mode, fn) {
  return dbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('playlists', mode);
      var req = fn(tx.objectStore('playlists'));
      tx.oncomplete = function () { resolve(req ? req.result : undefined); };
      tx.onerror = tx.onabort = function () { reject(tx.error); };
    });
  });
}
/** Stores or replaces a playlist by id; returns a promise for its key and propagates database errors. */
function libPut(entry) { return dbTx('readwrite', function (st) { return st.put(entry); }); }
/** Returns a promise for the playlist with this id, or undefined if absent; database errors propagate. */
function libGet(id) { return dbTx('readonly', function (st) { return st.get(id); }); }
/** Deletes a playlist by id; returns a promise for transaction completion and propagates database errors. */
function libDel(id) { return dbTx('readwrite', function (st) { return st['delete'](id); }); }
/** Returns a promise for all saved playlists; database errors propagate. */
function libAll() { return dbTx('readonly', function (st) { return st.getAll(); }); }

/**
 * Starts saving a playlist copy under its source kind and key, without waiting for completion.
 * The source key is a URL or filename; count is the parsed channel count. Save failures are ignored.
 */
function saveEntry(src, name, text, count) {
  var id = (src.kind === 'url' ? 'u:' : 'f:') + src.key;
  var entry = { id: id, kind: src.kind, name: name, url: src.kind === 'url' ? src.key : '', fileName: src.kind === 'file' ? src.key : '',
    text: text, count: count, savedAt: Date.now() };
  libPut(entry).catch(function () { /* копия не сохранилась — работаем без неё */ });
}

/* ================= Парсер M3U ================= */
/** Splits EXTINF content at the first comma outside double quotes; a missing comma yields an empty title. */
function splitExtInf(body) {
  var inQuote = false;
  for (var i = 0; i < body.length; i++) {
    var ch = body.charAt(i);
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) return { head: body.slice(0, i), title: body.slice(i + 1).trim() };
  }
  return { head: body, title: '' };
}
/** Extracts double-quoted attributes with lowercase keys and trimmed values; later duplicates win. */
function parseAttrs(head) {
  var attrs = {}, re = /([A-Za-z0-9_-]+)="([^"]*)"/g, m;
  while ((m = re.exec(head)) !== null) attrs[m[1].toLowerCase()] = m[2].trim();
  return attrs;
}
/** Derives a channel name from the decoded URL filename or hostname, returning the input on parse errors. */
function guessName(url) {
  try {
    var u = new URL(url);
    var last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    last = last.replace(/\.(m3u8?|ts|mp4|mkv|avi)$/i, '');
    return last || u.hostname;
  } catch (e) { return url; }
}
/** Creates channel data with search keys, falling back to playlist header catch-up settings for falsy values. */
function makeChannel(o) {
  var name = o.name || 'Без названия', group = o.group || '';
  return { name: name, url: o.url, logo: o.logo || '', group: group, tvgId: o.tvgId || '', tvgName: o.tvgName || '',
    catchup: o.catchup || headerCatchup.mode || '', catchupSource: o.catchupSource || headerCatchup.source || '', catchupDays: o.catchupDays || headerCatchup.days || 0,
    nameLower: name.toLowerCase(), groupLower: group.toLowerCase() };
}
/**
 * Returns channels for HTTP(S) entries in M3U text, inferring names for bare URLs.
 * Resets header catch-up defaults and updates the shared EPG URL when the header supplies an HTTP(S) URL.
 * Unsupported URL schemes are skipped; missing metadata uses channel defaults.
 */
function parsePlaylist(text) {
  var lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  var out = [], pending = null, extGrp = '';
  headerCatchup = { mode: '', source: '', days: 0 };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('#EXTM3U') === 0) {
      var ha = parseAttrs(line);
      var tv = ha['url-tvg'] || ha['x-tvg-url'] || ha['tvg-url'] || '';
      tv = tv.split(',')[0].trim();
      if (/^https?:\/\//i.test(tv)) headerEpgUrl = tv;
      if (ha['catchup']) headerCatchup.mode = ha['catchup'];
      if (ha['catchup-source']) headerCatchup.source = ha['catchup-source'];
      if (ha['catchup-days']) headerCatchup.days = parseInt(ha['catchup-days'], 10) || 0;
      continue;
    }
    if (line.indexOf('#EXTINF') === 0) {
      var colon = line.indexOf(':');
      var parts = splitExtInf(colon >= 0 ? line.slice(colon + 1) : '');
      var attrs = parseAttrs(parts.head);
      pending = {
        name: parts.title || attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        tvgId: attrs['tvg-id'] || '',
        tvgName: attrs['tvg-name'] || '',
        catchup: attrs['catchup'] || '',
        catchupSource: attrs['catchup-source'] || '',
        catchupDays: parseInt(attrs['catchup-days'] || attrs['timeshift'] || attrs['tvg-rec'] || '', 10) || 0
      };
      continue;
    }
    if (line.indexOf('#EXTGRP:') === 0) { extGrp = line.slice(8).trim(); continue; }
    if (line.charAt(0) === '#') continue;
    if (!/^https?:\/\//i.test(line)) { pending = null; continue; }
    if (pending) {
      if (!pending.group) pending.group = extGrp;
      pending.url = line;
      out.push(makeChannel(pending));
    } else {
      out.push(makeChannel({ name: guessName(line), url: line, group: extGrp }));
    }
    pending = null; extGrp = '';
  }
  return out;
}

/* ================= Загрузка и обновление плейлиста ================= */
/**
 * Fetches playlist text through Capacitor HTTP when available, otherwise browser fetch.
 * @returns A promise for the response text; non-string native data is JSON-serialized.
 * @throws If the HTTP status is unsuccessful; request, response-reading, and serialization errors also propagate.
 */
async function fetchPlaylistText(url) {
  var http = nativeHttp();
  if (window.Capacitor && http) {
    // Android: нативный HTTP — без CORS, с браузерными заголовками
    var res = await http.get({ url: url, headers: HTTP_HEADERS, responseType: 'text', connectTimeout: 20000, readTimeout: 60000 });
    if (res.status < 200 || res.status >= 300) throw new Error('сервер ответил HTTP ' + res.status);
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  // ПК / обычный браузер: стандартный fetch
  var r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('сервер ответил HTTP ' + r.status);
  return await r.text();
}
/** Saves the current reload timestamp in milliseconds and refreshes its settings display. */
function markReloaded() { lsSet(LS_RELOADED, String(Date.now())); updateLastReload(); }
/** Formats a load error, substituting a browser CORS/network hint for TypeError when native HTTP is absent. */
function netErrText(err) {
  var msg = errMsg(err);
  if (err instanceof TypeError && !nativeHttp()) msg = 'браузер заблокировал запрос (CORS или нет сети). В Android-приложении запрос идёт нативно.';
  return msg;
}

/**
 * Loads the HTTP(S) URL from the input unless another load is active.
 * On fetch or apply failure, tries cached.text if supplied; failures are displayed as status messages.
 * Successful network loads save the playlist and update its reload timestamp.
 */
async function loadFromUrl(cached) {
  if (loading) return;
  var url = urlInput.value.trim();
  if (!url) { setStatus('Введите ссылку на плейлист.', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) { setStatus('Ссылка должна начинаться с http:// или https://', 'error'); return; }
  lsSet(LS_URL, url);
  loading = true;
  setStatus('Загрузка плейлиста…');
  try {
    var text = await fetchPlaylistText(url);
    applyPlaylist(text, 'ссылка', { kind: 'url', key: url }, {});
    markReloaded();
  } catch (err) {
    if (cached && cached.text) {
      try {
        applyPlaylist(cached.text, 'сохранённая копия', { kind: 'url', key: url }, { nosave: true });
        setStatus('Нет связи (' + netErrText(err) + '). Открыта сохранённая копия плейлиста.', 'warn');
      } catch (e2) { setStatus('Не удалось загрузить плейлист: ' + netErrText(err), 'error'); }
    } else {
      setStatus('Не удалось загрузить плейлист: ' + netErrText(err), 'error');
    }
  } finally {
    loading = false;
  }
}

/**
 * Reloads the open URL or native file while retaining the search and rendered range.
 * Errors become status messages. A truthy manual flag adds feedback and requests a forced EPG reload
 * following the load attempt; an active load or missing entry returns early.
 */
async function reloadPlaylist(manual) {
  if (loading) { if (manual) showToast('Загрузка уже идёт…'); return; }
  var ent = state.entry;
  if (!ent) {
    if (manual) { setStatus('Сначала откройте плейлист.', 'warn'); showToast('Нет открытого плейлиста'); }
    return;
  }
  loading = true;
  if (manual) { setStatus('Обновление плейлиста…'); showToast('Обновление плейлиста…'); }
  try {
    var text, src;
    if (ent.kind === 'file') {
      var n = native();
      if (!n) throw new Error('обновление файла доступно только в приложении');
      var r = await n.readFile({ name: ent.fileName });
      text = r.text;
      src = { kind: 'file', key: ent.fileName };
    } else {
      text = await fetchPlaylistText(ent.url);
      src = { kind: 'url', key: ent.url };
    }
    applyPlaylist(text, 'обновлено ' + fmtTime(Date.now()), src, { keep: true });
    if (ent.kind === 'url') markReloaded();
    if (manual) showToast('Плейлист обновлён: ' + state.channels.length + ' ' + plural(state.channels.length));
  } catch (err) {
    setStatus('Не удалось обновить плейлист: ' + (ent.kind === 'url' ? netErrText(err) : errMsg(err)), 'error');
    if (manual) showToast('Ошибка обновления плейлиста');
  } finally {
    loading = false;
    updateLastReload();
  }
  if (manual) epgReload(true);
}
/** Reloads a URL playlist when its configured interval has elapsed, spacing automatic attempts by at least ten minutes. */
function autoTick() {
  if (!settings.autoReload || loading) return;
  if (!state.entry || state.entry.kind !== 'url') return;
  var last = parseInt(lsGet(LS_RELOADED), 10) || 0, now = Date.now();
  if (now - last >= settings.reloadHours * 3600000 && now - lastAutoTry >= 600000) {
    lastAutoTry = now;
    reloadPlaylist(false);
  }
}

/** Reads the first selected file as UTF-8 and applies it as a playlist, displaying read or apply errors in the UI. */
function loadFromFile() {
  var file = fileInput.files && fileInput.files[0];
  if (!file) return;
  setStatus('Чтение файла…');
  var reader = new FileReader();
  reader.onerror = function () { setStatus('Не удалось прочитать файл.', 'error'); };
  reader.onload = function () {
    try { applyPlaylist(String(reader.result || ''), file.name, { kind: 'file', key: file.name }, {}); }
    catch (err) { setStatus('Ошибка: ' + errMsg(err), 'error'); }
    try { fileInput.value = ''; } catch (e) { /* ignore */ }
  };
  reader.readAsText(file, 'utf-8');
}

/**
 * Replaces the channel list from M3U text, or treats a URL-backed HLS manifest as a single channel.
 * Updates playlist identity, groups, grid, focus, and EPG scheduling without starting playback.
 * @param sourceName Label shown in the load status.
 * @param src Source kind and key (URL or filename), used for persistence and later reloads.
 * @param opts keep preserves the search and rendered range and requests scroll restoration;
 *   nosave skips saving a library copy. Both default to false.
 * @throws If text is empty, looks like HTML, has no HTTP(S) channels, or is an HLS manifest without a source URL.
 */
function applyPlaylist(text, sourceName, src, opts) {
  opts = opts || {};
  var trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('плейлист пуст');
  if (/<html[\s>]/i.test(trimmed.slice(0, 500))) throw new Error('сервер вернул HTML-страницу вместо плейлиста');
  var sourceUrl = src && src.kind === 'url' ? src.key : '';
  headerEpgUrl = '';
  var channels;
  if (/#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)/.test(trimmed)) {
    if (!sourceUrl) throw new Error('это манифест одного HLS-потока, а не список каналов — загрузите его по ссылке');
    channels = [makeChannel({ name: 'Поток HLS', url: sourceUrl, group: 'Прямая ссылка' })];
  } else {
    channels = parsePlaylist(trimmed);
  }
  if (!channels.length) throw new Error('в плейлисте нет каналов с http/https-ссылками');

  if (src) {
    var id = (src.kind === 'url' ? 'u:' : 'f:') + src.key;
    state.entry = { id: id, kind: src.kind, url: sourceUrl, fileName: src.kind === 'file' ? src.key : '' };
    lsSet(LS_ENTRY, id);
    if (!opts.nosave) saveEntry(src, src.kind === 'url' ? niceUrlName(src.key) : src.key, trimmed, channels.length);
  }

  var prevUrl = state.current ? state.current.url : '';
  state.channels = channels;
  epg.cache.clear();
  buildGroups();
  if (state.group && state.group !== GROUP_FAV && !state.groups.some(function (g) { return g.key === state.group; })) {
    state.group = GROUP_ALL; lsSet(LS_GROUP, '');
  }
  if (!opts.keep) { searchInput.value = ''; state.renderCount = PAGE_SIZE; }
  computeView();
  if (prevUrl) {
    var found = channels.find(function (c) { return c.url === prevUrl; });
    if (found) state.current = found;
  }

  var lastIdx = -1;
  if (!opts.keep) {
    var lastUrl = lsGet(LS_LAST);
    if (lastUrl) { for (var i = 0; i < state.view.length; i++) { if (state.view[i].url === lastUrl) { lastIdx = i; break; } } }
    if (lastIdx >= state.renderCount) state.renderCount = lastIdx + PAGE_SIZE;
  } else if (state.renderCount < state.view.length && state.renderCount < PAGE_SIZE) {
    state.renderCount = PAGE_SIZE;
  }
  renderGroups();
  renderGrid(!!opts.keep);
  setStatus((opts.keep ? 'Обновлено: ' : 'Загружено: ') + channels.length + ' ' + plural(channels.length) + ' · ' + sourceName, 'ok');
  if (!opts.keep && state.mode === 'menu') {
    var target = cardMap.get(state.view[lastIdx >= 0 ? lastIdx : 0]);
    if (target) setFocus(target);
  }
  updateLastReload();
  scheduleEpgReload();
}

/* ================= Окно «Плейлисты» ================= */
function libraryOpen() { return libraryEl.classList.contains('open'); }
/** Opens the playlist library, loads saved entries and native files, and starts polling files every three seconds. */
async function openLibrary() {
  if (settingsOpen()) closeSettings();
  libraryEl.classList.add('open');
  filesSig = '';
  await refreshServerStatus();
  await renderLibrary();
  await renderFiles(true);
  clearInterval(libTimer);
  libTimer = setInterval(function () { renderFiles(false); }, 3000);
  setFocus(srvBtn, false);
}
function closeLibrary() {
  if (!libraryOpen()) return;
  libraryEl.classList.remove('open');
  clearInterval(libTimer);
  setFocus(libBtn, false);
}

/**
 * Assigns a button action that requires a second activation within three seconds.
 * The first activation shows a confirmation label; timeout restores label. Activation does not catch synchronous action errors.
 */
function twoStep(btn, label, action) {
  btn._armed = false;
  btn._act = function () {
    if (!btn._armed) {
      btn._armed = true;
      btn.textContent = 'Удалить?';
      btn.classList.add('armed');
      clearTimeout(btn._t);
      btn._t = setTimeout(function () { btn._armed = false; btn.textContent = label; btn.classList.remove('armed'); }, 3000);
    } else {
      clearTimeout(btn._t);
      action();
    }
  };
}

/** Renders saved playlists newest first, treating database read failures as an empty library. */
async function renderLibrary() {
  var entries = [];
  try { entries = await libAll(); } catch (e) { entries = []; }
  entries.sort(function (a, b) { return b.savedAt - a.savedAt; });
  libList.textContent = '';
  if (!entries.length) {
    libList.appendChild(mk('div', 'note', 'Пока пусто. Плейлисты, открытые по ссылке или из файла, сохраняются здесь автоматически.'));
  }
  entries.forEach(function (e) {
    var row = mk('div', 'lrow' + (state.entry && state.entry.id === e.id ? ' current' : ''));
    var main = mk('div', 'lmain');
    main.setAttribute('data-nav', '1');
    main.appendChild(mk('div', 'lname', e.name));
    main.appendChild(mk('div', 'lmeta', (e.kind === 'url' ? 'ссылка' : 'файл') + ' · ' + e.count + ' ' + plural(e.count) + ' · ' + fmtDateTime(e.savedAt)));
    main._act = function () { openEntry(e.id, false); };
    var del = mk('button', '', '\u2715');
    del.setAttribute('data-nav', '1');
    twoStep(del, '\u2715', function () {
      libDel(e.id).then(function () {
        if (state.entry && state.entry.id === e.id) { state.entry = null; lsSet(LS_ENTRY, ''); }
        showToast('Плейлист удалён');
        renderLibrary();
      });
    });
    row.appendChild(main);
    row.appendChild(del);
    libList.appendChild(row);
  });
  if (focusedEl && !document.body.contains(focusedEl)) setFocus(srvBtn, false);
}

/**
 * Renders native downloads and EPG selection, treating listing errors as an empty file list.
 * A truthy force bypasses the unchanged-list check; without a native bridge, shows an availability message.
 */
async function renderFiles(force) {
  var n = native();
  if (!n) {
    fileList.textContent = '';
    fileList.appendChild(mk('div', 'note', 'Файловый сервер и папка «Загрузки» доступны только в Android-приложении.'));
    return;
  }
  var files = [];
  try { files = (await n.listFiles()).files || []; } catch (e) { files = []; }
  var sig = JSON.stringify(files.map(function (f) { return [f.name, f.size, f.modified]; })) + '|' + epg.file;
  if (!force && sig === filesSig) return;
  filesSig = sig;
  fileList.textContent = '';
  if (!files.length) {
    fileList.appendChild(mk('div', 'note', 'Файлов пока нет. Загрузите их через браузер, когда сервер включён.'));
  }
  files.forEach(function (f) {
    var isEpg = /\.xml(\.gz)?$/i.test(f.name);
    var row = mk('div', 'lrow' + (isEpg && epg.file === f.name ? ' current' : ''));
    var main = mk('div', 'lmain');
    main.setAttribute('data-nav', '1');
    main.appendChild(mk('div', 'lname', f.name));
    main.appendChild(mk('div', 'lmeta', (isEpg ? 'телепрограмма (нажмите, чтобы использовать)' : 'плейлист (нажмите, чтобы открыть)') + ' · ' + fmtSize(f.size) + ' · ' + fmtDateTime(f.modified)));
    main._act = function () { if (isEpg) setEpgFile(f.name); else openDownloadFile(f.name); };
    var del = mk('button', '', '\u2715');
    del.setAttribute('data-nav', '1');
    twoStep(del, '\u2715', function () {
      n.deleteFile({ name: f.name }).then(function () {
        if (epg.file === f.name) { epg.file = ''; lsSet(LS_EPGFILE, ''); epgReload(true); }
        showToast('Файл удалён');
        renderFiles(true);
      }, function (e) { showToast('Не удалось удалить: ' + errMsg(e)); });
    });
    row.appendChild(main);
    row.appendChild(del);
    fileList.appendChild(row);
  });
  if (focusedEl && !document.body.contains(focusedEl)) setFocus(srvBtn, false);
}

/**
 * Opens a saved playlist, preferring stored edits and falling back to the original if edits cannot be applied.
 * URL entries try the network before their saved copy. Read/apply failures are reported in the UI.
 * A truthy startup leaves the library open rather than closing it before loading.
 */
async function openEntry(id, startup) {
  var e = null;
  try { e = await libGet(id); } catch (x) { e = null; }
  if (!e) { showToast('Плейлист не найден'); return; }
  if (!startup) closeLibrary();
  var savedEdit = lsGet('iptv.edit.' + id);
  if (savedEdit) {
    try { applyPlaylist(savedEdit, e.name + ' (с правками)', { kind: e.kind, key: e.kind === 'url' ? e.url : (e.fileName || e.name) }, { nosave: true }); return; }
    catch (err) { /* применим исходник */ }
  }
  if (e.kind === 'url') {
    urlInput.value = e.url;
    lsSet(LS_URL, e.url);
    await loadFromUrl(e);
  } else {
    try { applyPlaylist(e.text, e.name, { kind: 'file', key: e.fileName || e.name }, { nosave: true }); }
    catch (err) { setStatus('Не удалось открыть «' + e.name + '»: ' + errMsg(err), 'error'); }
  }
}
/** Reads and applies a native download by filename; no-ops without the bridge and displays read/apply failures. */
async function openDownloadFile(name) {
  var n = native();
  if (!n) return;
  try {
    var r = await n.readFile({ name: name });
    closeLibrary();
    applyPlaylist(r.text, name, { kind: 'file', key: name }, {});
  } catch (e) {
    setStatus('Не удалось открыть «' + name + '»: ' + errMsg(e), 'error');
    showToast('Не удалось открыть файл');
  }
}

/* ================= Файловый сервер ================= */
/** Returns the running server URL using its first address, or an empty string if stopped or no address is available. */
function serverUrl() {
  if (!srv.running) return '';
  var ip = srv.addresses && srv.addresses[0];
  return ip ? 'http://' + ip + ':' + srv.port : '';
}
function renderServerUi() {
  var url = serverUrl();
  var hasNative = !!native();
  srvChk.textContent = srv.running ? 'Выключить сервер' : 'Включить сервер';
  srvChk.disabled = !hasNative;
  srvBtn.textContent = srv.running ? 'Выключить сервер' : 'Включить сервер';
  var info;
  if (!hasNative) info = 'Доступно только в приложении.';
  else if (!srv.running) info = 'Сервер выключен.';
  else if (url) info = 'Откройте в браузере: ' + url;
  else info = 'Сервер запущен (порт ' + srv.port + '), но Wi-Fi не найден.';
  srvInfo.textContent = info;
  srvAddr.textContent = info;
  renderQr();
}
/** Displays the remote-control URL as a QR code, falling back to plain text if QR generation is unavailable or fails. */
function renderQr() {
  var box = $('qrBox');
  if (!box) return;
  var u = serverUrl() ? serverUrl() + '/remote' : '';
  box.textContent = '';
  if (!u) return;
  if (window.qrcode) {
    try {
      var q = window.qrcode(0, 'M');
      q.addData(u);
      q.make();
      box.innerHTML = q.createSvgTag(4, 8);
      var d = document.createElement('div');
      d.style.marginTop = '.4rem';
      d.textContent = u;
      box.appendChild(d);
      var h = document.createElement('div');
      h.textContent = 'Наведите камеру телефона → откроется пульт Remote Supremacy';
      box.appendChild(h);
      return;
    } catch (e) { /* покажем ссылку */ }
  }
  box.textContent = u;
}
/** Refreshes server state from the native bridge, retaining the previous state on errors, then updates the UI. */
async function refreshServerStatus() {
  var n = native();
  if (n) { try { srv = await n.serverStatus(); } catch (e) { /* оставляем прежнее состояние */ } }
  renderServerUi();
}
/** Starts or stops the native server and saves successful state changes; native failures are displayed as a toast. */
async function setServer(on) {
  var n = native();
  if (!n) { showToast('Сервер доступен только в приложении'); renderServerUi(); return; }
  try {
    if (on) {
      var port = toInt(lsGet(LS_PORT), 0, 0, 65535);
      if (!port) { port = 20000 + Math.floor(Math.random() * 40000); lsSet(LS_PORT, String(port)); }
      srv = await n.serverStart({ port: port });
      if (srv.port && srv.port !== port) lsSet(LS_PORT, String(srv.port));
      lsSet(LS_SRV, '1');
    } else {
      srv = await n.serverStop();
      lsSet(LS_SRV, '0');
    }
  } catch (e) {
    showToast('Сервер: ' + errMsg(e), 3500);
  }
  renderServerUi();
}

/* ================= Группы и фильтр ================= */
/** Returns the channel group, using GROUP_NONE for an empty group. */
function gkey(ch) { return ch.group || GROUP_NONE; }
/** Rebuilds group counts in playlist order, excluding blocked groups while the PIN is locked. */
function buildGroups() {
  var counts = new Map(), order = [];
  state.channels.forEach(function (ch) {
    var k = gkey(ch);
    if (blockedGroups.has(k) && !pinUnlocked) return;
    if (!counts.has(k)) { counts.set(k, 0); order.push(k); }
    counts.set(k, counts.get(k) + 1);
  });
  state.groups = order.map(function (k) { return { key: k, label: k === GROUP_NONE ? 'Без группы' : k, count: counts.get(k) }; });
}
/** Updates the channel view using PIN visibility, the selected group or favorites, and a case-insensitive name/group search. */
function computeView() {
  var q = searchInput.value.trim().toLowerCase(), g = state.group, out = state.channels;
  if (!pinUnlocked && blockedGroups.size) out = out.filter(function (c) { return !blockedGroups.has(gkey(c)); });
  if (g === GROUP_FAV) out = out.filter(isFav);
  else if (g) out = out.filter(function (c) { return gkey(c) === g; });
  if (q) out = out.filter(function (c) { return c.nameLower.indexOf(q) !== -1 || c.groupLower.indexOf(q) !== -1; });
  state.view = out;
}
function makeChip(key, label, count) {
  var el = mk('div', 'chip' + (state.group === key ? ' active' : ''));
  el.setAttribute('data-nav', '1');
  el._group = key;
  el.appendChild(document.createTextNode(label));
  el.appendChild(mk('small', '', String(count)));
  return el;
}
/** Opens PIN setup if unset, relocks visible groups if unlocked, or prompts for the existing PIN. */
function armUnlock() {
  if (!parentPin) { pinOpen('set'); return; }
  if (pinUnlocked) { pinUnlocked = false; buildGroups(); computeView(); renderGroups(); renderGrid(false); return; }
  pinOpen('unlock');
}
/* ================= Экранный PIN-пад (3 цифры) ================= */
var pinMode = 'unlock', pinBuf = '';
var pinFailCount = 0;            // неудачные попытки ввода PIN до закрытия окна
var PIN_MAX_FAILS = 5;
function pinpadOpen() { return pinpadEl.classList.contains('open'); }
/** Opens a cleared PIN pad in setup mode for "set", or unlock mode otherwise. */
function pinOpen(mode) {
  pinMode = mode; pinBuf = ''; pinFailCount = 0;
  pinTitle.textContent = mode === 'set' ? 'Задайте PIN из 3 цифр' : 'Введите PIN (3 цифры)';
  pinRenderDots(); pinRenderGrid();
  pinpadEl.classList.add('open');
  var b = pinGrid.querySelector('button'); if (b) setFocus(b, false);
}
function pinClose() {
  pinpadEl.classList.remove('open'); pinBuf = '';
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
}
function pinRenderDots() {
  pinDots.textContent = '';
  for (var i = 0; i < 3; i++) pinDots.appendChild(mk('i', i < pinBuf.length ? 'on' : ''));
}
/** Builds the PIN keypad, submitting automatically at three digits or on OK with three digits entered. */
function pinRenderGrid() {
  pinGrid.textContent = '';
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '\u232B', '0', 'OK'].forEach(function (lab) {
    var b = mk('button', '', lab);
    b.setAttribute('data-nav', '1'); b.type = 'button';
    b._act = function () {
      if (lab === '\u232B') { pinBuf = pinBuf.slice(0, -1); pinRenderDots(); }
      else if (lab === 'OK') { if (pinBuf.length === 3) pinSubmit(); }
      else if (pinBuf.length < 3) { pinBuf += lab; pinRenderDots(); if (pinBuf.length === 3) pinSubmit(); }
    };
    pinGrid.appendChild(b);
  });
}
/** Saves a new PIN or checks the entered PIN, revealing groups on success and clearing the input on mismatch. */
function pinSubmit() {
  var v = pinBuf;
  if (pinMode === 'set') {
    parentPin = v; lsSet('iptv.pin', v); pinUnlocked = true;
    pinClose(); buildGroups(); computeView(); renderGroups(); renderGrid(false); showToast('PIN задан');
  } else if (v === parentPin) {
    pinUnlocked = true; pinClose(); buildGroups();
    if (state.group && blockedGroups.has(state.group)) state.group = GROUP_ALL;
    computeView(); renderGroups(); renderGrid(false); showToast('Скрытые группы показаны');
  } else {
    pinBuf = ''; pinRenderDots();
    pinFailCount++;
    if (pinFailCount >= PIN_MAX_FAILS) {
      pinClose();
      showToast('Слишком много неверных попыток');
      setTimeout(function () { if (!pinUnlocked && parentPin) pinOpen('unlock'); }, 10000); // повторное окно через 10 с
    } else {
      showToast('Неверный PIN (' + pinFailCount + '/' + PIN_MAX_FAILS + ')');
    }
  }
}
function renderGroups() {
  groupBar.textContent = '';
  if (!state.channels.length) { groupBar.style.display = 'none'; return; }
  groupBar.style.display = 'flex';
  var favCount = 0;
  state.channels.forEach(function (c) { if (isFav(c)) favCount++; });
  var frag = document.createDocumentFragment();
  frag.appendChild(makeChip(GROUP_ALL, 'Все', state.channels.length));
  frag.appendChild(makeChip(GROUP_FAV, '\u2605 Избранное', favCount));
  state.groups.forEach(function (g) { frag.appendChild(makeChip(g.key, g.label, g.count)); });
  var lock = mk('div', 'chip' + (pinUnlocked ? ' active' : ''));
  lock.setAttribute('data-nav', '1');
  lock.appendChild(document.createTextNode(pinUnlocked ? '\uD83D\uDD13' : (parentPin ? '\uD83D\uDD12 Блок (' + blockedGroups.size + ')' : '\uD83D\uDD12 PIN')));
  lock._act = armUnlock;
  frag.appendChild(lock);
  groupBar.appendChild(frag);
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
}
/** Selects and saves a group key, resets pagination and scroll, and focuses its chip when present. */
function setGroup(key) {
  state.group = key;
  lsSet(LS_GROUP, key);
  state.renderCount = PAGE_SIZE;
  computeView();
  renderGroups();
  renderGrid(false);
  gridPane.scrollTop = 0;
  var act = groupBar.querySelector('.chip.active');
  if (act) {
    setFocus(act, false);
    try { act.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ignore */ }
  }
}

/** Toggles a channel URL in saved favorites and refreshes affected UI; a missing channel is ignored. */
function toggleFav(ch) {
  if (!ch) return;
  var on;
  if (favs.has(ch.url)) { favs.delete(ch.url); on = false; } else { favs.add(ch.url); on = true; }
  saveFavs();
  try { if (navigator.vibrate) navigator.vibrate(on ? [30, 40, 30] : 30); } catch (e) { /* ignore */ }
  showToast((on ? '\u2605 В избранное: ' : '\u2606 Убрано из избранного: ') + ch.name);
  var el = cardMap.get(ch);
  if (el) el.classList.toggle('fav', on);
  renderGroups();
  if (!on && state.group === GROUP_FAV && state.mode === 'menu') { computeView(); renderGrid(true); }
}
/** Handles the native remote Menu button by toggling the current or focused channel favorite, or prompting for a channel. */
window.__iptvMenu = function () {          // кнопка «три полоски» на пульте (вызывается из MainActivity)
  if (state.mode === 'player' && state.current) { toggleFav(state.current); showOsd(); return; }
  if (focusedEl && focusedEl._channel) { toggleFav(focusedEl._channel); return; }
  showToast('Наведите курсор на канал');
};

/* ================= Сетка каналов ================= */
/** Creates a logo placeholder from the first trimmed character, uppercased, or "?" for an empty name. */
function placeholder(name) {
  return mk('span', 'ph', (name.trim().charAt(0) || '?').toUpperCase());
}
/** Builds a navigable channel card with favorite and EPG state, substituting a placeholder if its logo fails to load. */
function createCard(ch) {
  var el = mk('div', 'card' + (isFav(ch) ? ' fav' : ''));
  el.setAttribute('data-nav', '1');
  el.title = ch.name;
  el._channel = ch;
  var star = mk('span', 'star', '\u2605');
  var logo = mk('div', 'logo');
  if (ch.logo) {
    var img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); logo.appendChild(placeholder(ch.name)); };
    img.src = ch.logo;
    logo.appendChild(img);
  } else {
    logo.appendChild(placeholder(ch.name));
  }
  var epgRoot = mk('div', 'epg'), et = mk('div', 'et'), bar = mk('i', 'bar'), fill = document.createElement('b');
  bar.appendChild(fill);
  epgRoot.appendChild(et); epgRoot.appendChild(bar);
  el._epg = { root: epgRoot, et: et, fill: fill };
  el.appendChild(star); el.appendChild(logo);
  el.appendChild(mk('div', 'name', ch.name));
  el.appendChild(mk('div', 'grp', ch.group));
  el.appendChild(epgRoot);
  epgPaintCard(el);
  return el;
}
function createMoreCard(rest) {
  var el = mk('div', 'card more', 'Показать ещё\n(осталось ' + rest + ')');
  el.setAttribute('data-nav', '1');
  el.style.whiteSpace = 'pre-line';
  return el;
}
/** Rebuilds the paginated channel grid and schedules an EPG refresh; a truthy keepScroll restores the prior scroll offset. */
function renderGrid(keepScroll) {
  var st = gridPane.scrollTop;
  grid.textContent = '';
  cardMap.clear();
  var frag = document.createDocumentFragment();
  var n = Math.min(state.view.length, state.renderCount);
  for (var i = 0; i < n; i++) {
    var el = createCard(state.view[i]);
    cardMap.set(state.view[i], el);
    frag.appendChild(el);
  }
  if (state.view.length > n) {
    frag.appendChild(createMoreCard(state.view.length - n));
  } else if (!state.view.length) {
    frag.appendChild(mk('div', 'empty', !state.channels.length ? 'Список каналов пуст'
      : (state.group === GROUP_FAV && !searchInput.value.trim() ? 'В избранном пусто. Нажмите ★ на канале, чтобы добавить.' : 'Ничего не найдено')));
  }
  grid.appendChild(frag);
  if (keepScroll) gridPane.scrollTop = st;
  var total = state.channels.length;
  countEl.textContent = total ? (state.view.length === total ? total + ' ' + plural(total) : state.view.length + ' из ' + total) : '';
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
  markPlaying();
  scheduleEpgRefresh();
}
function markPlaying() {
  cardMap.forEach(function (el, ch) { el.classList.toggle('playing', ch === state.current); });
}
function applyFilter() {
  computeView();
  state.renderCount = PAGE_SIZE;
  renderGrid(false);
}
/** Adds one page to the rendered range and focuses its first new channel, if present. */
function showMore() {
  var firstNew = state.renderCount;
  state.renderCount += PAGE_SIZE;
  renderGrid(true);
  var el = cardMap.get(state.view[firstNew]);
  if (el) setFocus(el);
}

/* ================= Телепрограмма (EPG) ================= */
function renderEpgInfo() {
  var t;
  if (!native()) t = 'Телепрограмма доступна только в Android-приложении.';
  else if (!epg.enabled) t = 'Телепрограмма выключена.';
  else if (epg.status === 'loading') t = 'Загрузка телепрограммы…';
  else if (epg.status === 'ok' && epg.info) t = 'Источник: ' + epg.info.source + ' · каналов в EPG: ' + epg.info.channels + ', передач: ' + epg.info.programmes + ' · ' + fmtDateTime(epg.info.loadedAt);
  else if (epg.status === 'error') t = 'Ошибка: ' + epg.err;
  else t = 'Нет источника. Загрузите xml или xml.gz в «Плейлисты» либо откройте плейлист со ссылкой url-tvg.';
  epgInfoEl.textContent = t;
  epgChk.checked = epg.enabled;
  epgChk.disabled = !native();
}
/** Debounces a non-forced EPG reload by 400 ms. */
function scheduleEpgReload() {
  clearTimeout(epgReloadTimer);
  epgReloadTimer = setTimeout(function () { epgReload(false); }, 400);
}
/**
 * Loads native EPG data from the selected file, falling back to the playlist header URL on failure.
 * A truthy force is passed to the native loader; overlapping requests queue a follow-up, prioritizing force.
 * Load errors update EPG status rather than rejecting; disabled or missing sources clear cached entries.
 */
async function epgReload(force) {
  var n = native();
  if (!n) { renderEpgInfo(); return; }
  if (!epg.enabled) { epg.status = 'off'; epg.cache.clear(); renderEpgInfo(); epgPaintAll(); return; }
  if (epg.loading) { epg.pending = force ? 'force' : (epg.pending || 'normal'); return; }
  var cands = [];
  if (epg.file) cands.push({ source: 'file', name: epg.file, url: '' });
  if (headerEpgUrl) cands.push({ source: 'url', name: '', url: headerEpgUrl });
  if (!cands.length) { epg.status = 'none'; epg.cache.clear(); renderEpgInfo(); epgPaintAll(); return; }

  var idSet = new Set(), nameSet = new Set();
  state.channels.forEach(function (c) {
    if (c.tvgId) idSet.add(c.tvgId);
    nameSet.add(c.name);
    if (c.tvgName) nameSet.add(c.tvgName);
  });
  var ids = Array.from(idSet), names = Array.from(nameSet);
  epg.loading = true;
  epg.status = 'loading';
  renderEpgInfo();
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var sig = (c.source === 'file' ? c.name : c.url) + '|' + state.channels.length + '|' + ids.length;
    try {
      epg.info = await n.epgLoad({ source: c.source, name: c.name, url: c.url, ids: ids, names: names, sig: sig, force: !!force });
      epg.status = 'ok';
      epg.err = '';
      break;
    } catch (e) {
      epg.status = 'error';
      epg.err = errMsg(e);
    }
  }
  epg.loading = false;
  epg.cache.clear();
  renderEpgInfo();
  epgRefresh();
  if (epg.pending) { var f = epg.pending === 'force'; epg.pending = ''; epgReload(f); }
}
/** Saves and enables the selected EPG filename, closes the library, and starts a forced reload. */
function setEpgFile(name) {
  epg.file = name;
  lsSet(LS_EPGFILE, name);
  epg.enabled = true;
  lsSet(LS_EPG, '1');
  closeLibrary();
  showToast('Телепрограмма: ' + name);
  epgReload(true);
}

/** Debounces the visible-channel EPG lookup by 250 ms. */
function scheduleEpgRefresh() {
  clearTimeout(epgTimer);
  epgTimer = setTimeout(epgRefresh, 250);
}
/**
 * Updates cached now/next programs for rendered channels and the current channel, then repaints EPG UI.
 * A native lookup failure stops further lookups and leaves already cached results available.
 */
async function epgRefresh() {
  var n = native();
  if (!n || !epg.enabled || epg.status !== 'ok') { epgPaintAll(); return; }
  var chans = [];
  cardMap.forEach(function (el, ch) { chans.push(ch); });
  if (state.current && chans.indexOf(state.current) === -1) chans.push(state.current);
  for (var off = 0; off < chans.length; off += 300) {
    var part = chans.slice(off, off + 300), res;
    try {
      res = await n.epgLookup({ items: part.map(function (c) { return { id: c.tvgId, name: c.name, alt: c.tvgName }; }) });
    } catch (e) { break; }
    var seen = {};
    (res.results || []).forEach(function (r) {
      var c = part[r.i];
      if (c) { epg.cache.set(c, { n: r.n || null, x: r.x || null }); seen[r.i] = 1; }
    });
    part.forEach(function (c, i) { if (!seen[i]) epg.cache.set(c, null); });
  }
  epgPaintAll();
}
/** Returns elapsed program progress as a percentage clamped to 0–100 for positive-duration s/e Unix timestamps in milliseconds. */
function progress(p) {
  var v = (Date.now() - p.s) / (p.e - p.s);
  return Math.max(0, Math.min(1, v)) * 100;
}
/** Paints cached current or next program data on a channel card, hiding it when EPG or program data is unavailable. */
function epgPaintCard(el) {
  var box = el._epg;
  if (!box) return;
  var d = epg.enabled ? epg.cache.get(el._channel) : null;
  if (d && d.n) {
    box.et.textContent = d.n.t;
    box.fill.style.width = progress(d.n) + '%';
    box.root.style.display = 'block';
  } else if (d && d.x) {
    box.et.textContent = fmtTime(d.x.s) + ' ' + d.x.t;
    box.fill.style.width = '0';
    box.root.style.display = 'block';
  } else {
    box.root.style.display = 'none';
  }
}
/** Paints cached now/next text and progress for ch, hiding the block when neither program is available. */
function epgPaintBlock(blockEl, nowEl, nextEl, barEl, ch) {
  var d = (epg.enabled && ch) ? epg.cache.get(ch) : null;
  if (!d || (!d.n && !d.x)) { blockEl.style.display = 'none'; return; }
  blockEl.style.display = 'block';
  if (d.n) {
    nowEl.textContent = 'Сейчас: ' + d.n.t + '  ' + fmtTime(d.n.s) + '\u2013' + fmtTime(d.n.e);
    barEl.style.width = progress(d.n) + '%';
  } else {
    nowEl.textContent = '';
    barEl.style.width = '0';
  }
  nextEl.textContent = d.x ? 'Далее: ' + d.x.t + '  ' + fmtTime(d.x.s) : '';
}
function epgPaintAll() {
  cardMap.forEach(function (el) { epgPaintCard(el); });
  epgPaintBlock(nowEpg, nowEpgNow, nowEpgNext, nowEpgBar, state.current);
  epgPaintBlock(osdEpg, osdEpgNow, osdEpgNext, osdEpgBar, state.current);
}

function guideOpen() { return guide.classList.contains('open'); }
function closeGuide() { guide.classList.remove('open'); }

/* ================= Панель избранного в плеере ================= */
var favList = [], favIdx = 0;
function favOpen() { return favsPanel.classList.contains('open'); }
function closeFavs() { favsPanel.classList.remove('open'); }
/** Rebuilds the favorites panel from all channels, wrapping an out-of-range selection and scrolling it into view. */
function renderFavs() {
  favsList.textContent = '';
  favList = state.channels.filter(isFav);
  if (!favList.length) {
    favsList.appendChild(mk('div', 'frow', 'В избранном пусто. Удержание OK на канале — добавить.'));
    favIdx = 0;
    return;
  }
  if (favIdx >= favList.length) favIdx = 0;
  if (favIdx < 0) favIdx = favList.length - 1;
  favList.forEach(function (c, i) {
    var row = mk('div', 'frow' + (c === state.current ? ' cur' : '') + (i === favIdx ? ' focused' : ''));
    row.appendChild(mk('div', 'fi', String(i + 1)));
    row.appendChild(mk('div', 'fn', c.name));
    favsList.appendChild(row);
  });
  var act = favsList.querySelector('.frow.focused');
  if (act) { try { act.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
}
/** Opens favorites with the current channel selected when present; no-ops if no channel is current. */
function openFavs() {
  if (!state.current) return;
  favList = state.channels.filter(isFav);
  favIdx = favList.indexOf(state.current);
  if (favIdx < 0) favIdx = 0;
  renderFavs();
  favsPanel.classList.add('open');
  showOsd();
}
/** Moves the favorite selection by delta positions with wraparound; does nothing for an empty list. */
function moveFav(delta) {
  if (!favList.length) return;
  favIdx = (favIdx + delta + favList.length) % favList.length;
  renderFavs();
}
/** Plays the selected favorite if present, then closes the favorites panel. */
function pickFav() {
  var c = favList[favIdx];
  if (c) playChannel(c);
  closeFavs();
}

var GUIDE_LIMIT = 500;
var guideProgs = [], guideIdx = 0;
/** Formats a Unix timestamp in milliseconds as a Russian local date, adding a relative label within two days of today. */
function guideDayLabel(ms) {
  var d = new Date(ms), now = new Date();
  var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var diff = Math.round((dd - d0) / 86400000);
  var rel = diff === 0 ? 'Сегодня' : diff === -1 ? 'Вчера' : diff === 1 ? 'Завтра' : diff === -2 ? 'Позавчера' : diff === 2 ? 'Послезавтра' : '';
  var wd = d.toLocaleDateString('ru-RU', { weekday: 'short' });
  var dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return (rel ? rel + ' · ' : '') + wd + ', ' + dm;
}
/** Stores and renders the supplied program order with local day headings, archive hints, and current/first-future descriptions. */
function renderGuide(programs) {
  guideProgs = programs.slice();
  guideList.textContent = '';
  if (!programs.length) { guideList.appendChild(mk('div', 'gd', 'Для этого канала нет программы передач.')); return; }
  var ch = state.current, canCap = !!(ch && (ch.catchupSource || headerCatchup.source));
  var now = Date.now(), lastDay = null, nextDone = false;
  programs.forEach(function (p, i) {
    var dk = new Date(p.s).toDateString();
    if (dk !== lastDay) { lastDay = dk; guideList.appendChild(mk('div', 'gday', guideDayLabel(p.s))); }
    var past = p.e <= now, cur = p.s <= now && p.e > now;
    var row = mk('div', 'grow' + (cur ? ' cur' : (past ? ' past' : ' fut')) + (i === guideIdx ? ' focused' : ''));
    row._idx = i;
    row.appendChild(mk('div', 'gt', fmtTime(p.s) + '\u2013' + fmtTime(p.e) + (cur ? ' · идёт сейчас' : (past && canCap ? ' · ⟲ архив' : ''))));
    row.appendChild(mk('div', 'gn', p.t));
    var showDesc = p.d && cur;
    if (!nextDone && p.s > now) { if (p.d) showDesc = true; nextDone = true; }
    if (showDesc) row.appendChild(mk('div', 'gd', p.d));
    guideList.appendChild(row);
  });
}
function guideScrollToIdx() {
  var rows = guideList.querySelectorAll('.grow');
  var row = rows[guideIdx];
  if (row) { try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
}
/** Moves the program selection by delta positions with wraparound and scrolls it into view. */
function guideMove(delta) {
  if (!guideProgs.length) return;
  guideIdx = (guideIdx + delta + guideProgs.length) % guideProgs.length;
  var rows = guideList.querySelectorAll('.grow');
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('focused', i === guideIdx);
  guideScrollToIdx();
}
/**
 * Builds an archive URL from channel or playlist header templates, returning null if neither supplies one.
 * Program s/e values are Unix milliseconds; time placeholders use Unix seconds and duration uses
 * rounded minutes with a minimum of one. Unknown placeholders remain unchanged; append mode extends ch.url.
 */
function catchupUrl(ch, p) {
  var tmpl = (ch && ch.catchupSource) || headerCatchup.source || '';
  if (!tmpl) return null;
  var mode = String((ch && ch.catchup) || headerCatchup.mode || '').toLowerCase();
  var sSec = Math.floor(p.s / 1000), eSec = Math.floor(p.e / 1000), nowSec = Math.floor(Date.now() / 1000);
  var dur = Math.max(1, Math.round((p.e - p.s) / 60000));
  var u = tmpl.replace(/\$\{([^}]+)\}|\{([^}]+)\}/g, function (m, a, b) {
    var k = String(a || b).toLowerCase();
    if (k === 'start' || k === 'utc' || k === 'stime') return String(sSec);
    if (k === 'end' || k === 'timestamp' || k === 'etime') return String(eSec);
    if (k === 'lutc' || k === 'now') return String(nowSec);
    if (k === 'duration' || k === 'dur') return String(dur);
    if (k === 'channel' || k === 'ch' || k === 'id') return encodeURIComponent((ch && ch.tvgId) || ch.name || '');
    if (k === 'name' || k === 'title') return encodeURIComponent(p.t || '');
    return m;
  });
  if (mode === 'append') {
    if (u.charAt(0) === '?' || u.charAt(0) === '&') return ch.url + (ch.url.indexOf('?') >= 0 ? '&' : '?') + u.replace(/^[?&]/, '');
    return ch.url + u;
  }
  return u;
}
/** Plays the selected past program via its archive template, resumes live for the current program, or shows why it cannot play. */
function guidePick() {
  var p = guideProgs[guideIdx], ch = state.current;
  if (!p || !ch) return;
  var now = Date.now();
  if (p.e <= now) {
    var url = catchupUrl(ch, p);
    if (!url) { showToast('У этого канала нет архива'); return; }
    closeGuide(); showToast('Архив: ' + p.t); playUrl(url);
  } else if (p.s <= now) {
    closeGuide(); playUrl(ch.url);
  } else {
    showToast('Передача ещё не началась');
  }
}
/** Requests up to 500 native EPG programs for the current channel and opens the guide at current or next; request errors produce a toast. */
async function openGuide() {
  var ch = state.current, n = native();
  if (!ch) return;
  if (!n || !epg.enabled || epg.status !== 'ok') { showToast('Телепрограмма недоступна'); return; }
  try {
    var r = await n.epgSchedule({ id: ch.tvgId, name: ch.name, alt: ch.tvgName, limit: GUIDE_LIMIT });
    var progs = r.programs || [], now = Date.now(), ci = -1;
    for (var i = 0; i < progs.length; i++) { if (progs[i].s <= now && progs[i].e > now) { ci = i; break; } }
    if (ci < 0) { for (var j = 0; j < progs.length; j++) { if (progs[j].s > now) { ci = j; break; } } }
    guideIdx = ci < 0 ? 0 : ci;
    guideTitle.textContent = ch.name;
    renderGuide(progs);
    guide.classList.add('open');
    guideScrollToIdx();
    showOsd();
  } catch (e) { showToast('Не удалось получить программу'); }
}

/* ================= Воспроизведение ================= */
/** Shows a video overlay message; a truthy isError also marks the current playback attempt as failed. */
function showVideoMsg(text, isError) {
  videoMsg.textContent = text;
  videoMsg.className = 'show' + (isError ? ' error' : '');
  if (isError) playFailed = true;
}
function hideVideoMsg() { videoMsg.className = ''; }
/** Attempts browser video playback, ignoring synchronous errors and rejected play promises, including autoplay denial. */
function safePlay() {
  try { var p = video.play(); if (p && p.catch) p.catch(function () { /* автозапуск запрещён — ждём действия */ }); } catch (e) { /* ignore */ }
}
/** Invalidates pending playback attempts, clears browser media and HLS state, and requests native playback stop. */
function stopPlayback() {
  playToken++;
  gating = false;
  hasPlayed = false;
  if (nativeErrHandler) { video.removeEventListener('error', nativeErrHandler); nativeErrHandler = null; }
  if (hls) { try { hls.destroy(); } catch (e) { /* ignore */ } hls = null; }
  try { video.pause(); } catch (e) { /* ignore */ }
  video.removeAttribute('src');
  try { video.load(); } catch (e) { /* ignore */ }
  var np = playerPlugin();
  if (np) { try { np.stop(); } catch (e) { /* ignore */ } }
}
function hlsAvailable() { return !!(window.Hls && window.Hls.isSupported()); }

/**
 * Returns buffered seconds ahead of the playhead from the first range ending no earlier than 0.1 seconds behind it.
 * Returns zero if no such range is found or buffered-range access fails.
 */
function bufferedAhead() {
  try {
    var b = video.buffered, ct = video.currentTime;
    for (var i = 0; i < b.length; i++) {
      if (b.end(i) >= ct - 0.1) return Math.max(0, b.end(i) - Math.max(ct, b.start(i)));
    }
  } catch (e) { /* ignore */ }
  return 0;
}
/**
 * Waits for ms milliseconds of buffered video, or until more than ms + 8,000 ms have elapsed, before attempting play.
 * A stale playback token or user pause cancels polling; a zero duration attempts playback immediately.
 */
function gatePlay(token, ms) {
  if (!ms) { gating = false; safePlay(); return; }
  gating = true;
  var t0 = Date.now();
  (function check() {
    if (token !== playToken || userPaused) { gating = false; return; }
    if (bufferedAhead() * 1000 >= ms || Date.now() - t0 > ms + 8000) { gating = false; safePlay(); return; }
    showVideoMsg('Буферизация…', false);
    setTimeout(check, 120);
  })();
}

/**
 * Starts browser media playback with the configured buffer delay for this playback token.
 * On a media error, tries HLS.js once if allowHlsFallback is truthy and supported; otherwise displays an error.
 */
function startNative(url, token, allowHlsFallback) {
  var handler = function () {
    if (token !== playToken) return;
    video.removeEventListener('error', handler);
    nativeErrHandler = null;
    if (allowHlsFallback && hlsAvailable()) startHls(url, token, false);
    else showVideoMsg('Не удалось воспроизвести поток', true);
  };
  nativeErrHandler = handler;
  video.addEventListener('error', handler);
  video.src = url;
  gatePlay(token, settings.bufferMs);
}
/**
 * Starts HLS.js playback for this token, retrying fatal network and media errors up to twice each.
 * Unrecovered fatal errors fall back to browser media when allowNativeFallback is truthy, or display an error.
 * Synchronous HLS setup errors propagate to the caller.
 */
function startHls(url, token, allowNativeFallback) {
  var H = window.Hls, ms = settings.bufferMs;
  var cfg = { enableWorker: true, lowLatencyMode: false, backBufferLength: 30,
    maxBufferLength: Math.max(30, Math.ceil(ms / 1000) + 15),
    manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 };
  // Для прямого эфира буфер = отступ от «живого» края
  if (ms > 0) cfg.liveSyncDuration = Math.max(1, ms / 1000); else cfg.liveSyncDurationCount = 1;
  var h = new H(cfg);
  hls = h;
  var netRetries = 0, mediaRetries = 0;
  h.on(H.Events.MANIFEST_PARSED, function () { if (token === playToken) gatePlay(token, ms); });
  h.on(H.Events.ERROR, function (ev, data) {
    if (token !== playToken || !data || !data.fatal) return;
    if (data.type === H.ErrorTypes.NETWORK_ERROR && netRetries < 2) {
      netRetries++;
      showVideoMsg('Проблема сети, повтор ' + netRetries + '…', false);
      setTimeout(function () { if (token === playToken && hls === h) h.startLoad(); }, 1200);
      return;
    }
    if (data.type === H.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
      mediaRetries++;
      h.recoverMediaError();
      return;
    }
    try { h.destroy(); } catch (e) { /* ignore */ }
    if (hls === h) hls = null;
    if (allowNativeFallback) startNative(url, token, false);
    else showVideoMsg('Ошибка потока (' + (data.details || data.type) + ')', true);
  });
  h.loadSource(url);
  h.attachMedia(video);
}
/** Starts a stream through the native player if available, otherwise chooses HLS.js or browser media with a fallback on media errors. Synchronous setup errors propagate. */
function playUrl(url) {
  if (playerPlugin()) { playNativePlayer(url); return; }
  stopPlayback();
  var token = playToken;
  playFailed = false;
  showVideoMsg('Загрузка потока…', false);
  var looksHls = /\.m3u8(\?|#|$)/i.test(url);
  if (looksHls && hlsAvailable()) startHls(url, token, true);
  else startNative(url, token, hlsAvailable());
}
var nativeListenerReady = false;
/** Registers the native player state listener once to update buffering, playing, and error UI. */
function ensureNativeListener(np) {
  if (nativeListenerReady || !np) return;
  nativeListenerReady = true;
  np.addListener('state', function (ev) {
    if (!ev || !state.current) return;
    if (ev.state === 'buffering') showVideoMsg('Буферизация…', false);
    else if (ev.state === 'playing') { hasPlayed = true; hideVideoMsg(); updateOsdState(); }
    else if (ev.state === 'error') showVideoMsg('Ошибка потока' + (ev.message ? ' (' + ev.message + ')' : ''), true);
  });
}
/** Sends video-box bounds in physical pixels to the native player when a channel is selected; rejected updates are ignored. */
function syncPlayerBounds() {
  var np = playerPlugin();
  if (!np || !state.current) return;
  var r = videoBox.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  np.setBounds({
    x: Math.round(r.left * dpr), y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr), h: Math.round(r.height * dpr)
  }).catch(function () { /* ignore */ });
}
/** Starts a native stream with the configured buffer and bounds; rejected play requests show an error if a channel is still selected. */
function playNativePlayer(url) {
  var np = playerPlugin();
  stopPlayback();
  playFailed = false;
  showVideoMsg('Загрузка потока…', false);
  ensureNativeListener(np);
  requestAnimationFrame(syncPlayerBounds);
  np.setVisible({ visible: true }).catch(function () { /* ignore */ });
  np.play({ url: url, bufferMs: settings.bufferMs }).catch(function (e) {
    if (state.current) showVideoMsg('Не удалось воспроизвести поток (' + errMsg(e) + ')', true);
  });
}
/** Selects a channel, saves its URL, clears user pause, refreshes channel/EPG UI, and starts its stream. Synchronous playback setup errors propagate. */
function playChannel(ch) {
  state.current = ch;
  userPaused = false;
  lsSet(LS_LAST, ch.url);
  nowTitle.textContent = ch.name;
  nowGroup.textContent = ch.group;
  markPlaying();
  epgPaintAll();
  scheduleEpgRefresh();
  playUrl(ch.url);
}
function togglePause() {
  if (!state.current) return;
  var np = playerPlugin();
  if (np) {
    if (userPaused) { userPaused = false; np.resume(); }
    else { userPaused = true; np.pause(); }
  } else if (userPaused || (video.paused && !gating)) { userPaused = false; safePlay(); }
  else { userPaused = true; try { video.pause(); } catch (e) { /* ignore */ } }
  updateOsdState();
  if (state.mode === 'player') showOsd();
}
/** Plays the channel delta positions away in the filtered view with wraparound; if the current channel is absent, selects an end by direction. */
function zap(delta) {
  var len = state.view.length;
  if (!len) return;
  var idx = state.view.indexOf(state.current);
  idx = idx < 0 ? (delta > 0 ? 0 : len - 1) : (idx + delta + len) % len;
  playChannel(state.view[idx]);
  showOsd();
}
video.addEventListener('playing', function () { hasPlayed = true; hideVideoMsg(); });
video.addEventListener('waiting', function () {
  if (!state.current || playFailed) return;
  showVideoMsg('Буферизация…', false);
  // Подвисание: ставим на паузу и ждём, пока снова накопится заданный буфер
  if (settings.bufferMs > 0 && hasPlayed && !gating && !userPaused && !video.seeking) {
    try { video.pause(); } catch (e) { /* ignore */ }
    gatePlay(playToken, settings.bufferMs);
  }
});
video.addEventListener('pause', updateOsdState);
video.addEventListener('play', updateOsdState);

/* ================= OSD и экран плеера ================= */
function updateOsdState() {
  if (playerPlugin()) { osdState.textContent = userPaused ? 'Пауза' : ''; return; }
  osdState.textContent = userPaused ? '\u23F8 Пауза' : '';
}
/** Shows current channel and EPG details and schedules hiding after 4.5 seconds; no-ops without a current channel. */
function showOsd() {
  if (!state.current) return;
  var idx = state.view.indexOf(state.current);
  osdNum.textContent = idx >= 0 ? (idx + 1) + ' / ' + state.view.length : '';
  osdName.textContent = state.current.name;
  osdGroup.textContent = state.current.group;
  updateOsdState();
  epgPaintAll();
  osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(function () { hideOsd(false); }, 4500);
}
/** Hides playback controls unless paused or a guide/favorites panel is open; a truthy force overrides those conditions. */
function hideOsd(force) {
  if ((userPaused || guideOpen() || favOpen()) && !force) return;      // на паузе или с открытой программой панель остаётся
  clearTimeout(osdTimer);
  osd.classList.remove('show');
}
function toggleControls() {
  if (osd.classList.contains('show')) hideOsd(true); else showOsd();
}
/** Enters the full-screen player layout for the current channel and schedules native bounds synchronization. */
function enterPlayer() {
  if (state.mode === 'player' || !state.current) return;
  state.mode = 'player';
  document.body.classList.add('player');
  showOsd();
  requestAnimationFrame(syncPlayerBounds);
}
/** Returns from player mode to the channel menu, closes player panels, and restores navigation focus while playback continues. */
function showMenu() {
  if (state.mode !== 'player') return;
  state.mode = 'menu';
  document.body.classList.remove('player');
  closeGuide();
  closeFavs();
  hideOsd(true);
  if (state.group === GROUP_FAV) { computeView(); renderGrid(true); }
  requestAnimationFrame(syncPlayerBounds);
  setFocus(cardMap.get(state.current) || videoBox);
}

/* ================= Кнопка «Назад» ================= */
var lastBackAt = 0, lastBackHandled = 0;
function exitApp() {
  var app = appPlugin();
  if (app && app.exitApp) app.exitApp(); else { try { window.close(); } catch (e) { /* ignore */ } }
}
/** Handles Back at most once per 250 ms, closing overlays or player mode first; in the menu, two presses within two seconds request exit. */
function handleBack() {
  var t = Date.now();
  if (t - lastBackHandled < 250) return;   // одно нажатие не должно обработаться дважды
  lastBackHandled = t;
  if (pinpadOpen()) { pinClose(); return; }
  if (guideOpen()) { closeGuide(); return; }
  if (libraryOpen()) { closeLibrary(); return; }
  if (settingsOpen()) { closeSettings(); return; }
  if (state.mode === 'player') { showMenu(); return; }
  var ae = document.activeElement;
  if (isText(ae)) { ae.blur(); return; }
  if (t - lastBackAt < 2000) { exitApp(); return; }
  lastBackAt = t;
  showToast('Нажмите «Назад» ещё раз для выхода');
}
(function registerBack() {
  var app = appPlugin();
  if (app && app.addListener) {
    try { app.addListener('backButton', function () { handleBack(); }); } catch (e) { /* ignore */ }
  }
})();

/* ================= Настройки ================= */
function settingsOpen() { return settingsEl.classList.contains('open'); }
var bufAtOpen = 0;
function updateLastReload() {
  var t = parseInt(lsGet(LS_RELOADED), 10), ent = state.entry;
  if (!ent) lastReloadEl.textContent = 'Плейлист ещё не открыт.';
  else if (ent.kind === 'file') lastReloadEl.textContent = 'Открыт файл «' + ent.fileName + '». Кнопка «Обновить» перечитывает его из «Загрузок».';
  else lastReloadEl.textContent = t ? 'Последнее обновление: ' + new Date(t).toLocaleString('ru-RU') : 'Плейлист ещё не обновлялся.';
}
function syncSettingsUi() {
  bufRange.value = settings.bufferMs;
  bufNum.value = settings.bufferMs;
  bufVal.textContent = settings.bufferMs + ' мс';
  autoChk.checked = settings.autoReload;
  hoursNum.value = settings.reloadHours;
  updateLastReload();
  renderEpgInfo();
  renderServerUi();
  syncAutoStartUi();
}
/** Reads native autostart state when supported; disables the control if unavailable and ignores read failures. */
function syncAutoStartUi() {
  var n = native();
  if (!n || !n.getAutoStart) { autoStartChk.disabled = true; autoStartChk.checked = false; return; }
  autoStartChk.disabled = false;
  n.getAutoStart().then(function (r) { autoStartChk.checked = !!(r && r.on); }).catch(function () { /* ignore */ });
}
/** Parses and saves a buffer duration in milliseconds, clamped to 0–7,000; invalid input retains the current value. */
function setBuffer(v) {
  settings.bufferMs = toInt(v, settings.bufferMs, 0, 7000);
  lsSet(LS_BUF, String(settings.bufferMs));
  syncSettingsUi();
}
/** Opens settings and focuses the buffer control, recording its value so closing can apply a changed buffer to playback. */
async function openSettings() {
  if (libraryOpen()) closeLibrary();
  bufAtOpen = settings.bufferMs;
  syncSettingsUi();
  settingsEl.classList.add('open');
  setFocus(bufRange, false);
  refreshServerStatus();
}
/** Closes settings, restores button focus, and restarts the current channel if the buffer changed while open. */
function closeSettings() {
  if (!settingsOpen()) return;
  settingsEl.classList.remove('open');
  setFocus(settingsBtn, false);
  if (settings.bufferMs !== bufAtOpen && state.current) playChannel(state.current);   // применить новый буфер сразу
}
bufRange.addEventListener('input', function () { setBuffer(bufRange.value); });
bufNum.addEventListener('change', function () { setBuffer(bufNum.value); });
autoChk.addEventListener('change', function () {
  settings.autoReload = autoChk.checked;
  lsSet(LS_AUTO, settings.autoReload ? '1' : '0');
  if (settings.autoReload) autoTick();
});
autoStartChk.addEventListener('change', function () {
  var n = native();
  if (!n || !n.setAutoStart) return;
  n.setAutoStart({ on: autoStartChk.checked }).then(function () {
    showToast(autoStartChk.checked ? 'Автозапуск включён' : 'Автозапуск выключен');
  }).catch(function () { /* ignore */ });
});
hoursNum.addEventListener('change', function () {
  settings.reloadHours = toInt(hoursNum.value, settings.reloadHours, 1, 168);
  lsSet(LS_HOURS, String(settings.reloadHours));
  syncSettingsUi();
});
epgChk.addEventListener('change', function () {
  epg.enabled = epgChk.checked;
  lsSet(LS_EPG, epg.enabled ? '1' : '0');
  epgReload(false);
});
$('epgReloadBtn').addEventListener('click', function () { epgReload(true); });
$('epgResetBtn').addEventListener('click', function () {
  epg.file = '';
  lsSet(LS_EPGFILE, '');
  showToast('Файл EPG сброшен');
  epgReload(true);
});
$('clearCacheBtn').addEventListener('click', async function () {
  var n = native();
  if (!n || !n.clearCache) { showToast('Очистка кэша доступна только в приложении'); return; }
  try {
    var r = await n.clearCache();
    showToast('Кэш очищен: освобождено ' + fmtSize((r && r.freed) || 0));
  } catch (e) { showToast('Не удалось очистить кэш: ' + errMsg(e), 3500); }
});
srvChk.addEventListener('click', function () { setServer(!srv.running); });
srvBtn.addEventListener('click', function () { setServer(!srv.running); });
$('libClose').addEventListener('click', closeLibrary);
$('reloadNow').addEventListener('click', function () { reloadPlaylist(true); });
$('closeSettings').addEventListener('click', closeSettings);
settingsEl.addEventListener('click', function (e) { if (e.target === settingsEl) closeSettings(); });
libraryEl.addEventListener('click', function (e) { if (e.target === libraryEl) closeLibrary(); });
settingsBtn.addEventListener('click', openSettings);
libBtn.addEventListener('click', openLibrary);
reloadBtn.addEventListener('click', function () { reloadPlaylist(true); });
$('pinSetBtn').addEventListener('click', function () {
  // смена существующего PIN требует авторизации (первоначальная установка — без неё)
  if (parentPin && !pinUnlocked) { pinOpen('unlock'); showToast('Сначала введите текущий PIN'); return; }
  pinOpen('set');
});
$('pinClearBtn').addEventListener('click', function () {
  if (!parentPin) { showToast('PIN не задан'); return; }
  // снятие PIN возможно только после разблокировки или ввода текущего PIN в настройках
  if (!pinUnlocked) {
    var p = window.prompt('Для снятия PIN введите текущий PIN (3 цифры):');
    if (p === null) return;
    if (String(p).trim() !== parentPin) { showToast('Неверный PIN'); return; }
  }
  parentPin = ''; lsSet('iptv.pin', ''); pinUnlocked = false; buildGroups(); computeView(); renderGroups(); renderGrid(false); showToast('PIN снят');
});
pinCancel.addEventListener('click', pinClose);

// Свайп вверх/вниз по видео — переключение каналов
var sw = null;
videoBox.addEventListener('touchstart', function (e) {
  if (state.mode !== 'player' || e.touches.length !== 1) { sw = null; return; }
  var t = e.touches[0];
  sw = { x: t.clientX, y: t.clientY };
}, { passive: true });
videoBox.addEventListener('touchend', function (e) {
  if (!sw) return;
  var t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  sw = null;
  if (guideOpen() || favOpen()) return;
  if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    swipedAt = Date.now();
    zap(dy < 0 ? 1 : -1);
  }
}, { passive: true });

// Долгое нажатие на канал — в избранное
var lpTimer = null, lpStart = null;
function cancelLongPress() { clearTimeout(lpTimer); lpTimer = null; }
grid.addEventListener('touchstart', function (e) {
  lpFired = false;
  if (e.target.closest && e.target.closest('.card .star')) { cancelLongPress(); return; }
  var el = e.target.closest ? e.target.closest('.card') : null;
  if (!el || !el._channel || e.touches.length !== 1) { cancelLongPress(); return; }
  var t = e.touches[0];
  lpStart = { x: t.clientX, y: t.clientY };
  cancelLongPress();
  lpTimer = setTimeout(function () { lpTimer = null; lpFired = true; toggleFav(el._channel); }, 550);
}, { passive: true });
grid.addEventListener('touchmove', function (e) {
  if (!lpTimer || !lpStart) return;
  var t = e.touches[0];
  if (Math.abs(t.clientX - lpStart.x) > 12 || Math.abs(t.clientY - lpStart.y) > 12) cancelLongPress();
}, { passive: true });
grid.addEventListener('touchend', cancelLongPress, { passive: true });
grid.addEventListener('touchcancel', cancelLongPress, { passive: true });
grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
// Тап по звёздочке на карточке — вкл/выкл избранное
grid.addEventListener('click', function (e) {
  var st = e.target.closest ? e.target.closest('.card .star') : null;
  if (!st) return;
  var card = st.closest('.card');
  if (card && card._channel) { e.preventDefault(); e.stopPropagation(); toggleFav(card._channel); }
});

/* ================= D-Pad навигация ================= */
/** Returns visible navigation targets within the first open overlay, or the whole document if none is open. */
function navItems() {
  var root = document.querySelector('.overlay.open') || document;
  return Array.prototype.slice.call(root.querySelectorAll('[data-nav]')).filter(function (el) { return el.getClientRects().length > 0; });
}
/** Moves the navigation highlight and blurs another text input; scrolls the target into view unless scroll is false. */
function setFocus(el, scroll) {
  if (!el) return;
  if (focusedEl && focusedEl !== el) focusedEl.classList.remove('focused');
  var ae = document.activeElement;
  if (isText(ae) && ae !== el) ae.blur();
  focusedEl = el;
  el.classList.add('focused');
  if (scroll !== false) {
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
    catch (e) { el.scrollIntoView(); }
  }
}
/** Moves the highlight left/right/up/down among visible targets, preferring candidates in the same row or column. */
function moveFocus(dir) {
  var items = navItems();
  if (!items.length) return;
  if (!focusedEl || items.indexOf(focusedEl) === -1) { setFocus(items[0]); return; }
  var c = focusedEl.getBoundingClientRect();
  var ccx = c.left + c.width / 2, ccy = c.top + c.height / 2;
  var best = null, bestScore = Infinity;          // любой подходящий (запасной вариант)
  var bestSame = null, bestSameScore = Infinity;  // приоритет: элемент в том же ряду/колонке
  for (var i = 0; i < items.length; i++) {
    var el = items[i];
    if (el === focusedEl) continue;
    var r = el.getBoundingClientRect();
    var rcx = r.left + r.width / 2, rcy = r.top + r.height / 2;
    var primary, secondary, same;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'right' ? rcx <= ccx + 2 : rcx >= ccx - 2) continue;
      secondary = Math.abs(rcy - ccy);
      if (el !== videoBox && secondary > Math.max(c.height, r.height) * 0.8) continue;
      primary = Math.abs(rcx - ccx);
      same = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top) > 0;   // перекрытие по вертикали — тот же ряд
    } else {
      if (dir === 'down' ? rcy <= ccy + 2 : rcy >= ccy - 2) continue;
      secondary = Math.abs(rcx - ccx);
      primary = Math.abs(rcy - ccy);
      same = Math.min(c.right, r.right) - Math.max(c.left, r.left) > 0;   // перекрытие по горизонтали — та же колонка
    }
    var score = primary + secondary * (same ? 0.4 : 2.5);
    if (score < bestScore) { bestScore = score; best = el; }
    if (same && score < bestSameScore) { bestSameScore = score; bestSame = el; }
  }
  var pick = bestSame || best;
  if (pick) setFocus(pick);
}
/** Activates a navigation target, using its custom action, input interaction, group selection, or channel playback behavior. */
function activate(el) {
  if (!el) return;
  if (el._act) { el._act(); return; }
  if (isText(el)) {
    el.focus();
    try { var n = el.value.length; el.setSelectionRange(n, n); } catch (e) { /* ignore */ }
  } else if (el.tagName === 'BUTTON' || el.type === 'checkbox' || el.type === 'file') {
    el.click();
  } else if (el === videoBox) {
    if (state.current) enterPlayer(); else setStatus('Сначала выберите канал справа.', 'warn');
  } else if (el._group !== undefined) {
    setGroup(el._group);
  } else if (el.classList.contains('more')) {
    showMore();
  } else if (el._channel) {
    if (state.current === el._channel && !playFailed) enterPlayer(); else playChannel(el._channel);
  }
}
/** Normalizes supported keyboard and TV remote keys to navigation actions, returning null for unrecognized keys. */
function keyName(e) {
  switch (e.key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': return 'enter';
    case 'Escape': case 'Backspace': case 'GoBack': case 'BrowserBack': return 'back';
  }
  switch (e.keyCode) {
    case 38: return 'up';
    case 40: return 'down';
    case 37: return 'left';
    case 39: return 'right';
    case 13: case 23: return 'enter';
    case 27: case 8: case 4: return 'back';
  }
  return null;
}
/** Routes keyboard and TV remote actions by player, panel, or text-editing state, preventing defaults for handled navigation. */
function onKeyDown(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') { e.preventDefault(); togglePause(); return; }
  if (state.mode === 'player' && (e.key === 'ChannelUp' || e.key === 'ChannelDown')) { e.preventDefault(); zap(e.key === 'ChannelUp' ? -1 : 1); return; }

  // Кнопка «Меню» на пульте в плеере — текущий канал в избранное
  if (state.mode === 'player' && (e.key === 'ContextMenu' || (e.keyCode === 82 && e.key !== 'r' && e.key !== 'R'))) {
    e.preventDefault();
    if (state.current) { toggleFav(state.current); showOsd(); }
    return;
  }

  // Режим плеера
  if (state.mode === 'player') {
    var pk = keyName(e);
    if (!pk) return;
    e.preventDefault();
    if (favOpen()) {                            // панель избранного открыта
      if (pk === 'back' || pk === 'left' || pk === 'right') { closeFavs(); return; }
      if (pk === 'up' || pk === 'down') { if (!e.repeat) moveFav(pk === 'up' ? -1 : 1); return; }
      if (pk === 'enter') { if (!e.repeat) pickFav(); return; }
      return;
    }
    if (guideOpen()) {                          // телепрограмма открыта
      if (pk === 'back' || pk === 'left' || pk === 'right') { closeGuide(); return; }
      if (pk === 'up') { if (!e.repeat) guideMove(-1); return; }
      if (pk === 'down') { if (!e.repeat) guideMove(1); return; }
      if (pk === 'enter') { if (!e.repeat) guidePick(); return; }
      return;
    }
    if (pk === 'back') handleBack();
    else if (pk === 'up') { if (!e.repeat) zap(-1); }
    else if (pk === 'down') { if (!e.repeat) zap(1); }
    else if (pk === 'right') { if (!e.repeat) openFavs(); }
    else if (pk === 'left') { if (!e.repeat) openGuide(); }
    else if (pk === 'enter') { if (!e.repeat) startOkHold(); }
    return;
  }

  // Редактирование текста (ссылка, поиск, числа в настройках)
  var ae = document.activeElement;
  if (isText(ae)) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      ae.blur();
      if (ae === urlInput) loadFromUrl();
      return;
    }
    if (e.key === 'Escape' || e.key === 'GoBack' || e.keyCode === 4) { e.preventDefault(); ae.blur(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); ae.blur(); moveFocus(e.key === 'ArrowUp' ? 'up' : 'down'); return; }
    return;   // остальные клавиши (в том числе Backspace и ←/→) работают как обычно
  }

  // Кнопка «Меню» на пульте — добавить/убрать канал из избранного
  if ((e.key === 'ContextMenu' || (e.keyCode === 82 && e.key !== 'r' && e.key !== 'R')) && focusedEl && focusedEl._channel) {
    e.preventDefault();
    toggleFav(focusedEl._channel);
    return;
  }

  // Режим меню
  var k = keyName(e);
  if (!k) return;
  e.preventDefault();
  if (k === 'back') { handleBack(); return; }
  if (focusedEl === bufRange && (k === 'left' || k === 'right')) { setBuffer(Number(bufRange.value) + (k === 'right' ? 100 : -100)); return; }
  if (k === 'enter') { if (!e.repeat) activate(focusedEl); }
  else moveFocus(k);
}
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('resize', function () { requestAnimationFrame(syncPlayerBounds); });

/* ===== Управление плеером с пульта: короткое OK — пауза, удержание OK — в избранное ===== */
var okHoldTimer = null;
/** Starts a 700 ms OK hold timer to toggle the current favorite; releasing earlier is handled as pause by onKeyUp. */
function startOkHold() {
  clearTimeout(okHoldTimer);
  okHoldTimer = setTimeout(function () {
    okHoldTimer = null;
    if (state.current) { toggleFav(state.current); showOsd(); }
  }, 700);
}
/** On OK release in player mode, cancels an unexpired hold timer and toggles pause; a completed hold does not pause. */
function onKeyUp(e) {
  if (state.mode !== 'player') return;
  if (keyName(e) !== 'enter') return;
  if (okHoldTimer) { clearTimeout(okHoldTimer); okHoldTimer = null; togglePause(); }
}
window.addEventListener('keyup', onKeyUp, true);
/** Restores the menu navigation highlight after focus changes, leaving active text/file inputs and player mode alone. */
function restoreNavFocus() {
  if (state.mode === 'player') return;
  var ae = document.activeElement;
  if (isText(ae) || (ae && ae.tagName === 'INPUT' && ae.type === 'file')) return;
  if (focusedEl && document.body.contains(focusedEl)) setFocus(focusedEl, false);
  else { var it = navItems(); if (it.length) setFocus(it[0], false); }
}
window.addEventListener('focus', function () { setTimeout(restoreNavFocus, 60); });

// Мышь / тач и синхронизация подсветки с реальным фокусом
var tapEl = null, tapAt = 0;
document.addEventListener('click', function (e) {
  // Кнопки панели плеера обрабатываются своими обработчиками: иначе после смены режима клик снова откроет полный экран
  if (pinpadOpen() && !(e.target.closest && e.target.closest('.pinpad-panel'))) { pinClose(); return; }
  if (e.target.closest && e.target.closest('.card .star')) return;   // звёздочку обрабатывает свой обработчик
  if (e.target.closest && e.target.closest('#favs')) { closeFavs(); return; }
  if (e.target.closest && e.target.closest('#guide')) {
    var gr = e.target.closest('.grow');
    if (gr && gr._idx != null) { guideIdx = gr._idx; guidePick(); } else closeGuide();
    return;
  }
  if (Date.now() - swipedAt < 400) return;
  if (state.mode === 'player') {
    toggleControls();      // тап по экрану показывает / прячет панель
    return;
  }
  if (lpFired) { lpFired = false; return; }   // после долгого нажатия канал не запускаем
  var el = e.target.closest ? e.target.closest('[data-nav]') : null;
  if (!el) return;
  setFocus(el, false);
  if (el._channel) {                          // двойной тап по каналу — на весь экран
    var t = Date.now();
    if (tapEl === el && t - tapAt < 350) {
      tapEl = null; tapAt = 0;
      if (state.current !== el._channel || playFailed) playChannel(el._channel);
      enterPlayer();
      return;
    }
    tapEl = el; tapAt = t;
  }
  if (el._act || el === videoBox || el.classList.contains('more') || el._channel || el._group !== undefined) activate(el);
});
document.addEventListener('focusin', function (e) {
  var el = e.target;
  if (el && el.matches && el.matches('[data-nav]') && el !== focusedEl) setFocus(el, false);
});

loadBtn.addEventListener('click', function () { loadFromUrl(); });
fileInput.addEventListener('change', loadFromFile);
searchInput.addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilter, 200);
});

// Автообновление плейлиста и телепрограммы: проверка раз в минуту и при возврате в приложение
setInterval(function () { autoTick(); if (!document.hidden) epgRefresh(); }, 60000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) { autoTick(); epgRefresh(); setTimeout(restoreNavFocus, 60); } });

/* ================= Пульт Remote Supremacy (мост из нативного сервера) ================= */
/**
 * Returns a remote-control snapshot with at most the first 800 filtered channels and their zero-based view indices.
 * Counts describe the full lists; playing indicates a selected channel, not confirmed media playback.
 */
function remoteState() {
  var chans = state.view.slice(0, 800).map(function (c, i) {
    return { i: i, name: c.name, group: c.group, url: c.url, playing: c === state.current, fav: favs.has(c.url) };
  });
  return {
    ok: true,
    current: state.current ? { name: state.current.name, group: state.current.group, url: state.current.url } : null,
    playing: !!state.current,
    paused: !!userPaused,
    count: state.channels.length,
    viewCount: state.view.length,
    query: searchInput.value,
    group: state.group,
    groups: (state.groups || []).map(function (g) { return { key: g.key, label: g.label, count: g.count }; }),
    favGroup: GROUP_FAV,
    favCount: state.channels.filter(isFav).length,
    blocked: Array.from(blockedGroups),
    pinSet: !!parentPin,
    locked: !pinUnlocked,
    channels: chans
  };
}
/** Serializes all current channels, including hidden ones, as M3U with the header EPG URL and selected channel metadata; catch-up attributes are omitted. */
function buildM3uText() {
  var headAttrs = [];
  if (headerEpgUrl) headAttrs.push('url-tvg="' + headerEpgUrl + '"');
  if (headerCatchup.mode) headAttrs.push('catchup="' + headerCatchup.mode + '"');
  if (headerCatchup.source) headAttrs.push('catchup-source="' + headerCatchup.source + '"');
  if (headerCatchup.days) headAttrs.push('catchup-days="' + headerCatchup.days + '"');
  var head = '#EXTM3U' + (headAttrs.length ? ' ' + headAttrs.join(' ') : '');
  var out = [head];
  state.channels.forEach(function (c) {
    var a = [];
    if (c.tvgId) a.push('tvg-id="' + c.tvgId + '"');
    if (c.tvgName) a.push('tvg-name="' + c.tvgName + '"');
    if (c.logo) a.push('tvg-logo="' + c.logo + '"');
    if (c.group) a.push('group-title="' + c.group + '"');
    // catchup-атрибуты канала — только если они отличаются от значений заголовка
    if (c.catchup && c.catchup !== headerCatchup.mode) a.push('catchup="' + c.catchup + '"');
    if (c.catchupSource && c.catchupSource !== headerCatchup.source) a.push('catchup-source="' + c.catchupSource + '"');
    if (c.catchupDays && c.catchupDays !== headerCatchup.days) a.push('catchup-days="' + c.catchupDays + '"');
    out.push('#EXTINF:-1' + (a.length ? ' ' + a.join(' ') : '') + ',' + c.name);
    out.push(c.url);
  });
  return out.join('\n') + '\n';
}
/** Renames the first channel matching cmd.url and refreshes the view; returns remote state or an error result if absent. */
function remoteRename(cmd) {
  var c = state.channels.filter(function (x) { return x.url === cmd.url; })[0];
  if (!c) return { ok: false, error: 'канал не найден' };
  c.name = String(cmd.name || c.name);
  c.nameLower = c.name.toLowerCase();
  computeView(); renderGroups(); renderGrid(true);
  return remoteState();
}
/** Removes all channels matching cmd.url and clears a matching current selection; returns refreshed remote state or a not-found error result. */
function remoteDelChannel(cmd) {
  var before = state.channels.length;
  state.channels = state.channels.filter(function (x) { return x.url !== cmd.url; });
  if (state.channels.length === before) return { ok: false, error: 'канал не найден' };
  if (state.current && state.current.url === cmd.url) state.current = null;
  buildGroups(); computeView(); renderGroups(); renderGrid(false);
  return remoteState();
}
/** Removes all channels in cmd.key (null or GROUP_NONE means ungrouped); returns refreshed remote state or a not-found error result. */
function remoteDelGroup(cmd) {
  var key = (cmd.key === GROUP_NONE || cmd.key == null) ? '' : String(cmd.key);
  var before = state.channels.length;
  state.channels = state.channels.filter(function (x) { return (x.group || '') !== key; });
  if (state.channels.length === before) return { ok: false, error: 'группа не найдена' };
  buildGroups(); computeView(); renderGroups(); renderGrid(false);
  return remoteState();
}
var remoteNote = '';
/** Saves an M3U edit snapshot for the open entry, silently ignoring persistence errors; no-ops without an entry. */
function persistChannels() {
  if (!state.entry) return;
  try { lsSet('iptv.edit.' + state.entry.id, buildM3uText()); } catch (e) { /* ignore */ }
}
/**
 * Moves channels from cmd.sources (an array or pipe-separated string of group names) into cmd.target.
 * GROUP_NONE as target means ungrouped. Persists edits and returns refreshed remote state with a moved count.
 */
function remoteMergeGroups(cmd) {
  var target = String(cmd.target || '');
  var sources = cmd.sources;
  if (typeof sources === 'string') sources = sources.split('|').filter(Boolean);
  if (!Array.isArray(sources)) sources = [];
  var set = {};
  sources.forEach(function (s) { set[s] = 1; });
  var moved = 0;
  state.channels.forEach(function (c) {
    var k = c.group || '';
    if (set[k]) { c.group = (target === GROUP_NONE ? '' : target); c.groupLower = c.group.toLowerCase(); moved++; }
  });
  if (state.group && set[state.group === GROUP_NONE ? '' : state.group]) state.group = GROUP_ALL;
  buildGroups(); computeView(); renderGroups(); renderGrid(false);
  persistChannels();
  var s = remoteState(); s.moved = moved; return s;
}
/** Persists blocking for cmd.key, or unblocks it when cmd.on is false, 0, or "0"; refreshes visibility and returns remote state. */
function remoteBlockGroup(cmd) {
  var key = String(cmd.key || '');
  var off = (cmd.on === false || cmd.on === '0' || cmd.on === 0);
  if (off) {
    // разблокировка группы требует авторизации: pinUnlocked или корректный cmd.pin; блокировка — нет
    if (!pinUnlocked) {
      if (!parentPin || String(cmd.pin || '') !== parentPin) return { ok: false, error: 'неверный PIN' };
      pinUnlocked = true;
    }
    blockedGroups['delete'](key);
  } else blockedGroups.add(key);
  saveBlocked();
  if (state.group && blockedGroups.has(state.group) && !pinUnlocked) state.group = GROUP_ALL;
  buildGroups(); computeView(); renderGroups(); renderGrid(false);
  return remoteState();
}
window.RemoteAPI = {
  /**
   * Dispatches a native server command, defaulting to state; channel indices refer to the filtered view.
   * Returns state, command data, or an acknowledgment. Unknown commands and synchronous exceptions become
   * { ok: false, error } results. Asynchronous loads, saves, and resets may still be pending after acknowledgment;
   * lastNote reports later save/reset messages.
   */
  handle: function (cmd) {
    try {
      cmd = cmd || {};
      var name = String(cmd.cmd || 'state');
      if (name === 'state') return remoteState();
      if (name === 'next') { zap(1); return remoteState(); }
      if (name === 'prev') { zap(-1); return remoteState(); }
      if (name === 'select') {
        var i = parseInt(cmd.i, 10);
        if (isFinite(i) && state.view[i]) { playChannel(state.view[i]); return remoteState(); }
        return { ok: false, error: 'нет канала с таким индексом' };
      }
      if (name === 'open') {
        var oi = parseInt(cmd.i, 10);
        if (isFinite(oi) && state.view[oi]) { playChannel(state.view[oi]); enterPlayer(); return remoteState(); }
        return { ok: false, error: 'нет канала с таким индексом' };
      }
      if (name === 'fullscreen') { if (state.current) enterPlayer(); return remoteState(); }
      if (name === 'fav') {
        var fc = state.channels.filter(function (x) { return x.url === cmd.url; })[0];
        if (fc) toggleFav(fc);
        return remoteState();
      }
      if (name === 'search') { searchInput.value = cmd.q || ''; applyFilter(); return remoteState(); }
      if (name === 'group') { setGroup(cmd.key || GROUP_ALL); return remoteState(); }
      if (name === 'loadUrl') { urlInput.value = cmd.url || ''; lsSet(LS_URL, urlInput.value); loadFromUrl(); return { ok: true, note: 'гружу плейлист по ссылке' }; }
      if (name === 'export') { return { ok: true, m3u: buildM3uText(), count: state.channels.length }; }
      if (name === 'openFile') { if (cmd.name) openDownloadFile(cmd.name); return { ok: true, note: 'открываю файл ' + (cmd.name || '') }; }
      if (name === 'rename') { var r1 = remoteRename(cmd); persistChannels(); return r1; }
      if (name === 'delChannel') { var r2 = remoteDelChannel(cmd); persistChannels(); return r2; }
      if (name === 'delGroup') { var r3 = remoteDelGroup(cmd); persistChannels(); return r3; }
      if (name === 'mergeGroups') return remoteMergeGroups(cmd);
      if (name === 'blockGroup') return remoteBlockGroup(cmd);
      if (name === 'setPin') {
        var newPin = String(cmd.pin || '').replace(/[^0-9]/g, '').slice(0, 3);
        // смена/снятие существующего PIN требует авторизации: pinUnlocked или текущий PIN в cmd.current
        if (parentPin && !pinUnlocked) {
          var cur = String(cmd.current != null ? cmd.current : '').replace(/[^0-9]/g, '');
          if (cur !== parentPin) return { ok: false, error: 'требуется текущий PIN' };
        }
        parentPin = newPin; lsSet('iptv.pin', parentPin); return { ok: true, pinSet: !!parentPin };
      }
      if (name === 'unlock') { if (parentPin && String(cmd.pin || '') === parentPin) { pinUnlocked = true; buildGroups(); computeView(); renderGroups(); renderGrid(false); return remoteState(); } return { ok: false, error: 'неверный PIN' }; }
      if (name === 'lock') { pinUnlocked = false; buildGroups(); computeView(); renderGroups(); renderGrid(false); return remoteState(); }
      if (name === 'clearEdits') { if (state.entry) lsSet('iptv.edit.' + state.entry.id, ''); return { ok: true }; }
  if (name === 'lastNote') { return { ok: true, note: remoteNote }; }
  if (name === 'saveFile') {
    var se = state.entry, sn = native();
    if (!se || se.kind !== 'file' || !se.fileName) return { ok: false, error: 'Текущий плейлист не файл на устройстве. Для ссылки используйте «Скачать текущий».' };
    if (!sn || !sn.writeFile) return { ok: false, error: 'Запись файла недоступна' };
    remoteNote = '';
    sn.writeFile({ name: se.fileName, text: buildM3uText() })
      .then(function () { remoteNote = 'Сохранено в файл ' + se.fileName; showToast('Сохранено в файл'); })
      .catch(function (er) { remoteNote = 'Не удалось сохранить: ' + errMsg(er); showToast('Не удалось сохранить файл'); });
    return { ok: true, note: 'Записываю в ' + se.fileName + '…' };
  }
  if (name === 'resetEdits') {
    var re = state.entry;
    if (!re) return { ok: false, error: 'Нет открытого плейлиста' };
    lsSet('iptv.edit.' + re.id, '');
    remoteNote = '';
    (async function () {
      try {
        var ent = await libGet(re.id), nn = native();
        if (ent && ent.kind === 'file' && ent.text && re.fileName && nn && nn.writeFile) {
          await nn.writeFile({ name: re.fileName, text: ent.text });
        }
      } catch (x) { /* файл не восстановлен, сбросим хотя бы кэш */ }
      await openEntry(re.id, true);
      remoteNote = 'Правки сброшены, исходный плейлист восстановлен';
    })();
    return { ok: true, note: 'Сбрасываю правки…' };
  }
      if (name === 'setEpg') {
        headerEpgUrl = cmd.url || '';
        epg.file = ''; lsSet(LS_EPGFILE, '');
        epg.enabled = !!cmd.url; lsSet(LS_EPG, epg.enabled ? '1' : '0');
        if (state.current) scheduleEpgReload(); else epgReload(true);
        return { ok: true, note: 'EPG: ' + (cmd.url || 'выключен') };
      }
      return { ok: false, error: 'неизвестная команда: ' + name };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
};

/* ================= Старт ================= */
(async function boot() {
  var savedUrl = lsGet(LS_URL);
  if (savedUrl) urlInput.value = savedUrl;
  syncSettingsUi();
  renderGroups();
  setFocus(urlInput, false);
  setTimeout(renderQr, 2000);
  if (playerPlugin()) { document.documentElement.classList.add('native'); document.body.classList.add('native'); ensureNativeListener(playerPlugin()); }
  if (native()) {
    if (lsGet(LS_SRV) === '1') setServer(true); else refreshServerStatus();
  }
  var entry = null, id = lsGet(LS_ENTRY);
  if (id) { try { entry = await libGet(id); } catch (e) { entry = null; } }
  if (entry) await openEntry(entry.id, true);
  else if (savedUrl) loadFromUrl();
})();
})();
