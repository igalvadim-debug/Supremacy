(function () {
  'use strict';
  var ALLOWED = /\.(m3u8?|xml|xml\.gz)$/i;
  var drop = document.getElementById('drop'), pick = document.getElementById('pick');
  var uploads = document.getElementById('uploads'), list = document.getElementById('list');
  var queue = [], busy = false;

  function fmtSize(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  }
  function fmtDate(ms) { return ms ? new Date(ms).toLocaleString('ru-RU') : ''; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function refresh() {
    fetch('/api/files', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
      list.textContent = '';
      if (!data.files.length) { list.appendChild(el('div', 'empty', 'Файлов пока нет')); return; }
      data.files.forEach(function (f) {
        var row = el('div', 'item');
        var name = el('div', 'name');
        var a = el('a', '', f.name);
        a.href = '/files/' + encodeURIComponent(f.name);
        name.appendChild(a);
        row.appendChild(name);
        row.appendChild(el('div', 'meta', fmtSize(f.size) + ' · ' + fmtDate(f.modified)));
        var del = el('button', '', 'Удалить');
        del.onclick = function () {
          if (!window.confirm('Удалить файл «' + f.name + '»?')) return;
          fetch('/api/files?name=' + encodeURIComponent(f.name), { method: 'DELETE' }).then(refresh);
        };
        row.appendChild(del);
        list.appendChild(row);
      });
    }).catch(function () {
      list.textContent = '';
      list.appendChild(el('div', 'empty err', 'Нет связи с устройством. Приложение должно быть открыто, сервер включён.'));
    });
  }

  function next() {
    if (busy || !queue.length) return;
    busy = true;
    var file = queue.shift();
    var row = el('div', 'item');
    var name = el('div', 'name', file.name);
    var bar = el('div', 'bar'), fill = el('b');
    bar.appendChild(fill);
    var state = el('div', 'meta', '0%');
    row.appendChild(name); row.appendChild(bar); row.appendChild(state);
    uploads.insertBefore(row, uploads.firstChild);

    function done(ok, msg) {
      state.textContent = msg;
      state.className = 'meta ' + (ok ? 'ok' : 'err');
      if (ok) fill.style.width = '100%';
      busy = false;
      refresh();
      next();
    }
    if (!ALLOWED.test(file.name)) { done(false, 'Допустимы .m3u, .m3u8, .xml, .xml.gz'); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      var p = Math.round(e.loaded / e.total * 100);
      fill.style.width = p + '%';
      state.textContent = p + '%';
    };
    xhr.onload = function () {
      var r = {};
      try { r = JSON.parse(xhr.responseText); } catch (e) { /* не JSON */ }
      if (xhr.status === 200 && r.ok) done(true, 'Готово · ' + fmtSize(r.size));
      else done(false, r.error || ('Ошибка ' + xhr.status));
    };
    xhr.onerror = function () { done(false, 'Обрыв связи'); };
    xhr.send(file);
  }
  function add(files) {
    for (var i = 0; i < files.length; i++) queue.push(files[i]);
    next();
  }

  pick.onchange = function () { add(pick.files); pick.value = ''; };
  ['dragenter', 'dragover'].forEach(function (n) {
    drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files); });

  refresh();
  setInterval(refresh, 5000);
})();
