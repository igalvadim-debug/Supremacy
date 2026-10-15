(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
/**
 * Sends an already URL-encoded query string to the remote endpoint without caching.
 * Returns a promise for parsed JSON; network and JSON errors reject, while HTTP status alone is not checked.
 */
function api(q) {
  return fetch('/api/remote?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); });
}
/** Encodes a group key for a query parameter, preserving the empty key for all channels. */
function groupKey(k) { return k === '' ? '' : encodeURIComponent(k); }
var lastTapUrl = '', lastTapAt = 0;
/** Renders the player snapshot and channel/group actions, or displays a connection error for a missing or unsuccessful response. */
function render(s) {
  if (!s || !s.ok) { $('err').textContent = 'Нет связи с плеером'; return; }
  $('err').textContent = '';
  $('now').textContent = s.current ? s.current.name : 'Канал не выбран';
  if (s.current && s.current.group) {
    var sm = document.createElement('small');
    sm.textContent = '  ·  ' + s.current.group;
    $('now').appendChild(sm);
  }
  var g = $('groups'); g.textContent = '';
  var all = document.createElement('div');
  all.className = 'chip' + (s.group === '' ? ' a' : '');
  all.textContent = 'Все (' + s.count + ')';
  all.onclick = function () { api('cmd=group&key=').then(render); };
  g.appendChild(all);
  var favc = document.createElement('div');
  favc.className = 'chip' + (s.group === s.favGroup ? ' a' : '');
  favc.textContent = '\u2605 Избранное (' + (s.favCount || 0) + ')';
  favc.onclick = function () { api('cmd=group&key=' + encodeURIComponent(s.favGroup || '')).then(render); };
  g.appendChild(favc);
  var lock = document.createElement('div');
  lock.className = 'chip' + (s.locked ? '' : ' a');
  lock.textContent = s.locked ? '\uD83D\uDD12' : '\uD83D\uDD13';
  lock.onclick = function () {
    if (!s.locked) { api('cmd=lock').then(render); return; }
    var p = prompt('PIN (3 цифры):'); if (p === null) return;
    api('cmd=unlock&pin=' + encodeURIComponent(p)).then(function (r) { if (!r || !r.ok) alert('Неверный PIN'); render(r); });
  };
  g.appendChild(lock);
  (s.groups || []).forEach(function (gr) {
    var c = document.createElement('div');
    c.className = 'chip' + (s.group === gr.key ? ' a' : '');
    c.textContent = gr.label + ' (' + gr.count + ')';
    c.onclick = function () { api('cmd=group&key=' + groupKey(gr.key)).then(render); };
    c.oncontextmenu = function (e) { e.preventDefault(); if (confirm('Удалить группу «' + gr.label + '» (' + gr.count + ')?')) api('cmd=delGroup&key=' + encodeURIComponent(gr.key)).then(render); return false; };
    g.appendChild(c);
  });
  renderGroupsList(s);
  var l = $('list'); l.textContent = '';
  if (!s.channels || !s.channels.length) {
    l.appendChild(el('div', 'status', 'Ничего не найдено'));
    return;
  }
  s.channels.forEach(function (ch) {
    var it = el('div', 'it' + (ch.playing ? ' on' : ''));
    it.appendChild(el('div', 'n', ch.name));
    var fv = el('button', 'mini fav' + (ch.fav ? ' on' : ''), ch.fav ? '\u2605' : '\u2606');
    fv.onclick = function (e) { e.stopPropagation(); api('cmd=fav&url=' + encodeURIComponent(ch.url)).then(render); };
    var ed = el('button', 'mini', '\u270E');
    ed.onclick = function (e) { e.stopPropagation(); var nn = prompt('Новое имя канала:', ch.name); if (nn) api('cmd=rename&url=' + encodeURIComponent(ch.url) + '&name=' + encodeURIComponent(nn)).then(render); };
    var dl = el('button', 'mini del', '\u2715');
    dl.onclick = function (e) { e.stopPropagation(); if (confirm('Удалить «' + ch.name + '»?')) api('cmd=delChannel&url=' + encodeURIComponent(ch.url)).then(render); };
    it.appendChild(fv); it.appendChild(ed); it.appendChild(dl);
    it.onclick = function () {                      // один тап — выбор, двойной — полный экран плеера
      var now = Date.now();
      if (lastTapUrl === ch.url && now - lastTapAt < 350) { lastTapUrl = ''; lastTapAt = 0; api('cmd=open&i=' + ch.i).then(render); return; }
      lastTapUrl = ch.url; lastTapAt = now;
      api('cmd=select&i=' + ch.i).then(render);
    };
    l.appendChild(it);
  });
}
function el(tag, cls, text) { var e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; }
/** Requests and renders the current player snapshot, displaying a connection error if the request or rendering fails. */
function poll() { api('cmd=state').then(render).catch(function () { $('err').textContent = 'Нет связи с плеером'; }); }
$('prev').onclick = function () { api('cmd=prev').then(render); };
$('next').onclick = function () { api('cmd=next').then(render); };
var t = null;
$('q').oninput = function () {
  clearTimeout(t);
  t = setTimeout(function () { api('cmd=search&q=' + encodeURIComponent($('q').value)).then(render); }, 250);
};
$('plload').onclick = function () {
  var u = $('plurl').value.trim();
  if (!u) return;
  $('plmsg').textContent = 'Загрузка…';
  api('cmd=loadUrl&url=' + encodeURIComponent(u)).then(function () { $('plmsg').textContent = 'Плейлист загружается…'; setTimeout(poll, 3000); });
};
$('epgload').onclick = function () {
  var u = $('epgurl').value.trim();
  api('cmd=setEpg&url=' + encodeURIComponent(u)).then(function (s) { $('plmsg').textContent = (s && s.note) || 'EPG'; });
};
$('pldl').onclick = function () {
  api('cmd=export').then(function (s) {
    if (!s || !s.m3u) return;
    var blob = new Blob([s.m3u], { type: 'audio/x-mpegurl' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playlist.m3u';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    $('plmsg').textContent = 'Скачано: ' + (s.count || 0) + ' каналов';
  });
};
/** Fetches the latest asynchronous save/reset message after 1.8 seconds; request rejections are not caught. */
function showNoteLater() { setTimeout(function () { api('cmd=lastNote').then(function (s) { if (s && s.note) $('plmsg').textContent = s.note; }); }, 1800); }
$('plsave').onclick = function () {
  $('plmsg').textContent = 'Сохраняю…';
  api('cmd=saveFile').then(function (s) {
    if (s && s.ok) { $('plmsg').textContent = s.note || 'Сохраняю…'; showNoteLater(); }
    else { $('plmsg').textContent = 'Ошибка: ' + ((s && s.error) || 'не удалось'); }
  }).catch(function () { $('plmsg').textContent = 'Нет связи с плеером'; });
};
$('plreset').onclick = function () {
  if (!confirm('Сбросить все правки и вернуть исходный плейлист?')) return;
  $('plmsg').textContent = 'Сбрасываю…';
  api('cmd=resetEdits').then(function (s) {
    if (s && s.ok) { $('plmsg').textContent = s.note || 'Сбрасываю…'; showNoteLater(); setTimeout(poll, 3000); }
    else { $('plmsg').textContent = 'Ошибка: ' + ((s && s.error) || 'не удалось'); }
  }).catch(function () { $('plmsg').textContent = 'Нет связи с плеером'; });
};  $('plup').onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  $('plmsg').textContent = 'Загрузка файла…';
  fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.ok) {
        $('plmsg').textContent = 'Файл загружен, открываю…';
        api('cmd=openFile&name=' + encodeURIComponent(f.name)).then(function () { setTimeout(poll, 3000); });
      } else { $('plmsg').textContent = 'Ошибка: ' + ((res && res.error) || 'upload'); }
    })
    .catch(function () { $('plmsg').textContent = 'Ошибка загрузки файла'; });
};

