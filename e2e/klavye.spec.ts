import { expect, test } from '@playwright/test';

/**
 * Klavye gezintisi.
 *
 * Fareyle çalışan bir arayüz klavyeyle çalışmayabilir ve bu birim testlerinden
 * görünmez: odak sırası, atlama bağlantısı ve tuzaklar ancak gerçek bir
 * tarayıcıda ortaya çıkar.
 */

type Ekran = {
  ad: string;
  url: string;
  hazir: string;
  /** Varsayılan KAPALI yüzeyler (radar) için açma adımı. */
  ac?: (page: import('@playwright/test').Page) => Promise<void>;
};

const SCREENS: Ekran[] = [
  { ad: 'Nabız', url: 'v=nabiz', hazir: '.pulse__flows' },
  { ad: 'Tarayıcı', url: 'v=tarayici', hazir: '.ui-vtable' },
  { ad: 'Sembol Masası', url: 'v=sembol&s=X001', hazir: '.desk__chart' },
  {
    // Radar üç yeni etkileşim getirdi: sürüklenebilir ayırıcı (ok tuşlarıyla
    // da çalışmalı), filtre ve sütun panelleri. Kapalıyken denetlenmiş
    // sayılmaz — biçim ve erişilebilirlik denetimlerinde aynı kör nokta
    // gerçek kusur çıkarmıştı.
    ad: 'Sembol Masası (radar)',
    url: 'v=sembol&s=X001',
    hazir: '.radar__tablo',
    ac: async (page) => {
      await page.getByText('Radar', { exact: true }).first().click();
      await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
    },
  },
  { ad: 'Strateji Laboratuvarı', url: 'v=laboratuvar&s=X001', hazir: '.lab__stats' },
  { ad: 'Stratejiler', url: 'v=stratejiler', hazir: '.rank__table' },
  { ad: 'Rapor', url: 'v=rapor&s=X001', hazir: '.report__sheet' },
];

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: klavyeyle gezilebiliyor`, async ({ page }) => {
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(300);

    // Atlama bağlantısı YALNIZCA tıklamayla açılmayan ekranlarda sınanıyor.
    //
    // Yüzeyi açmak için tıklamak, tarayıcının "sıradaki sekme nereden devam
    // etsin" işaretini o öğeye taşıyor; `blur()` bile onu geri almıyor
    // (ölçüldü: odak BODY'ye döndü ama Tab yine radar anahtarına gitti).
    // Atlama bağlantısı zaten bir SAYFA sözleşmesi ve aynı ekranın açılmamış
    // hâlinde sınanıyor; burada asıl sınanan şey odak TUZAĞI.
    if (!ac) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveText(/İçeriğe atla/);
    }

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

/**
 * Radarın KENDİ klavye sözleşmesi.
 *
 * Genişlik ayarı fareyle sürüklenerek yapılıyor; yalnızca fareyle ayarlanabilen
 * bir bölme klavye kullanıcısı için erişilemez olurdu. Filtre paneli de
 * klavyeyle açılıp kapanmalı ve Esc ile kapanmalı.
 */
test('Radar: genişlik ok tuşlarıyla, panel Esc ile', async ({ page }) => {
  await page.goto('/next.html?m=bist&v=sembol&s=X001', { waitUntil: 'networkidle' });
  await page.getByText('Radar', { exact: true }).first().click();
  await page.waitForSelector('.radar__tablo', { timeout: 90_000 });

  const ayirici = page.locator('.desk__ayirici');
  await ayirici.focus();
  const once = await page.locator('.desk__radar').evaluate((el) => el.clientWidth);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const sonra = await page.locator('.desk__radar').evaluate((el) => el.clientWidth);
  expect(sonra, 'sola ok radarı genişletmeli').toBeGreaterThan(once);
  // Erişilebilir değer de güncellenmeli; ekran okuyucu ne olduğunu duysun.
  await expect(ayirici).toHaveAttribute('aria-valuenow', String(sonra));

  const filtre = page.getByRole('button', { name: /^Filtre paneli/ });
  await filtre.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.radar__panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.radar__panel')).toHaveCount(0);
});
