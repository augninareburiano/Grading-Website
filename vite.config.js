import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    // Uncomment when a backend exists and VITE_DATA_BACKEND=remote, so /api
    // calls from the dev server reach it without CORS setup.
    // proxy: {
    //   '/api': { target: 'http://localhost:3000', changeOrigin: true }
    // }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
