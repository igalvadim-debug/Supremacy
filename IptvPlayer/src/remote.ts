import type { RemoteResponse, UploadResponse, Group, RemoteChannel } from './models';
// Strikte Typisierung: siehe ../MIGRATION.md.
import { requiredElement } from './dom';
import { tr, trLoose, setLang, applyStatic, buildLangButtons, syncLangFromDevice } from './i18n';
function $(id: string): HTMLElement { return requiredElement(id); }
/* Типизированный доступ к элементам форм: значения/файлы читаются только после проверки тега. */
function val(id: string): string { const e = $(id); return (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) ? e.value : ''; }
function fileAt(id: string, i: number): File | null { const e = $(id); return (e instanceof HTMLInputElement && e.files) ? e.files.item(i) : null; }
function api(q: string): Promise<RemoteResponse> {
  return fetch('/api/remote?' + q, { cache: 'no-store' }).then(function (r: Response): Promise<RemoteResponse> { return r.json() as Promise<RemoteResponse>; });
}
/** Encodes a group key for a query parameter, preserving the empty key for all channels. */
function groupKey(k: string): string { return k === '' ? '' : encodeURIComponent(k); }
let lastTapUrl: string = '', lastTapAt: number = 0;
/** Renders the player snapshot and channel/group actions, or displays a connection error for a missing or unsuccessful response. */
function render(s: RemoteResponse | null): void {
  if (!s || !s.ok) { $('err').textContent = tr('Нет связи с плеером'); return; }
  $('err').textContent = '';
  $('now').textContent = s.current ? s.current.name : tr('Канал не выбран');
  if (s.current && s.current.group) {
    const sm = document.createElement('small');
    sm.textContent = '  ·  ' + s.current.group;
    $('now').appendChild(sm);
  }
  const g = $('groups'); g.textContent = '';
  const all = el('button', 'chip' + (s.group === '' ? ' a' : ''), tr('Все ({0})', s.count));
  all.type = 'button';
  all.onclick = function (): void { api('cmd=group&key=').then(render); };
  g.appendChild(all);
  const favc = el('button', 'chip' + (s.group === s.favGroup ? ' a' : ''), tr('\u2605 Избранное ({0})', s.favCount || 0));
  favc.type = 'button';
  favc.onclick = function (): void { api('cmd=group&key=' + encodeURIComponent(s.favGroup || '')).then(render); };
  g.appendChild(favc);
  const lock = el('button', 'chip' + (s.locked ? '' : ' a'), s.locked ? '\uD83D\uDD12' : '\uD83D\uDD13');
  lock.type = 'button';
  lock.title = s.locked ? tr('Разблокировать скрытые группы') : tr('Скрыть разблокированные группы');
  lock.onclick = function (): void {
    if (!s.locked) { api('cmd=lock').then(render); return; }
    const p = prompt(tr('PIN (3 цифры):')); if (p === null) return;
    api('cmd=unlock&pin=' + encodeURIComponent(p)).then(function (r: RemoteResponse): void { if (!r || !r.ok) alert(tr('Неверный PIN')); render(r); });
  };
  g.appendChild(lock);
  (s.groups || []).forEach(function (gr: Group): void {
    const c = el('button', 'chip' + (s.group === gr.key ? ' a' : ''), gr.label + ' (' + gr.count + ')');
    c.type = 'button';
    // выбор группы доступно с клавиатуры: aria-pressed отражает активный чип
    c.setAttribute('aria-pressed', s.group === gr.key ? 'true' : 'false');
    c.onclick = function (): void { api('cmd=group&key=' + groupKey(gr.key)).then(render); };
    c.oncontextmenu = function (e: MouseEvent): boolean { e.preventDefault(); if (confirm(tr('Удалить группу «{0}» ({1})?', gr.label, gr.count))) api('cmd=delGroup&key=' + encodeURIComponent(gr.key)).then(render); return false; };
    g.appendChild(c);
  });
  renderGroupsList(s);
  const l = $('list'); l.textContent = '';
  if (!s.channels || !s.channels.length) {
    l.appendChild(el('div', 'status', tr('Ничего не найдено')));
    return;
  }
  s.channels.forEach(function (ch: RemoteChannel): void {
    const it = el('div', 'it' + (ch.playing ? ' on' : ''));
    // клавиатурно-управляемый выбор канала (Enter/Space); кнопки действий внутри строки сохранены
    const selBtn = el('button', 'n selectbtn', ch.name);
    selBtn.type = 'button';
    selBtn.setAttribute('aria-pressed', ch.playing ? 'true' : 'false');
    selBtn.title = tr('Выбрать канал (Enter) · двойной тап — полный экран плеера');
    selBtn.onclick = function (e: MouseEvent): void {                     // один тап — выбор, двойной — полный экран плеера
      e.stopPropagation();
      const now = Date.now();
      if (lastTapUrl === ch.url && now - lastTapAt < 350) { lastTapUrl = ''; lastTapAt = 0; api('cmd=open&i=' + ch.i).then(render); return; }
      lastTapUrl = ch.url; lastTapAt = now;
      api('cmd=select&i=' + ch.i).then(render);
    };
    it.appendChild(selBtn);
    const fv = el('button', 'mini fav' + (ch.fav ? ' on' : ''), ch.fav ? '\u2605' : '\u2606');
    fv.onclick = function (e: MouseEvent): void { e.stopPropagation(); api('cmd=fav&url=' + encodeURIComponent(ch.url)).then(render); };
    const ed = el('button', 'mini', '\u270E');
    ed.onclick = function (e: MouseEvent): void { e.stopPropagation(); const nn = prompt(tr('Новое имя канала:'), ch.name); if (nn) api('cmd=rename&url=' + encodeURIComponent(ch.url) + '&name=' + encodeURIComponent(nn)).then(render); };
    const dl = el('button', 'mini del', '\u2715');
    dl.onclick = function (e: MouseEvent): void { e.stopPropagation(); if (confirm(tr('Удалить «{0}»?', ch.name))) api('cmd=delChannel&url=' + encodeURIComponent(ch.url)).then(render); };
    it.appendChild(fv); it.appendChild(ed); it.appendChild(dl);
    l.appendChild(it);
  });
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; }
/** Requests and renders the current player snapshot, displaying a connection error if the request or rendering fails. */
function poll(): void { api('cmd=state').then(render).catch(function (): void { $('err').textContent = tr('Нет связи с плеером'); }); }
$('prev').onclick = function (): void { api('cmd=prev').then(render); };
$('next').onclick = function (): void { api('cmd=next').then(render); };
let t: number | undefined;
$('q').oninput = function (): void {
  clearTimeout(t);
  t = window.setTimeout(function (): void { api('cmd=search&q=' + encodeURIComponent(val('q'))).then(render); }, 250);
};
$('plload').onclick = function (): void {
  const u = val('plurl').trim();
  if (!u) return;
  $('plmsg').textContent = tr('Загрузка…');
  api('cmd=loadUrl&url=' + encodeURIComponent(u)).then(function (): void { $('plmsg').textContent = tr('Плейлист загружается…'); setTimeout(poll, 3000); });
};
$('epgload').onclick = function (): void {
  const u = val('epgurl').trim();
  api('cmd=setEpg&url=' + encodeURIComponent(u)).then(function (s: RemoteResponse): void { $('plmsg').textContent = (s && s.note) || 'EPG'; });
};
$('pldl').onclick = function (): void {
  api('cmd=export').then(function (s: RemoteResponse): void {
    if (!s || !s.m3u) return;
    const blob = new Blob([s.m3u], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playlist.m3u';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    $('plmsg').textContent = tr('Скачано: {0} каналов', s.count || 0);
  });
};
/** Fetches the latest asynchronous save/reset message after 1.8 seconds; request rejections are not caught. */
function showNoteLater(): void { setTimeout(function (): void { api('cmd=lastNote').then(function (s: RemoteResponse): void { if (s && s.note) $('plmsg').textContent = s.note; }); }, 1800); }
$('plsave').onclick = function (): void {
  $('plmsg').textContent = tr('Сохраняю…');
  api('cmd=saveFile').then(function (s: RemoteResponse): void {
    if (s && s.ok) { $('plmsg').textContent = trLoose(s.note || tr('Сохраняю…')); showNoteLater(); }
    else { $('plmsg').textContent = tr('Ошибка: {0}', trLoose((s && s.error) || tr('не удалось'))); }
  }).catch(function (): void { $('plmsg').textContent = tr('Нет связи с плеером'); });
};
$('plreset').onclick = function (): void {
  if (!confirm(tr('Сбросить все правки и вернуть исходный плейлист?'))) return;
  $('plmsg').textContent = tr('Сбрасываю…');
  api('cmd=resetEdits').then(function (s: RemoteResponse): void {
    if (s && s.ok) { $('plmsg').textContent = trLoose(s.note || tr('Сбрасываю…')); showNoteLater(); setTimeout(poll, 3000); }
    else { $('plmsg').textContent = tr('Ошибка: {0}', trLoose((s && s.error) || tr('не удалось'))); }
  }).catch(function (): void { $('plmsg').textContent = tr('Нет связи с плеером'); });
};  $('plup').onchange = function (): void {
  const f = fileAt('plup', 0);
  if (!f) return;
  $('plmsg').textContent = tr('Загрузка файла…');
  fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
    .then(function (r: Response): Promise<UploadResponse> { return r.json() as Promise<UploadResponse>; })
    .then(function (res: UploadResponse): void {
      if (res && res.ok) {
        $('plmsg').textContent = tr('Файл загружен, открываю…');
        api('cmd=openFile&name=' + encodeURIComponent(f.name)).then(function (): void { setTimeout(poll, 3000); });
      } else { $('plmsg').textContent = tr('Ошибка: {0}', trLoose((res && res.error) || 'upload')); }
    })
    .catch(function (): void { $('plmsg').textContent = tr('Ошибка загрузки файла'); });
};

/* Связка чекбокса группы с её ключом — типизированная (WeakMap вместо custom-свойства _key). */
const chkKeys = new WeakMap<HTMLInputElement, string>();
function renderGroupsList(s: RemoteResponse): void {
  const box = document.getElementById('glist');
  if (!box) return;
  box.textContent = '';
  const sel = document.getElementById('mtarget');
  if (!(sel instanceof HTMLSelectElement)) return;
  const prev = sel.value;
  sel.textContent = '';
  (s.groups || []).forEach(function (gr: Group): void {
    const row = el('div', 'it');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'mchk'; chkKeys.set(cb, gr.key);
    row.appendChild(cb);
    row.appendChild(el('div', 'n', gr.label));
    row.appendChild(el('div', 'g', String(gr.count)));
    const isB = (s.blocked || []).indexOf(gr.key) !== -1;
    const bl = el('button', 'mini', isB ? '\uD83D\uDD12' : '\uD83D\uDD13');
    bl.onclick = function (): void { api('cmd=blockGroup&key=' + encodeURIComponent(gr.key) + '&on=' + (isB ? '0' : '1')).then(render); };
    const dl = el('button', 'mini del', '\u2715');
    dl.onclick = function (): void { if (confirm(tr('Удалить группу «{0}» ({1})?', gr.label, gr.count))) api('cmd=delGroup&key=' + encodeURIComponent(gr.key)).then(render); };
    row.appendChild(bl); row.appendChild(dl);
    box.appendChild(row);
    const opt = document.createElement('option'); opt.value = gr.key; opt.textContent = gr.label; sel.appendChild(opt);
  });
  if (prev) { try { sel.value = prev; } catch (e) { /* ignore */ } }
}
$('mmerge').onclick = function (): void {
  const target = val('mtarget');
  const srcs = Array.from(document.querySelectorAll<HTMLInputElement>('#glist input.mchk:checked')).map(function (c: HTMLInputElement): string | undefined { return chkKeys.get(c); }).filter(function (k: string | undefined): k is string { return k !== undefined; });
  if (!srcs.length) { $('gmsg').textContent = tr('Отметьте группы для объединения'); return; }
  api('cmd=mergeGroups&target=' + encodeURIComponent(target) + '&sources=' + encodeURIComponent(srcs.join('|'))).then(function (s: RemoteResponse): void { $('gmsg').textContent = tr('Объединено каналов: {0}', (s && s.moved) || 0); render(s); });
};
$('pinset').onclick = function (): void {
  const p = val('pin').trim();
  // смена/снятие существующего PIN требует подтверждения: сначала «Разблокировать», затем задать новый
  api('cmd=setPin&pin=' + encodeURIComponent(p)).then(function (s: RemoteResponse): void {
    if (s && s.ok === false) { $('gmsg').textContent = tr('Ошибка: {0}', trLoose(s.error || tr('сначала разблокируйте (введите текущий PIN)'))); return; }
    $('gmsg').textContent = 'PIN ' + (s && s.pinSet ? tr('задан') : tr('снят'));
  });
};
$('pinunlock').onclick = function (): void {
  const p = val('pin').trim();
  api('cmd=unlock&pin=' + encodeURIComponent(p)).then(function (s: RemoteResponse): void { $('gmsg').textContent = (s && s.ok) ? tr('Заблокированные показаны') : tr('Неверный PIN'); render(s); });
};

$('sync').onclick = function (): void {
  const b = $('sync'); b.textContent = tr('\u21BB Синхронизация…');
  api('cmd=state').then(function (s: RemoteResponse): void {
    render(s);
    b.textContent = tr('\u2713 Синхронизировано');
    setTimeout(function (): void { b.textContent = tr('\u21BB Синхронизация с плеером'); }, 1200);
  }).catch(function (): void { $('err').textContent = tr('Нет связи с плеером'); b.textContent = tr('\u21BB Синхронизация с плеером'); });
};

poll();
setInterval(poll, 15000);

/* ---- Язык: тексты страницы и флаги (по умолчанию язык, выбранный на ТВ) ---- */
import type { Lang } from './i18n';
applyStatic();
buildLangButtons($('langBtns'), function (l: Lang): void { setLang(l, true); window.location.reload(); });
syncLangFromDevice();

