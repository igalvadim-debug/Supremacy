/* Мини-система переводов (RU / DE / EN).
 * Ключ — русский текст. Подстановки: {0}, {1} … Если перевода нет, показывается русский текст. */
import { DICT } from './i18n-dict';

export type Lang = 'ru' | 'de' | 'en';
export const LANGS: Lang[] = ['ru', 'de', 'en'];
const LS_LANG = 'iptv.lang', LS_MANUAL = 'iptv.lang.manual';

function lsGet(key: string): string { try { return window.localStorage.getItem(key) || ''; } catch (e) { return ''; } }
function lsSet(key: string, value: string): void { try { window.localStorage.setItem(key, value); } catch (e) { /* хранилище недоступно */ } }
function isLang(v: string): v is Lang { return v === 'ru' || v === 'de' || v === 'en'; }
/** Язык по умолчанию — язык системы/браузера, иначе русский. */
function guess(): Lang {
  const n = (navigator.language || '').toLowerCase();
  return n.indexOf('de') === 0 ? 'de' : n.indexOf('en') === 0 ? 'en' : 'ru';
}
const stored = lsGet(LS_LANG);
let current: Lang = isLang(stored) ? stored : guess();

/** true, если язык уже выбран (при первом запуске — false, тогда показывается выбор языка). */
export function hasLangChoice(): boolean { return isLang(lsGet(LS_LANG)); }
export function getLang(): Lang { return current; }
/** Сохраняет язык; manual=true — выбор сделал пользователь (автосинхронизация с ТВ его не меняет). */
export function setLang(l: Lang, manual: boolean): void {
  lsSet(LS_LANG, l);
  if (manual) lsSet(LS_MANUAL, '1');
  current = l;
}
export function isManualLang(): boolean { return lsGet(LS_MANUAL) === '1'; }
/** Локаль для дат и времени. */
export function locale(): string { return current === 'de' ? 'de-DE' : current === 'en' ? 'en-GB' : 'ru-RU'; }

function fmt(s: string, args: Array<string | number>): string {
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, function (m: string, i: string): string {
    const n = Number(i);
    return n < args.length ? String(args[n]) : m;
  });
}
/** Перевод на заданный язык (нужен, чтобы показать ошибку сразу на трёх языках). */
export function trIn(l: Lang, key: string, ...args: Array<string | number>): string {
  let s = key;
  if (l !== 'ru') {
    const e = DICT[key];
    if (e) { const v = e[l === 'de' ? 0 : 1]; if (v) s = v; }
  }
  return fmt(s, args);
}
/** Перевод на текущий язык интерфейса. */
export function tr(key: string, ...args: Array<string | number>): string { return trIn(current, key, ...args); }

let patterns: Array<{ re: RegExp; key: string }> | null = null;
/** Переводит уже готовую русскую строку (например, ответ ТВ или нативной части), в том числе с подставленными значениями. */
export function trLoose(s: string): string {
  if (current === 'ru' || !s) return s;
  if (DICT[s]) return tr(s);
  if (!patterns) {
    patterns = [];
    Object.keys(DICT).forEach(function (k: string): void {
      if (k.indexOf('{') < 0) return;
      const src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d+\}/g, '(.+?)');
      patterns!.push({ re: new RegExp('^' + src + '$'), key: k });
    });
  }
  for (let i = 0; i < patterns.length; i++) {
    const m = patterns[i].re.exec(s);
    if (m) return trIn(current, patterns[i].key, ...m.slice(1));
  }
  return s;
}

