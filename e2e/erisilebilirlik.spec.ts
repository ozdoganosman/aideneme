import { expect, test } from '@playwright/test';

/**
 * Ekran genelinde erişilebilirlik denetimi.
 *
 * Lint kuralları "etiket var mı" diye bakar; bu test "etiket AYIRT EDİCİ mi"
 * diye bakar. Sekiz satırda sekiz kez "Laboratuvarda aç" duyan bir ekran
 * okuyucu kullanıcısı hangisinin hangi strateji olduğunu bilemez — lint bunu
 * göremez, çünkü teknik olarak hepsi etiketlidir.
 */

/**
 * [ad, sorgu, hazır-seçici, açılışta tıklanacak sekme]
 *
 * SEKME de bir DURUMDUR. Denetim dokuz ekranı yalnızca varsayılan durumda
 * geziyordu ve bu iki kez ısırdı: önce Model'in son tahmin kartı (yalnızca
 * hüküm "kullanma" değilken çiziliyor), sonra Sembol Masası'nın Finansallar
 * sekmesi — on iki sayı kartının SEKİZİNDE provenance katmanı yoktu ve
 * denetim o sekmeyi hiç açmadığı için yeşil kalıyordu. Ölçülmemiş durum,
 * denetlenmemiş durumdur.
 */
const SCREENS: [string, string, string, string?][] = [
  ['Nabız', 'v=nabiz', '.pulse__flows'],
  ['Tarayıcı', 'v=tarayici', '.ui-vtable'],
  ['Sembol Masası', 'v=sembol&s=X001', '.desk__health'],
  ['Sembol Masası — Finansallar', 'v=sembol&s=X001', '.fin', 'Finansallar'],
  ['Sembol Masası — Sektör', 'v=sembol&s=X001', '.desk__sector', 'Sektör'],
  ['Karşılaştır', 'v=karsilastir&cmp=X001,X002,X003', '.compare__matrix'],
  ['Strateji Laboratuvarı', 'v=laboratuvar&s=X001', '.lab__stats'],
  ['Stratejiler', 'v=stratejiler', '.rank__table'],
  ['Model', 'v=model&s=X001', '.model__verdict'],
  ['Portföy', 'v=portfoy', '.ui-field'],
  ['Rapor', 'v=rapor&s=X001', '.report__sheet'],
];

for (const [name, query, ready, tab] of SCREENS) {
  test(`${name}: etiketler eksiksiz ve ayırt edici`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (tab) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForSelector(ready, { timeout: 90_000 });
      await page.waitForTimeout(800);
    }
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(300);

    const audit = await page.evaluate(() => {
      const all = (s: string) => Array.from(document.querySelectorAll(s));
      const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const buttons = all('button').filter(visible) as HTMLButtonElement[];
      const names = buttons
        .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
        .filter(Boolean);
      const counts = new Map<string, number>();
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);

      return {
        h1: all('h1').map((h) => h.textContent?.trim() ?? ''),
        adsizDugme: buttons.filter(
          (b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label'),
        ).length,
        // Adsız BAĞLANTI da aynı kusur; ilk denetimde yalnızca düğmelere
        // bakmıştım ve grafik kütüphanesinin atıf bağlantısını kaçırmıştım.
        adsizBaglanti: (all('a') as HTMLAnchorElement[])
          .filter(visible)
          .filter((a) => !(a.textContent || '').trim() && !a.getAttribute('aria-label')).length,
        adsizGiris: all('input, select, textarea').filter((el) => {
          if (!visible(el)) return false;
          const labelled =
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
            el.getAttribute('aria-label') ||
            el.closest('label');
          return !labelled;
        }).length,
        tekrar: [...counts.entries()].filter(([, c]) => c > 1).map(([n, c]) => `${n} ×${c}`),
        // Ürün ilkesi #2: yayınlanan her sayı "bu nereden geliyor?" katmanını
        // taşımalı. Plan bunu %100 diye yazıyordu ama ölçülmemişti; ölçünce
        // Laboratuvar'ın sekiz kartında ve Model'in dokuzunda hiç yoktu.
        provenanceSiz: all('.ui-stat')
          .filter(visible)
          .filter((el) => !el.querySelector('.desk__prov'))
          .map((el) => (el.querySelector('.ui-stat__label')?.textContent ?? '?').trim()),
      };
    });

    // Her ekranın tek ve doğru bir h1'i olmalı.
    // Sekme varyantında h1 hâlâ EKRANIN adı; ad alanı testin etiketi.
    expect(audit.h1).toEqual([name.split(' — ')[0]]);
    expect(audit.adsizDugme, 'adsız düğme').toBe(0);
    expect(audit.adsizBaglanti, 'adsız bağlantı').toBe(0);
    expect(audit.adsizGiris, 'etiketsiz giriş alanı').toBe(0);
    expect(audit.tekrar, 'aynı ada sahip düğmeler ayırt edilemez').toEqual([]);
    expect(audit.provenanceSiz, 'provenance katmanı olmayan sayı kartı').toEqual([]);
  });
}

/**
 * WCAG 2.2 §4.1.3 "Durum Mesajları" (AA).
 *
 * Ölçüm: hesap sonucu bildiren HİÇBİR metin canlı bölgede değildi. Gören
 * kullanıcı tablonun dolduğunu görüyordu; ekran okuyucu kullanıcısına
 * saniyeler süren Stratejiler/Model ekranlarında hiçbir şey söylenmiyordu.
 * Odak değişmediği için tetiklenecek başka bir duyuru da yok.
 *
 * Portföy listede yok: boş portföyde hesaplanan bir şey yoktur, olmayan
 * sonucun duyurusu da olmaz (işlem eklendiğinde duyuruyu birim testi korur).
 */
const DUYURU: [string, string, string, RegExp][] = [
  ['Nabız', 'v=nabiz', '.pulse__flows', /Piyasa nabzı hazır: \d+ sembol/],
  ['Tarayıcı', 'v=tarayici', '.ui-vtable', /Tarama tamamlandı: \d+ sembolden \d+/],
  ['Sembol Masası', 'v=sembol&s=X001', '.desk__health', /X001 hazır: \d+ bar/],
  ['Karşılaştır', 'v=karsilastir&cmp=X001,X002,X003', '.compare__matrix', /Korelasyon hazır/],
  [
    'Strateji Laboratuvarı',
    'v=laboratuvar&s=X001',
    '.lab__stats',
    /Backtest tamamlandı: \d+ işlem/,
  ],
  ['Stratejiler', 'v=stratejiler', '.rank__table', /Strateji sıralaması hazır: \d+ strateji/],
  ['Model', 'v=model&s=X001', '.model__verdict', /Model eğitimi tamamlandı\. Hüküm:/],
  ['Rapor', 'v=rapor&s=X001', '.report__sheet', /X001 raporu hazır: \d+ bar/],
];

for (const [name, query, ready, pattern] of DUYURU) {
  test(`${name}: sonuç canlı bölgede duyuruluyor`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { timeout: 90_000 });

    // Duyuru gecikmeli yayımlanıyor (ara sonuçlar okunmasın diye).
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              Array.from(document.querySelectorAll('main [role="status"]'))
                .map((el) => el.textContent?.trim() ?? '')
                .filter(Boolean),
            )
          ).join(' || '),
        { timeout: 15_000 },
      )
      .toMatch(pattern);
  });
}
