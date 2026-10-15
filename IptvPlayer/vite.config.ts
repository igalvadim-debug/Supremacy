import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
        index: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
        'server-page': resolve(__dirname, 'server-page.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
