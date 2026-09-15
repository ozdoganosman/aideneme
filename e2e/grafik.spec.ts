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

/**
 * Finansal kolon grafiğinin YATAY düzeni.
 *
 * Gerçek BIST verisiyle (THYAO, 8 çeyrek) ölçülen kusur — örnek veride
 * görünmüyordu çünkü orada dönem etiketleri kısaydı:
 *
 * 1. `grid-template-columns: repeat(n, 1fr)` aslında `minmax(auto, 1fr)`
 *    demek. "2025/12" gibi uzun bir etiket kendi kolonunu genişletiyordu:
 *    sekiz kolonun ikisi 45,7 px, altısı 38,7 px oluyordu. Yani etiketler
 *    çubuk MERKEZLERİNDEN kayıyordu — grafik yanlış okunuyordu.
 * 2. Etiket satırı 256 px'lik kaba 338 px sığmaya çalışıp panelin dışına,
 *    yanındaki grafiğin üstüne taşıyordu.
 *
 * Birim testi bunu yakalayamaz: ızgara kolon genişliği bir DÜZEN sonucudur,
 * jsdom hesaplamaz.
 */
test.describe('Finansallar — kolon grafiği etiketleri', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('etiketler panele sığıyor ve çubuklarla hizalı', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page
      .getByRole('tab', { name: /finansal/i })
      .first()
      .click();
    await page.waitForSelector('.barseries', { timeout: 30_000 });

    const paneller = await page.evaluate(() =>
      [...document.querySelectorAll('.barseries')].map((fig) => {
        const satir = fig.querySelector('.barseries__labels') as HTMLElement;
        const kap = fig.querySelector('.barseries__kap') as HTMLElement;
        const genislikler = getComputedStyle(satir)
          .gridTemplateColumns.split(' ')
          .map((x) => parseFloat(x))
          .filter((x) => Number.isFinite(x));
        return {
          satirGenislik: satir.clientWidth,
          satirIcerik: satir.scrollWidth,
          figIcerik: (fig as HTMLElement).scrollWidth,
          figGenislik: (fig as HTMLElement).clientWidth,
          kapGenislik: kap.clientWidth,
          genislikler,
          // Kırpılan etiket: kolonuna sığmayan metin `overflow: hidden`
          // yüzünden TAŞMIYOR ama yarısı kesiliyor — "2025/12" yerine
          // "2025/" okunuyor. Düzen ölçümü bunu yakalamaz, bu yakalar.
          kirpilan: [...satir.children]
            .filter((c) => !c.classList.contains('is-hidden'))
            .filter((c) => c.scrollWidth > c.clientWidth + 1)
            .map((c) => (c as HTMLElement).innerText),
        };
      }),
    );

    expect(paneller.length, 'kolon grafiği çizilmemiş').toBeGreaterThan(0);

    for (const p of paneller) {
      // Taşma: satırın içeriği kabından geniş olamaz (1 px yuvarlama payı).
      expect(p.satirIcerik, 'etiket satırı kabını taşıyor').toBeLessThanOrEqual(
        p.satirGenislik + 1,
      );
      expect(p.figIcerik, 'kolon grafiği panelini taşıyor').toBeLessThanOrEqual(p.figGenislik + 1);
      // Hizalama: çubuklar EŞİT aralıklı çiziliyor, kolonlar da eşit olmalı.
      // Alt piksel yuvarlaması için 1 px tolerans.
      const enDar = Math.min(...p.genislikler);
      const enGenis = Math.max(...p.genislikler);
      expect(
        enGenis - enDar,
        'ızgara kolonları eşit değil — etiketler çubuktan kayar',
      ).toBeLessThanOrEqual(1);
      // Etiket satırı grafik kabıyla aynı genişlikte: ikisi aynı ızgara
      // sütununda, kayarlarsa hizalama yine bozulur.
      expect(Math.abs(p.satirGenislik - p.kapGenislik)).toBeLessThanOrEqual(1);
      // Okunabilirlik: görünür etiketlerin hiçbiri kırpılmıyor.
      expect(p.kirpilan, `kırpılan etiket: ${p.kirpilan.join(', ')}`).toEqual([]);
    }
  });
});
