import { ileriGetiri, kesZaman } from '../data/kes';
import type { Candles } from '../data/types';
import { metricsFor, type MetricDef, type ScreenParams, type ScreenRow } from './metrics';

/**
 * FİLTRE ZAMAN MAKİNESİ — "bu filtre o gün ne bulurdu, bulduğu ne yaptı?"
 *
 * Kullanıcının kurduğu radar filtresini geçmiş bir güne kurar: her sembolün
 * serisi o güne kadar KESİLİR, ölçütler o kesik seriden hesaplanır, sonra o
 * günden sembolün son barına getiri ayrı bir ölçüt olarak satıra yazılır.
 * Radar bu satırlara kendi kurallarını olduğu gibi uygular — yani filtre
 * geçmişte de aynı filtredir; ayrı bir motor yok.
 *
 * BU BİR BACKTEST DEĞİL ve öyle okunmamalı. Üç sınır, üçü de ekranda yazılı:
 *
 *  1. TEK TARİH, TEK PENCERE. Bir strateji yüzlerce giriş/çıkış üzerinden
 *     ölçülür; burada tek bir gün ve o günden bugüne tek bir getiri var.
 *     Bir günde iyi görünen filtre başka bir günde kötü görünebilir.
 *  2. HAYATTA KALMA YANLILIĞI. Paket yalnızca BUGÜN kote olan sembolleri
 *     taşıyor. O gün var olup sonra silinen bir hisse burada hiç yok — yani
 *     en kötü sonuçlar evrenden çıkmış durumda. Getiri gerçekten fazla
 *     iyimser olabilir ve bunu düzeltecek veri elimizde yok.
 *  3. TEMEL VERİ GEÇMİŞE GİDEMEZ. Elimizdeki F/K bugünün F/K'sı; onu altı ay
 *     öncesine uygulamak geleceği görmek olur. Zaman makinesinde temel
 *     ölçütlü kurallar bu yüzden uygulanmıyor ve arayüz bunu söylüyor.
 *
 * Neden yine de değerli: "en doğru filtre hangisi" sorusunu strateji
 * motorunu geri getirmeden sınamanın en ucuz yolu bu. Sayının ne olduğunu
 * ve ne OLMADIĞINI birlikte söylediğimiz sürece.
 */

/** İleri getirinin ölçüt kimliği — radar sütun/sıralama olarak bunu kullanır. */
export const ILERI_GETIRI_ID = 'ileriGetiri';

export const ILERI_GETIRI_TANIMI: MetricDef = {
  id: ILERI_GETIRI_ID,
  label: 'İleri getiri',
  unit: 'pct',
  signed: true,
  decimals: 2,
  formula: () =>
    'Seçilen günün kapanışından sembolün SON barına yüzde değişim. ' +
    'Sembol o günden sonra işlem görmediyse tanımsız.',
};

/**
 * Bir sembolün `tCut` itibarıyla tarama satırı + ileri getirisi.
 *
 * Kesik seride ölçüm yapılamıyorsa (iki bardan az) null — bugünkü taramadaki
 * kuralla aynı; o sembol o gün evrende yoktu demek.
 */
export function zamanMakinesiSatiri(
  symbol: string,
  c: Candles,
  tCut: number,
  params: ScreenParams,
): ScreenRow | null {
  const gecmis = kesZaman(c, tCut);
  const row = metricsFor(symbol, gecmis, params);
  if (!row) return null;
  row.values[ILERI_GETIRI_ID] = ileriGetiri(c, tCut);
  return row;
}

/**
 * Bulunan kümenin ve evrenin ileri getiri özeti — "filtre işe yaradı mı".
 *
 * MEDYAN, ortalama değil: tek bir on katına çıkan hisse ortalamayı sürükler,
 * medyanı sürüklemez. Kıyas ölçütü tüm evren: "filtrem %8 kazandırdı" tek
 * başına bir şey söylemez, o gün her şey %12 yükseldiyse filtre kaybettirmiş.
 *
 * NaN'lar sayıma girmiyor ve kaç tane olduğu söyleniyor — ölçülemeyen
 * sembol "sıfır getirdi" sayılmaz.
 */
export interface IleriOzet {
  /** Ölçülebilen sembol sayısı. */
  n: number;
  /** İleri getirisi ölçülemeyen (NaN) sembol sayısı. */
  olculemeyen: number;
  medyan: number;
  /** Sıfırın üstünde kalanların payı, 0..1. */
  kazananPay: number;
}

export function ileriOzet(rows: ScreenRow[]): IleriOzet {
  const d: number[] = [];
  let olculemeyen = 0;
  for (const r of rows) {
    const v = r.values[ILERI_GETIRI_ID];
    if (Number.isFinite(v)) d.push(v);
    else olculemeyen++;
  }
  if (d.length === 0) return { n: 0, olculemeyen, medyan: Number.NaN, kazananPay: Number.NaN };
  d.sort((a, b) => a - b);
  const m = d.length >> 1;
  const medyan = d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
  const kazanan = d.filter((v) => v > 0).length;
  return { n: d.length, olculemeyen, medyan, kazananPay: kazanan / d.length };
}
