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
  // KISA TELEFON ayrı bir ölçü ve bu bilerek: dikey taşma kusuru en sert
  // burada çıktı. 390×780'de panel 208 px, 360×640'ta 1.397 px sarkıyordu.
  { ad: 'kısa telefon', width: 360, height: 640 },
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
              ust: Math.round(r.top),
              alt: Math.round(r.bottom),
              pencere: window.innerWidth,
              pencereY: window.innerHeight,
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
        /*
          DİKEY EKSEN. Denetim bir süre YALNIZCA yatay bakıyordu ve tam o
          kör noktada bir kusur yaşadı: yerleştirme yalnızca "altta yer yoksa
          ve üstte TAM sığıyorsa yukarı dön" diyordu; ikisine de sığmayan
          panel aşağıda kalıp ekranın dışına sarkıyordu. Yatayda kenetleme
          vardı, dikeyde yoktu.
        */
        expect(
          k.ust,
          `${olcu.ad}: katman ekranın üstünden taşıyor — ${k.ad}`,
        ).toBeGreaterThanOrEqual(-1);
        expect(k.alt, `${olcu.ad}: katman ekranın altından taşıyor — ${k.ad}`).toBeLessThanOrEqual(
          k.pencereY + 1,
        );
      }
    }
  });
}

/*
  SINIRA DAYANAN KATMAN KAYDIRILABİLMELİ.

  Yukarıdaki denetim panelin ekrana SIĞDIĞINI ölçüyor ve sığdırmanın yolu
  yüksekliği sınırlayıp içeriği kaydırılabilir yapmak. Ama "kaydırılabilir
  görünmek" ile "gerçekten kaydırılmak" aynı şey değil ve tam oradan bir
  kusur çıktı: yerleştirme, DOĞAL yüksekliği ölçmek için sınırı bir an
  kaldırıyordu; sınır kalkınca taşma da kalkıyor ve tarayıcı `scrollTop`'u
  0'a kenetliyor. Panelin kendi kaydırması `capture` dinleyicisiyle
  yerleştirmeyi tetiklediği için kullanıcı her kaydırışında liste başa
  sarıyordu — filtre paneli ve sütun listesi aşağı kaydırılamıyordu.

  Ölçüm en dar ekranda: taşmanın kesin olduğu yer orası.
*/
for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: sınıra dayanan katman gerçekten kaydırılıyor`, async ({ page }) => {
    await page.setViewportSize(OLCULER[2]);
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });
    await page.waitForTimeout(250);

    const olcum = await page.evaluate(async () => {
      const panel = [
        ...document.querySelectorAll<HTMLElement>('.ui-popover__panel'),
      ].find((el) => el.offsetWidth > 0 && el.scrollHeight > el.clientHeight + 1);
      if (!panel) return null;
      const hedef = Math.min(120, panel.scrollHeight - panel.clientHeight);
      panel.scrollTop = hedef;
      // `scroll` olayının ve tetiklediği yeniden yerleştirmenin bitmesi için.
      await new Promise((r) => setTimeout(r, 300));
      return { hedef, sonra: panel.scrollTop };
    });

    // Taşmayan panel bu denetimin konusu değil.
    test.skip(olcum === null, 'bu ekranda sınıra dayanan katman yok');
    expect(olcum!.sonra, 'katman kaydırıldıktan sonra başa sarıyor').toBeGreaterThan(
      olcum!.hedef - 2,
    );
  });
}
