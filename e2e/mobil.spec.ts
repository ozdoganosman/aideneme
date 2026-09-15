import { expect, test } from '@playwright/test';
import { denetimEkranlari, type Ekran } from './ekranlar';

/**
 * Dar ekran düzeni.
 *
 * Tasarım tek responsive ağaç üzerine kurulu (ayrı mobil bileşen yok), ama bu
 * kendiliğinden dar ekranda doğru çalıştığı anlamına gelmiyor: ekran sayısı
 * arttıkça gezinti çubuğu telefona sığmaz oldu ve TÜM sayfayı yatay
 * kaydırılabilir hale getirdi (tarayıcı da görünümü küçülttü). Bu test o
 * gerilemeyi yakalar.
 */

test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

const SCREENS: Ekran[] = denetimEkranlari('mobil');

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: telefon genişliğinde yatay taşma yok`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(300);

    const layout = await page.evaluate(() => ({
      // Düzen genişliği cihaz genişliğine eşit olmalı: büyükse tarayıcı
      // "sığdırmak için" görünümü küçültmüş demektir.
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(layout.innerWidth, 'düzen genişliği cihazdan büyük (sayfa küçültüldü)').toBe(390);
    expect(layout.scrollWidth, 'sayfa yatay kayıyor').toBeLessThanOrEqual(layout.innerWidth + 1);
  });
}
