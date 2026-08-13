import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Changes on every build/dev-server start, and is what busts the service
// worker's cache. Without it a released index would keep being served from a
// previous version's cache - and index.bin and cards.json must always come from
// the same build or the Scanner refuses to start.
const BUILD_ID = String(Date.now());

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: '127.0.0.1', port: 5273 },
  resolve: {
    alias: {
      '@bulksift/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  worker: { format: 'es' },
});
