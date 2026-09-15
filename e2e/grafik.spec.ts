import { expect, test } from '@playwright/test';

/**
 * Grafik ekranının DİKEY düzeni.
 *
 * Kullanıcı isteği: "grafik ekranı çok önemli, grafiği olabildiğince genişlet
 * dikeyde". İki ayrı kusur ölçüldü ve ikisi de buradan korunuyor:
 *
 * 1. Grafik kabı `flex: 1` ile büyüyordu ve kapsayıcının `min-height: 100%`
 *    değeriyle birlikte 1.344 px'e çıkıyordu — görünür alan ise 905 px. Yani
 *    grafiğin alt üçte biri ve altındaki metrik kartları ekranın DIŞINDA
 *    kalıyordu. (Ölçüm: hem bu sürümde hem bir önceki sürümde aynı sayı.)
 * 2. İndikatör panelleri kapalıyken bile paylarını alıyordu: esneme
 *    katsayıları kuruluşta 3/1/1 olarak sabitleniyordu, yani iki panel de
 *    kapalıyken fiyat grafiğin yalnızca %59,8'ini kullanıyordu. Katsayı artık
 *    panelin AÇIK olup olmamasına göre veriliyor ve oran %98,9'a çıkıyor.
 *
 * Birim testi bunu yakalayamaz: jsdom düzen hesaplamaz, yükseklikler 0'dır.
 */
test.describe('Sembol Masası — grafik yüksekliği', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('grafik görünür alana sığıyor ve ondan küçük değil', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    // 1,5 s: kusur ANINDA görünmüyor. Grafik kütüphanesi kabı gözlemleyip
    // yeniden boyutlanıyor ve şişme bir sonraki düzen turunda oluşuyor —
    // 500 ms ile ölçüldüğünde kusurlu sürüm bile "geçiyordu".
    await page.waitForTimeout(1500);

    const olcum = await page.evaluate(() => {
      const kap = document.querySelector('.desk__chart') as HTMLElement;
      const kaydirma = document.querySelector('.shell-content') as HTMLElement;
      return { grafik: kap.clientHeight, gorunur: kaydirma.clientHeight };
    });

    // Taşmıyor: grafik görünür alandan yüksek olamaz.
    expect(olcum.grafik, 'grafik görünür alanı taşıyor').toBeLessThanOrEqual(olcum.gorunur);
    // Ama ezilmiyor da: alanın yarısından fazlasını alıyor. Sabit bir piksel
    // değeri yerine ORAN: pencere boyu değişince eşik anlamsızlaşmasın.
    expect(olcum.grafik, 'grafik dikeyde eziliyor').toBeGreaterThan(olcum.gorunur * 0.5);
  });

  test('kapalı indikatör paneli yer kaplamıyor', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    /**
     * Kütüphane panelleri bir tablo satırı olarak çiziyor: ilk satır fiyat
     * paneli, aradakiler indikatör panelleri, sonuncusu zaman ekseni.
     *
     * Ölçüm ORAN üzerinden: mutlak piksel, pencere boyuna ve daha önce
     * düzeltilen yükseklik kusuruna bağlı olduğu için iki sürümde de
     * "geçebiliyordu" — ölçüldü, bu testin ilk hâli kusurlu sürümde de
     * yeşil kalmıştı.
     */
    const fiyatPayi = async () =>
      page.evaluate(() => {
        const satirlar = [...document.querySelectorAll('.chart-host tr')].map(
          (r) => (r as HTMLElement).clientHeight,
        );
        if (satirlar.length < 2) return 0;
        // Son satır zaman ekseni: panel payına girmiyor.
        const paneller = satirlar.slice(0, -1);
        const toplam = paneller.reduce((a, b) => a + b, 0);
        return toplam > 0 ? paneller[0] / toplam : 0;
      });

    const kapali = await fiyatPayi();
    expect(
      kapali,
      'iki panel de kapalıyken fiyat alanı grafiğin tamamına yakın olmalı',
    ).toBeGreaterThan(0.85);

    await page.getByText('Williams %R', { exact: true }).click();
    await page.waitForTimeout(1500);
    const acik = await fiyatPayi();
    expect(acik, 'panel açılınca fiyat payı düşmeli').toBeLessThan(kapali);
    expect(acik, 'açık panel fiyatı ezmemeli').toBeGreaterThan(0.6);
  });
});
