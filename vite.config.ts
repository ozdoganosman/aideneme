/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// base: './' so the built app works from any path (static hosting, CI artifact).
//
// Two entries during the rewrite:
//   index.html → mevcut (legacy) uygulama, üretimde yayında kalır
//   next.html  → yeni kabuk (tasarım sistemi + 7 ekran), Faz 2'de index'in yerini alır
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        next: resolve(__dirname, 'next.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
