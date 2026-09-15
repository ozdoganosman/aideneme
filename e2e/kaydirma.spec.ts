import { expect, test } from '@playwright/test';
import { denetimEkranlari, type Ekran } from './ekranlar';

/**
 * KAYDIRMA DENETİMİ — "kaydırılabilirim" diyen her yüzey GERÇEKTEN kayıyor mu.
 *
 * Neden ayrı bir denetim: mevcut denetimler yerleşimi ölçüyor — panel ekrana
 * sığıyor mu, satır taşıyor mu. Ama dar ekranda sığdırmanın YOLU içeriği
 * kaydırılabilir yapmak; yani "sığıyor" raporu, içeriğin okunabildiğinin
 * değil, kaydırmaya DEVREDİLDİĞİNİN kanıtı. Kaydırma çalışmıyorsa sığan
 * panel de okunamaz.
 *
 * Kör noktada gerçek bir kusur yaşadı ve kullanıcı bildirdi: filtre paneli ve
 * sütun listesi aşağı kaydırılamıyordu. Yerleştirme, doğal yüksekliği ölçmek
 * için yükseklik sınırını bir an kaldırıyordu; sınır kalkınca taşma da
 * kalkıyor ve tarayıcı `scrollTop`'u 0'a kenetliyor. Beş denetimin hiçbiri
 * göremiyordu, çünkü hepsi panelin SIĞDIĞINI doğruluyordu — ki sığıyordu.
 *
 * Ölçüt: `overflow-y` değeri `auto`/`scroll` OLAN ve içeriği taşan her öğe.
 * Böyle bir öğe kaydırılabilir olduğunu İDDİA ediyor; iddia sınanıyor.
 * `overflow: hidden` olanlar kapsam dışı — onlar bir şey iddia etmiyor.
 */

const OLCULER = [
  { ad: 'masaüstü', width: 1500, height: 950 },
  // Dar ekran ayrı: taşma asıl burada oluşuyor, yani kaydırmaya devredilen
  // içerik de burada en çok.
  { ad: 'kısa telefon', width: 360, height: 640 },
];

const SCREENS: Ekran[] = denetimEkranlari('kaydirma');

for (const { ad: name, url: query, hazir: ready, ac } of SCREENS) {
  test(`${name}: kaydırılabilir yüzeyler gerçekten kayıyor`, async ({ page }) => {
    await page.setViewportSize(OLCULER[0]);
    await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
    if (ac) await ac(page);
    await page.waitForSelector(ready, { timeout: 90_000 });

    for (const olcu of OLCULER) {
      await page.setViewportSize(olcu);
      await page.waitForTimeout(250);

      const kusurlar = await page.evaluate(async () => {
        const kaydirilabilir = [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
          const o = getComputedStyle(el).overflowY;
          return (
            (o === 'auto' || o === 'scroll') &&
            el.scrollHeight > el.clientHeight + 1 &&
            el.offsetWidth > 0 &&
            el.offsetHeight > 0
          );
        });
        const bozuk: { ad: string; hedef: number; sonra: number }[] = [];
        for (const el of kaydirilabilir) {
          const basla = el.scrollTop;
          const hedef = Math.min(basla + 80, el.scrollHeight - el.clientHeight);
          if (hedef <= basla) continue;
          el.scrollTop = hedef;
          // Kaydırmayı geri alan bir iş varsa (yeniden yerleştirme, odak
          // geri getirme) olay döngüsünde çalışır; ölçüm ondan SONRA.
          await new Promise((r) => setTimeout(r, 250));
          if (el.scrollTop < hedef - 2) {
            bozuk.push({
              ad: `${el.tagName.toLowerCase()}.${el.className || '(sınıfsız)'}`.slice(0, 90),
              hedef,
              sonra: el.scrollTop,
            });
          }
          el.scrollTop = basla;
        }
        return bozuk;
      });

      expect(
        kusurlar,
        `${olcu.ad}: kaydırılabilir olduğunu söyleyen yüzey kaymıyor — ${JSON.stringify(kusurlar)}`,
      ).toEqual([]);
    }
  });
}
