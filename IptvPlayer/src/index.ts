import type Hls from 'hls.js';
import type { HlsConfig, Events, ErrorData } from 'hls.js';
import type { AppPlugin } from '@capacitor/app';
import type { IptvNativePlugin, IptvPlayerPlugin, NativePlayerEvent, CapacitorHttpType, EpgLookupResponse } from './plugins';
import type { Channel, ChannelInput, Group, PlaylistSource, PlaylistIdentity, PlaylistEntry, PlaylistOptions, PlayerState, Settings, CatchupDefaults, EpgProgram, EpgState, ServerStatus, ServerFile, RemoteCommand, RemoteResponse, RemoteState, RemoteChannel, Point, Direction, RemoteKey, NavMetadata, NavElement } from './models';
// Strikte Typisierung: siehe ../MIGRATION.md.
import { requiredElement } from './dom';
import { tr, trIn, trLoose, getLang, setLang, hasLangChoice, locale, applyStatic, buildLangButtons, LANGS, ERR_KEYS, RETRY_KEY } from './i18n';
import type { Lang, StreamErrKind } from './i18n';

/* ================= Константы ================= */
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LS_URL = 'iptv.playlistUrl', LS_LAST = 'iptv.lastChannel', LS_FAVS = 'iptv.favs', LS_GROUP = 'iptv.group';
const LS_BUF = 'iptv.bufferMs', LS_AUTO = 'iptv.autoReload', LS_HOURS = 'iptv.reloadHours', LS_RELOADED = 'iptv.lastReload';
const LS_ENTRY = 'iptv.entry', LS_SRV = 'iptv.serverOn', LS_PORT = 'iptv.serverPort', LS_EPG = 'iptv.epgOn', LS_EPGFILE = 'iptv.epgFile';
const PAGE_SIZE = 300;
const GROUP_ALL = '', GROUP_FAV = '\u0001', GROUP_NONE = '\u0002';
const HTTP_HEADERS = {
  'User-Agent': DESKTOP_UA,
  'Referer': 'https://google.com',
  'Accept': '*/*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
};

/* ================= Элементы ================= */
function $(id: string): NavElement { return requiredElement<NavElement>(id); }
const urlInput = requiredElement<HTMLInputElement>('urlInput'), loadBtn = $('loadBtn'), fileInput = requiredElement<HTMLInputElement>('fileInput'), searchInput = requiredElement<HTMLInputElement>('searchInput');
const reloadBtn = $('reloadBtn'), settingsBtn = $('settingsBtn'), libBtn = $('libBtn');
const countEl = $('count'), statusEl = $('status'), grid = $('grid'), gridPane = $('gridPane'), groupBar = $('groupBar');
const videoBox = $('videoBox'), video = requiredElement<HTMLVideoElement>('video');
const videoMsg = $('videoMsg'), nowTitle = $('nowTitle'), nowGroup = $('nowGroup');
const nowEpg = $('nowEpg'), nowEpgNow = $('nowEpgNow'), nowEpgNext = $('nowEpgNext'), nowEpgBar = $('nowEpgBar');
const osd = $('osd'), osdNum = $('osdNum'), osdName = $('osdName'), osdGroup = $('osdGroup'), osdState = $('osdState');
const osdEpg = $('osdEpg'), osdEpgNow = $('osdEpgNow'), osdEpgNext = $('osdEpgNext'), osdEpgBar = $('osdEpgBar');
const guide = $('guide'), guideTitle = $('guideTitle'), guideList = $('guideList');
const favsPanel = $('favs'), favsTitle = $('favsTitle'), favsList = $('favsList');
const pinpadEl = $('pinpad'), pinTitle = $('pinTitle'), pinDots = $('pinDots'), pinGrid = $('pinGrid'), pinCancel = $('pinCancel');
const settingsEl = $('settings'), bufRange = requiredElement<HTMLInputElement>('bufRange'), bufNum = requiredElement<HTMLInputElement>('bufNum'), bufVal = $('bufVal');
const autoChk = requiredElement<HTMLInputElement>('autoChk'), hoursNum = requiredElement<HTMLInputElement>('hoursNum'), lastReloadEl = $('lastReload'), toastEl = $('toast');
const epgChk = requiredElement<HTMLInputElement>('epgChk'), epgInfoEl = $('epgInfo'), srvChk = requiredElement<HTMLButtonElement>('srvChk'), srvAddr = $('srvAddr'), autoStartChk = requiredElement<HTMLInputElement>('autoStartChk');
const libraryEl = $('library'), libList = $('libList'), fileList = $('fileList'), srvBtn = requiredElement<HTMLButtonElement>('srvBtn'), srvInfo = $('srvInfo');

/* ================= Утилиты ================= */
/** Reads a stored value, returning an empty string for missing keys or storage errors. */
function lsGet(key: string): string { try { return window.localStorage.getItem(key) || ''; } catch (e) { return ''; } }
/** Stores a value, silently ignoring storage errors. */
function lsSet(key: string, value: string): void { try { window.localStorage.setItem(key, value); } catch (e) { /* хранилище недоступно */ } }
/** Parses a base-10 integer, uses def if parsing fails, and clamps to the inclusive min/max bounds. */
function toInt(v: string | number, def: number, min: number, max: number): number {
  let n = parseInt(String(v), 10);
  if (isNaN(n)) n = def;
  return Math.max(min, Math.min(max, n));
}
function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] & NavMetadata {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setStatus(text: string, kind?: string): void { statusEl.textContent = text; statusEl.className = kind || ''; }
/** Returns the Russian noun form for a channel count. */
function plural(n: number): string {
  if (getLang() === 'de') return n === 1 ? 'Kanal' : 'Kanäle';
  if (getLang() === 'en') return n === 1 ? 'channel' : 'channels';
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'канал'; // noi18n
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'канала'; // noi18n
  return 'каналов'; // noi18n
}
function nativeHttp(): CapacitorHttpType | null {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
}
function appPlugin(): AppPlugin | null {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null;
}
// Собственный нативный плагин (файловый сервер, папка «Загрузки», EPG). В обычном браузере его нет.
let nativeP: IptvNativePlugin | null | undefined;
/** Returns the cached IptvNative bridge, or null if unavailable or registration throws. */
function native(): IptvNativePlugin | null {
  if (nativeP !== undefined) return nativeP;
  nativeP = null;
  try {
    const C = window.Capacitor;
    if (C) nativeP = (C.Plugins && C.Plugins.IptvNative) || (C.registerPlugin ? C.registerPlugin('IptvNative') : null);
  } catch (e) { nativeP = null; }
  return nativeP;
}
let nativePlayerP: IptvPlayerPlugin | null | undefined;
/** Returns the cached IptvPlayer bridge, or null if unavailable or registration throws. */
function playerPlugin(): IptvPlayerPlugin | null {
  if (nativePlayerP !== undefined) return nativePlayerP;
  nativePlayerP = null;
  try {
    const C = window.Capacitor;
    if (C) nativePlayerP = (C.Plugins && C.Plugins.IptvPlayer) || (C.registerPlugin ? C.registerPlugin('IptvPlayer') : null);
  } catch (e) { nativePlayerP = null; }
  return nativePlayerP;
}
let toastTimer: number | undefined = undefined;
/** Shows a message for ms milliseconds; a missing or zero duration uses 2,200 ms. */
function showToast(text: string, ms?: number): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function (): void { toastEl.classList.remove('show'); }, ms || 2200);
}
function isText<T extends Element>(el: T | null): el is T & HTMLInputElement { return !!el && el instanceof HTMLInputElement && el.type === 'text'; }
/** Formats a Unix timestamp in milliseconds as a Russian hour/minute string in the local time zone. */
function fmtTime(ms: number): string { return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); }
/** Formats a Unix timestamp in milliseconds as a Russian day/month and time in the local time zone. */
function fmtDateTime(ms: number): string { return new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
/** Formats bytes with Russian unit labels, using powers of 1,024 and one decimal above the byte range. */
function fmtSize(n: number): string {
  if (n < 1024) return n + ' ' + tr('Б');
  if (n < 1048576) return (n / 1024).toFixed(1) + ' ' + tr('КБ');
  return (n / 1048576).toFixed(1) + ' ' + tr('МБ');
}
/** Returns a URL hostname and final path segment, or the original input if URL parsing fails. */
function niceUrlName(url: string): string {
  try {
    const u = new URL(url), last = u.pathname.split('/').filter(Boolean).pop() || '';
    return u.hostname + (last ? '/' + last : '');
  } catch (e) { return url; }
}
function errMsg(err: unknown): string { return (err && typeof err === 'object' && 'message' in err && err.message) ? trLoose(String(err.message)) : trLoose(String(err)); }

/* ================= Настройки, избранное, EPG-состояние ================= */
const settings: Settings = {
  bufferMs: toInt(lsGet(LS_BUF), 1500, 0, 7000),
  autoReload: lsGet(LS_AUTO) !== '0',
  reloadHours: toInt(lsGet(LS_HOURS), 24, 1, 168)
};
const favs = new Set<string>();
try {
  const arr: unknown = JSON.parse(lsGet(LS_FAVS) || '[]');
  if (Array.isArray(arr)) (arr as unknown[]).forEach(function (u: unknown): void { favs.add(String(u)); });
} catch (e) { /* повреждённые данные — начинаем с пустого списка */ }
function saveFavs(): void { lsSet(LS_FAVS, JSON.stringify(Array.from(favs))); }
function isFav(ch: Channel): boolean { return favs.has(ch.url); }

const epg: EpgState = { enabled: lsGet(LS_EPG) !== '0', file: lsGet(LS_EPGFILE), status: 'none', info: null, err: '', loading: false, pending: '', cache: new Map() };
let headerEpgUrl: string = '';
let headerCatchup: CatchupDefaults = { mode: '', source: '', days: 0 };
let srv: ServerStatus = { running: false, port: 0, addresses: [] };
const blockedGroups = new Set<string>();
try { (JSON.parse(lsGet('iptv.blocked') || '[]') as unknown[]).forEach(function (k: unknown): void { blockedGroups.add(String(k)); }); } catch (e) { /* ignore */ }
function saveBlocked(): void { lsSet('iptv.blocked', JSON.stringify(Array.from(blockedGroups))); }
/** Returns the blocking key for a remote command group key: '' (all channels) blocks the ungrouped group (GROUP_NONE). */
function blockKeyFromRemote(rawKey: string): string { return rawKey === '' ? GROUP_NONE : rawKey; }
let parentPin: string = lsGet('iptv.pin') || '';
let pinUnlocked: boolean = false;
/** Returns whether any group keys are blocked, even if absent from the current playlist. */
function hasBlockedGroups(): boolean { return blockedGroups.size > 0; }

/* ================= Состояние ================= */
const state: PlayerState = { channels: [], view: [], groups: [], group: lsGet(LS_GROUP), current: null, entry: null, mode: 'menu', renderCount: PAGE_SIZE };
const cardMap = new Map<Channel, NavElement>();
// Индекс канала в state.view — O(1) вместо линейного поиска (indexOf) на каждое переключение канала/OSD.
const viewIndex = new Map<Channel, number>();
let focusedEl: NavElement | null = null, osdTimer: number | undefined = undefined, searchTimer: number | undefined = undefined, epgTimer: number | undefined = undefined, epgReloadTimer: number | undefined = undefined, libTimer: number | undefined = undefined;
let hls: Hls | null = null, playToken: number = 0, nativeErrHandler: (() => void) | null = null, playFailed: boolean = false, userPaused: boolean = false, loading: boolean = false;
let gating: boolean = false, hasPlayed: boolean = false, swipedAt: number = 0, lpFired: boolean = false, lastAutoTry: number = 0, filesSig: string = '';

/* ================= Библиотека плейлистов (IndexedDB) ================= */
let libDb: IDBDatabase | null = null;
/**
 * Opens or reuses the playlist database, creating its store on the first open.
 * @returns A promise for the database; rejects when IndexedDB is unavailable or opening fails.
 */
function dbOpen(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>(function (resolve: (value: IDBDatabase | PromiseLike<IDBDatabase>) => void, reject: (reason?: unknown) => void): void {
    if (libDb) { resolve(libDb); return; }
    if (!window.indexedDB) { reject(new Error(tr('IndexedDB недоступна'))); return; }
    const rq = window.indexedDB.open('iptv-lib', 1);
    rq.onupgradeneeded = function (): void { rq.result.createObjectStore('playlists', { keyPath: 'id' }); };
    rq.onsuccess = function (): void { libDb = rq.result; resolve(libDb); };
    rq.onerror = function (): void { reject(rq.error); };
  });
}
/**
 * Runs fn with the playlist store in the requested IndexedDB transaction mode.
 * @returns A promise for the returned request's result after commit.
 *   Database-open, transaction, and callback errors reject the promise.
 */
function dbTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return dbOpen().then(function (db: IDBDatabase): Promise<T> {
    return new Promise<T>(function (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void): void {
      const tx = db.transaction('playlists', mode);
      const req = fn(tx.objectStore('playlists'));
      tx.oncomplete = function (): void { resolve(req.result); };
      tx.onerror = tx.onabort = function (): void { reject(tx.error); };
    });
  });
}
/** Stores or replaces a playlist by id; returns a promise for its key and propagates database errors. */
function libPut(entry: PlaylistEntry): Promise<IDBValidKey> { return dbTx('readwrite', function (st: IDBObjectStore): IDBRequest<IDBValidKey> { return st.put(entry); }); }
/** IndexedDB stores PlaylistEntry records via libPut. The DOM API erases that schema on reads. */
function libGet(id: string): Promise<PlaylistEntry | undefined> { return dbTx<PlaylistEntry | undefined>('readonly', function (st: IDBObjectStore): IDBRequest<PlaylistEntry | undefined> { return st.get(id) as IDBRequest<PlaylistEntry | undefined>; }); }
/** Deletes a playlist by id; returns a promise for transaction completion and propagates database errors. */
function libDel(id: string): Promise<undefined> { return dbTx('readwrite', function (st: IDBObjectStore): IDBRequest<undefined> { return st['delete'](id); }); }
/** Returns a promise for all saved playlists; database errors propagate. */
function libAll(): Promise<PlaylistEntry[]> { return dbTx<PlaylistEntry[]>('readonly', function (st: IDBObjectStore): IDBRequest<PlaylistEntry[]> { return st.getAll() as IDBRequest<PlaylistEntry[]>; }); }

/**
 * Starts saving a playlist copy under its source kind and key, without waiting for completion.
 * The source key is a URL or filename; count is the parsed channel count. Save failures are ignored.
 */
function saveEntry(src: PlaylistSource, name: string, text: string, count: number): void {
  const id = (src.kind === 'url' ? 'u:' : 'f:') + src.key;
  const entry: PlaylistEntry = { id: id, kind: src.kind, name: name, url: src.kind === 'url' ? src.key : '', fileName: src.kind === 'file' ? src.key : '',
    text: text, count: count, savedAt: Date.now() };
  libPut(entry).catch(function (): void { /* копия не сохранилась — работаем без неё */ });
}

