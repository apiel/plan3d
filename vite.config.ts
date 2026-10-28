import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // three.js, loaded only when the 3D view opens
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: { main: 'index.html', depth: 'depth.html' },
    },
  },
  test: {
    environment: 'node',
  },
});
