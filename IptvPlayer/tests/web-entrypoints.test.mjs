import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';

const webRoot = new URL('../www/', import.meta.url);
const pages = [
  { page: 'index.html', entry: 'js/player.js' },
  { page: 'remote.html', entry: 'js/remote.js' },
  { page: 'server-page.html', entry: 'js/server-page.js' },
];

// Match these pages' script tags without splitting on '>' inside an attribute.
function scriptsIn(html) {
  return [...html.matchAll(/<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => {
      const [, attributes, body] = match;
      const attrs = new Map([...attributes.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)]
        .map(([, name, doubleQuoted, singleQuoted, unquoted]) => [
          name.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted ?? '',
        ]));
      return { attrs, body, offset: match.index };
    });
}

for (const { page, entry } of pages) {
  test(`${page} loads its extracted entry point exactly once`, () => {
    const html = readFileSync(new URL(page, webRoot), 'utf8');
    const scripts = scriptsIn(html);
    const localScripts = scripts.filter(({ attrs }) => {
      const src = attrs.get('src');
      return src !== undefined && !/^(?:https?:)?\/\//i.test(src);
    });

    assert.deepEqual(localScripts.map(({ attrs }) => attrs.get('src')), [entry]);
    assert.ok(scripts.every(({ body }) => body.trim() === ''),
      'Inline application code must not run alongside the extracted script');
  });

  test(`${page} has a nonempty, syntactically valid classic script at its entry URL`, () => {
    // Resolve relative to the HTML page, as a browser or Capacitor WebView does.
    const scriptUrl = new URL(entry, new URL(page, webRoot));
    const source = readFileSync(scriptUrl, 'utf8');
    assert.notEqual(source.trim(), '', `${entry} must contain application code`);
    assert.doesNotThrow(() => new Script(source, { filename: scriptUrl.pathname }));
  });

  test(`${page} initializes after its DOM controls exist`, () => {
    const html = readFileSync(new URL(page, webRoot), 'utf8');
    const script = scriptsIn(html).find(({ attrs }) => attrs.get('src') === entry);
    assert.ok(script, `Missing ${entry} script tag`);
    const controlOffsets = [...html.matchAll(/\bid\s*=\s*["'][^"']+["']/gi)]
      .map(({ index }) => index);
    assert.ok(controlOffsets.length > 0, 'The page must contain its application controls');
    assert.ok(script.offset > Math.max(...controlOffsets),
      'The extracted script accesses DOM controls during initialization');
    assert.ok(script.offset < html.toLowerCase().lastIndexOf('</body>'));
    assert.equal(script.attrs.has('async'), false, 'Async loading can race DOM initialization');
    assert.ok(['', 'text/javascript', 'application/javascript'].includes(script.attrs.get('type') ?? ''),
      'Extraction must preserve classic-script execution');
  });
}
