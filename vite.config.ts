import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { jspdfOptionalChunkFileNames, pwaOptions } from './pwa.config';

export default defineConfig({
  // PWA manifest + service worker (M8.3); options live in pwa.config.ts (platform-engineer).
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      // Fixed names for jsPDF's unused optional chunks, so the SW precache can exclude them.
      output: { chunkFileNames: jspdfOptionalChunkFileNames },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // jsdom component tests can exceed the 5 s default on slow CI runners or a busy machine.
    testTimeout: 15_000,
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
