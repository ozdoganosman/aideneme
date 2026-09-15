import { expect, test } from '@playwright/test';

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

type Ekran = {
  ad: string;
  url: string;
  hazir: string;
  /** Varsayılan kapalı yüzeyler (radar) için açma adımı. */
  ac?: (page: import('@playwright/test').Page) => Promise<void>;
};

const SCREENS: Ekran[] = [
  { ad: 'Nabız', url: 'v=nabiz', hazir: '.pulse__flows' },
  // Sektör endeksi paneli ASENKRON yükleniyor: `.pulse__flows` hazır olduğunda
  // tablosu daha çizilmemiş olabiliyor. Ayrı giriş, çünkü denetimin kör
  // noktası tam olarak buydu — varsayılan durumda GÖRÜNMEYEN yüzeyler.
  { ad: 'Nabız (sektör endeksleri)', url: 'v=nabiz', hazir: '.sektor__tablo' },
  { ad: 'Tarayıcı', url: 'v=tarayici', hazir: '.ui-vtable' },
  { ad: 'Sembol Masası', url: 'v=sembol&s=X001', hazir: '.desk__chart' },
  {
    // Radar dar ekranda grafiğin ALTINA iniyor; tam genişlik alan bir tablo
    // sayfayı yatay kaydırılabilir yapabilir. Kapalıyken denetlenmiş sayılmaz.
    ad: 'Sembol Masası (radar)',
    url: 'v=sembol&s=X001',
    hazir: '.radar__tablo',
    ac: async (page) => {
      await page.getByText('Radar', { exact: true }).first().click();
      await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
      await page.getByLabel('Kapsam').selectOption('piyasa');
      // Temel veri filtresi UYGULANIYOR: "ölçülemedi" notu yalnızca böyle
      // görünüyor ve denetim görmediği yüzeyi koruyamaz.
      await page.getByRole('button', { name: 'Hazır', exact: true }).click();
      await page.getByRole('button', { name: /Ucuz ve kârlı/ }).click();
      await page.waitForSelector('.radar__olculemedi', { timeout: 30_000 });
    },
  },
  { ad: 'Stratejiler', url: 'v=stratejiler', hazir: '.rank__table' },
  { ad: 'Model', url: 'v=model&s=X001', hazir: '.model__verdict' },
  { ad: 'Rapor', url: 'v=rapor&s=X001', hazir: '.report__sheet' },
];

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
