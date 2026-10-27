import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', depth: 'depth.html' },
    },
  },
  test: {
    environment: 'node',
  },
});