/** Rebuilds group merge/block/delete controls from the snapshot, attempting to restore a nonempty previous merge target. */
function renderGroupsList(s) {
  var box = $('glist');
  if (!box) return;
  box.textContent = '';
  var sel = $('mtarget');
  var prev = sel.value;
  sel.textContent = '';
  (s.groups || []).forEach(function (gr) {
    var row = el('div', 'it');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'mchk'; cb._key = gr.key;
    row.appendChild(cb);
    row.appendChild(el('div', 'n', gr.label));
    row.appendChild(el('div', 'g', String(gr.count)));
    var isB = (s.blocked || []).indexOf(gr.key) !== -1;
    var bl = el('button', 'mini', isB ? '\uD83D\uDD12' : '\uD83D\uDD13');
    bl.onclick = function () { api('cmd=blockGroup&key=' + encodeURIComponent(gr.key) + '&on=' + (isB ? '0' : '1')).then(render); };
    var dl = el('button', 'mini del', '\u2715');
    dl.onclick = function () { if (confirm('Удалить группу «' + gr.label + '» (' + gr.count + ')?')) api('cmd=delGroup&key=' + encodeURIComponent(gr.key)).then(render); };
    row.appendChild(bl); row.appendChild(dl);
    box.appendChild(row);
    var opt = document.createElement('option'); opt.value = gr.key; opt.textContent = gr.label; sel.appendChild(opt);
  });
  if (prev) { try { sel.value = prev; } catch (e) { /* ignore */ } }
}
$('mmerge').onclick = function () {
  var target = $('mtarget').value;
  var srcs = Array.prototype.slice.call(document.querySelectorAll('#glist input.mchk:checked')).map(function (c) { return c._key; });
  if (!srcs.length) { $('gmsg').textContent = 'Отметьте группы для объединения'; return; }
  api('cmd=mergeGroups&target=' + encodeURIComponent(target) + '&sources=' + encodeURIComponent(srcs.join('|'))).then(function (s) { $('gmsg').textContent = 'Объединено каналов: ' + ((s && s.moved) || 0); render(s); });
};
$('pinset').onclick = function () {
  var p = $('pin').value.trim();
  api('cmd=setPin&pin=' + encodeURIComponent(p)).then(function (s) { $('gmsg').textContent = 'PIN ' + (s && s.pinSet ? 'задан' : 'снят'); });
};
$('pinunlock').onclick = function () {
  var p = $('pin').value.trim();
  api('cmd=unlock&pin=' + encodeURIComponent(p)).then(function (s) { $('gmsg').textContent = (s && s.ok) ? 'Заблокированные показаны' : 'Неверный PIN'; render(s); });
};

$('sync').onclick = function () {
  var b = $('sync'); b.textContent = '\u21BB Синхронизация…';
  api('cmd=state').then(function (s) {
    render(s);
    b.textContent = '\u2713 Синхронизировано';
    setTimeout(function () { b.textContent = '\u21BB Синхронизация с плеером'; }, 1200);
  }).catch(function () { $('err').textContent = 'Нет связи с плеером'; b.textContent = '\u21BB Синхронизация с плеером'; });
};

poll();
setInterval(poll, 15000);
})();
