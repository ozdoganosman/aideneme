import { expect, test } from '@playwright/test';

/**
 * Klavye gezintisi.
 *
 * Fareyle çalışan bir arayüz klavyeyle çalışmayabilir ve bu birim testlerinden
 * görünmez: odak sırası, atlama bağlantısı ve tuzaklar ancak gerçek bir
 * tarayıcıda ortaya çıkar.
 */

const SCREENS: [string, string, string][] = [
  ['Nabız', 'v=nabiz', '.pulse__flows'],
  ['Tarayıcı', 'v=tarayici', '.ui-vtable'],
  ['Sembol Masası', 'v=sembol&s=X001', '.desk__chart'],
  ['Strateji Laboratuvarı', 'v=laboratuvar&s=X001', '.lab__stats'],
  ['Stratejiler', 'v=stratejiler', '.rank__table'],
  ['Rapor', 'v=rapor&s=X001', '.report__sheet'],
];

for (const [name, query, ready] of SCREENS) {
  test(`${name}: klavyeyle gezilebiliyor`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(300);

    // İlk sekme durağı "içeriğe atla" olmalı: klavye kullanıcısı her sayfada
    // önce menüyü baştan geçmek zorunda kalmasın.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText(/İçeriğe atla/);

    // 40 sekme boyunca odak ilerlemeli ve sayfada kalmalı (tuzak yok).
    //
    // Kimlik METİNDEN değil ÖĞEDEN türetiliyor: iki farklı onay kutusu aynı
    // metni taşıyabilir (adları sarmalayan <label>'dan gelir) ve metne bakan
    // bir ölçüt bunu "odak sıkıştı" sanır — ilk yazımda tam bu oldu.
    const stops: number[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return -1;
        const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
        return all.indexOf(el);
      });
      if (id < 0) break;
      stops.push(id);
    }

    expect(stops.length, 'odaklanabilir öğe bulunamadı').toBeGreaterThan(5);
    // Aynı ÖĞEDE sıkışma: art arda on kez aynı öğe = tuzak.
    const stuck = stops.some((s, i) => i >= 9 && stops.slice(i - 9, i + 1).every((x) => x === s));
    expect(stuck, 'odak aynı öğede sıkıştı').toBe(false);
    // Duraklar ilerlemeli: en az yarısı birbirinden farklı olmalı.
    expect(new Set(stops).size).toBeGreaterThan(stops.length / 2);
  });
}
