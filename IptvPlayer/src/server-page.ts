import type { FilesResponse, UploadResponse, ServerFile } from './models';
import qrcode from 'qrcode-generator';
// Strikte Typisierung: siehe ../MIGRATION.md.
import { requiredElement } from './dom';
import { tr, trLoose, locale, setLang, applyStatic, buildLangButtons, syncLangFromDevice } from './i18n';
const ALLOWED = /\.(m3u8?|xml|xml\.gz)$/i;
const drop = requiredElement('drop'), pick = requiredElement<HTMLInputElement>('pick');
const uploads = requiredElement('uploads'), list = requiredElement('list');
let queue: File[] = [], busy: boolean = false;
/* Типизированный доступ к элементам форм (файлы/значение читаются после проверки тега). */
function val(id: string): string { const e = document.getElementById(id); return (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) ? e.value : ''; }
function filesOf(e: HTMLElement | null): FileList | null { return (e && e instanceof HTMLInputElement && e.files) ? e.files : null; }
/* Сообщение о состоянии под списком файлов (создаётся при первом использовании). */
function listMessage(text: string, isErr: boolean): void {
  let msg = document.getElementById('listmsg');
  if (!msg) {
    msg = el('div', 'empty' + (isErr ? ' err' : ''));
    msg.id = 'listmsg';
    list.appendChild(msg);
  }
  msg.textContent = text;
  msg.className = 'empty' + (isErr ? ' err' : '');
}

