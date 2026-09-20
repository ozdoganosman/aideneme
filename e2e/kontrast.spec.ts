import { expect, test } from '@playwright/test';
import { denetimEkranlari, type Ekran } from './ekranlar';

/**
 * Metin kontrastı (WCAG AA).
 *
 * Lint ve etiket denetimleri rengi göremez. Ölçüm yapılınca ikincil metin
 * tokenı her iki temada da eşiğin ALTINDA çıktı (açık 3,98 · koyu 4,27;
 * gerek 4,5) — yani ürünün "neden böyle" anlatan yazısının çoğu okunaklı
 * değildi. Anlam renkleri (yükseliş/düşüş/uyarı) ve koyu temada birincil
 * düğme de eşiği tutturmuyordu.
 */

/**
 * Ekran listesi — bazıları AÇILMASI gereken yüzeyler.
 *
 * Denetimin kör noktası buydu: radar, finansal sekmesi, sektör paneli ve
 * rotasyon görünümü varsayılan olarak KAPALI. Adrese gidip beklemek onları
 * hiç görmüyor — daha önce finansallar sekmesinde 12 karttan 8'i tam bu
 * yüzden denetimsiz kalmıştı. `ac` verilen satırlarda denetim yüzeyi önce
 * açıyor.
 */

const SCREENS: Ekran[] = denetimEkranlari('kontrast');

/** Sayfada çalışır: her metin düğümünün rengini zeminine karşı ölçer. */
const AUDIT = () => {
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  // Zemin: saydam olmayan ilk ata. Yarı saydam katmanlar karıştırılmıyor —
  // ölçüm iyimser tarafta kalsın, yanlış alarm üretmesin.
  const bgOf = (el: Element) => {
    let node: Element | null = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.9) return c.rgb;
      node = node.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  };

  const bad: string[] = [];
  /*
    KÖK: `body`, kabuk bölgeleri DEĞİL.

    Önceki kök `.shell-content, .shell-topbar, .shell-rail` idi ve açılır
    panellerin HİÇBİRİNİ görmüyordu: `Popover`, `Dialog` ve `Sheet`
    içeriklerini `createPortal` ile doğrudan `body`ye asıyor. Yani radarın
    filtre paneli, sektör rozetleri, hazır filtreler ve sütun seçici bu
    denetimden bugüne kadar hiç geçmemiş — üstelik `sembol:radar-filtre`
    girdisi TAM OLARAK o paneli denetlemek için eklenmişti ve boşuna geçiyordu.

    Ölçülerek bulundu: `.radar__gosterge-ad` rengi bilerek #b9b9b9 yapıldı
    (açık temada 1,9:1), denetim yine "geçti" dedi.

    `body` kökü güvenli, çünkü eleme zaten aşağıda yapılıyor: kendi metni
    olmayan, görünmeyen ve saydam öğeler atlanıyor.
  */
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    if (!own) continue;
    if (!(el as HTMLElement).offsetParent && el.getClientRects().length === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.opacity === '0') continue;
    const fg = parse(st.color);
    if (!fg || fg.a < 0.9) continue;
    const size = parseFloat(st.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg.rgb, bgOf(el));
    if (r < need) bad.push(`${r.toFixed(2)}<${need} "${own.slice(0, 24)}" (${st.color})`);
  }
  return [...new Set(bad)];
};

for (const tema of ['light', 'dark'] as const) {
  test.describe(`${tema} tema`, () => {
    test.use({ colorScheme: tema });
    for (const ekran of SCREENS) {
      test(`${ekran.ad}: metin kontrastı AA`, async ({ page }) => {
        await page.goto(`/next.html?m=bist&${ekran.url}`, { waitUntil: 'networkidle' });
        if (ekran.ac) await ekran.ac(page);
        await page.waitForSelector(ekran.hazir, { timeout: 90_000 });
        await page.waitForTimeout(300);
        expect(await page.evaluate(AUDIT), 'WCAG AA altında kalan metin').toEqual([]);
      });
    }
  });
}
