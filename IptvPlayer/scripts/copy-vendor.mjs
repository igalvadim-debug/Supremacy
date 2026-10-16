// Копирует локальную копию hls.js в public/vendor — Vite включит её в dist/ как есть.
// Это запасной вариант, если CDN недоступен (работает без интернета для самой библиотеки).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const dst = resolve(root, 'public', 'vendor', 'hls.min.js');

if (!existsSync(src)) {
  console.error('hls.js не найден. Сначала выполните: npm install');
  process.exit(1);
}
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst);
console.log('hls.min.js скопирован в public/vendor');
