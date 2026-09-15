import { expect, test } from '@playwright/test';

/**
 * Türkçe sayı biçimi denetimi.
 *
 * Elle tarayınca iki turda da eksik kaldı: ilk turda yalnızca yüzdelere
 * bakmıştım, ondalık noktalar durdu; ikinci turda dokuz ekranı tek tek
 * gezmek gerekti. Yeni bir kart eklenince aynı kaçış yine olur — bu yüzden
 * tarama teste taşındı.
 *
 * İki kural aranıyor:
 *   1. Ondalık ayırıcı NOKTA olmamalı (`18.24` → `18,24`).
 *   2. Yüzde işareti sayının ÖNÜNDE olmalı (`40%` → `%40`).
 */

/**
 * Ekranlar ve GEREKİRSE açılacak yüzey.
 *
 * Denetimin kör noktası: yalnızca varsayılan durumlar taranıyordu. Model
 * ekranının indirme PLANI (havuzlanmış model) "474.5 MB" yazıyordu ve bu
 * satır ancak plan ekrandayken görünüyor — denetim bazen yakalıyor, bazen
 * kaçırıyordu; iki turda "kararsız test" sanıldı. Aynı sınıftan beş kaçak
 * daha çıktı (indirme notu, laboratuvarın yıl ipucu, galeri fiyat sütunu,
 * sembol masasının varsayılan biçimi, finansallarda küçük tutar).
 */
type Ekran = {
  ad: string;
  url: string;
  hazir: string;
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
  {
    ad: 'Sembol Masası (finansallar)',
    url: 'v=sembol&s=X001',
    hazir: '.fin__karne',
    ac: async (page) => {
      await page.getByRole('tab', { name: 'Finansallar' }).click();
    },
  },
  { ad: 'Karşılaştır', url: 'v=karsilastir&cmp=X001,X002,X003', hazir: '.compare__matrix' },
  { ad: 'Laboratuvar', url: 'v=laboratuvar&s=X001', hazir: '.lab__stats' },
  { ad: 'Stratejiler', url: 'v=stratejiler', hazir: '.rank__table' },
  {
    // İNDİRME PLANI: "x MB indirilecek" satırı yalnızca bu kapsamda çiziliyor.
    ad: 'Stratejiler (derin tarama planı)',
    url: 'v=stratejiler',
    hazir: '.rank__deep',
    ac: async (page) => {
      await page.getByLabel('Kapsam').selectOption('deep');
    },
  },
  { ad: 'Model', url: 'v=model&s=X001', hazir: '.model__verdict' },
  {
    // Havuz eğitiminin indirme PLANI: "x sembol · y MB indirilecek" satırı.
    ad: 'Model (havuz planı)',
    url: 'v=model&s=X001',
    hazir: '.rank__deep',
    ac: async (page) => {
      await page.getByLabel('Kapsam').selectOption('pool');
    },
  },
  {
    // UI kitaplığının tablo sekmesi: fiyat sütunu burada çiziliyor ve bu
    // ekran hiç denetlenmemişti.
    ad: 'Kitaplık (tablo)',
    url: 'v=kitaplik',
    hazir: '.ui-vtable',
    ac: async (page) => {
      await page.getByRole('tab', { name: /Tablo/ }).click();
    },
  },
  { ad: 'Rapor', url: 'v=rapor&s=X001', hazir: '.report__sheet' },
];

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: sayılar Türkçe biçimde`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(400);

    const bulgular = await page.evaluate(() => {
      const text = (document.querySelector('.shell-content') as HTMLElement).innerText.replace(
        /\s+/g,
        ' ',
      );
      // Ondalık nokta: önünde/ardında başka rakam ya da nokta OLMAYAN
      // `12.3` / `12.34` kalıpları. Böylece binlik ayırıcı (12.345) ve
      // tarih (14.09.2026) elenir.
      const ondalik = [...text.matchAll(/(?<![.\d])\d+\.\d{1,2}(?![.\d])/g)].map((m) => m[0]);
      // Sondan yüzde: rakamdan hemen sonra gelen % işareti.
      //
      // İki yanlış alarm sınıfı elendi, ikisi de ölçütün kendi kusuruydu:
      //   1. İki doğru yüzde yan yana gelince ("-%2,37 %18") araya düşen
      //      "7 %" — işaretin ardından RAKAM geliyorsa o zaten bir sonraki
      //      sayının başıdır.
      //   2. Ardından HARF gelen % (".. > 50 %R 14 > 50"). Strateji adları
      //      Williams %R içeriyor; Türkçede yüzde her zaman % + rakamdır,
      //      "%R" bir yüzde değil indikatör adıdır.
      const sondanYuzde = [...text.matchAll(/\d\s?%(?![\d\p{L}])/gu)].map((m) => m[0]);
      // ISO tarih (2025-09-28). Üründe iki tarih biçimi yan yana duruyordu:
      // tazelik rozeti "11 Eyl 2026" derken rapor, portföy, laboratuvar,
      // model ve grafik ekseni ISO yazıyordu — on ayrı yerde. Bu, ondalık
      // virgül kusurunun aynısı ve elle tarama iki turda da kaçırmıştı.
      //
      // `<input type="date">` DEĞERİ ISO olmak zorunda (HTML sözleşmesi) ama
      // innerText giriş alanlarının değerini içermez, o yüzden yanlış alarm
      // vermiyor.
      const isoTarih = [...text.matchAll(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g)].map((m) => m[0]);
      return {
        ondalik: [...new Set(ondalik)],
        sondanYuzde: [...new Set(sondanYuzde)],
        isoTarih: [...new Set(isoTarih)],
      };
    });

    expect(bulgular.ondalik, 'ondalık ayırıcı virgül olmalı').toEqual([]);
    expect(bulgular.sondanYuzde, 'yüzde işareti sayıdan önce gelmeli').toEqual([]);
    expect(bulgular.isoTarih, 'tarih Türkçe biçimde olmalı (28 Eyl 2025)').toEqual([]);
  });
}
