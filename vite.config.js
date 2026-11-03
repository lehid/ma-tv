import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'web',
  publicDir: resolve(__dirname, 'public'),
  base: './', // chemins relatifs : marche sur https://<user>.github.io/ma-tv/ comme en local
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: ['es2017', 'chrome63', 'safari12'], // navigateurs de Smart TV (Tizen 5+, webOS 5+)
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'web/index.html'),
        guide: resolve(__dirname, 'web/guide.html'),
        stats: resolve(__dirname, 'web/stats.html'),
      },
    },
  },
  server: { host: true },
});
