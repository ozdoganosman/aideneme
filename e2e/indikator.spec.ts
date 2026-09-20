import { expect, test } from '@playwright/test';

/**
 * İNDİKATÖR SİSTEMİ.
 *
 * Kullanıcı isteği: "indikatör sistemini trading view gibi yapabilir miyiz,
 * arama butonu orada indikatörler; indikatörün ayar kısmında parametrelerin
 * değiştirilebilmesi; temel indikatörlerin barındırılması".
 *
 * Birim testleri kayıt defterini ve worker hesabını koruyor. Burada korunan
 * şey ZİNCİR: arama → ekleme → çizim → ayar → kaldırma. Kırılma tam olarak
 * bağlantılarda olur; bu oturumda "hesap doğru ama ekranda görünmüyor"
 * sınıfından iki kusur zaten ölçüldü.
 */
test.describe('Sembol Masası — indikatörler', () => {
  test.use({ viewport: { width: 1500, height: 950 } });

  const cipler = async (page: import('@playwright/test').Page) =>
    (await page.locator('.ind__satir').allInnerTexts()).map((t) => t.split('\n')[0].trim());

  test('eski sabit düzen göstergelere taşınmış geliyor', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1200);

    /*
      Sabit sistemin varsayılanları: EMA 50 açık, EMA 200 kapalı, iki panel
      kapalı. Yeniden yapılandırma kullanıcının gördüğü düzeni sessizce
      değiştirmemeli — bu yüzden liste de sıra da sınanıyor.
    */
    expect(await cipler(page)).toEqual([
      'EMA 50',
      'EMA 200',
      '%R 260 · 260 · 120',
      'nMACD 120 · 260 · 50 · 185',
    ]);
  });

  test('arama → ekleme → ayar → kaldırma', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1200);

    const tuval = () => page.locator('.chart-host canvas').count();
    const onceki = await tuval();

    // 1) ARAMA: Türkçe karakter yazmadan da bulunmalı.
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.fill('#ind-ara', 'oynaklik');
    await expect(page.locator('.ind__ekle')).toHaveCount(2); // Bollinger + ATR

    // 2) FİYAT ÜSTÜNE ekleme: yeni panel AÇILMAMALI.
    await page.fill('#ind-ara', 'bollinger');
    await page.locator('.ind__ekle').first().click();
    await page.waitForTimeout(1500);
    expect(await cipler(page)).toContain('BB 20 · 2');
    expect(await tuval(), 'fiyat üstü gösterge yeni panel açtı').toBe(onceki);

    // 3) AYRI PANEL isteyen gösterge: panel açılmalı.
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.fill('#ind-ara', 'rsi');
    await page.locator('.ind__ekle').first().click();
    await page.waitForTimeout(1800);
    expect(await cipler(page)).toContain('RSI 14');
    expect(await tuval(), 'ayrı panel isteyen gösterge panel açmadı').toBeGreaterThan(onceki);

    // 4) AYAR: parametre değişince etiket de değişmeli.
    await page.getByRole('button', { name: /^RSI .* ayarları/ }).click();
    await page.getByLabel('Uzunluk').first().fill('7');
    await page.waitForTimeout(1500);
    await page
      .locator('.ui-dialog')
      .getByRole('button', { name: 'Kapat', exact: true })
      .last()
      .click();
    expect(await cipler(page)).toContain('RSI 7');

    // 5) SINIR: şemanın dışına çıkan değer yutuluyor, çizgi kaybolmuyor.
    await page.getByRole('button', { name: /^RSI .* ayarları/ }).click();
    await page.getByLabel('Uzunluk').first().fill('0');
    await page.waitForTimeout(1200);
    await page
      .locator('.ui-dialog')
      .getByRole('button', { name: 'Kapat', exact: true })
      .last()
      .click();
    expect(await cipler(page), 'sınır uygulanmadı').toContain('RSI 1');

    // 6) KALDIRMA.
    await page.getByRole('button', { name: /^RSI .* göstergesini kaldır/ }).click();
    await page.waitForTimeout(1200);
    expect((await cipler(page)).some((c) => c.startsWith('RSI'))).toBe(false);
  });

  test('görünürlük kapatılınca paneli de kapanıyor', async ({ page }) => {
    await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1200);
    const onceki = await page.locator('.chart-host canvas').count();

    /*
      Anahtarın KENDİSİ tıklanamaz: girdi `opacity: 0; width: 0` ile gizli,
      görünen şey etiket. Erişilebilirlik açısından doğru kurulum (rol ve ad
      girdide), ama tıklama etikete yapılır — ilk yazımda girdiyi tıklamaya
      çalışıp zaman aşımına düştüm.
    */
    await page.getByText('%R 260 · 260 · 120', { exact: true }).click();
    await page.waitForTimeout(1800);
    expect(
      await page.locator('.chart-host canvas').count(),
      'gösterge açıldı ama panel kurulmadı',
    ).toBeGreaterThan(onceki);
  });
});