/* ---------- Ошибки потока: текст на трёх языках ---------- */
export type StreamErrKind = 'network' | 'timeout' | 'notfound' | 'denied' | 'server' | 'cleartext' | 'format' | 'decoder' | 'audio' | 'generic';
export const ERR_KEYS: Record<StreamErrKind, string> = {
  network: 'Нет связи с каналом',
  timeout: 'Канал не отвечает',
  notfound: 'Канал не найден на сервере',
  denied: 'Доступ запрещён: проверьте подписку или лимит подключений',
  server: 'Сервер канала сейчас не работает',
  cleartext: 'Незащищённое соединение запрещено',
  format: 'Поток повреждён или формат не поддерживается',
  decoder: 'Устройство не может показать это видео',
  audio: 'Проблема со звуком',
  generic: 'Ошибка воспроизведения'
};
export const RETRY_KEY = 'Повтор через {0} с… ({1}/{2})';

/* ---------- Статичные тексты страницы ---------- */
const origs = new WeakMap<Element, Record<string, string>>();
function remember(el: Element, slot: string, cur: string): string {
  let o = origs.get(el);
  if (!o) { o = {}; origs.set(el, o); }
  if (o[slot] === undefined) o[slot] = cur;
  return o[slot];
}
/** Переводит элементы с data-i18n (текст) и data-i18n-ph / -title / -aria (placeholder, title, aria-label). */
export function applyStatic(): void {
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach(function (e: Element): void {
    const k = remember(e, 't', (e.textContent || '').trim());
    e.textContent = tr(k);
  });
  const attrs: Array<[string, string]> = [['data-i18n-ph', 'placeholder'], ['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label']];
  attrs.forEach(function (a: [string, string]): void {
    document.querySelectorAll('[' + a[0] + ']').forEach(function (e: Element): void {
      const k = remember(e, a[1], e.getAttribute(a[1]) || '');
      e.setAttribute(a[1], tr(k));
    });
  });
  document.title = tr(remember(document.documentElement, 'title', document.title));
}

/* ---------- Флаги и кнопки выбора языка ---------- */
const FLAGS: Record<Lang, string> = {
  ru: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039a6"/><rect y="13.33" width="30" height="6.67" fill="#d52b1e"/></svg>',
  de: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/><rect y="13.33" width="30" height="6.67" fill="#ffce00"/></svg>',
  en: '<svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" fill="#012169"/><path d="M0,0 60,40M60,0 0,40" stroke="#fff" stroke-width="8"/><path d="M0,0 60,40M60,0 0,40" stroke="#c8102e" stroke-width="3"/><path d="M30,0v40M0,20h60" stroke="#fff" stroke-width="13"/><path d="M30,0v40M0,20h60" stroke="#c8102e" stroke-width="8"/></svg>'
};
const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', de: 'Deutsch', en: 'English' };

/** Рисует кнопки с флагами; текущий язык подсвечен. Кнопки доступны с пульта (data-nav). */
export function buildLangButtons(box: HTMLElement, onPick: (l: Lang) => void): HTMLButtonElement[] {
  box.textContent = '';
  return LANGS.map(function (l: Lang): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'flagbtn btn-slate' + (l === current ? ' on' : '');
    b.setAttribute('data-nav', '1');
    b.setAttribute('aria-label', LANG_NAMES[l]);
    const f = document.createElement('span');
    f.className = 'flag';
    f.innerHTML = FLAGS[l];
    const n = document.createElement('span');
    n.textContent = LANG_NAMES[l];
    b.appendChild(f);
    b.appendChild(n);
    b.onclick = function (): void { onPick(l); };
    box.appendChild(b);
    return b;
  });
}

/** Для страниц в браузере: берёт язык, выбранный на ТВ, если пользователь не выбирал язык здесь вручную. */
export function syncLangFromDevice(): void {
  if (isManualLang()) return;
  fetch('/api/remote?cmd=state', { cache: 'no-store' })
    .then(function (r: Response): Promise<{ lang?: string }> { return r.json() as Promise<{ lang?: string }>; })
    .then(function (s: { lang?: string }): void {
      const l = s && typeof s.lang === 'string' ? s.lang : '';
      if (isLang(l) && l !== current) {
        setLang(l, false);
        if (lsGet(LS_LANG) === l) window.location.reload();
      }
    })
    .catch(function (): void { /* нет связи — остаётся язык браузера */ });
}
