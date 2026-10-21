import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'desktop/renderer',
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
    include: ['src/**/*.test.jsx', '../electron/**/*.test.mjs'],
    restoreMocks: true,
  },
});