/* ================= Парсер M3U ================= */
/** Splits EXTINF content at the first comma outside double quotes; a missing comma yields an empty title. */
function splitExtInf(body: string): { head: string; title: string } {
  let inQuote = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) return { head: body.slice(0, i), title: body.slice(i + 1).trim() };
  }
  return { head: body, title: '' };
}
/** Extracts double-quoted attributes with lowercase keys and trimmed values; later duplicates win. */
function parseAttrs(head: string): Record<string, string> {
  let attrs: Record<string, string> = {}, re = /([A-Za-z0-9_-]+)="([^"]*)"/g, m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) attrs[m[1].toLowerCase()] = m[2].trim();
  return attrs;
}
/** Derives a channel name from the decoded URL filename or hostname, returning the input on parse errors. */
function guessName(url: string): string {
  try {
    const u = new URL(url);
    let last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    last = last.replace(/\.(m3u8?|ts|mp4|mkv|avi)$/i, '');
    return last || u.hostname;
  } catch (e) { return url; }
}
/** Creates channel data with search keys, falling back to playlist header catch-up settings for falsy values. */
function makeChannel(o: ChannelInput): Channel {
  const name = o.name || tr('Без названия'), group = o.group || '';
  return { name: name, url: o.url, logo: o.logo || '', group: group, tvgId: o.tvgId || '', tvgName: o.tvgName || '',
    catchup: o.catchup || headerCatchup.mode || '', catchupSource: o.catchupSource || headerCatchup.source || '', catchupDays: o.catchupDays || headerCatchup.days || 0,
    nameLower: name.toLowerCase(), groupLower: group.toLowerCase() };
}
/**
 * Returns channels for HTTP(S) entries in M3U text, inferring names for bare URLs.
 * Resets header catch-up defaults and updates the shared EPG URL when the header supplies an HTTP(S) URL.
 * Unsupported URL schemes are skipped; missing metadata uses channel defaults.
 */
