import { INDIKATOR_ILE, parametreSinirla } from '../indicators/kayit';
import { HESAPLAR } from '../indicators/kayitHesap';
import type { Candles } from '../data/types';
import type { OlcutIstegi } from './indikatorOlcut';

/**
 * GÖSTERGE ÖLÇÜTLERİNİN HESABI — yalnızca worker'dan çağrılıyor.
 *
 * `indikatorOlcut.ts`'ten AYRI duruyor çünkü `HESAPLAR` bütün gösterge
 * matematiğini içeri çekiyor. Aynı ayrım `kayit.ts` / `kayitHesap.ts` arasında
 * da var ve orada ölçüldü: tek dosya olduğunda Sembol Masası paketi 11,2 →
 * 30,1 kB büyümüş, zayıf makinede açılış 1501 → 1731 ms'ye çıkmıştı.
 *
 * Alınan değer SON BARINKİ: radar "bugün bu hisse nerede" sorusunu soruyor.
 *
 * Isınma NaN kalıyor ve bilerek öyle bırakılıyor. 60 barlık bir sembolde
 * "EMA 200" ölçülemez; sıfır ya da son geçerli değer yazmak o sembolü
 * ölçülmüş gibi gösterirdi. NaN hiçbir kuralı geçmediği için sembol elenir ve
 * radarın "ölçülemedi" özeti bunu KAÇ sembolde olduğuyla birlikte söyler.
 */
export function gostergeDegerleri(c: Candles, istekler: OlcutIstegi[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = c.length;
  if (n === 0) return out;
  for (const istek of istekler) {
    const t = INDIKATOR_ILE.get(istek.id);
    const hesap = HESAPLAR[istek.id];
    // Bilinmeyen kimlik: sessizce atlanıyor. Eski bir tercihten gelen ölçüt
    // artık kayıtta olmayabilir; bu, taramayı çökertecek bir durum değil.
    if (!t || !hesap) continue;
    const p = parametreSinirla(t, istek.parametreler);
    let seriler: Float64Array[];
    try {
      seriler = hesap(c, p);
    } catch {
      continue;
    }
    const ciktilar = t.ciktilar(p);
    for (let k = 0; k < ciktilar.length; k++) {
      const s = seriler[k] as Float64Array | undefined;
      out[`${istek.anahtar}:${ciktilar[k].ad}`] = s && s.length === n ? s[n - 1] : NaN;
    }
  }
  return out;
}
