import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const appRoot = new URL('../', import.meta.url);
const configFiles = ['tsconfig.base.json', 'tsconfig.checkjs.json', 'tsconfig.strict.json'];
const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => '\n',
};

// Use the real configurations and declarations, with isolated source fixtures.
// Cleanup also runs when an assertion fails; nothing is written into www/.
function project(t, sources) {
  const root = mkdtempSync(join(tmpdir(), 'iptv-typechecking-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { ...sources };
  for (const file of [...configFiles, 'types/globals.d.ts']) {
    files[file] = readFileSync(new URL(file, appRoot), 'utf8');
  }
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }

  function config(mode) {
    const path = join(root, `tsconfig.${mode}.json`);
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        assert.fail(ts.formatDiagnostics([diagnostic], formatHost));
      },
    });
    assert.ok(parsed, `Unable to parse ${path}`);
    assert.deepEqual(parsed.errors, [], ts.formatDiagnostics(parsed.errors, formatHost));
    return parsed;
  }

  function program(mode) {
    const parsed = config(mode);
    return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  }

  return { root, config, program };
}

function assertClean(program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, formatHost));
}

test('checkJs includes nested application scripts and ambient types, excluding vendor and native code', (t) => {
  const fixture = project(t, {
    'www/js/player.js': 'const player = true;',
    'www/js/nested/remote.js': 'const remote = true;',
    'www/vendor/library.js': 'const vendor = true;',
    'android/generated.js': 'const native = true;',
    'node_modules/library/index.js': 'const dependency = true;',
  });
  const included = fixture.config('checkjs').fileNames
    .map((file) => relative(fixture.root, file).replaceAll('\\', '/')).sort();
  assert.deepEqual(included, [
    'types/globals.d.ts', 'www/js/nested/remote.js', 'www/js/player.js',
  ]);
});

test('checkJs reports incompatible JavaScript assignments', (t) => {
  const fixture = project(t, {
    'www/js/assignment.js': '/** @type {number} */\nlet count = "not a number";',
  });
  const diagnostics = ts.getPreEmitDiagnostics(fixture.program('checkjs'));
  assert.deepEqual(diagnostics.map(({ code }) => code), [2322],
    ts.formatDiagnostics(diagnostics, formatHost));
});

test('checkJs keeps null checks enabled when implicit parameters are allowed', (t) => {
  const fixture = project(t, {
    'www/js/null.js': 'document.getElementById("video").textContent = "Playing";',
  });
  const diagnostics = ts.getPreEmitDiagnostics(fixture.program('checkjs'));
  assert.deepEqual(diagnostics.map(({ code }) => code), [2531],
    ts.formatDiagnostics(diagnostics, formatHost));
});

test('checkJs accepts legacy implicit parameters and browser ES2017 APIs', (t) => {
  const fixture = project(t, {
    'www/js/browser.js': `
      function channelName(channel) { return channel.name; }
      async function update() {
        const names = await Promise.resolve(['News']);
        for (const video of document.querySelectorAll('video')) video.pause();
        return Object.entries({ title: names[0] });
      }
    `,
  });
  assertClean(fixture.program('checkjs'));
});

test('strict checking includes JavaScript entry points rather than silently checking only declarations', (t) => {
  const fixture = project(t, { 'www/js/player.js': 'function play(channel) { return channel; }' });
  const included = fixture.config('strict').fileNames
    .map((file) => relative(fixture.root, file).replaceAll('\\', '/'));
  assert.ok(included.includes('www/js/player.js'),
    'The strict configuration must include the JavaScript it is intended to check');
  const diagnostics = ts.getPreEmitDiagnostics(fixture.program('strict'));
  assert.deepEqual(diagnostics.map(({ code }) => code), [7006],
    ts.formatDiagnostics(diagnostics, formatHost));
});

test('strict checking rejects implicit any in TypeScript sources', (t) => {
  const fixture = project(t, { 'www/js/channel.ts': 'function nameOf(channel) { return channel.name; }' });
  const diagnostics = ts.getPreEmitDiagnostics(fixture.program('strict'));
  assert.deepEqual(diagnostics.map(({ code }) => code), [7006],
    ts.formatDiagnostics(diagnostics, formatHost));
});

for (const mode of ['checkjs', 'strict']) {
  test(`${mode} checks sources without emitting or overwriting application files`, (t) => {
    const fixture = project(t, { 'www/js/channel.ts': 'export const name: string = "News";' });
    const program = fixture.program(mode);
    assertClean(program);
    const writes = [];
    const result = program.emit(undefined, (file) => writes.push(file));
    assert.equal(result.emitSkipped, true);
    assert.deepEqual(writes, []);
  });
}

test('ambient declarations support HLS, optional browser hooks, and native plugin registration', (t) => {
  const fixture = project(t, {
    'www/js/bridge.ts': `
      const browserWindow: Window = window;
      browserWindow.Capacitor = undefined;
      browserWindow.RemoteAPI = undefined;
      browserWindow.__iptvMenu = undefined;
      const minimal: CapacitorBridge = { registerPlugin: (name: string) => ({ name }) };
      const native: CapacitorBridge = {
        ...minimal, isNativePlatform: () => true, getPlatform: () => 'android',
        Plugins: { App: { exitApp() {} } }
      };
      browserWindow.Capacitor = native;
      native.registerPlugin('IptvNative');
      native.registerPlugin('IptvPlayer', { web: () => ({}) });
      browserWindow.RemoteAPI = { handle: (cmd: unknown) => cmd };
      browserWindow.__iptvMenu = () => {};
      const hls = new Hls({ maxBufferLength: 30 });
      hls.attachMedia(document.createElement('video'));
      if (window.Hls) window.Hls.isSupported();
    `,
  });
  assertClean(fixture.program('strict'));
});

test('ambient declarations reject unsafe optional bridge and menu access', (t) => {
  const fixture = project(t, {
    'www/js/unsafe.ts': `
      // @ts-expect-error The Capacitor bridge is absent in an ordinary browser.
      window.Capacitor.registerPlugin('IptvNative');
      // @ts-expect-error The native menu callback may not have been installed.
      window.__iptvMenu();
      // @ts-expect-error Native platform detection returns a boolean.
      const bridge: CapacitorBridge = { registerPlugin() {}, isNativePlatform: () => 'android' };
    `,
  });
  assertClean(fixture.program('strict'));
});

test('QR declarations accept the player SVG markup call with cell size and margin', (t) => {
  const fixture = project(t, {
    'www/js/qr-svg.ts': `
      if (window.qrcode) {
        const qr = window.qrcode(0, 'M');
        qr.addData('http://example.invalid/remote');
        qr.make();
        document.createElement('div').innerHTML = qr.createSvgTag(4, 8);
      }
    `,
  });
  assertClean(fixture.program('strict'));
});

test('QR image markup is a string that can be inserted into the page', (t) => {
  const fixture = project(t, {
    'www/js/qr-image.ts': `
      const qr = qrcode(0, 'M');
      qr.addData('http://example.invalid/remote');
      qr.make();
      document.createElement('div').innerHTML = qr.createImgTag();
      const markup: string = qr.createImgTag(4, 8);
    `,
  });
  assertClean(fixture.program('strict'));
});

test('QR declarations reject invalid version and data argument types', (t) => {
  const fixture = project(t, {
    'www/js/qr-invalid.ts': `
      // @ts-expect-error The QR version is numeric, including zero for automatic sizing.
      qrcode('auto', 'M');
      const qr = qrcode(0, 'M');
      // @ts-expect-error QR payloads must be strings.
      qr.addData(42);
    `,
  });
  assertClean(fixture.program('strict'));
});
