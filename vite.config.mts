import { defineConfig } from 'vite';

// The browser game lives in /client. Vite bundles it into /dist/client,
// and the Node server (server/index.ts) serves that folder.
export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000, // Phaser is big; that's fine.
  },
  // Only used if you run `vite` locally for development: forward socket traffic to the Node server.
  server: {
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
});
