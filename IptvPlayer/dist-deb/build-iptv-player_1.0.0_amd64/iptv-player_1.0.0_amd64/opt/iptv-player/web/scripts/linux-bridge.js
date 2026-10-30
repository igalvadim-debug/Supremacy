// Linux-Brücke: stellt window.Capacitor bereit, damit der Web-Client
// (src/index.ts) im Desktop-Browser dieselben Schnittstellen vorfindet wie in
// der Android-App. Alle Methoden sprechen den lokalen HTTP-Server
// (scripts/iptv-server.mjs) über /native/* an; Fehler werden als rejected
// Promise weitergereicht und laufen damit in die vorhandene UI-Fehlerbehandlung.
(function () {
  var listeners = {};
  var pollTimer = null;

  // Все запросы идут на локальный сервер, который отдал эту страницу.
  // window.IPTV_BRIDGE.serverBase задаётся injectBridge() в iptv-server.mjs;
  // при ручном открытии dist/index.html без сервера считаем базой саму страницу.
  function base() {
    var b = window.IPTV_BRIDGE && window.IPTV_BRIDGE.serverBase;
    if (!b) { try { b = new URL('.', window.location.href).href; } catch (e) { b = '/'; } }
    return b;
  }
  function url(p) { return base() + p; }

  function json(u, opts) {
    return fetch(u, opts).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error(t || ('HTTP ' + r.status));
        });
      }
      return r.json();
    });
  }

  function fire(ev, data) {
    (listeners[ev] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { /* ignore */ }
    });
  }

  // Remote-Pulse: команды пульта (/api/remote) буферизуются сервером; страница плеера
  // забирает их этим поллингом, выполняет через window.RemoteAPI.handle() и отвечает
  // через POST /native/result. Пауза опроса — когда команда уже выполняется
  // (сериализация, как в Android-версии, где вызовы шли в UI-поток последовательно).
  var pulseTimer = null;
  var pulseBusy = false;

  function runRemoteCommand(cmd) {
    var api = window.RemoteAPI;
    if (!api || typeof api.handle !== 'function') {
      return Promise.resolve({ ok: false, error: 'нет RemoteAPI на странице' });
    }
    try {
      return Promise.resolve(api.handle(cmd)).then(function (r) {
        return r && typeof r === 'object' ? r : { ok: true };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function pulsePoll() {
    if (pulseBusy) return;
    json(url('/native/pulse?limit=5'))
      .then(function (data) {
        var commands = (data && data.commands) || [];
        if (!commands.length) return;
        pulseBusy = true;
        var chain = Promise.resolve();
        var results = [];
        commands.forEach(function (c) {
          chain = chain.then(function () {
            return runRemoteCommand(c.cmd).then(function (result) {
              results.push({ id: c.id, result: result });
            });
          });
        });
        chain.then(function () {
          pulseBusy = false;
          return json(url('/native/result'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(results)
          });
        }).catch(function () { pulseBusy = false; });
      })
      .catch(function () { /* сервер недоступен — следующая попытка на следующем тике */ });
  }

  function startPulsePolling() {
    if (pulseTimer) return;
    pulseTimer = setInterval(pulsePoll, 700);
  }

  // Player-Zustand wird vom Server gepollt; gleiche Eventform wie NativePlayerEvent.
  function startPolling() {
    if (pollTimer) return;
    var last = '';
    pollTimer = setInterval(function () {
      json(url('/native/player/state'))
        .then(function (s) {
          var key = JSON.stringify(s);
          if (key === last) return;
          last = key;
          fire('state', { state: s.state, message: s.message || '', status: s.status || 0 });
        })
        .catch(function () { /* Server nicht erreichbar — Zustand bleibt unverändert */ });
    }, 1000);
  }

  var IptvNative = {
    readFile: function (o) { return json(url('/native/files/') + encodeURIComponent(o.name)); },
    listFiles: function () { return json(url('/native/files')); },
    deleteFile: function (o) {
      return json(url('/native/files/') + encodeURIComponent(o.name), { method: 'DELETE' });
    },
    writeFile: function (o) {
      return json(url('/native/files/') + encodeURIComponent(o.name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: o.text })
      });
    },
    serverStatus: function () { return json(url('/native/server/status')); },
    serverStart: function (o) {
      return json(url('/native/server/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: o.port })
      });
    },
    serverStop: function () { return json(url('/native/server/stop'), { method: 'POST' }); },
    epgLoad: function (o) {
      return json(url('/native/epg/load'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o)
      });
    },
    epgLookup: function (o) { return json(url('/native/epg/lookup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); },
    epgSchedule: function (o) { return json(url('/native/epg/schedule?') + new URLSearchParams(o), undefined); },
    getAutoStart: function () { return json(url('/native/autostart')); },
    setAutoStart: function (o) {
      return json(url('/native/autostart'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !!o.on })
      });
    },
    clearCache: function () { return json(url('/native/cache/clear'), { method: 'POST' }); }
  };

  var IptvPlayer = {
    addListener: function (ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      startPolling();
      return Promise.resolve({ remove: function () {
        listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; });
      } });
    },
    removeAllListeners: function () { listeners = {}; return Promise.resolve(); },
    play: function (o) {
      return json(url('/native/player/play'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o)
      });
    },
    stop: function () { return json(url('/native/player/stop'), { method: 'POST' }); },
    pause: function () { return json(url('/native/player/pause'), { method: 'POST' }); },
    resume: function () { return json(url('/native/player/resume'), { method: 'POST' }); },
    // Reines Video wird im Browser-<video> abgespielt; ein natives Overlay gibt es nicht.
    setBounds: function () { return Promise.resolve(); },
    setVisible: function () { return Promise.resolve(); }
  };

  var Capacitor = {
    isNativePlatform: function () { return false; },
    getPlatform: function () { return 'linux'; },
    Plugins: {
      IptvNative: IptvNative,
      IptvPlayer: IptvPlayer,
      App: {
        addListener: function () { return Promise.resolve({ remove: function () {} }); },
        exitApp: function () { return Promise.resolve(); },
        getInfo: function () { return Promise.resolve({ name: 'IPTV Player', version: '1.0.0', platform: 'linux' }); }
      }
    },
    registerPlugin: function (name) { return Capacitor.Plugins[name]; }
  };

  window.Capacitor = Capacitor;
})();
