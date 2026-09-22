import { expect, test } from '@playwright/test';
import { SEMBOL } from './semboller';

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
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
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
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
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
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
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

/**
 * KENDİ GÖSTERGENİ YAZ.
 *
 * Kullanıcı isteği: "pinescript yerine javascript ile yeni indikatör
 * yükleme". Korunması gereken zincir: yaz → dene → kaydet → listeye ekle →
 * çiz. Ayrıca HATA YOLU: kaydetmeden önce deneme zorunlu ve hata mesajı
 * kullanıcıya nerede yanlış yaptığını söylüyor.
 */
test.describe('Sembol Masası — kendi göstergen', () => {
  test.use({ viewport: { width: 1500, height: 950 } });

  const KOD = `({
  ad: 'Ortalama Farkı',
  kisa: 'OF',
  panel: 'ayri',
  parametreler: [
    { ad: 'kisa', etiket: 'Kısa', varsayilan: 10, min: 2, max: 200 },
    { ad: 'uzun', etiket: 'Uzun', varsayilan: 50, min: 3, max: 400 },
  ],
  ciktilar: (p) => [{ ad: 'f', etiket: 'OF ' + p.kisa, tur: 'cizgi', token: 'accent', taban: 0 }],
  hesapla: (c, p, lib) => [lib.fark(lib.ema(c.close, p.kisa), lib.ema(c.close, p.uzun))],
})`;

  test('yaz → dene → kaydet → çiz', async ({ page }) => {
    const hatalar: string[] = [];
    page.on('pageerror', (e) => hatalar.push(e.message));

    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1200);
    const onceki = await page.locator('.chart-host canvas').count();

    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.getByRole('button', { name: /Yeni gösterge yaz/ }).click();
    await page.waitForSelector('#gosterge-kaynak', { timeout: 20_000 });

    // 1) HATALI kod: kaydet KAPALI kalmalı ve hata alanı söylenmeli.
    await page.fill(
      '#gosterge-kaynak',
      `({ ad: 'Bozuk', kisa: 'BZ', parametreler: [], hesapla: () => { throw new Error('bilerek'); } })`,
    );
    await page.getByRole('button', { name: 'Dene' }).click();
    await expect(page.locator('.gosterge__hata')).toContainText('hesapla()');
    await expect(page.getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    // 2) ÇALIŞAN kod: üstveri KODDAN okunuyor, kullanıcıya ikinci kez sorulmuyor.
    await page.fill('#gosterge-kaynak', KOD);
    await page.getByRole('button', { name: 'Dene' }).click();
    await expect(page.locator('.gosterge__tamam')).toContainText('Ortalama Farkı');
    await expect(page.locator('.gosterge__tamam')).toContainText('ayrı panel');
    await page.getByRole('button', { name: 'Kaydet' }).click();

    // 3) Listeye ekle → kendi paneline çiz.
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.locator('.ind__kullanici .ind__ekle').first().click();
    await page.waitForTimeout(2500);

    const cipler = (await page.locator('.ind__satir').allInnerTexts()).map((t) =>
      t.split('\n')[0].trim(),
    );
    expect(cipler).toContain('OF 10 · 50');
    expect(
      await page.locator('.chart-host canvas').count(),
      'kullanıcı göstergesi panel açmadı',
    ).toBeGreaterThan(onceki);
    // Hata rozeti YOK: hesap gerçekten tamamlandı.
    await expect(page.locator('.ind__satir--hatali')).toHaveCount(0);
    expect(hatalar, 'sayfa hatası').toEqual([]);
  });

  test('kaydedilen gösterge sonraki açılışta duruyor', async ({ page }) => {
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.getByRole('button', { name: /Yeni gösterge yaz/ }).click();
    await page.waitForSelector('#gosterge-kaynak', { timeout: 20_000 });
    await page.fill('#gosterge-kaynak', KOD);
    await page.getByRole('button', { name: 'Dene' }).click();
    await expect(page.locator('.gosterge__tamam')).toContainText('Ortalama Farkı');
    await page.getByRole('button', { name: 'Kaydet' }).click();

    // Sayfa YENİDEN yükleniyor: kayıt tarayıcıda kalmalı.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await expect(page.locator('.ind__kullanici')).toContainText('Ortalama Farkı');
  });

  test('kendi göstergen PİYASADA koşuyor: radara ekle → dağılım → eşikle süz', async ({ page }) => {
    /*
      Bu yol yalnızca burada sınanabiliyor: jsdom'da Worker yok, birim
      testleri korumalı worker'ı taklit ediyor. Burada GERÇEK worker, GERÇEK
      paket (3 MB kopya), gerçek derleme ve 580+ sembolde gerçek koşturma var.

      Ölçüldü (Node, örnek gösterge): 584 sembol 2,7 ms. Tarayıcıda buna
      worker kurulumu ve paket aktarımı ekleniyor; sınır 10 s.
    */
    const hatalar: string[] = [];
    page.on('pageerror', (e) => hatalar.push(e.message));

    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });

    // Göstergeyi yaz, kaydet, grafiğe ekle (önceki testle aynı yol).
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.getByRole('button', { name: /Yeni gösterge yaz/ }).click();
    await page.waitForSelector('#gosterge-kaynak', { timeout: 20_000 });
    await page.fill('#gosterge-kaynak', KOD);
    await page.getByRole('button', { name: 'Dene' }).click();
    await expect(page.locator('.gosterge__tamam')).toContainText('Ortalama Farkı');
    await page.getByRole('button', { name: 'Kaydet' }).click();
    await page.getByRole('button', { name: /İndikatörler/ }).click();
    await page.locator('.ind__kullanici .ind__ekle').first().click();
    await page.keyboard.press('Escape');

    // Radar, tüm piyasa, filtre paneli, gösterge bölümü.
    await page.getByText('Radar', { exact: true }).first().click();
    await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
    await page.getByLabel('Kapsam').selectOption('piyasa');
    await page.getByRole('button', { name: /^Filtre paneli/ }).click();
    await page.getByText('Grafikteki göstergeler').click();

    // Eski not GİTMİŞ olmalı; yerine ekle düğmesi.
    await expect(page.getByText(/radarda ölçülemiyor/)).toHaveCount(0);
    await page.getByRole('button', { name: /OF ölçütlerini radardan ekle/ }).click();

    /*
      Dağılım BÜTÜN evrende olmalı. Sayıyı sabit yazmak (">500") YANLIŞTI:
      gerçek BIST 584 sembol ama CI'ın sentetik seti 200 — test orada
      düşüyordu. Evrenin büyüklüğünü ekranın kendisinden okuyoruz ("Radardaki
      N sembolden…") ve dağılımın en az %90'ını kapsadığını istiyoruz; %100
      değil, çünkü kısa geçmişli birkaç sembolde gösterge ölçülemez. Evren de
      gerçekten piyasa olmalı (≥ 100), yoksa "piyasa" kapsamı seçilmemiştir.
    */
    const evrenMetni = (await page.locator('.radar__sayac').getAttribute('title')) ?? '';
    const evren = Number(evrenMetni.match(/Radardaki (\d+) sembolden/)?.[1] ?? 0);
    expect(evren, `evren: "${evrenMetni}"`).toBeGreaterThanOrEqual(100);
    const dagilim = page.locator('.radar__dagilim').first();
    await expect(dagilim).toBeVisible({ timeout: 30_000 });
    const metin = (await dagilim.innerText()).replace(/\s+/g, ' ');
    const n = Number(metin.match(/^(\d+) sembolde/)?.[1] ?? 0);
    expect(n, `dağılım sembol sayısı: "${metin}" / evren ${evren}`).toBeGreaterThanOrEqual(
      Math.floor(evren * 0.9),
    );
    expect(metin).toMatch(/medyan/);
    // Ondalık VİRGÜL. `\d\.\d` YANLIŞTI: Türkçede nokta BİNLİK ayırıcı ("6.425,66")
    // ve o kalıp doğru sayıyı yakalıyordu. bicim.spec ile aynı ondalık kalıbı.
    expect(metin).not.toMatch(/(?<![.\d])\d+\.\d{1,2}(?![.\d])/);
    // Ölçek bildirilmedi → birim eki YOK: "fiyat farkı"na "×" yazmak yanlış bir iddia.
    expect(metin).not.toMatch(/×/);

    // Eşik: 0'dan büyük → kısa EMA uzunun üstünde olan hisseler. Tablo daralmalı.
    const onceki = await page.locator('.radar__tablo tbody tr').count();
    await page.getByLabel(/^OF \d+ en az$/).fill('0');
    await page.waitForFunction(
      (o) => document.querySelectorAll('.radar__tablo tbody tr').length < o,
      onceki,
      { timeout: 30_000 },
    );
    expect(hatalar, 'sayfa hatası').toEqual([]);
  });
});
