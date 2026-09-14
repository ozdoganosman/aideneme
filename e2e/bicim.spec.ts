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

const SCREENS: [string, string, string][] = [
  ['Nabız', 'v=nabiz', '.pulse__flows'],
  ['Tarayıcı', 'v=tarayici', '.ui-vtable'],
  ['Sembol Masası', 'v=sembol&s=X001', '.desk__health'],
  ['Karşılaştır', 'v=karsilastir&cmp=X001,X002,X003', '.compare__matrix'],
  ['Laboratuvar', 'v=laboratuvar&s=X001', '.lab__stats'],
  ['Stratejiler', 'v=stratejiler', '.rank__table'],
  ['Model', 'v=model&s=X001', '.model__verdict'],
  ['Rapor', 'v=rapor&s=X001', '.report__sheet'],
];

for (const [name, query, ready] of SCREENS) {
  test(`${name}: sayılar Türkçe biçimde`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
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
      // Sondan yüzde: rakamdan hemen sonra gelen % işareti. DİKKAT: iki
      // doğru yazılmış yüzde yan yana gelince ("-%2,37 %18") araya düşen
      // "7 %" yanlış alarm üretiyordu — işaretin ardından rakam geliyorsa
      // o zaten bir sonraki sayının başıdır.
      const sondanYuzde = [...text.matchAll(/\d\s?%(?!\d)/g)].map((m) => m[0]);
      return { ondalik: [...new Set(ondalik)], sondanYuzde: [...new Set(sondanYuzde)] };
    });

    expect(bulgular.ondalik, 'ondalık ayırıcı virgül olmalı').toEqual([]);
    expect(bulgular.sondanYuzde, 'yüzde işareti sayıdan önce gelmeli').toEqual([]);
  });
}
