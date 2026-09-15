import { expect, test } from '@playwright/test';
import { denetimEkranlari, type Ekran } from './ekranlar';

/**
 * KATMAN DENETİMİ — popover ve diyalog panelleri.
 *
 * Neden ayrı bir denetim: katmanlar belge akışının DIŞINDA. Panel gövdeye
 * taşınıyor ve `position: fixed` ile duruyor, yani belgenin genişliğine hiç
 * dokunmuyor. Mobil denetiminin ölçtüğü şey `documentElement.scrollWidth`;
 * o ölçüm katmanları GÖREMİYOR.
 *
 * Kör noktada gerçek bir kusur yaşadı: radar filtre panelinin çocuğu 360 px
 * genişlik istiyordu, popover'ın 360 px'lik sınırı ise DOLGUYU içeriyordu
 * (border-box). Panel kendi içinde 14 px yatay kayıyordu — scrollWidth 372,
 * clientWidth 358 — ve sağ kenarı kırpılmış duruyordu. Gerçek veride gözle
 * ölçüldü; beş denetimin hiçbiri göremiyordu.
 *
 * İKİ GENİŞLİKTE birden ölçülüyor ve bu bilerek: kusur yalnızca MASAÜSTÜNDE
 * görünüyordu. Telefonda `78vw` = 304 px olduğu için panel sınıra hiç
 * dayanmıyordu. Tek genişlikte ölçen bir denetim bu kusuru kaçırırdı —
 * nitekim önce mobil denetimine eklemiştim, geri alma denemesi testin
 * kusuru YAKALAMADIĞINI gösterdi.
 */

const OLCULER = [
  { ad: 'masaüstü', width: 1500, height: 950 },
  { ad: 'telefon', width: 390, height: 780 },
];

const SCREENS: Ekran[] = denetimEkranlari('katman');

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: açık katmanlar ekrana sığıyor`, async ({ page }) => {
    await page.setViewportSize(OLCULER[0]);
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });

    for (const olcu of OLCULER) {
      await page.setViewportSize(olcu);
      // Katman konumu `resize` olayında yeniden hesaplanıyor; ölçümden önce
      // o hesabın bitmesi gerekiyor.
      await page.waitForTimeout(250);

      const katmanlar = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.ui-popover__panel, .ui-dialog, .ui-sheet, [role="dialog"]',
          ),
        ]
          .filter((el) => el.offsetWidth > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              ad: el.className || el.tagName,
              kayma: el.scrollWidth - el.clientWidth,
              sol: Math.round(r.left),
              sag: Math.round(r.right),
              pencere: window.innerWidth,
            };
          }),
      );

      for (const k of katmanlar) {
        expect(
          k.kayma,
          `${olcu.ad}: katman kendi içinde yatay kayıyor — ${k.ad}`,
        ).toBeLessThanOrEqual(1);
        expect(
          k.sol,
          `${olcu.ad}: katman ekranın solundan taşıyor — ${k.ad}`,
        ).toBeGreaterThanOrEqual(-1);
        expect(k.sag, `${olcu.ad}: katman ekranın sağından taşıyor — ${k.ad}`).toBeLessThanOrEqual(
          k.pencere + 1,
        );
      }
    }
  });
}
