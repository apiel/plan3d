import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', depth: 'depth.html', scan: 'scan.html' },
    },
  },
  test: {
    environment: 'node',
  },
});
