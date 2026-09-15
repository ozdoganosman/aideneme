import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Ölçüm aracının HAZIR ölçütleri hâlâ geçerli mi?
 *
 * ÖLÇÜLEN KUSUR: veri sağlığı paneli kaldırıldığında (kullanıcı isteği)
 * `scripts/measure-perf.mjs` onu beklemeye devam etti ve `npm run perf` o
 * günden beri hiç çalışmadı — 120 saniye bekleyip zaman aşımına düşüyordu.
 * CI'da koşmadığı için kırılma kimseye görünmedi; yani "zayıf makinede
 * akışkan" iddiası doğrulanamaz hâldeydi ve bunu kimse bilmiyordu.
 *
 * Ölçümün kendisini CI'ya koymak pahalı (dakikalar). Bu test onun yerine
 * YALNIZCA seçicilerin varlığını doğruluyor: saniyeler sürüyor ve tam olarak
 * bu çürümeyi yakalıyor.
 */
const { ekranlar } = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/perf-ekranlar.json'), 'utf8'),
) as { ekranlar: { ad: string; url: string; hazir: string }[] };

for (const ekran of ekranlar) {
  test(`ölçüm aracının "${ekran.ad}" hazır ölçütü hâlâ geçerli`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${ekran.url}`, { waitUntil: 'networkidle' });
    await expect(
      page.locator(ekran.hazir).first(),
      `ölçüm aracı bu seçiciyi bekliyor ama ekranda yok: ${ekran.hazir}`,
    ).toBeVisible({ timeout: 120_000 });
  });
}
