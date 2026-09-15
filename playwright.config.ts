import { defineConfig, devices } from '@playwright/test';

/**
 * Uçtan uca testler — planın §8 kalite kapısındaki "5 kritik akış".
 *
 * Birim testleri parçaların doğruluğunu koruyor; burada korunan şey **akış**:
 * gerçek Worker'lar, gerçek IndexedDB, gerçek canvas ve gerçek bir ağ isteği
 * zinciriyle ekranların birbirine bağlanması. Bu turlar boyunca elle yapılan
 * tarayıcı doğrulamaları buraya taşındı; elle yapılan doğrulama regresyonu
 * yakalamaz, test yakalar.
 *
 * Veri: `python scripts/make_sample_data.py` ile üretilen SENTETİK set
 * (sabit tohum → her yerde aynı baytlar).
 */
export default defineConfig({
  testDir: './e2e',
  // Worker havuzu + backtest gerçek CPU işi; zayıf CI makinesinde cömert olalım.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // CI'da tek işçi: paralel sekmeler aynı çekirdekleri paylaşınca ölçüm değil
  // kuyruk beklenir ve testler nedensiz kırılır.
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Kaçış kapısı: ortamda HAZIR bir Chromium varsa Playwright'ın kendi
      // sürümünü indirmesini beklemeden onu kullan. CI'da bu değişken yok,
      // orada `playwright install --with-deps chromium` çalışır.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/next.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
