import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
    port: 5173,
  },
});
