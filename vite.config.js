import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    // Uncomment when running your own backend with VITE_DATA_BACKEND=remote, so
    // /api calls from the dev server reach it without CORS setup. The firebase
    // backend does not need this — it talks to Google directly.
    // proxy: {
    //   '/api': { target: 'http://localhost:3000', changeOrigin: true }
    // }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The Firebase SDK is ~600kB on its own and cannot be trimmed further; it
    // is already a lazily-imported chunk, and only ships when
    // VITE_DATA_BACKEND=firebase. Raised so a real regression still warns.
    chunkSizeWarningLimit: 700
  },
  test: {
    // jsdom only where a DOM is needed — app.test.js opts in with a docblock.
    environment: 'node',
    include: ['src/**/*.test.js']
  }
});
