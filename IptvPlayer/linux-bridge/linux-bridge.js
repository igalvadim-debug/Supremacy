// Linux-Brücke: stellt window.Capacitor bereit, damit der Web-Client
// (src/index.ts) im Desktop-Browser dieselben Schnittstellen vorfindet wie in
// der Android-App. Alle Methoden sprechen den lokalen HTTP-Server
// (scripts/iptv-server.mjs) über /native/* an; Fehler werden als rejected
// Promise weitergereicht und laufen damit in die vorhandene UI-Fehlerbehandlung.
(function () {
  var listeners = {};
  var pollTimer = null;

  function json(url, opts) {
    return fetch(url, opts).then(function (r) {
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

  // Player-Zustand wird vom Server gepollt; gleiche Eventform wie NativePlayerEvent.
  function startPolling() {
    if (pollTimer) return;
    var last = '';
    pollTimer = setInterval(function () {
      json('/native/player/state')
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
    readFile: function (o) { return json('/native/files/' + encodeURIComponent(o.name)); },
    listFiles: function () { return json('/native/files'); },
    deleteFile: function (o) {
      return json('/native/files/' + encodeURIComponent(o.name), { method: 'DELETE' });
    },
    writeFile: function (o) {
      return json('/native/files/' + encodeURIComponent(o.name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: o.text })
      });
    },
    serverStatus: function () { return json('/native/server/status'); },
    serverStart: function (o) {
      return json('/native/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: o.port })
      });
    },
    serverStop: function () { return json('/native/server/stop', { method: 'POST' }); },
    epgLoad: function (o) {
      return json('/native/epg/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o)
      });
    },
    epgLookup: function (o) { return json('/native/epg/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); },
    epgSchedule: function (o) { return json('/native/epg/schedule?' + new URLSearchParams(o), undefined); },
    getAutoStart: function () { return json('/native/autostart'); },
    setAutoStart: function (o) {
      return json('/native/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !!o.on })
      });
    },
    clearCache: function () { return json('/native/cache/clear', { method: 'POST' }); }
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
      return json('/native/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(o)
      });
    },
    stop: function () { return json('/native/player/stop', { method: 'POST' }); },
    pause: function () { return json('/native/player/pause', { method: 'POST' }); },
    resume: function () { return json('/native/player/resume', { method: 'POST' }); },
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
