#!/usr/bin/env node
// iptv-server.test.mjs — тесты Linux-сервера (node --test или запуск напрямую).
// Покрываются исправления с M93:
//   1) ffplay запускается без -nodisp, с -fs и DISPLAY=:0 (картинка на USB-дисплее);
//   2) режим auto при отсутствии mpv автоматически падает на ffplay;
//   3) статус ffplay переходит из «buffering» в «playing», пока процесс жив;
//   4) синтаксические ошибки (Java-литералы 400L, \p{Cntrl}) устранены — модуль загружается.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import * as mod from './iptv-server.mjs';

const { ExternalPlayer, MAX_UPLOAD_BYTES, MAX_READ_BYTES } = mod;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Мок ChildProcess: управляем exitCode/pid и эмитим события вручную. */
class FakeProc extends EventEmitter {
  constructor(bin) { super(); this.bin = bin; this.pid = 424242; this.exitCode = null; this.killed = false; }
  kill(sig) { if (sig === 'SIGTERM') { this.killed = true; } return true; }
  unref() {}
}

/** Мок spawn: пишет вызовы в лог; по коду ENOENT для заданного бина — «не установлен». */
function makeSpawn(missingBins = []) {
  const calls = [];
  const spawnImpl = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const proc = new FakeProc(bin);
    if (missingBins.includes(bin)) {
      setImmediate(() => {
        const err = new Error(bin + ' not found');
        err.code = 'ENOENT';
        proc.emit('error', err);
      });
    }
    return proc;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}

/* ---------- 4) синтаксис / константы ---------- */

test('модуль загружается, Java-литералы заменены числами JS', () => {
  assert.equal(MAX_UPLOAD_BYTES, 400 * 1024 * 1024);
  assert.equal(MAX_READ_BYTES, 30 * 1024 * 1024);
});

/* ---------- 1) аргументы ffplay: без -nodisp, с -fs и DISPLAY=:0 ---------- */

test('ffplay стартует без -nodisp, с -fs и DISPLAY=:0', async () => {
  const dir = tmpDir('iptv-player-');
  const spawnImpl = makeSpawn();
  const p = new ExternalPlayer(dir, spawnImpl);
  await p.play('http://example/stream.m3u8', 1500, 'ffplay');
  const call = spawnImpl.calls[0];
  assert.equal(call.bin, 'ffplay');
  assert.ok(!call.args.includes('-nodisp'), '-nodisp выключает видеовыход — быть не должно');
  assert.ok(call.args.includes('-fs'), 'нужен полноэкранный режим');
  assert.equal(call.opts.env.DISPLAY, ':0');
  assert.equal(call.args[call.args.length - 1], 'http://example/stream.m3u8');
  p.stop();
});

/* ---------- 2) auto: отсутствие mpv → автоматический переход на ffplay ---------- */

test('auto без mpv автоматически переключается на ffplay', async () => {
  const dir = tmpDir('iptv-player-');
  const spawnImpl = makeSpawn(['mpv']);           // mpv «не установлен» (ENOENT)
  const p = new ExternalPlayer(dir, spawnImpl);
  await p.play('http://example/stream.m3u8', 1500, undefined); // preferredBin не задан → был бы mpv
  // ждём асинхронного фолбэка после события error
  for (let i = 0; i < 50 && !spawnImpl.calls.some((c) => c.bin === 'ffplay'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const ff = spawnImpl.calls.find((c) => c.bin === 'ffplay');
  assert.ok(ff, 'ожидался автозапуск ffplay после ENOENT у mpv');
  assert.ok(!ff.args.includes('-nodisp'));
  assert.ok(ff.args.includes('-fs'));
  assert.notEqual(p.state, 'error', 'статус не должен остаться в ошибке');
  p.stop();
});

/* ---------- 3) статус buffering → playing для ffplay ---------- */

test('ffplay: статус переходит из buffering в playing, пока процесс жив', async () => {
  const dir = tmpDir('iptv-player-');
  const spawnImpl = makeSpawn();
  const p = new ExternalPlayer(dir, spawnImpl);
  await p.play('http://example/stream.m3u8', 1500, 'ffplay');
  assert.equal(p.state, 'buffering');            // сразу после старта
  const proc = spawnImpl.calls[0] && p.proc;
  assert.ok(proc);
  // монитор живости опрашивает PID раз в 500 мс; дождимся перехода
  for (let i = 0; i < 60 && p.state === 'buffering'; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(p.state, 'playing', 'UI не должен зависать на «Загрузка»');
  // пауза не должна мгновенно возвращаться в playing
  await p.pause();
  assert.equal(p.state, 'paused');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(p.state, 'paused', 'монитор живости не должен сбрасывать паузу');
  // остановка → idle
  p.stop();
  assert.equal(p.getState().state, 'idle');
});

/* ---------- API-эндпоинты через createServer.handler ---------- */

import http from 'node:http';

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch (e) { /* html/plain */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('native API: player/play|state|stop и remote-pulse roundtrip', async () => {
  const dir = tmpDir('iptv-server-');
  const spawnImpl = makeSpawn();
  const srv = mod.createServer({
    root: dir, dist: dir, filesDir: path.join(dir, 'files'),
    stateFile: path.join(dir, 'state.json'), playerMode: 'ffplay', spawn: spawnImpl
  });
  const server = http.createServer(srv.handler);
  const port = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));

  try {
    // play → ffplay с правильными флагами
    const play = await request(port, 'POST', '/native/player/play', { url: 'http://ex/s.m3u8' });
    assert.equal(play.status, 200);
    assert.equal(play.body.ok, true);
    const st = await request(port, 'GET', '/native/player/state');
    assert.ok(['buffering', 'playing'].includes(st.body.state));

    // stop → idle
    const stop = await request(port, 'POST', '/native/player/stop', {});
    assert.equal(stop.body.ok, true);
    const st2 = await request(port, 'GET', '/native/player/state');
    assert.equal(st2.body.state, 'idle');

    // remote pulse: реальный путь пульта — POST /api/remote ставит команду в очередь,
    // страница забирает её через GET /native/pulse и отвечает POST /native/result.
    const cmdBody = { action: 'select', id: 7 };
    let answered;
    const apiPromise = request(port, 'POST', '/api/remote', cmdBody).then((r) => { answered = r; });
    let taken;
    for (let i = 0; i < 50 && !(taken && taken.body.commands.length); i++) {
      taken = await request(port, 'GET', '/native/pulse?limit=10');
      if (taken.body.commands.length) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(taken.status, 200);
    assert.ok(Array.isArray(taken.body.commands));
    assert.ok(taken.body.commands.length >= 1, 'команда из /api/remote должна попасть в /native/pulse');
    assert.deepEqual(taken.body.commands[0].cmd, cmdBody);
    const id = taken.body.commands[0].id;
    const result = await request(port, 'POST', '/native/result', [{ id, result: { ok: true, channel: 'CTV' } }]);
    assert.equal(result.body.ok, true);
    // enqueuePulse ждёт ответ страницы → /api/remote должен вернуть именно его
    const apiRes = await apiPromise;
    assert.equal(apiRes.status, 200);
    assert.equal(answered.body.ok, true);
    assert.equal(answered.body.channel, 'CTV');
  } finally {
    srv.player.stop();
    await new Promise((res) => server.close(res));
  }
});
