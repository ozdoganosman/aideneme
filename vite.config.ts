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
    coverage: {
      provider: 'v8',
      // Hedef ÇEKİRDEK katman: saf analiz kodu. Arayüz bileşenleri etkileşim
      // testleriyle ve uçtan uca akışlarla sınanıyor, satır kapsamıyla değil.
      include: ['src/core/**'],
      // DIŞARIDA BIRAKILANLAR ve nedenleri (gizlemek için değil, ölçüyü doğru
      // şeye bakmak için):
      //  - indicators/analysis.ts, backtest.ts, customStrategy.ts: eski
      //    uygulamanın (index.html) strateji motoru. Yeni çekirdekteki
      //    `core/backtest/` bunun yerini aldı; eskisi yeniden yazılmadı ve
      //    uçtan uca akışlarla sınanıyor. Kapsamı docs'ta raporlanıyor (%0),
      //    saklanmıyor.
      //  - synthetic.ts: yalnızca demo/geliştirme verisi üretir.
      // NOT: indikatörlerin kendisi (calc, rsi, patterns, stats) artık kapının
      // İÇİNDE — testleri sonradan yazıldı.
      exclude: [
        'src/core/indicators/analysis.ts',
        'src/core/indicators/backtest.ts',
        'src/core/indicators/customStrategy.ts',
        'src/core/data/synthetic.ts',
      ],
      reporter: ['text', 'json-summary'],
      // Eşik, ölçülen değerin hemen altında: geriye gidişi yakalar, ileriye
      // gitmeyi engellemez.
      thresholds: { statements: 95, branches: 90, functions: 95 },
    },
  },
});
