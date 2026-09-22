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
/*
  ZOR SEMBOLLERLE KOŞMAK — ve bilinen tek sınırı.

  Kapı açıldıktan sonra suite kısa geçmişli GERÇEK sembollerle de koşturuldu
  (ISKUR, GENKM, AKHAN). Sonuç ürün adına iyi: ISKUR'un finansal tablosu
  kaynakta yok ve sektörü sınıflandırılmamış; ekran ikisinde de doğru olanı
  yapıyor — "'tablo yok' değil, 'bizde yok'" ve "Rastgele bir grup göstermek
  yerine boş bırakıldı" diyen boş durumlar çiziyor. Denetimler o yüzeyleri
  görmüyordu; artık görüyor (bkz. ekranlar.ts, `.ui-empty`).

  BİLİNEN SINIR: `klavye` denetimi böyle bir sembolde finansallar ve sektör
  sekmelerinde düşüyor. Sebebi kusur değil — bilgilendirme amaçlı boş durumun
  odaklanabilir öğesi yok, sekme düğmesinden sonraki Tab sayfadan çıkıyor ve
  denetimin ">5 durak" beklentisi karşılanmıyor. Odak TUZAĞA düşmüyor, ki
  denetimin asıl koruduğu şey o. Denetimi bu uç hâl için gevşetmek, normal
  ekranlardaki gerçek bir "odaklanacak şey yok" gerilemesini de yutardı;
  bu yüzden gevşetilmedi, yazıldı.
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
