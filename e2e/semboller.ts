/**
 * ÖLÇÜLECEK SEMBOLLER — tek kapı.
 *
 * Bu oturumda aynı ders ÜÇ KEZ öğrenildi ve her seferinde yalnızca o anki
 * dosya düzeltildi:
 *
 *   1. `scripts/measure-perf.mjs` sabit `X001` yazıyordu; araç yayındaki
 *      gerçek veride hiç çalışmıyor, 120 saniye bekleyip düşüyordu.
 *   2. `e2e/ekranlar.ts` aynı kusuru taşıyordu; denetimler yalnızca örnek
 *      veriyle koşabiliyordu.
 *   3. Geriye kalan altı spec dosyası (akışlar, grafik, indikatör, klavye,
 *      erişilebilirlik, ölçüm) HÂLÂ sabit yazıyordu. Ölçüldü: gerçek BIST
 *      verisiyle koşulduğunda 17 test düşüyor ve hepsinin sebebi aynı —
 *      `X001` orada yok, grafik hiç çizilmiyor, `waitForSelector` 90 saniye
 *      bekleyip zaman aşımına giriyor.
 *
 * Üçüncüsü asıl önemli olanı: testler gerçek veride KOŞAMIYORDU. Oysa bu
 * oturumda örnek verinin kusurları gizlediği defalarca ölçüldü — bar sayıları
 * örnekte hep aynı, gerçekte 18–3650; grafik hatası yalnızca gerçek veride
 * görünmüştü. Yani güvenlik ağının tam da en çok gerektiği yerde deliği vardı.
 *
 * Çözümü dosya dosya tekrarlamak kusuru dördüncü kez üretirdi. Kapı artık
 * TEK:
 *
 *   E2E_SEMBOL=THYAO,GARAN,ASELS npx playwright test
 */
export const SEMBOLLER: string[] = (process.env.E2E_SEMBOL ?? 'X001,X002,X003').split(',');

/** Birinci sembol — tek sembollü ekranlar bunu kullanıyor. */
export const SEMBOL = SEMBOLLER[0];
/** İkinci/üçüncü sembol; verilmediyse birinciye düşüyor. */
export const SEMBOL2 = SEMBOLLER[1] ?? SEMBOLLER[0];
export const SEMBOL3 = SEMBOLLER[2] ?? SEMBOLLER[0];

/** `{SEMBOL}`, `{SEMBOL2}`, `{SEMBOL3}` yer tutucularını çözer. */
export function coz(url: string): string {
  return url
    .replaceAll('{SEMBOL2}', SEMBOL2)
    .replaceAll('{SEMBOL3}', SEMBOL3)
    .replaceAll('{SEMBOL}', SEMBOL);
}