function parsePlaylist(text: string): Channel[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let out: Channel[] = [], pending: Partial<Channel> | null = null, extGrp = '';
  headerCatchup = { mode: '', source: '', days: 0 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('#EXTM3U') === 0) {
      const ha = parseAttrs(line);
      let tv = ha['url-tvg'] || ha['x-tvg-url'] || ha['tvg-url'] || '';
      tv = tv.split(',')[0].trim();
      if (/^https?:\/\//i.test(tv)) headerEpgUrl = tv;
      if (ha['catchup']) headerCatchup.mode = ha['catchup'];
      if (ha['catchup-source']) headerCatchup.source = ha['catchup-source'];
      if (ha['catchup-days']) headerCatchup.days = parseInt(ha['catchup-days'], 10) || 0;
      continue;
    }
    if (line.indexOf('#EXTINF') === 0) {
      const colon = line.indexOf(':');
      const parts = splitExtInf(colon >= 0 ? line.slice(colon + 1) : '');
      const attrs = parseAttrs(parts.head);
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
      // EXTINF metadata acquires its required URL immediately above.
      out.push(makeChannel(pending as ChannelInput));
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
async function fetchPlaylistText(url: string): Promise<string> {
  const http = nativeHttp();
  if (window.Capacitor && http) {
    // Android: нативный HTTP — без CORS, с браузерными заголовками
    const res = await http.get({ url: url, headers: HTTP_HEADERS, responseType: 'text', connectTimeout: 20000, readTimeout: 60000 });
    if (res.status < 200 || res.status >= 300) throw new Error(tr('сервер ответил HTTP {0}', res.status));
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }
  // ПК / обычный браузер: стандартный fetch
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(tr('сервер ответил HTTP {0}', r.status));
  return await r.text();
}
/** Saves the current reload timestamp in milliseconds and refreshes its settings display. */
function markReloaded(): void { lsSet(LS_RELOADED, String(Date.now())); updateLastReload(); }
/** Formats a load error, substituting a browser CORS/network hint for TypeError when native HTTP is absent. */
function netErrText(err: unknown): string {
  let msg = errMsg(err);
  if (err instanceof TypeError && !nativeHttp()) msg = tr('браузер заблокировал запрос (CORS или нет сети). В Android-приложении запрос идёт нативно.');
  return msg;
}

/**
 * Loads the HTTP(S) URL from the input unless another load is active.
 * On fetch or apply failure, tries cached.text if supplied; failures are displayed as status messages.
 * Successful network loads save the playlist and update its reload timestamp.
 */
async function loadFromUrl(cached?: PlaylistEntry): Promise<void> {
  if (loading) return;
  const url = urlInput.value.trim();
  if (!url) { setStatus(tr('Введите ссылку на плейлист.'), 'error'); return; }
  // строгая проверка парсером URL: принимаем только http/https (regex пропускал «httpx://…»)
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch (e) { setStatus(tr('Некорректная ссылка на плейлист'), 'error'); return; }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') { setStatus(tr('Ссылка должна начинаться с http:// или https://'), 'error'); return; }
  // Нет сети — не пытаемся грузить, сразу понятное сообщение + сохранённая копия, если есть.
  if (navigator.onLine === false) {
    if (cached && cached.text) {
      try {
        applyPlaylist(cached.text, tr('сохранённая копия'), { kind: 'url', key: url }, { nosave: true });
        setStatus(tr('Нет связи ({0}). Открыта сохранённая копия плейлиста.', tr('устройство не в сети')), 'warn');
      } catch (e2) { setStatus(tr('Не удалось загрузить плейлист: {0}', tr('устройство не в сети')), 'error'); }
    } else {
      setStatus(tr('Нет соединения с интернетом. Проверьте сеть и повторите попытку.'), 'error');
    }
    return;
  }
  lsSet(LS_URL, url);
  loading = true;
  setStatus(tr('Загрузка плейлиста…'));
  try {
    const text = await fetchPlaylistText(url);
    applyPlaylist(text, tr('ссылка'), { kind: 'url', key: url }, {});
    markReloaded();
  } catch (err) {
    if (cached && cached.text) {
      try {
        applyPlaylist(cached.text, tr('сохранённая копия'), { kind: 'url', key: url }, { nosave: true });
        setStatus(tr('Нет связи ({0}). Открыта сохранённая копия плейлиста.', netErrText(err)), 'warn');
      } catch (e2) { setStatus(tr('Не удалось загрузить плейлист: {0}', netErrText(err)), 'error'); }
    } else {
      setStatus(tr('Не удалось загрузить плейлист: {0}', netErrText(err)), 'error');
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
async function reloadPlaylist(manual: boolean): Promise<void> {
  if (loading) { if (manual) showToast(tr('Загрузка уже идёт…')); return; }
  const ent = state.entry;
  if (!ent) {
    if (manual) { setStatus(tr('Сначала откройте плейлист.'), 'warn'); showToast(tr('Нет открытого плейлиста')); }
    return;
  }
  loading = true;
  if (manual) { setStatus(tr('Обновление плейлиста…')); showToast(tr('Обновление плейлиста…')); }
  try {
    let text: string, src: PlaylistSource;
    if (ent.kind === 'file') {
      const n = native();
      if (!n) throw new Error(tr('обновление файла доступно только в приложении'));
      const r = await n.readFile({ name: ent.fileName });
      text = r.text;
      src = { kind: 'file', key: ent.fileName };
    } else {
      text = await fetchPlaylistText(ent.url);
      src = { kind: 'url', key: ent.url };
    }
    applyPlaylist(text, tr('обновлено {0}', fmtTime(Date.now())), src, { keep: true });
    if (ent.kind === 'url') markReloaded();
    if (manual) showToast(tr('Плейлист обновлён: {0} {1}', state.channels.length, plural(state.channels.length)));
  } catch (err) {
    setStatus(tr('Не удалось обновить плейлист: {0}', ent.kind === 'url' ? netErrText(err) : errMsg(err)), 'error');
    if (manual) showToast(tr('Ошибка обновления плейлиста'));
  } finally {
    loading = false;
    updateLastReload();
  }
  if (manual) epgReload(true);
}
/** Reloads a URL playlist when its configured interval has elapsed, spacing automatic attempts by at least ten minutes. */
function autoTick(): void {
  if (!settings.autoReload || loading) return;
  if (!state.entry || state.entry.kind !== 'url') return;
  const last = parseInt(lsGet(LS_RELOADED), 10) || 0, now = Date.now();
  if (now - last >= settings.reloadHours * 3600000 && now - lastAutoTry >= 600000) {
    lastAutoTry = now;
    reloadPlaylist(false);
  }
}

/** Reads the first selected file as UTF-8 and applies it as a playlist, displaying read or apply errors in the UI. */
function loadFromFile(): void {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  setStatus(tr('Чтение файла…'));
  const reader = new FileReader();
  reader.onerror = function (): void { setStatus(tr('Не удалось прочитать файл.'), 'error'); };
  reader.onload = function (): void {
    try { applyPlaylist(String(reader.result || ''), file.name, { kind: 'file', key: file.name }, {}); }
    catch (err) { setStatus(tr('Ошибка: {0}', errMsg(err)), 'error'); }
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
function applyPlaylist(text: string, sourceName: string, src: PlaylistSource | null, opts: PlaylistOptions): void {
  opts = opts || {};
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error(tr('плейлист пуст'));
  if (/<html[\s>]/i.test(trimmed.slice(0, 500))) throw new Error(tr('сервер вернул HTML-страницу вместо плейлиста'));
  const sourceUrl = src && src.kind === 'url' ? src.key : '';
  headerEpgUrl = '';
  let channels: Channel[];
  if (/#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)/.test(trimmed)) {
    if (!sourceUrl) throw new Error(tr('это манифест одного HLS-потока, а не список каналов — загрузите его по ссылке'));
    channels = [makeChannel({ name: tr('Поток HLS'), url: sourceUrl, group: tr('Прямая ссылка') })];
  } else {
    channels = parsePlaylist(trimmed);
  }
  if (!channels.length) throw new Error(tr('в плейлисте нет каналов с http/https-ссылками'));

  if (src) {
    const id = (src.kind === 'url' ? 'u:' : 'f:') + src.key;
    state.entry = { id: id, kind: src.kind, url: sourceUrl, fileName: src.kind === 'file' ? src.key : '' };
    lsSet(LS_ENTRY, id);
    if (!opts.nosave) saveEntry(src, src.kind === 'url' ? niceUrlName(src.key) : src.key, trimmed, channels.length);
  }

  const prevUrl = state.current ? state.current.url : '';
  state.channels = channels;
  epg.cache.clear();
  buildGroups();
  if (state.group && state.group !== GROUP_FAV && !state.groups.some(function (g: Group): boolean { return g.key === state.group; })) {
    state.group = GROUP_ALL; lsSet(LS_GROUP, '');
  }
  if (!opts.keep) { searchInput.value = ''; state.renderCount = PAGE_SIZE; }
  computeView();
  if (prevUrl) {
    const found = channels.find(function (c: Channel): boolean { return c.url === prevUrl; });
    if (found) state.current = found;
  }

  let lastIdx = -1;
  if (!opts.keep) {
    const lastUrl = lsGet(LS_LAST);
    if (lastUrl) { for (let i = 0; i < state.view.length; i++) { if (state.view[i].url === lastUrl) { lastIdx = i; break; } } }
    if (lastIdx >= state.renderCount) state.renderCount = lastIdx + PAGE_SIZE;
  } else if (state.renderCount < state.view.length && state.renderCount < PAGE_SIZE) {
    state.renderCount = PAGE_SIZE;
  }
  renderGroups();
  renderGrid(!!opts.keep);
  setStatus((opts.keep ? tr('Обновлено: ') : tr('Загружено: ')) + channels.length + ' ' + plural(channels.length) + ' · ' + sourceName, 'ok');
  if (!opts.keep && state.mode === 'menu') {
    const target = cardMap.get(state.view[lastIdx >= 0 ? lastIdx : 0]);
    if (target) setFocus(target);
  }
  updateLastReload();
  scheduleEpgReload();
}

/* ================= Окно «Плейлисты» ================= */
function libraryOpen(): boolean { return libraryEl.classList.contains('open'); }
/** Opens the playlist library, loads saved entries and native files, and starts polling files every three seconds. */
async function openLibrary(): Promise<void> {
  if (settingsOpen()) closeSettings();
  libraryEl.classList.add('open');
  filesSig = '';
  await refreshServerStatus();
  await renderLibrary();
  await renderFiles(true);
  clearInterval(libTimer);
  libTimer = window.setInterval(function (): void { renderFiles(false); }, 3000);
  setFocus(srvBtn, false);
}
function closeLibrary(): void {
  if (!libraryOpen()) return;
  libraryEl.classList.remove('open');
  clearInterval(libTimer);
  setFocus(libBtn, false);
}

/**
 * Assigns a button action that requires a second activation within three seconds.
 * The first activation shows a confirmation label; timeout restores label. Activation does not catch synchronous action errors.
 */
function twoStep(btn: NavElement, label: string, action: () => void): void {
  btn._armed = false;
  btn._act = function (): void {
    if (!btn._armed) {
      btn._armed = true;
      btn.textContent = tr('Удалить?');
      btn.classList.add('armed');
      clearTimeout(btn._t);
      btn._t = window.setTimeout(function (): void { btn._armed = false; btn.textContent = label; btn.classList.remove('armed'); }, 3000);
    } else {
      clearTimeout(btn._t);
      action();
    }
  };
}

/** Renders saved playlists newest first, treating database read failures as an empty library. */
async function renderLibrary(): Promise<void> {
  let entries: PlaylistEntry[] = [];
  try { entries = await libAll(); } catch (e) { entries = []; }
  entries.sort(function (a: PlaylistEntry, b: PlaylistEntry): number { return b.savedAt - a.savedAt; });
  libList.textContent = '';
  if (!entries.length) {
    libList.appendChild(mk('div', 'note', tr('Пока пусто. Плейлисты, открытые по ссылке или из файла, сохраняются здесь автоматически.')));
  }
  entries.forEach(function (e: PlaylistEntry): void {
    const row = mk('div', 'lrow' + (state.entry && state.entry.id === e.id ? ' current' : ''));
    const main = mk('div', 'lmain');
    main.setAttribute('data-nav', '1');
    main.appendChild(mk('div', 'lname', e.name));
    main.appendChild(mk('div', 'lmeta', (e.kind === 'url' ? tr('ссылка') : tr('файл')) + ' · ' + e.count + ' ' + plural(e.count) + ' · ' + fmtDateTime(e.savedAt)));
    main._act = function (): void { openEntry(e.id, false); };
    const del = mk('button', '', '\u2715');
    del.setAttribute('data-nav', '1');
    twoStep(del, '\u2715', function (): void {
      libDel(e.id).then(function (): void {
        if (state.entry && state.entry.id === e.id) { state.entry = null; lsSet(LS_ENTRY, ''); }
        showToast(tr('Плейлист удалён'));
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
async function renderFiles(force: boolean): Promise<void> {
  const n = native();
  if (!n) {
    fileList.textContent = '';
    fileList.appendChild(mk('div', 'note', tr('Файловый сервер и папка «Загрузки» доступны только в Android-приложении.')));
    return;
  }
  let files: ServerFile[] = [];
  try { files = (await n.listFiles()).files || []; } catch (e) { files = []; }
  const sig = JSON.stringify(files.map(function (f: ServerFile): (string | number)[] { return [f.name, f.size, f.modified]; })) + '|' + epg.file;
  if (!force && sig === filesSig) return;
  filesSig = sig;
  fileList.textContent = '';
  if (!files.length) {
    fileList.appendChild(mk('div', 'note', tr('Файлов пока нет. Загрузите их через браузер, когда сервер включён.')));
  }
  files.forEach(function (f: ServerFile): void {
    const isEpg = /\.xml(\.gz)?$/i.test(f.name);
    const row = mk('div', 'lrow' + (isEpg && epg.file === f.name ? ' current' : ''));
    const main = mk('div', 'lmain');
    main.setAttribute('data-nav', '1');
    main.appendChild(mk('div', 'lname', f.name));
    main.appendChild(mk('div', 'lmeta', (isEpg ? tr('телепрограмма (нажмите, чтобы использовать)') : tr('плейлист (нажмите, чтобы открыть)')) + ' · ' + fmtSize(f.size) + ' · ' + fmtDateTime(f.modified)));
    main._act = function (): void { if (isEpg) setEpgFile(f.name); else openDownloadFile(f.name); };
    const del = mk('button', '', '\u2715');
    del.setAttribute('data-nav', '1');
    twoStep(del, '\u2715', function (): void {
      n.deleteFile({ name: f.name }).then(function (): void {
        if (epg.file === f.name) { epg.file = ''; lsSet(LS_EPGFILE, ''); epgReload(true); }
        showToast(tr('Файл удалён'));
        renderFiles(true);
      }, function (e: unknown): void { showToast(tr('Не удалось удалить: {0}', errMsg(e))); });
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
async function openEntry(id: string, startup: boolean): Promise<void> {
  let e: PlaylistEntry | undefined | null = null;
  try { e = await libGet(id); } catch (x) { e = null; }
  if (!e) { showToast(tr('Плейлист не найден')); return; }
  if (!startup) closeLibrary();
  const savedEdit = lsGet('iptv.edit.' + id);
  if (savedEdit) {
    try { applyPlaylist(savedEdit, tr('{0} (с правками)', e.name), { kind: e.kind, key: e.kind === 'url' ? e.url : (e.fileName || e.name) }, { nosave: true }); return; }
    catch (err) { /* применим исходник */ }
  }
  if (e.kind === 'url') {
    urlInput.value = e.url;
    lsSet(LS_URL, e.url);
    await loadFromUrl(e);
  } else {
    try { applyPlaylist(e.text, e.name, { kind: 'file', key: e.fileName || e.name }, { nosave: true }); }
    catch (err) { setStatus(tr('Не удалось открыть «{0}»: {1}', e.name, errMsg(err)), 'error'); }
  }
}
/** Reads and applies a native download by filename; no-ops without the bridge and displays read/apply failures. */
async function openDownloadFile(name: string): Promise<void> {
  const n = native();
  if (!n) return;
  try {
    const r = await n.readFile({ name: name });
    closeLibrary();
    applyPlaylist(r.text, name, { kind: 'file', key: name }, {});
  } catch (e) {
    setStatus(tr('Не удалось открыть «{0}»: {1}', name, errMsg(e)), 'error');
    showToast(tr('Не удалось открыть файл'));
  }
}

/* ================= Файловый сервер ================= */
/** Returns the running server URL using its first address, or an empty string if stopped or no address is available. */
function serverUrl(): string {
  if (!srv.running) return '';
  const ip = srv.addresses && srv.addresses[0];
  return ip ? 'http://' + ip + ':' + srv.port : '';
}
function renderServerUi(): void {
  const url = serverUrl();
  const hasNative = !!native();
  srvChk.textContent = srv.running ? tr('Выключить сервер') : tr('Включить сервер');
  srvChk.disabled = !hasNative;
  srvBtn.textContent = srv.running ? tr('Выключить сервер') : tr('Включить сервер');
  let info: string;
  if (!hasNative) info = tr('Доступно только в приложении.');
  else if (!srv.running) info = tr('Сервер выключен.');
  else if (url) info = tr('Откройте в браузере: {0}', url);
  else info = tr('Сервер запущен (порт {0}), но Wi-Fi не найден.', srv.port);
  srvInfo.textContent = info;
  srvAddr.textContent = info;
  renderQr();
}
/** Displays the remote-control URL as a QR code, falling back to plain text if QR generation is unavailable or fails. */
function renderQr(): void {
  const box = document.getElementById('qrBox');
  if (!box) return;
  const u = serverUrl() ? serverUrl() + '/remote' : '';
  box.textContent = '';
  if (!u) return;
  if (window.qrcode) {
    try {
      const q = window.qrcode(0, 'M');
      q.addData(u);
      q.make();
      box.innerHTML = q.createSvgTag(4, 8);
      const d = document.createElement('div');
      d.style.marginTop = '.4rem';
      d.textContent = u;
      box.appendChild(d);
      const h = document.createElement('div');
      h.textContent = tr('Наведите камеру телефона → откроется пульт Remote Supremacy');
      box.appendChild(h);
      return;
    } catch (e) { /* покажем ссылку */ }
  }
  box.textContent = u;
}
/** Refreshes server state from the native bridge, retaining the previous state on errors, then updates the UI. */
async function refreshServerStatus(): Promise<void> {
  const n = native();
  if (n) { try { srv = await n.serverStatus(); } catch (e) { /* оставляем прежнее состояние */ } }
  renderServerUi();
}
/** Starts or stops the native server and saves successful state changes; native failures are displayed as a toast. */
async function setServer(on: boolean): Promise<void> {
  const n = native();
  if (!n) { showToast(tr('Сервер доступен только в приложении')); renderServerUi(); return; }
  try {
    if (on) {
      let port = toInt(lsGet(LS_PORT), 0, 0, 65535);
      if (!port) { port = 20000 + Math.floor(Math.random() * 40000); lsSet(LS_PORT, String(port)); }
      srv = await n.serverStart({ port: port });
      if (srv.port && srv.port !== port) lsSet(LS_PORT, String(srv.port));
      lsSet(LS_SRV, '1');
    } else {
      srv = await n.serverStop();
      lsSet(LS_SRV, '0');
    }
  } catch (e) {
    showToast(tr('Сервер: {0}', errMsg(e)), 3500);
  }
  renderServerUi();
}

/* ================= Группы и фильтр ================= */
/** Returns the channel group, using GROUP_NONE for an empty group. */
function gkey(ch: Channel): string { return ch.group || GROUP_NONE; }
/** Rebuilds group counts in playlist order, excluding blocked groups while the PIN is locked. */
function buildGroups(): void {
  const counts = new Map<string, number>(), order: string[] = [];
  state.channels.forEach(function (ch: Channel): void {
    const k = gkey(ch);
    if (blockedGroups.has(k) && !pinUnlocked) return;
    if (!counts.has(k)) { counts.set(k, 0); order.push(k); }
    // The key was inserted immediately above.
    counts.set(k, counts.get(k)! + 1);
  });
  state.groups = order.map(function (k: string): Group { return { key: k, label: k === GROUP_NONE ? tr('Без группы') : k, count: counts.get(k)! }; });
}
/** Updates the channel view using PIN visibility, the selected group or favorites, and a case-insensitive name/group search. */
function computeView(): void {
  let q = searchInput.value.trim().toLowerCase(), g = state.group, out = state.channels;
  if (!pinUnlocked && blockedGroups.size) out = out.filter(function (c: Channel): boolean { return !blockedGroups.has(gkey(c)); });
  if (g === GROUP_FAV) out = out.filter(isFav);
  else if (g) out = out.filter(function (c: Channel): boolean { return gkey(c) === g; });
  if (q) out = out.filter(function (c: Channel): boolean { return c.nameLower.indexOf(q) !== -1 || c.groupLower.indexOf(q) !== -1; });
  state.view = out;
  viewIndex.clear();
  for (let i = 0; i < out.length; i++) viewIndex.set(out[i], i);
}
function makeChip(key: string, label: string, count: number): NavElement {
  const el = mk('div', 'chip' + (state.group === key ? ' active' : ''));
  el.setAttribute('data-nav', '1');
  el._group = key;
  el.appendChild(document.createTextNode(label));
  el.appendChild(mk('small', '', String(count)));
  return el;
}
/** Opens PIN setup if unset, relocks visible groups if unlocked, or prompts for the existing PIN. */
function armUnlock(): void {
  if (!parentPin) {
    // без заданного PIN блокировка бессмысленна: сначала задаём PIN
    pinOpen('set');
    return;
  }
  if (pinUnlocked) { pinUnlocked = false; buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus(); return; }
  pinOpen('unlock');
}
/* ================= Экранный PIN-пад (3 цифры) ================= */
let pinMode: 'unlock' | 'set' = 'unlock', pinBuf: string = '';
let pinFailCount: number = 0;
let pinBlockedUntil: number = 0;
const PIN_MAX_FAILS = 5;
/** Shares failed attempts and cooldown across the keypad, settings and remote commands. */
function verifyPin(value: string | number | null | undefined): boolean {
  if (Date.now() < pinBlockedUntil) return false;
  if (pinBlockedUntil) { pinFailCount = 0; pinBlockedUntil = 0; }
  if (parentPin && String(value == null ? '' : value) === parentPin) {
    pinFailCount = 0;
    return true;
  }
  pinFailCount++;
  if (pinFailCount >= PIN_MAX_FAILS) pinBlockedUntil = Date.now() + 10000;
  return false;
}
function pinpadOpen(): boolean { return pinpadEl.classList.contains('open'); }
/** Opens a cleared PIN pad in setup mode for "set", or unlock mode otherwise. */
function pinOpen(mode: 'set' | 'unlock'): void {
  if (mode === 'set' && parentPin && !pinUnlocked) mode = 'unlock';
  if (mode !== 'set') {
    if (Date.now() < pinBlockedUntil) { showToast(tr('Слишком много неверных попыток. Подождите 10 секунд')); return; }
    if (pinBlockedUntil) { pinFailCount = 0; pinBlockedUntil = 0; }
  }
  pinMode = mode; pinBuf = '';
  pinTitle.textContent = mode === 'set' ? tr('Задайте PIN из 3 цифр') : tr('Введите PIN (3 цифры)');
  pinRenderDots(); pinRenderGrid();
  pinpadEl.classList.add('open');
  const b = pinGrid.querySelector('button'); if (b) setFocus(b, false);
}
function pinClose(): void {
  pinpadEl.classList.remove('open'); pinBuf = '';
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
}
function pinRenderDots(): void {
  pinDots.textContent = '';
  for (let i = 0; i < 3; i++) pinDots.appendChild(mk('i', i < pinBuf.length ? 'on' : ''));
}
/** Builds the PIN keypad, submitting automatically at three digits or on OK with three digits entered. */
function pinRenderGrid(): void {
  pinGrid.textContent = '';
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '\u232B', '0', 'OK'].forEach(function (lab: string): void {
    const b = mk('button', '', lab);
    b.setAttribute('data-nav', '1'); b.type = 'button';
    b._act = function (): void {
      if (lab === '\u232B') { pinBuf = pinBuf.slice(0, -1); pinRenderDots(); }
      else if (lab === 'OK') { if (pinBuf.length === 3) pinSubmit(); }
      else if (pinBuf.length < 3) { pinBuf += lab; pinRenderDots(); if (pinBuf.length === 3) pinSubmit(); }
    };
    pinGrid.appendChild(b);
  });
}
/** Saves a new PIN or checks the entered PIN, revealing groups on success and clearing the input on mismatch. */
function pinSubmit(): void {
  if (pinMode === 'set' && parentPin && !pinUnlocked) { pinOpen('unlock'); showToast(tr('Сначала введите текущий PIN')); return; }
  if (pinMode !== 'set' && Date.now() < pinBlockedUntil) { showToast(tr('Слишком много неверных попыток. Подождите 10 секунд')); return; }
  const v = pinBuf;
  if (pinMode === 'set') {
    parentPin = v; lsSet('iptv.pin', v); pinUnlocked = true; pinFailCount = 0; pinBlockedUntil = 0;
    pinClose(); buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus(); showToast(tr('PIN задан'));
  } else if (verifyPin(v)) {
    pinUnlocked = true; pinClose(); buildGroups();
    if (state.group && blockedGroups.has(state.group)) state.group = GROUP_ALL;
    computeView(); renderGroups(); renderGrid(false); renderPinStatus(); showToast(tr('Скрытые группы показаны'));
  } else {
    pinBuf = ''; pinRenderDots();
    if (pinFailCount >= PIN_MAX_FAILS) {
      pinClose();
      showToast(tr('Слишком много неверных попыток. Подождите 10 секунд'));
    } else {
      showToast(tr('Неверный PIN ({0}/{1})', pinFailCount, PIN_MAX_FAILS));
    }
  }
}
function renderGroups(): void {
  groupBar.textContent = '';
  if (!state.channels.length) { groupBar.style.display = 'none'; return; }
  groupBar.style.display = 'flex';
  let favCount = 0;
  state.channels.forEach(function (c: Channel): void { if (isFav(c)) favCount++; });
  const frag = document.createDocumentFragment();
  frag.appendChild(makeChip(GROUP_ALL, tr('Все'), state.channels.length));
  frag.appendChild(makeChip(GROUP_FAV, tr('\u2605 Избранное'), favCount));
  state.groups.forEach(function (g: Group): void { frag.appendChild(makeChip(g.key, g.label, g.count)); });
  const lock = mk('div', 'chip' + (pinUnlocked ? ' active' : ''));
  lock.setAttribute('data-nav', '1');
  lock.appendChild(document.createTextNode(pinUnlocked ? '\uD83D\uDD13' : (parentPin ? tr('\uD83D\uDD12 Блок ({0})', blockedGroups.size) : '\uD83D\uDD12 PIN')));
  lock._act = armUnlock;
  frag.appendChild(lock);
  groupBar.appendChild(frag);
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
}
/** Selects and saves a group key, resets pagination and scroll, and focuses its chip when present. */
function setGroup(key: string): void {
  state.group = key;
  lsSet(LS_GROUP, key);
  state.renderCount = PAGE_SIZE;
  computeView();
  renderGroups();
  renderGrid(false);
  gridPane.scrollTop = 0;
  const act = groupBar.querySelector<NavElement>('.chip.active');
  if (act) {
    setFocus(act, false);
    try { act.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ignore */ }
  }
}

/** Toggles a channel URL in saved favorites and refreshes affected UI; a missing channel is ignored. */
function toggleFav(ch: Channel | null | undefined): void {
  if (!ch) return;
  let on: boolean;
  if (favs.has(ch.url)) { favs.delete(ch.url); on = false; } else { favs.add(ch.url); on = true; }
  saveFavs();
  try { if (navigator.vibrate) navigator.vibrate(on ? [30, 40, 30] : 30); } catch (e) { /* ignore */ }
  showToast((on ? tr('\u2605 В избранное: ') : tr('\u2606 Убрано из избранного: ')) + ch.name);
  const el = cardMap.get(ch);
  if (el) el.classList.toggle('fav', on);
  renderGroups();
  if (!on && state.group === GROUP_FAV && state.mode === 'menu') { computeView(); renderGrid(true); }
}
/** Handles the native remote Menu button by toggling the current or focused channel favorite, or prompting for a channel. */
window.__iptvMenu = function (): void {          // кнопка «три полоски» на пульте (вызывается из MainActivity)
  if (state.mode === 'player' && state.current) { toggleFav(state.current); showOsd(); return; }
  if (focusedEl && focusedEl._channel) { toggleFav(focusedEl._channel); return; }
  showToast(tr('Наведите курсор на канал'));
};

/* ================= Сетка каналов ================= */
/** Creates a logo placeholder from the first trimmed character, uppercased, or "?" for an empty name. */
function placeholder(name: string): HTMLSpanElement {
  return mk('span', 'ph', (name.trim().charAt(0) || '?').toUpperCase());
}
/** Builds a navigable channel card with favorite and EPG state, substituting a placeholder if its logo fails to load. */
function createCard(ch: Channel): NavElement {
  const el = mk('div', 'card' + (isFav(ch) ? ' fav' : ''));
  el.setAttribute('data-nav', '1');
  el.title = ch.name;
  el._channel = ch;
  const star = mk('span', 'star', '\u2605');
  const logo = mk('div', 'logo');
  if (ch.logo) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function (): void { if (img.parentNode) img.parentNode.removeChild(img); logo.appendChild(placeholder(ch.name)); };
    img.src = ch.logo;
    logo.appendChild(img);
  } else {
    logo.appendChild(placeholder(ch.name));
  }
  const epgRoot = mk('div', 'epg'), et = mk('div', 'et'), bar = mk('i', 'bar'), fill = document.createElement('b');
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
function createMoreCard(rest: number): NavElement {
  const el = mk('div', 'card more', tr('Показать ещё\n(осталось {0})', rest));
  el.setAttribute('data-nav', '1');
  el.style.whiteSpace = 'pre-line';
  el._more = true;
  return el;
}
/** Rebuilds the paginated channel grid and schedules an EPG refresh; a truthy keepScroll restores the prior scroll offset. */
function renderGrid(keepScroll: boolean): void {
  const st = gridPane.scrollTop;
  const n = Math.min(state.view.length, state.renderCount);
  // Инкрементальная перерисовка: карточки уже отрендеренных каналов переиспользуются,
  // DOM меняется только в изменившемся хвосте списка (поиск, «Показать ещё», EPG-обновления).
  let common = 0;
  if (grid.childElementCount === n + (state.view.length > n ? 1 : 0) && !(grid.firstElementChild as NavElement | null)?._more) {
    while (common < n) {
      const el = grid.children[common] as NavElement | undefined;
      if (!el || el._channel !== state.view[common]) break;
      common++;
    }
  }
  if (common) {
    // Удаляем устаревшие хвостовые узлы; cardMap очистим ниже и заполним заново.
    while (grid.lastElementChild && grid.childElementCount > common) grid.removeChild(grid.lastElementChild);
  } else {
    grid.textContent = '';
    cardMap.clear();
  }
  const frag = document.createDocumentFragment();
  for (let i = common; i < n; i++) {
    const el = createCard(state.view[i]);
    frag.appendChild(el);
  }
  if (state.view.length > n) {
    frag.appendChild(createMoreCard(state.view.length - n));
  } else if (!state.view.length) {
    frag.appendChild(mk('div', 'empty', !state.channels.length ? tr('Список каналов пуст')
      : (state.group === GROUP_FAV && !searchInput.value.trim() ? tr('В избранном пусто. Нажмите ★ на канале, чтобы добавить.') : tr('Ничего не найдено'))));
  }
  grid.appendChild(frag);
  for (let i = 0; i < n; i++) cardMap.set(state.view[i], grid.children[i] as NavElement);
  if (keepScroll) gridPane.scrollTop = st;
  const total = state.channels.length;
  countEl.textContent = total ? (state.view.length === total ? total + ' ' + plural(total) : tr('{0} из {1}', state.view.length, total)) : '';
  if (focusedEl && !document.body.contains(focusedEl)) focusedEl = null;
  markPlaying();
  scheduleEpgRefresh();
}
function markPlaying(): void {
  cardMap.forEach(function (el: NavElement, ch: Channel): void { el.classList.toggle('playing', ch === state.current); });
}
function applyFilter(): void {
  computeView();
  state.renderCount = PAGE_SIZE;
  renderGrid(false);
}
/** Adds one page to the rendered range and focuses its first new channel, if present. */
function showMore(): void {
  const firstNew = state.renderCount;
  state.renderCount += PAGE_SIZE;
  renderGrid(true);
  const el = cardMap.get(state.view[firstNew]);
  if (el) setFocus(el);
}

/* ================= Телепрограмма (EPG) ================= */
function renderEpgInfo(): void {
  let t: string;
  if (!native()) t = tr('Телепрограмма доступна только в Android-приложении.');
  else if (!epg.enabled) t = tr('Телепрограмма выключена.');
  else if (epg.status === 'loading') t = tr('Загрузка телепрограммы…');
  else if (epg.status === 'ok' && epg.info) t = tr('Источник: {0} · каналов в EPG: {1}, передач: {2} · {3}', epg.info.source, epg.info.channels, epg.info.programmes, fmtDateTime(epg.info.loadedAt));
  else if (epg.status === 'error') t = tr('Ошибка: {0}', epg.err);
  else t = tr('Нет источника. Загрузите xml или xml.gz в «Плейлисты» либо откройте плейлист со ссылкой url-tvg.');
  epgInfoEl.textContent = t;
  epgChk.checked = epg.enabled;
  epgChk.disabled = !native();
}
/** Debounces a non-forced EPG reload by 400 ms. */
function scheduleEpgReload(): void {
  clearTimeout(epgReloadTimer);
  epgReloadTimer = window.setTimeout(function (): void { epgReload(false); }, 400);
}
/**
 * Loads native EPG data from the selected file, falling back to the playlist header URL on failure.
 * A truthy force is passed to the native loader; overlapping requests queue a follow-up, prioritizing force.
 * Load errors update EPG status rather than rejecting; disabled or missing sources clear cached entries.
 */
async function epgReload(force: boolean): Promise<void> {
  const n = native();
  if (!n) { renderEpgInfo(); return; }
  if (!epg.enabled) { epg.status = 'off'; epg.cache.clear(); renderEpgInfo(); epgPaintAll(); return; }
  if (epg.loading) { epg.pending = force ? 'force' : (epg.pending || 'normal'); return; }
  const cands = [];
  if (epg.file) cands.push({ source: 'file', name: epg.file, url: '' });
  if (headerEpgUrl) cands.push({ source: 'url', name: '', url: headerEpgUrl });
  if (!cands.length) { epg.status = 'none'; epg.cache.clear(); renderEpgInfo(); epgPaintAll(); return; }

  const idSet = new Set<string>(), nameSet = new Set<string>();
  state.channels.forEach(function (c: Channel): void {
    if (c.tvgId) idSet.add(c.tvgId);
    nameSet.add(c.name);
    if (c.tvgName) nameSet.add(c.tvgName);
  });
  const ids = Array.from(idSet), names = Array.from(nameSet);
  epg.loading = true;
  epg.status = 'loading';
  renderEpgInfo();
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const sig = (c.source === 'file' ? c.name : c.url) + '|' + state.channels.length + '|' + ids.length;
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
  if (epg.pending) { const f = epg.pending === 'force'; epg.pending = ''; epgReload(f); }
}
/** Saves and enables the selected EPG filename, closes the library, and starts a forced reload. */
function setEpgFile(name: string): void {
  epg.file = name;
  lsSet(LS_EPGFILE, name);
  epg.enabled = true;
  lsSet(LS_EPG, '1');
  closeLibrary();
  showToast(tr('Телепрограмма: {0}', name));
  epgReload(true);
}

/** Debounces the visible-channel EPG lookup by 250 ms. */
function scheduleEpgRefresh(): void {
  clearTimeout(epgTimer);
  epgTimer = window.setTimeout(epgRefresh, 250);
}
/**
 * Updates cached now/next programs for rendered channels and the current channel, then repaints EPG UI.
 * A native lookup failure stops further lookups and leaves already cached results available.
 */
async function epgRefresh(): Promise<void> {
  const n = native();
  if (!n || !epg.enabled || epg.status !== 'ok') { epgPaintAll(); return; }
  const chans: Channel[] = [];
  cardMap.forEach(function (el: NavElement, ch: Channel): void { chans.push(ch); });
  if (state.current && !epg.cache.has(state.current)) chans.push(state.current);
  for (let off = 0; off < chans.length; off += 300) {
    let part = chans.slice(off, off + 300), res: EpgLookupResponse;
    try {
      res = await n.epgLookup({ items: part.map(function (c: Channel): { id: string; name: string; alt: string; } { return { id: c.tvgId, name: c.name, alt: c.tvgName }; }) });
    } catch (e) { break; }
    const seen: Record<number, number> = {};
    (res.results || []).forEach(function (r: { i: number; n?: EpgProgram | null; x?: EpgProgram | null; }): void {
      const c = part[r.i];
      if (c) { epg.cache.set(c, { n: r.n || null, x: r.x || null }); seen[r.i] = 1; }
    });
    part.forEach(function (c: Channel, i: number): void { if (!seen[i]) epg.cache.set(c, null); });
  }
  epgPaintAll();
}
/** Returns elapsed program progress as a percentage clamped to 0–100 for positive-duration s/e Unix timestamps in milliseconds. */
function progress(p: EpgProgram): number {
  const v = (Date.now() - p.s) / (p.e - p.s);
  return Math.max(0, Math.min(1, v)) * 100;
}
/** Paints cached current or next program data on a channel card, hiding it when EPG or program data is unavailable. */
function epgPaintCard(el: NavElement): void {
  const box = el._epg;
  if (!box) return;
  const d = epg.enabled ? (el._channel ? epg.cache.get(el._channel) : undefined) : null;
  // Пропускаем перерисовку, если данные и ширина полосы не изменились (экономит layout на сотнях карточек).
  const w = d && d.n ? progress(d.n) + '%' : '0';
  if (d && d.n) {
    if (box.et.textContent !== d.n.t) box.et.textContent = d.n.t;
    if (box.fill.style.width !== w) box.fill.style.width = w;
    if (box.root.style.display !== 'block') box.root.style.display = 'block';
  } else if (d && d.x) {
    const t = fmtTime(d.x.s) + ' ' + d.x.t;
    if (box.et.textContent !== t) box.et.textContent = t;
    if (box.fill.style.width !== '0') box.fill.style.width = '0';
    if (box.root.style.display !== 'block') box.root.style.display = 'block';
  } else {
    if (box.root.style.display !== 'none') box.root.style.display = 'none';
  }
}
/** Paints cached now/next text and progress for ch, hiding the block when neither program is available. */
function epgPaintBlock(blockEl: HTMLElement, nowEl: HTMLElement, nextEl: HTMLElement, barEl: HTMLElement, ch: Channel | null): void {
  const d = (epg.enabled && ch) ? epg.cache.get(ch) : null;
  if (!d || (!d.n && !d.x)) { blockEl.style.display = 'none'; return; }
  blockEl.style.display = 'block';
  if (d.n) {
    nowEl.textContent = tr('Сейчас: {0}  {1}\u2013{2}', d.n.t, fmtTime(d.n.s), fmtTime(d.n.e));
    barEl.style.width = progress(d.n) + '%';
  } else {
    nowEl.textContent = '';
    barEl.style.width = '0';
  }
  nextEl.textContent = d.x ? tr('Далее: {0}  {1}', d.x.t, fmtTime(d.x.s)) : '';
}
function epgPaintAll(): void {
  cardMap.forEach(function (el: NavElement): void { epgPaintCard(el); });
  epgPaintBlock(nowEpg, nowEpgNow, nowEpgNext, nowEpgBar, state.current);
  epgPaintBlock(osdEpg, osdEpgNow, osdEpgNext, osdEpgBar, state.current);
}

function guideOpen(): boolean { return guide.classList.contains('open'); }
function closeGuide(): void { guide.classList.remove('open'); }

/* ================= Панель избранного в плеере ================= */
let favList: Channel[] = [], favIdx: number = 0;
function favOpen(): boolean { return favsPanel.classList.contains('open'); }
function closeFavs(): void { favsPanel.classList.remove('open'); }
/** Rebuilds the favorites panel from all channels, wrapping an out-of-range selection and scrolling it into view. */
function renderFavs(): void {
  favsList.textContent = '';
  favList = state.channels.filter(isFav);
  if (!favList.length) {
    favsList.appendChild(mk('div', 'frow', tr('В избранном пусто. Удержание OK на канале — добавить.')));
    favIdx = 0;
    return;
  }
  if (favIdx >= favList.length) favIdx = 0;
  if (favIdx < 0) favIdx = favList.length - 1;
  favList.forEach(function (c: Channel, i: number): void {
    const row = mk('div', 'frow' + (c === state.current ? ' cur' : '') + (i === favIdx ? ' focused' : ''));
    row.appendChild(mk('div', 'fi', String(i + 1)));
    row.appendChild(mk('div', 'fn', c.name));
    favsList.appendChild(row);
  });
  const act = favsList.querySelector('.frow.focused');
  if (act) { try { act.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
}
/** Opens favorites with the current channel selected when present; no-ops if no channel is current. */
function openFavs(): void {
  if (!state.current) return;
  favList = state.channels.filter(isFav);
  favIdx = favList.indexOf(state.current);
  if (favIdx < 0) favIdx = 0;
  renderFavs();
  favsPanel.classList.add('open');
  showOsd();
}
/** Moves the favorite selection by delta positions with wraparound; does nothing for an empty list. */
function moveFav(delta: number): void {
  if (!favList.length) return;
  favIdx = (favIdx + delta + favList.length) % favList.length;
  renderFavs();
}
/** Plays the selected favorite if present, then closes the favorites panel. */
function pickFav(): void {
  const c = favList[favIdx];
  if (c) playChannel(c);
  closeFavs();
}

const GUIDE_LIMIT = 500;
let guideProgs: EpgProgram[] = [], guideIdx: number = 0;
/** Formats a Unix timestamp in milliseconds as a Russian local date, adding a relative label within two days of today. */
function guideDayLabel(ms: number): string {
  const d = new Date(ms), now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dd - d0) / 86400000);
  const rel = diff === 0 ? tr('Сегодня') : diff === -1 ? tr('Вчера') : diff === 1 ? tr('Завтра') : diff === -2 ? tr('Позавчера') : diff === 2 ? tr('Послезавтра') : '';
  const wd = d.toLocaleDateString(locale(), { weekday: 'short' });
  const dm = d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
  return (rel ? rel + ' · ' : '') + wd + ', ' + dm;
}
/** Stores and renders the supplied program order with local day headings, archive hints, and current/first-future descriptions. */
function renderGuide(programs: EpgProgram[]): void {
  guideProgs = programs.slice();
  guideList.textContent = '';
  if (!programs.length) { guideList.appendChild(mk('div', 'gd', tr('Для этого канала нет программы передач.'))); return; }
  const ch = state.current, canCap = !!(ch && (ch.catchupSource || headerCatchup.source));
  let now = Date.now(), lastDay: string | null = null, nextDone = false;
  programs.forEach(function (p: EpgProgram, i: number): void {
    const dk = new Date(p.s).toDateString();
    if (dk !== lastDay) { lastDay = dk; guideList.appendChild(mk('div', 'gday', guideDayLabel(p.s))); }
    const past = p.e <= now, cur = p.s <= now && p.e > now;
    const row = mk('div', 'grow' + (cur ? ' cur' : (past ? ' past' : ' fut')) + (i === guideIdx ? ' focused' : ''));
    row._idx = i;
    row.appendChild(mk('div', 'gt', fmtTime(p.s) + '\u2013' + fmtTime(p.e) + (cur ? tr(' · идёт сейчас') : (past && canCap ? tr(' · ⟲ архив') : ''))));
    row.appendChild(mk('div', 'gn', p.t));
    let showDesc = p.d && cur;
    if (!nextDone && p.s > now) { if (p.d) showDesc = true; nextDone = true; }
    if (showDesc) row.appendChild(mk('div', 'gd', p.d));
    guideList.appendChild(row);
  });
}
function guideScrollToIdx(): void {
  const rows = guideList.querySelectorAll('.grow');
  const row = rows[guideIdx];
  if (row) { try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
}
/** Moves the program selection by delta positions with wraparound and scrolls it into view. */
function guideMove(delta: number): void {
  if (!guideProgs.length) return;
  guideIdx = (guideIdx + delta + guideProgs.length) % guideProgs.length;
  const rows = guideList.querySelectorAll('.grow');
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('focused', i === guideIdx);
  guideScrollToIdx();
}
/**
 * Builds an archive URL from channel or playlist header templates, returning null if neither supplies one.
 * Program s/e values are Unix milliseconds; time placeholders use Unix seconds and duration uses
 * rounded minutes with a minimum of one. Unknown placeholders remain unchanged; append mode extends ch.url.
 */
function catchupUrl(ch: Channel, p: EpgProgram): string | null {
  const tmpl = (ch && ch.catchupSource) || headerCatchup.source || '';
  if (!tmpl) return null;
  const mode = String((ch && ch.catchup) || headerCatchup.mode || '').toLowerCase();
  const sSec = Math.floor(p.s / 1000), eSec = Math.floor(p.e / 1000), nowSec = Math.floor(Date.now() / 1000);
  const dur = Math.max(1, Math.round((p.e - p.s) / 60000));
  const u = tmpl.replace(/\$\{([^}]+)\}|\{([^}]+)\}/g, function (m: string, a: string | undefined, b: string | undefined): string {
    const k = String(a || b).toLowerCase();
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
function guidePick(): void {
  const p = guideProgs[guideIdx], ch = state.current;
  if (!p || !ch) return;
  const now = Date.now();
  if (p.e <= now) {
    const url = catchupUrl(ch, p);
    if (!url) { showToast(tr('У этого канала нет архива')); return; }
    closeGuide(); showToast(tr('Архив: {0}', p.t)); playUrl(url);
  } else if (p.s <= now) {
    closeGuide(); playUrl(ch.url);
  } else {
    showToast(tr('Передача ещё не началась'));
  }
}
/** Requests up to 500 native EPG programs for the current channel and opens the guide at current or next; request errors produce a toast. */
async function openGuide(): Promise<void> {
  const ch = state.current, n = native();
  if (!ch) return;
  if (!n || !epg.enabled || epg.status !== 'ok') { showToast(tr('Телепрограмма недоступна')); return; }
  try {
    const r = await n.epgSchedule({ id: ch.tvgId, name: ch.name, alt: ch.tvgName, limit: GUIDE_LIMIT });
    let progs = r.programs || [], now = Date.now(), ci = -1;
    for (let i = 0; i < progs.length; i++) { if (progs[i].s <= now && progs[i].e > now) { ci = i; break; } }
    if (ci < 0) { for (let j = 0; j < progs.length; j++) { if (progs[j].s > now) { ci = j; break; } } }
    guideIdx = ci < 0 ? 0 : ci;
    guideTitle.textContent = ch.name;
    renderGuide(progs);
    guide.classList.add('open');
    guideScrollToIdx();
    showOsd();
  } catch (e) { showToast(tr('Не удалось получить программу')); }
}

/* ================= Воспроизведение ================= */
/** Shows a video overlay message; a truthy isError also marks the current playback attempt as failed. */
function showVideoMsg(text: string, isError: boolean): void {
  videoMsg.textContent = text;
  videoMsg.className = 'show' + (isError ? ' error' : '');
  if (isError) playFailed = true;
}
function hideVideoMsg(): void { videoMsg.className = ''; }
/* ---- Ошибки потока: крупно на языке интерфейса, ниже на двух других, технический код скрыт ---- */
const RETRY_DELAYS_MS = [1000, 3000, 7000];
/** Увеличенные таймауты ExoPlayer (мс): соединение / чтение. Передаются в нативный плеер. */
const NET_CONNECT_TIMEOUT_MS = 20000, NET_READ_TIMEOUT_MS = 30000;
let retryCount = 0;
let retryTimer: number | undefined = undefined;
/** Показывает ошибку потока на трёх языках; final=false — идёт автоповтор, к тексту добавляется обратный отсчёт. */
function showStreamError(kind: StreamErrKind, code: string, final: boolean, retrySec?: number, attempt?: number, max?: number): void {
  videoMsg.textContent = '';
  const order: Lang[] = [getLang()].concat(LANGS.filter(function (l: Lang): boolean { return l !== getLang(); }));
  order.forEach(function (l: Lang, i: number): void {
    const d = document.createElement('div');
    d.className = i === 0 ? 'em1' : 'em2';
    let txt = trIn(l, ERR_KEYS[kind]);
    if (!final && retrySec !== undefined) txt += ' \u00B7 ' + trIn(l, RETRY_KEY, retrySec, attempt || 1, max || 1);
    d.textContent = txt;
    videoMsg.appendChild(d);
  });
  // Технический код (ExoPlayer/hls.js) обычному пользователю не показываем;
  // он остаётся только в консоли для диагностики.
  if (code) console.log('[stream-error]', kind, code, final ? 'final' : 'retry');
  videoMsg.className = 'show error';
  if (final) playFailed = true;
}
/** Сопоставляет имя/текст ошибки ExoPlayer (Media3) и HTTP-код с понятной причиной. */
function nativeErrKind(code: string, status?: number): StreamErrKind {
  const u = code.toUpperCase();
  if (u.indexOf('BAD_HTTP_STATUS') >= 0 || /HTTP (4|5)\d\d/.test(u)) {
    if (status === 404 || status === 410) return 'notfound';
    if (status === 401 || status === 403 || status === 429) return 'denied';
    if (status && status < 500) return 'server';
    return 'server';
  }
  if (u.indexOf('FILE_NOT_FOUND') >= 0) return 'notfound';
  if (u.indexOf('CLEARTEXT') >= 0) return 'cleartext';
  if (u.indexOf('TIMEOUT') >= 0 || u.indexOf('ETIMEDOUT') >= 0) return 'timeout';
  if (u.indexOf('INVALID_HTTP_CONTENT_TYPE') >= 0 || u.indexOf('PARSING_') >= 0 || u.indexOf('UNEXPECTED_FEATURE') >= 0) return 'format';
  if (u.indexOf('AUDIO_TRACK') >= 0) return 'audio';
  if (u.indexOf('DECOD') >= 0 || u.indexOf('UNSUPPORTED_FORMAT') >= 0 || u.indexOf('CONFIGURATION_ERROR') >= 0) return 'decoder';
  // Сетевые сбои: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED / -CLOSED / SOCKET / UNKNOWN_HOST
  // и тексты исключений Java (UnknownHost, Connection refused, Network is unreachable …).
  if (u.indexOf('ERROR_CODE_IO_') >= 0 || u.indexOf('REMOTE_ERROR') >= 0 ||
      u.indexOf('UNKNOWN_HOST') >= 0 || u.indexOf('CONNECTION_REFUSED') >= 0 ||
      u.indexOf('NETWORK_IS_UNREACHABLE') >= 0 || u.indexOf('ENOTCONN') >= 0 ||
      u.indexOf('ECONNREFUSED') >= 0 || u.indexOf('EHOSTUNREACH') >= 0 ||
      u.indexOf('NO INTERNET') >= 0 || u.indexOf('SOCKET') >= 0 ||
      u.indexOf('SSL') >= 0 || u.indexOf('CLOCK') >= 0) return 'network';
  if (u.indexOf('BEHIND_LIVE_WINDOW') >= 0) return 'timeout';
  return 'generic';
}
/** Причина фатальной ошибки hls.js (браузерный запасной плеер). */
function hlsErrKind(data: ErrorData): StreamErrKind {
  if (String(data.type) === 'networkError') {
    const st = data.response ? data.response.code : 0;
    if (st === 404 || st === 410) return 'notfound';
    if (st === 401 || st === 403 || st === 429) return 'denied';
    return 'network';
  }
  if (String(data.type) === 'mediaError') return 'format';
  return 'generic';
}
/** Таймаут «поток молчит»: нет состояния playing/error от нативного плеера — считаем канал недоступен. */
const STARTUP_TIMEOUT_MS = 45000;
let startupTimer: number | undefined = undefined;
/** Включает watchdog запуска: если за STARTUP_TIMEOUT_MS ничего не играет — автоповтор/ошибка как при сбое сети. */
function armStartupWatchdog(): void {
  window.clearTimeout(startupTimer);
  startupTimer = window.setTimeout(function (): void {
    if (state.current && !playFailed && !userPaused) handleNativeError({ state: 'error', message: 'STARTUP_TIMEOUT' });
  }, STARTUP_TIMEOUT_MS);
}
function disarmStartupWatchdog(): void { window.clearTimeout(startupTimer); startupTimer = undefined; }
/** Ошибка нативного плеера: при сетевых сбоях — автоповтор через 1, 3 и 7 секунд, затем понятное сообщение. */
function handleNativeError(ev: NativePlayerEvent): void {
  const code = ev.message || 'ERROR';
  const kind = code === 'STARTUP_TIMEOUT' ? 'timeout' : nativeErrKind(code, ev.status);
  const label = ev.status ? code + ' \u00B7 HTTP ' + ev.status : code;
  const cur = state.current;
  const retryable = kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'denied' || kind === 'generic';
  if (cur && retryable && retryCount < RETRY_DELAYS_MS.length) {
    const delay = RETRY_DELAYS_MS[retryCount];
    retryCount++;
    disarmStartupWatchdog();
    showStreamError(kind, label, false, delay / 1000, retryCount, RETRY_DELAYS_MS.length);
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(function (): void { if (state.current === cur) retryNative(cur.url); }, delay);
    return;
  }
  disarmStartupWatchdog();
  showStreamError(kind, label, true);
}
/** Повторный запуск того же потока в нативном плеере (без полной остановки). */
function retryNative(url: string): void {
  const np = playerPlugin();
  if (!np) return;
  playFailed = false;
  armStartupWatchdog();
  np.play({ url: url, bufferMs: settings.bufferMs, connectTimeoutMs: NET_CONNECT_TIMEOUT_MS, readTimeoutMs: NET_READ_TIMEOUT_MS }).catch(function (e: unknown): void {
    if (state.current) showStreamError('generic', errMsg(e), true);
  });
}
/* Сеть вернулась — перезапускаем канал, который остановился с ошибкой. */
window.addEventListener('online', function (): void {
  if (state.current && playFailed) { retryCount = 0; playChannel(state.current); }
});
/** Attempts browser video playback, ignoring synchronous errors and rejected play promises, including autoplay denial. */
function safePlay(): void {
  try { const p = video.play(); if (p && p.catch) p.catch(function (): void { /* автозапуск запрещён — ждём действия */ }); } catch (e) { /* ignore */ }
}
/** Invalidates pending playback attempts, clears browser media and HLS state, and requests native playback stop. */
function stopPlayback(): void {
  playToken++;
  gating = false;
  hasPlayed = false;
  retryCount = 0; window.clearTimeout(retryTimer); disarmStartupWatchdog();
  if (nativeErrHandler) { video.removeEventListener('error', nativeErrHandler); nativeErrHandler = null; }
  if (hls) { try { hls.destroy(); } catch (e) { /* ignore */ } hls = null; }
  try { video.pause(); } catch (e) { /* ignore */ }
  video.removeAttribute('src');
  try { video.load(); } catch (e) { /* ignore */ }
  const np = playerPlugin();
  if (np) { try { np.stop(); } catch (e) { /* ignore */ } }
}
function hlsAvailable(): boolean { return !!(window.Hls && window.Hls.isSupported()); }

/**
 * Returns buffered seconds ahead of the playhead from the first range ending no earlier than 0.1 seconds behind it.
 * Returns zero if no such range is found or buffered-range access fails.
 */
function bufferedAhead(): number {
  try {
    const b = video.buffered, ct = video.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.end(i) >= ct - 0.1) return Math.max(0, b.end(i) - Math.max(ct, b.start(i)));
    }
  } catch (e) { /* ignore */ }
  return 0;
}
/**
 * Waits for ms milliseconds of buffered video, or until more than ms + 8,000 ms have elapsed, before attempting play.
 * A stale playback token or user pause cancels polling; a zero duration attempts playback immediately.
 */
function gatePlay(token: number, ms: number): void {
  if (!ms) { gating = false; safePlay(); return; }
  gating = true;
  const t0 = Date.now();
  function check(): void {
    if (token !== playToken || userPaused) { gating = false; return; }
    if (bufferedAhead() * 1000 >= ms || Date.now() - t0 > ms + 8000) { gating = false; safePlay(); return; }
    showVideoMsg(tr('Буферизация…'), false);
    window.setTimeout(check, 120);
  }
  check();
}

/**
 * Starts browser media playback with the configured buffer delay for this playback token.
 * On a media error, tries HLS.js once if allowHlsFallback is truthy and supported; otherwise displays an error.
 */
function startNative(url: string, token: number, allowHlsFallback: boolean): void {
  const handler = function (): void {
    if (token !== playToken) return;
    video.removeEventListener('error', handler);
    nativeErrHandler = null;
    if (allowHlsFallback && hlsAvailable()) startHls(url, token, false);
    else showVideoMsg(tr('Не удалось воспроизвести поток'), true);
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
function startHls(url: string, token: number, allowNativeFallback: boolean): void {
  // Both callers first check hlsAvailable(); no asynchronous gap precedes this read.
  const H = window.Hls!, ms = settings.bufferMs;
  const cfg: Partial<HlsConfig> = { enableWorker: true, lowLatencyMode: false, backBufferLength: 30,
    maxBufferLength: Math.max(30, Math.ceil(ms / 1000) + 15),
    manifestLoadingTimeOut: 20000, manifestLoadingMaxRetry: 2, levelLoadingTimeOut: 20000, levelLoadingMaxRetry: 2,
    fragLoadingTimeOut: 30000, fragLoadingMaxRetry: 3 };
  // Для прямого эфира буфер = отступ от «живого» края
  if (ms > 0) cfg.liveSyncDuration = Math.max(1, ms / 1000); else cfg.liveSyncDurationCount = 1;
  const h = new H(cfg);
  hls = h;
  let netRetries = 0, mediaRetries = 0;
  h.on(H.Events.MANIFEST_PARSED, function (): void { if (token === playToken) gatePlay(token, ms); });
  h.on(H.Events.ERROR, function (ev: Events.ERROR, data: ErrorData): void {
    if (token !== playToken || !data || !data.fatal) return;
    if (data.type === H.ErrorTypes.NETWORK_ERROR && netRetries < 2) {
      netRetries++;
      showStreamError('network', 'HLS', false, 1, netRetries, 2);
      window.setTimeout(function (): void { if (token === playToken && hls === h) h.startLoad(); }, 1200);
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
    else showStreamError(hlsErrKind(data), String(data.details || data.type), true);
  });
  h.loadSource(url);
  h.attachMedia(video);
}
/** Starts a stream through the native player if available, otherwise chooses HLS.js or browser media with a fallback on media errors. Synchronous setup errors propagate. */
function playUrl(url: string): void {
  if (playerPlugin()) { playNativePlayer(url); return; }
  stopPlayback();
  const token = playToken;
  playFailed = false;
  showVideoMsg(tr('Загрузка потока…'), false);
  const looksHls = /\.m3u8(\?|#|$)/i.test(url);
  if (looksHls && hlsAvailable()) startHls(url, token, true);
  else startNative(url, token, hlsAvailable());
}
let nativeListenerReady: boolean = false;
/** Registers the native player state listener once to update buffering, playing, and error UI. */
function ensureNativeListener(np: IptvPlayerPlugin | null): void {
  if (nativeListenerReady || !np) return;
  nativeListenerReady = true;
  np.addListener('state', function (ev: NativePlayerEvent): void {
    if (!ev || !state.current) return;
    if (ev.state === 'buffering') showVideoMsg(tr('Буферизация…'), false);
    else if (ev.state === 'playing') { hasPlayed = true; retryCount = 0; disarmStartupWatchdog(); hideVideoMsg(); updateOsdState(); }
    else if (ev.state === 'error') handleNativeError(ev);
  });
}
/** Sends video-box bounds in physical pixels to the native player when a channel is selected; rejected updates are ignored. */
function syncPlayerBounds(): void {
  const np = playerPlugin();
  if (!np || !state.current) return;
  const r = videoBox.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  np.setBounds({
    x: Math.round(r.left * dpr), y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr), h: Math.round(r.height * dpr)
  }).catch(function (): void { /* ignore */ });
}
/** Starts a native stream with the configured buffer and bounds; rejected play requests show an error if a channel is still selected. */
function playNativePlayer(url: string): void {
  // Called only after playUrl has obtained the cached native player bridge.
  const np = playerPlugin()!;
  stopPlayback();
  playFailed = false;
  showVideoMsg(tr('Загрузка потока…'), false);
  ensureNativeListener(np);
  requestAnimationFrame(syncPlayerBounds);
  np.setVisible({ visible: true }).catch(function (): void { /* ignore */ });
  armStartupWatchdog();
  np.play({ url: url, bufferMs: settings.bufferMs, connectTimeoutMs: NET_CONNECT_TIMEOUT_MS, readTimeoutMs: NET_READ_TIMEOUT_MS }).catch(function (e: unknown): void {
    if (state.current) showStreamError('generic', errMsg(e), true);
  });
}
/** Selects a channel, saves its URL, clears user pause, refreshes channel/EPG UI, and starts its stream. Synchronous playback setup errors propagate. */
function playChannel(ch: Channel): void {
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
function togglePause(): void {
  if (!state.current) return;
  const np = playerPlugin();
  if (np) {
    if (userPaused) { userPaused = false; np.resume(); }
    else { userPaused = true; np.pause(); }
  } else if (userPaused || (video.paused && !gating)) { userPaused = false; safePlay(); }
  else { userPaused = true; try { video.pause(); } catch (e) { /* ignore */ } }
  updateOsdState();
  if (state.mode === 'player') showOsd();
}
/** Plays the channel delta positions away in the filtered view with wraparound; if the current channel is absent, selects an end by direction. */
function zap(delta: number): void {
  const len = state.view.length;
  if (!len) return;
  let idx = (state.current ? viewIndex.get(state.current) : undefined);
  if (idx === undefined) idx = -1;
  idx = idx < 0 ? (delta > 0 ? 0 : len - 1) : (idx + delta + len) % len;
  playChannel(state.view[idx]);
  showOsd();
}
video.addEventListener('playing', function (): void { hasPlayed = true; hideVideoMsg(); });
video.addEventListener('waiting', function (): void {
  if (!state.current || playFailed) return;
  showVideoMsg(tr('Буферизация…'), false);
  // Подвисание: ставим на паузу и ждём, пока снова накопится заданный буфер
  if (settings.bufferMs > 0 && hasPlayed && !gating && !userPaused && !video.seeking) {
    try { video.pause(); } catch (e) { /* ignore */ }
    gatePlay(playToken, settings.bufferMs);
  }
});
video.addEventListener('pause', updateOsdState);
video.addEventListener('play', updateOsdState);

/* ================= OSD и экран плеера ================= */
function updateOsdState(): void {
  if (playerPlugin()) { osdState.textContent = userPaused ? tr('Пауза') : ''; return; }
  osdState.textContent = userPaused ? tr('\u23F8 Пауза') : '';
}
/** Shows current channel and EPG details and schedules hiding after 4.5 seconds; no-ops without a current channel. */
function showOsd(): void {
  if (!state.current) return;
  const idx = (state.current ? viewIndex.get(state.current) : undefined);
  osdNum.textContent = idx !== undefined ? (idx + 1) + ' / ' + state.view.length : '';
  osdName.textContent = state.current.name;
  osdGroup.textContent = state.current.group;
  updateOsdState();
  epgPaintAll();
  osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = window.setTimeout(function (): void { hideOsd(false); }, 4500);
}
/** Hides playback controls unless paused or a guide/favorites panel is open; a truthy force overrides those conditions. */
function hideOsd(force: boolean): void {
  if ((userPaused || guideOpen() || favOpen()) && !force) return;      // на паузе или с открытой программой панель остаётся
  clearTimeout(osdTimer);
  osd.classList.remove('show');
}
function toggleControls(): void {
  if (osd.classList.contains('show')) hideOsd(true); else showOsd();
}
/** Enters the full-screen player layout for the current channel and schedules native bounds synchronization. */
function enterPlayer(): void {
  if (state.mode === 'player' || !state.current) return;
  state.mode = 'player';
  document.body.classList.add('player');
  showOsd();
  requestAnimationFrame(syncPlayerBounds);
}
/** Returns from player mode to the channel menu, closes player panels, and restores navigation focus while playback continues. */
function showMenu(): void {
  if (state.mode !== 'player') return;
  state.mode = 'menu';
  document.body.classList.remove('player');
  closeGuide();
  closeFavs();
  hideOsd(true);
  if (state.group === GROUP_FAV) { computeView(); renderGrid(true); }
  requestAnimationFrame(syncPlayerBounds);
  setFocus((state.current ? cardMap.get(state.current) : undefined) || videoBox);
}

/* ================= Кнопка «Назад» ================= */
let lastBackAt: number = 0, lastBackHandled: number = 0;
function exitApp(): void {
  const app = appPlugin();
  if (app && app.exitApp) app.exitApp(); else { try { window.close(); } catch (e) { /* ignore */ } }
}
/** Handles Back at most once per 250 ms, closing overlays or player mode first; in the menu, two presses within two seconds request exit. */
function handleBack(): void {
  const t = Date.now();
  if (t - lastBackHandled < 250) return;   // одно нажатие не должно обработаться дважды
  lastBackHandled = t;
  if (langPickOpen()) return;
  if (pinpadOpen()) { pinClose(); return; }
  if (guideOpen()) { closeGuide(); return; }
  if (libraryOpen()) { closeLibrary(); return; }
  if (settingsOpen()) { closeSettings(); return; }
  if (state.mode === 'player') { showMenu(); return; }
  const ae = document.activeElement;
  if (isText(ae)) { ae.blur(); return; }
  if (t - lastBackAt < 2000) { exitApp(); return; }
  lastBackAt = t;
  showToast(tr('Нажмите «Назад» ещё раз для выхода'));
}
function registerBack(): void {
  const app = appPlugin();
  if (app && app.addListener) {
    try { app.addListener('backButton', function (): void { handleBack(); }); } catch (e) { /* ignore */ }
  }
}
registerBack();

/* ================= Настройки ================= */
function settingsOpen(): boolean { return settingsEl.classList.contains('open'); }
/* ================= Язык интерфейса ================= */
const langPickEl = $('langPick');
function langPickOpen(): boolean { return langPickEl.classList.contains('open'); }
/** Сохраняет язык и перезапускает интерфейс, чтобы все тексты построились заново. */
function chooseLang(l: Lang): void {
  setLang(l, true);
  const np = playerPlugin();
  const reload = function (): void { window.location.reload(); };
  if (np) { Promise.resolve(np.stop()).then(reload, reload); } else reload();
}
function buildSettingsLang(): void { buildLangButtons($('langBtns'), chooseLang); }
/** Первый запуск: экран выбора языка с флагами. */
function openLangPick(): void {
  const btns = buildLangButtons($('langPickBtns'), chooseLang);
  langPickEl.classList.add('open');
  setFocus(btns[LANGS.indexOf(getLang())] || btns[0], false);
}
let bufAtOpen: number = 0;
function updateLastReload(): void {
  const t = parseInt(lsGet(LS_RELOADED), 10), ent = state.entry;
  if (!ent) lastReloadEl.textContent = tr('Плейлист ещё не открыт.');
  else if (ent.kind === 'file') lastReloadEl.textContent = tr('Открыт файл «{0}». Кнопка «Обновить» перечитывает его из «Загрузок».', ent.fileName);
  else lastReloadEl.textContent = t ? tr('Последнее обновление: {0}', new Date(t).toLocaleString(locale())) : tr('Плейлист ещё не обновлялся.');
}
/** Refreshes settings controls and playlist, EPG, PIN, server, and native autostart status. */
function syncSettingsUi(): void {
  bufRange.value = String(settings.bufferMs);
  bufNum.value = String(settings.bufferMs);
  bufVal.textContent = settings.bufferMs + ' ' + tr('мс');
  autoChk.checked = settings.autoReload;
  hoursNum.value = String(settings.reloadHours);
  updateLastReload();
  renderEpgInfo();
  renderPinStatus();
  renderServerUi();
  syncAutoStartUi();
}
/** Displays PIN setup/unlock status and, when set, the blocked-group count; no-ops if the status element is absent. */
function renderPinStatus(): void {
  const el = document.getElementById('pinStatus');
  if (!el) return;
  if (!parentPin) el.textContent = tr('PIN не задан');
  else if (pinUnlocked) el.textContent = tr('🔓 PIN задан, скрытые группы показаны ({0})', blockedGroups.size);
  else el.textContent = tr('🔒 PIN задан, скрыто групп: {0}', blockedGroups.size);
}
/** Reads native autostart state when supported; disables the control if unavailable and ignores read failures. */
function syncAutoStartUi(): void {
  const n = native();
  if (!n || !n.getAutoStart) { autoStartChk.disabled = true; autoStartChk.checked = false; return; }
  autoStartChk.disabled = false;
  n.getAutoStart().then(function (r: { on: boolean; }): void { autoStartChk.checked = !!(r && r.on); }).catch(function (): void { /* ignore */ });
}
/** Parses and saves a buffer duration in milliseconds, clamped to 0–7,000; invalid input retains the current value. */
function setBuffer(v: string | number): void {
  settings.bufferMs = toInt(v, settings.bufferMs, 0, 7000);
  lsSet(LS_BUF, String(settings.bufferMs));
  syncSettingsUi();
}
/** Opens settings and focuses the buffer control, recording its value so closing can apply a changed buffer to playback. */
async function openSettings(): Promise<void> {
  if (libraryOpen()) closeLibrary();
  bufAtOpen = settings.bufferMs;
  syncSettingsUi();
  settingsEl.classList.add('open');
  setFocus(bufRange, false);
  refreshServerStatus();
}
/** Closes settings, restores button focus, and restarts the current channel if the buffer changed while open. */
function closeSettings(): void {
  if (!settingsOpen()) return;
  settingsEl.classList.remove('open');
  setFocus(settingsBtn, false);
  if (settings.bufferMs !== bufAtOpen && state.current) playChannel(state.current);   // применить новый буфер сразу
}
bufRange.addEventListener('input', function (): void { setBuffer(bufRange.value); });
bufNum.addEventListener('change', function (): void { setBuffer(bufNum.value); });
autoChk.addEventListener('change', function (): void {
  settings.autoReload = autoChk.checked;
  lsSet(LS_AUTO, settings.autoReload ? '1' : '0');
  if (settings.autoReload) autoTick();
});
autoStartChk.addEventListener('change', function (): void {
  const n = native();
  if (!n || !n.setAutoStart) return;
  n.setAutoStart({ on: autoStartChk.checked }).then(function (): void {
    showToast(autoStartChk.checked ? tr('Автозапуск включён') : tr('Автозапуск выключен'));
  }).catch(function (): void { /* ignore */ });
});
hoursNum.addEventListener('change', function (): void {
  settings.reloadHours = toInt(hoursNum.value, settings.reloadHours, 1, 168);
  lsSet(LS_HOURS, String(settings.reloadHours));
  syncSettingsUi();
});
epgChk.addEventListener('change', function (): void {
  epg.enabled = epgChk.checked;
  lsSet(LS_EPG, epg.enabled ? '1' : '0');
  epgReload(false);
});
$('epgReloadBtn').addEventListener('click', function (): void { epgReload(true); });
$('epgResetBtn').addEventListener('click', function (): void {
  epg.file = '';
  lsSet(LS_EPGFILE, '');
  showToast(tr('Файл EPG сброшен'));
  epgReload(true);
});
$('clearCacheBtn').addEventListener('click', async function (): Promise<void> {
  const n = native();
  if (!n || !n.clearCache) { showToast(tr('Очистка кэша доступна только в приложении')); return; }
  try {
    const r = await n.clearCache();
    showToast(tr('Кэш очищен: освобождено {0}', fmtSize((r && r.freed) || 0)));
  } catch (e) { showToast(tr('Не удалось очистить кэш: {0}', errMsg(e)), 3500); }
});
srvChk.addEventListener('click', function (): void { setServer(!srv.running); });
srvBtn.addEventListener('click', function (): void { setServer(!srv.running); });
$('libClose').addEventListener('click', closeLibrary);
$('reloadNow').addEventListener('click', function (): void { reloadPlaylist(true); });
$('closeSettings').addEventListener('click', closeSettings);
settingsEl.addEventListener('click', function (e: MouseEvent): void { if (e.target === settingsEl) closeSettings(); });
libraryEl.addEventListener('click', function (e: MouseEvent): void { if (e.target === libraryEl) closeLibrary(); });
settingsBtn.addEventListener('click', openSettings);
libBtn.addEventListener('click', openLibrary);
reloadBtn.addEventListener('click', function (): void { reloadPlaylist(true); });
$('pinSetBtn').addEventListener('click', function (): void {
  // смена существующего PIN требует авторизации (первоначальная установка — без неё)
  if (parentPin && !pinUnlocked) { pinOpen('unlock'); showToast(tr('Сначала введите текущий PIN')); return; }
  pinOpen('set');
});
/** Removes the PIN only when no group keys remain blocked, prompting for the current PIN unless already unlocked. */
$('pinClearBtn').addEventListener('click', function (): void {
  if (!parentPin) { showToast(tr('PIN не задан')); return; }
  // под снятым PIN заблокированные группы перестанут скрываться, поэтому сначала нужно снять все блокировки
  if (hasBlockedGroups()) { showToast(tr('Сначала разблокируйте все скрытые группы')); return; }
  // снятие PIN возможно только после разблокировки или ввода текущего PIN в настройках
  if (!pinUnlocked) {
    const p = window.prompt(tr('Для снятия PIN введите текущий PIN (3 цифры):'));
    if (p === null) return;
    if (!verifyPin(String(p).trim())) { showToast(tr('Неверный PIN')); return; }
  }
  parentPin = ''; lsSet('iptv.pin', ''); pinUnlocked = false; pinFailCount = 0; pinBlockedUntil = 0; buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus(); showToast(tr('PIN снят'));
});
pinCancel.addEventListener('click', pinClose);

// Свайп вверх/вниз по видео — переключение каналов
let sw: Point | null = null;
videoBox.addEventListener('touchstart', function (e: TouchEvent): void {
  if (state.mode !== 'player' || e.touches.length !== 1) { sw = null; return; }
  const t = e.touches[0];
  sw = { x: t.clientX, y: t.clientY };
}, { passive: true });
videoBox.addEventListener('touchend', function (e: TouchEvent): void {
  if (!sw) return;
  const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  sw = null;
  if (guideOpen() || favOpen()) return;
  if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    swipedAt = Date.now();
    zap(dy < 0 ? 1 : -1);
  }
}, { passive: true });

// Долгое нажатие на канал — в избранное
let lpTimer: number | undefined = undefined, lpStart: Point | null = null;
function cancelLongPress(): void { clearTimeout(lpTimer); lpTimer = undefined; }
grid.addEventListener('touchstart', function (e: TouchEvent): void {
  lpFired = false;
  if ((e.target as Element).closest && (e.target as Element).closest<NavElement>('.card .star')) { cancelLongPress(); return; }
  const el = (e.target as Element).closest ? (e.target as Element).closest<NavElement>('.card') : null;
  if (!el || !el._channel || e.touches.length !== 1) { cancelLongPress(); return; }
  const t = e.touches[0];
  lpStart = { x: t.clientX, y: t.clientY };
  cancelLongPress();
  lpTimer = window.setTimeout(function (): void { lpTimer = undefined; lpFired = true; toggleFav(el._channel); }, 550);
}, { passive: true });
grid.addEventListener('touchmove', function (e: TouchEvent): void {
  if (!lpTimer || !lpStart) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - lpStart.x) > 12 || Math.abs(t.clientY - lpStart.y) > 12) cancelLongPress();
}, { passive: true });
grid.addEventListener('touchend', cancelLongPress, { passive: true });
grid.addEventListener('touchcancel', cancelLongPress, { passive: true });
grid.addEventListener('contextmenu', function (e: MouseEvent): void { e.preventDefault(); });
// Тап по звёздочке на карточке — вкл/выкл избранное
grid.addEventListener('click', function (e: MouseEvent): void {
  const st = (e.target as Element).closest ? (e.target as Element).closest<NavElement>('.card .star') : null;
  if (!st) return;
  const card = st.closest<NavElement>('.card');
  if (card && card._channel) { e.preventDefault(); e.stopPropagation(); toggleFav(card._channel); }
});

/* ================= D-Pad навигация ================= */
/** Returns visible navigation targets within the first open overlay, or the whole document if none is open. */
function navItems(): NavElement[] {
  const root = document.querySelector('.overlay.open') || document;
  return Array.from(root.querySelectorAll<NavElement>('[data-nav]')).filter(function (el: NavElement): boolean { return el.getClientRects().length > 0; });
}
/** Moves the navigation highlight and blurs another text input; scrolls the target into view unless scroll is false. */
function setFocus(el: NavElement | null | undefined, scroll?: boolean): void {
  if (!el) return;
  if (focusedEl && focusedEl !== el) focusedEl.classList.remove('focused');
  const ae = document.activeElement;
  if (isText(ae) && ae !== el) ae.blur();
  focusedEl = el;
  el.classList.add('focused');
  if (scroll !== false) {
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
    catch (e) { el.scrollIntoView(); }
  }
}
/** Moves the highlight left/right/up/down among visible targets, preferring candidates in the same row or column. */
function moveFocus(dir: Direction): void {
  const items = navItems();
  if (!items.length) return;
  if (!focusedEl || items.indexOf(focusedEl) === -1) { setFocus(items[0]); return; }
  const c = focusedEl.getBoundingClientRect();
  const ccx = c.left + c.width / 2, ccy = c.top + c.height / 2;
  let best: NavElement | null = null, bestScore = Infinity;          // любой подходящий (запасной вариант)
  let bestSame: NavElement | null = null, bestSameScore = Infinity;  // приоритет: элемент в том же ряду/колонке
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    if (el === focusedEl) continue;
    const r = el.getBoundingClientRect();
    const rcx = r.left + r.width / 2, rcy = r.top + r.height / 2;
    let primary: number, secondary: number, same: boolean;
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
    const score = primary + secondary * (same ? 0.4 : 2.5);
    if (score < bestScore) { bestScore = score; best = el; }
    if (same && score < bestSameScore) { bestSameScore = score; bestSame = el; }
  }
  const pick = bestSame || best;
  if (pick) setFocus(pick);
}
/** Activates a navigation target, using its custom action, input interaction, group selection, or channel playback behavior. */
function activate(el: NavElement | null): void {
  if (!el) return;
  if (el._act) { el._act(); return; }
  if (isText(el)) {
    el.focus();
    try { const n = el.value.length; el.setSelectionRange(n, n); } catch (e) { /* ignore */ }
  } else if (el.tagName === 'BUTTON' || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'file'))) {
    el.click();
  } else if (el === videoBox) {
    if (state.current) enterPlayer(); else setStatus(tr('Сначала выберите канал справа.'), 'warn');
  } else if ('_group' in el && el._group !== undefined) {
    setGroup(el._group);
  } else if (el.classList.contains('more')) {
    showMore();
  } else if ('_channel' in el && el._channel) {
    if (state.current === el._channel && !playFailed) enterPlayer(); else playChannel(el._channel);
  }
}
/** Normalizes supported keyboard and TV remote keys to navigation actions, returning null for unrecognized keys. */
function keyName(e: KeyboardEvent): RemoteKey {
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
function onKeyDown(e: KeyboardEvent): void {
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
    const pk = keyName(e);
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
  const ae = document.activeElement;
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
  const k = keyName(e);
  if (!k) return;
  e.preventDefault();
  if (k === 'back') { handleBack(); return; }
  if (focusedEl === bufRange && (k === 'left' || k === 'right')) { setBuffer(Number(bufRange.value) + (k === 'right' ? 100 : -100)); return; }
  if (k === 'enter') { if (!e.repeat) activate(focusedEl); }
  else moveFocus(k);
}
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('resize', function (): void { requestAnimationFrame(syncPlayerBounds); });

/* ===== Управление плеером с пульта: короткое OK — пауза, удержание OK — в избранное ===== */
let okHoldTimer: number | undefined = undefined;
/** Starts a 700 ms OK hold timer to toggle the current favorite; releasing earlier is handled as pause by onKeyUp. */
function startOkHold(): void {
  clearTimeout(okHoldTimer);
  okHoldTimer = window.setTimeout(function (): void {
    okHoldTimer = undefined;
    if (state.current) { toggleFav(state.current); showOsd(); }
  }, 700);
}
/** On OK release in player mode, cancels an unexpired hold timer and toggles pause; a completed hold does not pause. */
function onKeyUp(e: KeyboardEvent): void {
  if (state.mode !== 'player') return;
  if (keyName(e) !== 'enter') return;
  if (okHoldTimer) { clearTimeout(okHoldTimer); okHoldTimer = undefined; togglePause(); }
}
window.addEventListener('keyup', onKeyUp, true);
/** Restores the menu navigation highlight after focus changes, leaving active text/file inputs and player mode alone. */
function restoreNavFocus(): void {
  if (state.mode === 'player') return;
  const ae = document.activeElement;
  if (isText(ae) || (ae && ae instanceof HTMLInputElement && ae.type === 'file')) return;
  if (focusedEl && document.body.contains(focusedEl)) setFocus(focusedEl, false);
  else { const it = navItems(); if (it.length) setFocus(it[0], false); }
}
window.addEventListener('focus', function (): void { window.setTimeout(restoreNavFocus, 60); });

// Мышь / тач и синхронизация подсветки с реальным фокусом
let tapEl: NavElement | null = null, tapAt: number = 0;
document.addEventListener('click', function (e: MouseEvent): void {
  // Кнопки панели плеера обрабатываются своими обработчиками: иначе после смены режима клик снова откроет полный экран
  if (pinpadOpen() && !((e.target as Element).closest && (e.target as Element).closest<NavElement>('.pinpad-panel'))) { pinClose(); return; }
  if ((e.target as Element).closest && (e.target as Element).closest<NavElement>('.card .star')) return;   // звёздочку обрабатывает свой обработчик
  if ((e.target as Element).closest && (e.target as Element).closest<NavElement>('#favs')) { closeFavs(); return; }
  if ((e.target as Element).closest && (e.target as Element).closest<NavElement>('#guide')) {
    const gr = (e.target as Element).closest<NavElement>('.grow');
    if (gr && gr._idx != null) { guideIdx = gr._idx; guidePick(); } else closeGuide();
    return;
  }
  if (Date.now() - swipedAt < 400) return;
  if (state.mode === 'player') {
    toggleControls();      // тап по экрану показывает / прячет панель
    return;
  }
  if (lpFired) { lpFired = false; return; }   // после долгого нажатия канал не запускаем
  const el = (e.target as Element).closest ? (e.target as Element).closest<NavElement>('[data-nav]') : null;
  if (!el) return;
  setFocus(el, false);
  if (el._channel) {                          // двойной тап по каналу — на весь экран
    const t = Date.now();
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
document.addEventListener('focusin', function (e: FocusEvent): void {
  const el = e.target as NavElement | null;
  if (el && 'matches' in el && el.matches('[data-nav]') && el !== focusedEl) setFocus(el, false);
});

loadBtn.addEventListener('click', function (): void { loadFromUrl(); });
fileInput.addEventListener('change', loadFromFile);
searchInput.addEventListener('input', function (): void {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applyFilter, 200);
});

// Автообновление плейлиста и телепрограммы: проверка раз в минуту и при возврате в приложение
window.setInterval(function (): void { autoTick(); if (!document.hidden) epgRefresh(); }, 60000);
document.addEventListener('visibilitychange', function (): void { if (!document.hidden) { autoTick(); epgRefresh(); window.setTimeout(restoreNavFocus, 60); } });

/* ================= Пульт Remote Supremacy (мост из нативного сервера) ================= */
/**
 * Returns a remote-control snapshot with at most the first 800 filtered channels and their zero-based view indices.
 * Counts describe the full lists; playing indicates a selected channel, not confirmed media playback.
 */
function remoteState(): RemoteState {
  const chans = state.view.slice(0, 800).map(function (c: Channel, i: number): RemoteChannel {
    return { i: i, name: c.name, group: c.group, url: c.url, playing: c === state.current, fav: favs.has(c.url) };
  });
  return {
    ok: true,
    lang: getLang(),
    current: state.current ? { name: state.current.name, group: state.current.group, url: state.current.url } : null,
    playing: !!state.current,
    paused: !!userPaused,
    count: state.channels.length,
    viewCount: state.view.length,
    query: searchInput.value,
    group: state.group,
    groups: (state.groups || []).map(function (g: Group): Group { return { key: g.key, label: g.label, count: g.count }; }),
    favGroup: GROUP_FAV,
    favCount: favs.size,
    blocked: Array.from(blockedGroups),
    pinSet: !!parentPin,
    locked: !pinUnlocked,
    channels: chans
  };
}
/** Serializes all current channels, including hidden ones, as M3U with the header EPG URL and selected channel metadata; catch-up attributes are omitted. */
function buildM3uText(): string {
  const headAttrs = [];
  if (headerEpgUrl) headAttrs.push('url-tvg="' + headerEpgUrl + '"');
  if (headerCatchup.mode) headAttrs.push('catchup="' + headerCatchup.mode + '"');
  if (headerCatchup.source) headAttrs.push('catchup-source="' + headerCatchup.source + '"');
  if (headerCatchup.days) headAttrs.push('catchup-days="' + headerCatchup.days + '"');
  const head = '#EXTM3U' + (headAttrs.length ? ' ' + headAttrs.join(' ') : '');
  const out = [head];
  state.channels.forEach(function (c: Channel): void {
    const a = [];
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
function remoteRename(cmd: RemoteCommand): RemoteResponse {
  const c = state.channels.filter(function (x: Channel): boolean { return x.url === cmd.url; })[0];
  if (!c) return { ok: false, error: 'канал не найден' };
  c.name = String(cmd.name || c.name);
  c.nameLower = c.name.toLowerCase();
  computeView(); renderGroups(); renderGrid(true);
  return remoteState();
}
/** Removes all channels matching cmd.url and clears a matching current selection; returns refreshed remote state or a not-found error result. */
function remoteDelChannel(cmd: RemoteCommand): RemoteResponse {
  const before = state.channels.length;
  state.channels = state.channels.filter(function (x: Channel): boolean { return x.url !== cmd.url; });
  if (state.channels.length === before) return { ok: false, error: 'канал не найден' };
  if (state.current && state.current.url === cmd.url) {
    // канал играл — останавливаем воспроизведение и очищаем индикатор «сейчас играет» до сброса state.current
    stopPlayback();
    state.current = null;
    nowTitle.textContent = '';
    nowGroup.textContent = '';
  }
  // удаляем отметку «скрыта» для групп без оставшихся каналов (в blockedGroups ключи хранятся через gkey)
  const remaining: Record<string, number> = {};
  state.channels.forEach(function (x: Channel): void { remaining[gkey(x)] = 1; });
  let blockedChanged = false;
  Array.from(blockedGroups).forEach(function (k: string): void {
    if (!remaining[k]) { blockedGroups['delete'](k); blockedChanged = true; }
  });
  if (blockedChanged) saveBlocked();
  buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus();
  return remoteState();
}
/**
 * Removes all channels in cmd.key (null or GROUP_NONE means ungrouped) and clears the group's block.
 * While locked, deleting a blocked key requires cmd.pin; successful verification unlocks groups.
 * Prunes favorites absent from the remaining channels and clears matching current/group selections.
 * Returns refreshed remote state, or an error result if PIN setup or verification fails or no channels match.
 */
function remoteDelGroup(cmd: RemoteCommand): RemoteResponse {
  // удаление скрытой под PIN группы требует авторизации — иначе пульт мог бы снять защиту, просто удалив группу
  // пустой ключ (rawKey === '') означает «без группы» и хранится в blockedGroups как GROUP_NONE
  const rawKey = cmd.key == null ? GROUP_NONE : String(cmd.key);
  const blockKey = blockKeyFromRemote(rawKey);
  if (blockedGroups.has(blockKey) && !pinUnlocked) {
    if (!parentPin) return { ok: false, error: 'сначала задайте PIN' };
    if (!verifyPin(cmd.pin)) return { ok: false, error: 'неверный PIN' };
    pinUnlocked = true;
  }
  const key = (rawKey === GROUP_NONE) ? '' : rawKey;
  const before = state.channels.length;
  state.channels = state.channels.filter(function (x: Channel): boolean { return (x.group || '') !== key; });
  if (state.channels.length === before) return { ok: false, error: 'группа не найдена' };
  blockedGroups['delete'](key);
  blockedGroups['delete'](rawKey);
  blockedGroups['delete'](blockKey);
  saveBlocked();
  // из избранного (ключ — url канала) убираем url удалённых каналов, иначе счётчик «★ Избранное» завышается
  const keptUrls: Record<string, number> = {};
  state.channels.forEach(function (x: Channel): void { keptUrls[x.url] = 1; });
  favs.forEach(function (u: string): void { if (!keptUrls[u]) favs['delete'](u); });
  saveFavs();
  if (state.current && (state.current.group || '') === key) {
    // играл канал из удаляемой группы — останавливаем воспроизведение и очищаем индикатор до сброса state.current
    stopPlayback();
    state.current = null;
    nowTitle.textContent = '';
    nowGroup.textContent = '';
  }
  if (state.group === rawKey) state.group = GROUP_ALL;
  buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus();
  return remoteState();
}
let remoteNote: string = '';
/** Saves an M3U edit snapshot for the open entry, silently ignoring persistence errors; no-ops without an entry. */
function persistChannels(): void {
  if (!state.entry) return;
  try { lsSet('iptv.edit.' + state.entry.id, buildM3uText()); } catch (e) { /* ignore */ }
}
/**
 * Moves channels from cmd.sources (an array or pipe-separated string of group names) into cmd.target.
 * GROUP_NONE as target means ungrouped; ungrouped sources use the empty string in an array.
 * While locked, blocked source or target keys require cmd.pin; successful verification unlocks groups.
 * Missing PIN setup for a blocked source or failed verification returns an error result without moving channels.
 * Persists edits and returns refreshed remote state with the number of matching channels, even if already in the target.
 */
function remoteMergeGroups(cmd: RemoteCommand): RemoteResponse {
  const target = String(cmd.target || '');
  let sources = cmd.sources;
  if (typeof sources === 'string') {
    // источники кодируются по отдельности (remote.ts), поэтому сначала декодируем каждый элемент —
    // иначе имя группы, содержащее «|», было бы разбито на несколько групп
    sources = sources.split('|').map(function (s: string): string {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    }).filter(Boolean);
  }
  if (!Array.isArray(sources)) sources = [];
  // перемещение каналов из скрытой под PIN группы требует авторизации — иначе пульт мог бы «слить» защищённую группу без PIN
  const srcBlocked = sources.some(function (k: string): boolean { return blockedGroups.has(blockKeyFromRemote(k)); });
  if (srcBlocked && !pinUnlocked) {
    if (!parentPin) return { ok: false, error: 'сначала задайте PIN' };
    if (!verifyPin(cmd.pin)) return { ok: false, error: 'неверный PIN' };
    pinUnlocked = true;
  }
  // нельзя перелить каналы в скрытую группу без PIN — это обошло бы защиту (каналы исчезли бы из меню)
  if (target && blockedGroups.has(blockKeyFromRemote(target)) && !pinUnlocked) {
    if (!verifyPin(cmd.pin)) return { ok: false, error: 'неверный PIN' };
    pinUnlocked = true;
  }
  const set: Record<string, number> = {};
  sources.forEach(function (s: string): void { set[s] = 1; });
  let moved = 0;
  state.channels.forEach(function (c: Channel): void {
    const k = c.group || '';
    if (set[k]) { c.group = (target === GROUP_NONE ? '' : target); c.groupLower = c.group.toLowerCase(); moved++; }
  });
  if (state.group && set[state.group === GROUP_NONE ? '' : state.group]) state.group = GROUP_ALL;
  buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus();
  persistChannels();
  const s = remoteState(); s.moved = moved; return s;
}
/**
 * Persists blocking for cmd.key, or unblocks it when cmd.on is false, 0, or "0".
 * Blocking requires a configured PIN. Unblocking while any keys are blocked and the player is locked
 * requires cmd.pin; successful verification unlocks groups. Failed requirements return an error result.
 * Refreshes visibility and returns remote state on success.
 */
function remoteBlockGroup(cmd: RemoteCommand): RemoteResponse {
  const key = String(cmd.key || '');
  const off = (cmd.on === false || cmd.on === '0' || cmd.on === 0);
  if (off) {
    // снятие блокировки с группы требует авторизации PIN, если под защитой уже есть скрытые группы
    if (hasBlockedGroups() && !pinUnlocked) {
      if (!verifyPin(cmd.pin)) return { ok: false, error: 'неверный PIN' };
      pinUnlocked = true;
    }
    blockedGroups['delete'](key);
  } else {
    // блокировка без заданного PIN бессмысленна — сначала требуется установить PIN
    if (!parentPin) return { ok: false, error: 'сначала задайте PIN' };
    blockedGroups.add(key);
  }
  saveBlocked();
  if (state.group && blockedGroups.has(state.group) && !pinUnlocked) state.group = GROUP_ALL;
  buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus();
  return remoteState();
}
window.RemoteAPI = {
  /**
   * Dispatches a native server command, defaulting to state; channel indices refer to the filtered view.
   * Returns state, command data, or an acknowledgment. Unknown commands and synchronous exceptions become
   * { ok: false, error } results. Asynchronous loads, saves, and resets may still be pending after acknowledgment;
   * lastNote reports later save/reset messages.
   * loadUrl requires a trimmed HTTP(S) prefix; openFile requires a nonempty name. Their acknowledgments
   * do not confirm loading succeeded; load failures are displayed in the player.
   * setPin keeps at most three digits from cmd.pin; an empty result removes the PIN only if no keys are blocked.
   * Changing an existing PIN while locked requires cmd.current. unlock requires a configured, valid cmd.pin.
   * PIN checks share the five-attempt, ten-second cooldown; validation failures return error results.
   */
  handle: function (cmd: RemoteCommand): RemoteState | RemoteResponse {
    try {
      cmd = cmd || {};
      const name = String(cmd.cmd || 'state');
      if (name === 'state') return remoteState();
      if (name === 'next') { zap(1); return remoteState(); }
      if (name === 'prev') { zap(-1); return remoteState(); }
      if (name === 'select') {
        const i = parseInt(String(cmd.i), 10);
        if (isFinite(i) && state.view[i]) { playChannel(state.view[i]); return remoteState(); }
        return { ok: false, error: 'нет канала с таким индексом' };
      }
      if (name === 'open') {
        const oi = parseInt(String(cmd.i), 10);
        if (isFinite(oi) && state.view[oi]) { playChannel(state.view[oi]); enterPlayer(); return remoteState(); }
        return { ok: false, error: 'нет канала с таким индексом' };
      }
      if (name === 'fullscreen') { if (state.current) enterPlayer(); return remoteState(); }
      if (name === 'fav') {
        const fc = state.channels.filter(function (x: Channel): boolean { return x.url === cmd.url; })[0];
        if (fc) toggleFav(fc);
        return remoteState();
      }
      if (name === 'search') { searchInput.value = cmd.q || ''; applyFilter(); return remoteState(); }
      if (name === 'group') { setGroup(cmd.key || GROUP_ALL); return remoteState(); }
      if (name === 'loadUrl') {
        const lu = String(cmd.url || '').trim();
        // строгая проверка: парсим как URL и принимаем только http/https (regex пропускал «httpx://…»)
        let parsedLu: URL;
        try { parsedLu = new URL(lu); } catch (e) { return { ok: false, error: 'некорректная ссылка' }; }
        if (parsedLu.protocol !== 'http:' && parsedLu.protocol !== 'https:') return { ok: false, error: 'ссылка должна начинаться с http:// или https://' };
        urlInput.value = parsedLu.href; lsSet(LS_URL, parsedLu.href); loadFromUrl();
        return { ok: true, note: 'гружу плейлист по ссылке' };
      }
      if (name === 'export') { return { ok: true, m3u: buildM3uText(), count: state.channels.length }; }
      if (name === 'openFile') {
        if (!cmd.name) return { ok: false, error: 'не указано имя файла' };
        openDownloadFile(cmd.name);
        return { ok: true, note: 'открываю файл ' + cmd.name };
      }
      if (name === 'rename') { const r1 = remoteRename(cmd); persistChannels(); return r1; }
      if (name === 'delChannel') { const r2 = remoteDelChannel(cmd); persistChannels(); return r2; }
      if (name === 'delGroup') { const r3 = remoteDelGroup(cmd); persistChannels(); return r3; }
      if (name === 'mergeGroups') return remoteMergeGroups(cmd);
      if (name === 'blockGroup') return remoteBlockGroup(cmd);
      if (name === 'setPin') {
        const newPin = String(cmd.pin || '').replace(/[^0-9]/g, '').slice(0, 3);
        // смена/снятие существующего PIN требует авторизации: pinUnlocked или текущий PIN в cmd.current
        if (parentPin && !pinUnlocked) {
          const cur = String(cmd.current != null ? cmd.current : '');
          if (!verifyPin(cur)) return { ok: false, error: 'требуется текущий PIN' };
        }
        // снятие PIN невозможно, если под защитой остались заблокированные группы — иначе они перестанут скрываться
        if (!newPin && hasBlockedGroups()) return { ok: false, error: 'сначала разблокируйте все скрытые группы' };
        parentPin = newPin; lsSet('iptv.pin', parentPin); pinFailCount = 0; pinBlockedUntil = 0;
        if (!parentPin) pinUnlocked = false;
        buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus();
        // возвращаем полный снимок состояния (группы, каналы), чтобы render() на пульте получил валидные данные
        return remoteState();
      }
      if (name === 'unlock') {
        if (!parentPin) return { ok: false, error: 'PIN не задан' };
        if (verifyPin(cmd.pin)) { pinUnlocked = true; buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus(); return remoteState(); }
        return { ok: false, error: 'неверный PIN' };
      }
      if (name === 'lock') { pinUnlocked = false; buildGroups(); computeView(); renderGroups(); renderGrid(false); renderPinStatus(); return remoteState(); }
      if (name === 'clearEdits') { if (state.entry) lsSet('iptv.edit.' + state.entry.id, ''); return { ok: true }; }
  if (name === 'lastNote') { return { ok: true, note: remoteNote }; }
  if (name === 'saveFile') {
    const se = state.entry, sn = native();
    if (!se || se.kind !== 'file' || !se.fileName) return { ok: false, error: 'Текущий плейлист не файл на устройстве. Для ссылки используйте «Скачать текущий».' };
    if (!sn || !sn.writeFile) return { ok: false, error: 'Запись файла недоступна' };
    remoteNote = '';
    sn.writeFile({ name: se.fileName, text: buildM3uText() })
      .then(function (): void { remoteNote = 'Сохранено в файл ' + se.fileName; showToast(tr('Сохранено в файл')); })
      .catch(function (er: unknown): void { remoteNote = 'Не удалось сохранить: ' + errMsg(er); showToast(tr('Не удалось сохранить файл')); });
    return { ok: true, note: 'Записываю в ' + se.fileName + '…' };
  }
  if (name === 'resetEdits') {
    const re = state.entry;
    if (!re) return { ok: false, error: 'Нет открытого плейлиста' };
    lsSet('iptv.edit.' + re.id, '');
    remoteNote = '';
    async function resetEdits(entry: PlaylistIdentity): Promise<void> {
      try {
        const ent = await libGet(entry.id), nn = native();
        if (ent && ent.kind === 'file' && ent.text && entry.fileName && nn && nn.writeFile) {
          await nn.writeFile({ name: entry.fileName, text: ent.text });
        }
      } catch (x) { /* файл не восстановлен, сбросим хотя бы кэш */ }
      await openEntry(entry.id, true);
      remoteNote = 'Правки сброшены, исходный плейлист восстановлен';
    }
    resetEdits(re);
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
    } catch (e) { return { ok: false, error: String((e && typeof e === 'object' && 'message' in e && e.message) || e) }; }
  }
};

/* ================= Старт ================= */
async function boot(): Promise<void> {
  applyStatic();
  buildSettingsLang();
  if (!hasLangChoice()) { openLangPick(); return; }
  const savedUrl = lsGet(LS_URL);
  if (savedUrl) urlInput.value = savedUrl;
  syncSettingsUi();
  renderGroups();
  setFocus(urlInput, false);
  window.setTimeout(renderQr, 2000);
  if (playerPlugin()) { document.documentElement.classList.add('native'); document.body.classList.add('native'); ensureNativeListener(playerPlugin()); }
  if (native()) {
    if (lsGet(LS_SRV) === '1') setServer(true); else refreshServerStatus();
  }
  let entry: PlaylistEntry | undefined | null = null, id = lsGet(LS_ENTRY);
  if (id) { try { entry = await libGet(id); } catch (e) { entry = null; } }
  if (entry) await openEntry(entry.id, true);
  else if (savedUrl) loadFromUrl();
}
boot();
