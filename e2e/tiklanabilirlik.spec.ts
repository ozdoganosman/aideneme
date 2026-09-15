import { expect, test } from '@playwright/test';
import { denetimEkranlari, type Ekran } from './ekranlar';

/**
 * TIKLANABİLİRLİK DENETİMİ — "görünüyorum" diyen denetim gerçekten
 * tıklanabiliyor mu.
 *
 * Kaydırma denetiminin kardeşi ve aynı dersten doğdu: mevcut denetimler
 * öğenin VAR olduğunu ve yerine oturduğunu ölçüyor, ama bir düğmenin
 * ekranda görünmesi ona ulaşılabildiği anlamına gelmiyor. Portal ile
 * gövdeye taşınan, `position: fixed` duran bir panel pekâlâ başka bir
 * denetimin üstüne oturabilir; o panel testlerde "ekrana sığıyor" diye
 * yeşil görünürken altındaki düğme tıklanamaz olur.
 *
 * Ölçüt: öğenin MERKEZİNE `elementFromPoint` sorulur. Dönen öğe kendisi ya
 * da bir soyu/atası değilse, araya başka bir şey girmiştir.
 *
 * İki şey bilerek kapsam dışı:
 * - KIRPILMIŞ öğe. Kaydırılabilir kabın dışına kaymış bir düğmenin
 *   dikdörtgeni hâlâ ekranın içinde kalabiliyor (altta footer var) ve
 *   `elementFromPoint` doğal olarak footer'ı döndürüyor. İlk sürümüm bunu
 *   atlamıştı ve tek ürettiği yanlış alarmdı — ölçüldü: kap 62-917, düğme
 *   917'nin altında. Görünmeyen bir denetimin tıklanamaması kusur değil.
 * - AÇIK DİYALOĞUN DIŞI. Modal bir katman açıkken altındaki denetimlerin
 *   örtülmesi doğru davranış; ölçüm en üstteki katmanın içine bakar.
 *
 * Geri alma ile doğrulandı: kabuğa yapay bir tam ekran örtü eklenince
 * denetim gezinme düğmelerini örtülü olarak bildiriyor.
 */

const OLCULER = [
  { ad: 'masaüstü', width: 1500, height: 950 },
  { ad: 'kısa telefon', width: 360, height: 640 },
];

const SCREENS: Ekran[] = denetimEkranlari('katman');

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: görünen denetimler tıklanabiliyor`, async ({ page }) => {
    await page.setViewportSize(OLCULER[0]);
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });

    for (const olcu of OLCULER) {
      await page.setViewportSize(olcu);
      await page.waitForTimeout(250);
      const kusurlar = await page.evaluate(() => {
        const SEC = 'button, a[href], input, select, textarea, [role="button"], [role="tab"]';
        // Açık bir diyalog varsa DIŞINDAKİ denetimlerin örtülmesi doğru
        // davranış; ölçüm yalnızca en üstteki katmanın içine bakar.
        const diyaloglar = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
          (d) => d.offsetWidth > 0,
        );
        const kok: ParentNode = diyaloglar.length ? diyaloglar[diyaloglar.length - 1] : document;
        const bozuk: { ad: string; ustunde: string }[] = [];
        for (const el of [...kok.querySelectorAll<HTMLElement>(SEC)]) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          if (el.hasAttribute('disabled')) continue;
          const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
          const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
          /*
            KIRPAN ATA hesaba katılıyor. İlk sürüm bunu atlıyordu ve tek
            yaptığı yanlış alarm üretmekti: kaydırılabilir kabın altına
            kaymış bir düğmenin dikdörtgeni hâlâ ekranın içinde kalıyor
            (altta footer var), `elementFromPoint` de doğal olarak footer'ı
            döndürüyordu. Ölçüldü — kap 62-917, düğme 917'nin altında, yani
            örtülme değil KIRPILMA. Görünmeyen bir denetimin tıklanamaması
            kusur değil.
          */
          let kirpildi = false;
          for (let a = el.parentElement; a && !kirpildi; a = a.parentElement) {
            const st = getComputedStyle(a);
            if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
            const ar = a.getBoundingClientRect();
            if (x < ar.left || x > ar.right || y < ar.top || y > ar.bottom) kirpildi = true;
          }
          if (kirpildi) continue;
          const ust = document.elementFromPoint(x, y);
          if (!ust) continue;
          if (el.contains(ust) || ust.contains(el)) continue;
          bozuk.push({
            ad: `${el.tagName.toLowerCase()}.${el.className || '?'}`.slice(0, 70),
            ustunde: `${ust.tagName.toLowerCase()}.${(ust as HTMLElement).className || '?'}`.slice(
              0,
              70,
            ),
          });
        }
        return bozuk;
      });
      expect(
        kusurlar,
        `${olcu.ad}: görünen denetim başka bir öğeyle örtülü — ${JSON.stringify(kusurlar.slice(0, 6))}`,
      ).toEqual([]);
    }
  });
}
