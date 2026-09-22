import type { Bundle } from '../data/pack';
import type { PulseRow } from './pulse';

/**
 * PARA AKIŞI OYNATICISI — son N günün her biri için sembol başına işlem değeri
 * ve günlük değişim, GÜN EKSENİNE HİZALI.
 *
 * Nabız'daki sektör haritası tek bir kare: bugün. Soru ("para hangi
 * endüstriye göçüyor?") ise bir HAREKET sorusu; tek kare hareketi göstermez.
 * Bu modül son N günün karelerini üretiyor; arayüz onları kaydırıcıyla
 * gezdiriyor ya da oynatıyor.
 *
 * HİZALAMA ZORUNLU, TERCİH DEĞİL. `seriesOf` her sembolü kendi sonlu
 * kapanışlarına sıkıştırıyor; oradan "sondan d. bar" alınsa boşluğu olan
 * sembolde başka bir takvim gününe düşer ve aynı karede iki farklı gün
 * toplanır. Bu yüzden paketin HAM ızgarasından okunuyor (`closeAt`,
 * `volumeAt`): satır sembol, sütun ortak gün.
 *
 * Değişim ÖNCEKİ SONLU kapanışa göre — `pulseRow` ile aynı anlam: sembol bir
 * gün işlem görmediyse ertesi günkü değişim iki gün öncesine göre ölçülür,
 * yoksa o gün "değişim yok" sayılırdı.
 *
 * Bir gün işlem görmeyen sembolün o günkü değeri 0 ve değişimi NaN; kare
 * toplanırken böyle satırlar ATLANIYOR (bkz. gunSatirlari) — 0 × NaN = NaN,
 * tek bir sembol bütün sektörü NaN yapardı.
 */
export interface AkisGunleri {
  /** Karelerin günleri (epoch gün), artan; son eleman en yeni gün. */
  gunler: Int32Array;
  semboller: string[];
  /** deger[s * gunSayisi + d] = kapanış × hacim. İşlem yoksa 0. */
  deger: Float32Array;
  /** degisim[s * gunSayisi + d] = önceki sonlu kapanışa göre % değişim; yoksa NaN. */
  degisim: Float32Array;
}

/** Bir kareyi `flowBySector`'ın anladığı satırlara çevirir. */
export type AkisSatiri = Pick<PulseRow, 'symbol' | 'value' | 'changePct'>;

/**
 * Paketten son `gunSayisi` günün karelerini üretir.
 *
 * Değişimin ilk kare için de doğru olması için yürüyüş paketin İLK gününden
 * başlıyor (önceki sonlu kapanışı bulmak için); yalnızca son N gün yazılıyor.
 * 584 sembol × 250 gün = 146 bin hücre — ölçülebilir ama küçük.
 */
export function akisGunleriHesapla(paket: Bundle, gunSayisi: number): AkisGunleri {
  const N = Math.max(1, Math.min(gunSayisi, paket.bars));
  const bas = paket.bars - N;
  const S = paket.names.length;
  const deger = new Float32Array(S * N);
  const degisim = new Float32Array(S * N).fill(Number.NaN);

  for (let si = 0; si < S; si++) {
    let oncekiKapanis = Number.NaN;
    for (let di = 0; di < paket.bars; di++) {
      const k = paket.closeAt(si, di);
      if (!(k > 0)) continue;
      if (di >= bas) {
        const d = di - bas;
        const h = paket.volumeAt(si, di);
        deger[si * N + d] = Number.isFinite(h) && h > 0 ? k * h : 0;
        if (oncekiKapanis > 0) degisim[si * N + d] = (k / oncekiKapanis - 1) * 100;
      }
      oncekiKapanis = k;
    }
  }

  return {
    gunler: paket.days.slice(bas, paket.bars),
    semboller: [...paket.names],
    deger,
    degisim,
  };
}

/** d. karenin satırları; o gün işlem görmeyen ya da değişimi ölçülemeyen sembol atlanır. */
export function gunSatirlari(a: AkisGunleri, d: number): AkisSatiri[] {
  const N = a.gunler.length;
  if (d < 0 || d >= N) return [];
  const out: AkisSatiri[] = [];
  for (let si = 0; si < a.semboller.length; si++) {
    const value = a.deger[si * N + d];
    const changePct = a.degisim[si * N + d];
    if (!(value > 0) || !Number.isFinite(changePct)) continue;
    out.push({ symbol: a.semboller[si], value, changePct });
  }
  return out;
}
