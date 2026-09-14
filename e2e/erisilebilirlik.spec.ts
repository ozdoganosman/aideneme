import { expect, test } from '@playwright/test';

/**
 * Ekran genelinde erişilebilirlik denetimi.
 *
 * Lint kuralları "etiket var mı" diye bakar; bu test "etiket AYIRT EDİCİ mi"
 * diye bakar. Sekiz satırda sekiz kez "Laboratuvarda aç" duyan bir ekran
 * okuyucu kullanıcısı hangisinin hangi strateji olduğunu bilemez — lint bunu
 * göremez, çünkü teknik olarak hepsi etiketlidir.
 */

const SCREENS: [string, string, string][] = [
  ['Nabız', 'v=nabiz', '.pulse__flows'],
  ['Tarayıcı', 'v=tarayici', '.ui-vtable'],
  ['Sembol Masası', 'v=sembol&s=X001', '.desk__health'],
  ['Karşılaştır', 'v=karsilastir&cmp=X001,X002,X003', '.compare__matrix'],
  ['Strateji Laboratuvarı', 'v=laboratuvar&s=X001', '.lab__stats'],
  ['Stratejiler', 'v=stratejiler', '.rank__table'],
  ['Model', 'v=model&s=X001', '.model__verdict'],
  ['Portföy', 'v=portfoy', '.ui-field'],
  ['Rapor', 'v=rapor&s=X001', '.report__sheet'],
];

for (const [name, query, ready] of SCREENS) {
  test(`${name}: etiketler eksiksiz ve ayırt edici`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
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
        adsizGiris: all('input, select, textarea').filter((el) => {
          if (!visible(el)) return false;
          const labelled =
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
            el.getAttribute('aria-label') ||
            el.closest('label');
          return !labelled;
        }).length,
        tekrar: [...counts.entries()].filter(([, c]) => c > 1).map(([n, c]) => `${n} ×${c}`),
      };
    });

    // Her ekranın tek ve doğru bir h1'i olmalı.
    expect(audit.h1).toEqual([name]);
    expect(audit.adsizDugme, 'adsız düğme').toBe(0);
    expect(audit.adsizGiris, 'etiketsiz giriş alanı').toBe(0);
    expect(audit.tekrar, 'aynı ada sahip düğmeler ayırt edilemez').toEqual([]);
  });
}
