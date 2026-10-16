import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Каталог проекта. __dirname недоступен в ESM-конфигах (package.json "type": "module"),
// поэтому корень вычисляем из import.meta.url.
const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Конфигурация Vite для много-страничного приложения IPTV Player.
 * Страницы: index.html (плеер), remote.html (пульт), server-page.html (файлы).
 */
export default defineConfig({
  // Capacitor отдаёт контент из корня http://localhost/, пути — абсолютные
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Поддержка Android WebView ~Chrome 74+ (Capacitor 5+) и старых TV-устройств
    target: ['chrome74', 'safari12', 'firefox90'],
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(rootDir, 'index.html'),
        remote: resolve(rootDir, 'remote.html'),
        'server-page': resolve(rootDir, 'server-page.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