/** Formats bytes with Russian unit labels, using powers of 1,024 and one decimal above the byte range. */
function fmtSize(n: number | undefined): string {
  const size = Number(n);
  if (size < 1024) return n + ' ' + tr('Б');
  if (size < 1048576) return (size / 1024).toFixed(1) + ' ' + tr('КБ');
  return (size / 1048576).toFixed(1) + ' ' + tr('МБ');
}
/** Formats a Unix timestamp in milliseconds as a Russian local date/time, returning an empty string for a falsy timestamp. */
function fmtDate(ms: number): string { return ms ? new Date(ms).toLocaleString(locale()) : ''; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Fetches and renders native files with download/delete actions; request, JSON, or rendering errors become a connection message. */
function refresh(): void {
  fetch('/api/files', { cache: 'no-store' }).then(function (r: Response): Promise<FilesResponse> { return r.json() as Promise<FilesResponse>; }).then(function (data: FilesResponse): void {
    list.textContent = '';
    if (!data.files.length) { list.appendChild(el('div', 'empty', tr('Файлов пока нет'))); return; }
    data.files.forEach(function (f: ServerFile): void {
      const row = el('div', 'item');
      const name = el('div', 'name');
      const a = el('a', '', f.name);
      a.href = '/files/' + encodeURIComponent(f.name);
      name.appendChild(a);
      row.appendChild(name);
      row.appendChild(el('div', 'meta', fmtSize(f.size) + ' · ' + fmtDate(f.modified)));
      const del = el('button', '', tr('Удалить'));
      del.onclick = function (): void {
        if (!window.confirm(tr('Удалить файл «{0}»?', f.name))) return;
        // обновляем список только после успешного удаления; ошибку — показываем явно
        fetch('/api/files?name=' + encodeURIComponent(f.name), { method: 'DELETE' })
          .then(function (response: Response): void {
            if (!response.ok) {
              listMessage(tr('Не удалось удалить «{0}»: HTTP {1}', f.name, response.status), true);
              return;
            }
            refresh();
          })
          .catch(function (): void { listMessage(tr('Не удалось удалить «{0}»: нет связи с устройством', f.name), true); });
      };
      row.appendChild(del);
      list.appendChild(row);
    });
  }).catch(function (): void {
    list.textContent = '';
    list.appendChild(el('div', 'empty err', tr('Нет связи с устройством. Приложение должно быть открыто, сервер включён.')));
  });
}

/**
 * Starts the next queued upload unless one is active or the queue is empty.
 * Accepts .m3u, .m3u8, .xml, and .xml.gz names, case-insensitively. Rejected filenames, HTTP/API failures,
 * and network errors update the upload row and advance the queue; success requires HTTP 200 and a truthy ok.
 */
function next(): void {
  if (busy || !queue.length) return;
  busy = true;
  // The nonempty queue was checked above; no callback runs before shift.
  const file = queue.shift()!;
  const row = el('div', 'item');
  const name = el('div', 'name', file.name);
  const bar = el('div', 'bar'), fill = el('b');
  bar.appendChild(fill);
  const state = el('div', 'meta', '0%');
  row.appendChild(name); row.appendChild(bar); row.appendChild(state);
  uploads.insertBefore(row, uploads.firstChild);

  function done(ok: boolean, msg: string): void {
    state.textContent = msg;
    state.className = 'meta ' + (ok ? 'ok' : 'err');
    if (ok) fill.style.width = '100%';
    busy = false;
    refresh();
    next();
  }
  if (!ALLOWED.test(file.name)) { done(false, tr('Допустимы .m3u, .m3u8, .xml, .xml.gz')); return; }
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
  xhr.upload.onprogress = function (e: ProgressEvent<EventTarget>): void {
    if (!e.lengthComputable) return;
    const p = Math.round(e.loaded / e.total * 100);
    fill.style.width = p + '%';
    state.textContent = p + '%';
  };
  xhr.onload = function (): void {
    let r: UploadResponse = {};
    try { r = JSON.parse(xhr.responseText) as UploadResponse; } catch (e) { /* не JSON */ }
    if (xhr.status === 200 && r.ok) done(true, tr('Готово · {0}', fmtSize(r.size)));
    else done(false, r.error ? trLoose(r.error) : tr('Ошибка {0}', xhr.status));
  };
  xhr.onerror = function (): void { done(false, tr('Обрыв связи')); };
  xhr.timeout = 60000; // конечный таймаут: зависший ответ не блокирует очередь
  xhr.ontimeout = function (): void { done(false, tr('Таймаут загрузки')); };
  xhr.send(file);
}
/** Appends selected files to the upload queue and starts processing if idle. */
function add(files: FileList): void {
  for (let i = 0; i < files.length; i++) queue.push(files[i]);
  next();
}

// #pick is a static input[type=file], whose files list is non-null.
pick.onchange = function (): void { add(pick.files!); pick.value = ''; };
['dragenter', 'dragover'].forEach(function (n: string): void {
  drop.addEventListener(n, function (e: Event): void { e.preventDefault(); drop.classList.add('over'); });
});
['dragleave', 'drop'].forEach(function (n: string): void {
  drop.addEventListener(n, function (e: Event): void { e.preventDefault(); drop.classList.remove('over'); });
});
drop.addEventListener('drop', function (e: DragEvent): void { if (e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files); });

refresh();
/** QR-коды страницы загрузки и пульта по адресу, с которого открыта эта страница; при сбое остаётся ссылка текстом. */
function renderQrCards(): void {
  const base = window.location.origin;
  const items: Array<[string, string]> = [['qrUpload', base + '/'], ['qrRemote', base + '/remote']];
  items.forEach(function (it: [string, string]): void {
    const box = document.getElementById(it[0]);
    if (!box) return;
    box.textContent = '';
    try {
      const q = qrcode(0, 'M');
      q.addData(it[1]);
      q.make();
      box.innerHTML = q.createSvgTag(4, 8);
    } catch (e) { /* покажем только ссылку */ }
    box.appendChild(el('div', 'url', it[1]));
  });
}
renderQrCards();
setInterval(refresh, 5000);

/* ---- Язык: тексты страницы и флаги (по умолчанию язык, выбранный на ТВ) ---- */
import type { Lang } from './i18n';
applyStatic();
buildLangButtons(requiredElement('langBtns'), function (l: Lang): void { setLang(l, true); window.location.reload(); });
syncLangFromDevice();

