import { inflationDailyRates } from '../data/inflation';

const DAY = 86400;

/**
 * İki tarih arasındaki birikimli TÜFE çarpanı (1,42 = fiyatlar %42 arttı).
 *
 * TL portföyünde nominal getiri tek başına yanıltıcıdır: %60 kazanç, %65
 * enflasyonda satın alma gücü KAYBIDIR. Reel getiri bu çarpanla düzeltilir.
 */
export function inflationFactor(fromUnix: number, toUnix: number): number {
  if (!(toUnix > fromUnix)) return 1;
  const days = Math.max(1, Math.round((toUnix - fromUnix) / DAY));
  const time = new Float64Array(days);
  for (let i = 0; i < days; i++) time[i] = fromUnix + i * DAY;

  const rates = inflationDailyRates(time, days);
  let factor = 1;
  for (let i = 0; i < days; i++) factor *= 1 + rates[i];
  return factor;
}

/** Nominal getiriyi (%) reel getiriye çevirir. */
export function realReturnPct(nominalPct: number, fromUnix: number, toUnix: number): number {
  const factor = inflationFactor(fromUnix, toUnix);
  if (!(factor > 0)) return NaN;
  return ((1 + nominalPct / 100) / factor - 1) * 100;
}

/** Reel hesaplarda bir maliyet lotu: ne kadar para, ne zaman bağlandı. */
export interface MaliyetLotu {
  /** Lotun toplam maliyeti (komisyon dahil). */
  cost: number;
  /** Paranın bağlandığı tarih — unix saniye. */
  date: number;
}

/**
 * SATIN ALMA GÜCÜ CİNSİNDEN maliyet: her lot KENDİ tarihinden düzeltilir.
 *
 * Neden gerekli: reel getiri, portföyün tamamını İLK işlem tarihinden
 * düşürüyordu. Gerçek veriyle ölçtüm — 15 Ocak 2025'te THYAO, 10 Mart
 * 2025'te GARAN alınan bir portföyde tek tarihli hesap reel getiriyi
 * -%18,6, lot bazlı hesap -%17,1 veriyordu. 1,5 puanlık fark ve YÖNÜ
 * sistematik: sonradan eklenen para baştan beri enflasyona maruz sayıldığı
 * için kayıp HER ZAMAN abartılıyordu.
 *
 * Tarih başına TÜFE çarpanı bir kez hesaplanıyor: aynı gün bağlanan iki lot
 * aynı çarpanı paylaşıyor.
 */
export function realCostBasis(lots: readonly MaliyetLotu[], toUnix: number): number {
  const carpan = new Map<number, number>();
  let toplam = 0;
  for (const lot of lots) {
    if (!(lot.cost > 0)) continue;
    const gun = Math.round(lot.date);
    let f = carpan.get(gun);
    if (f === undefined) {
      f = inflationFactor(gun, toUnix);
      carpan.set(gun, f);
    }
    toplam += lot.cost * f;
  }
  return toplam;
}

/**
 * Lotlara göre reel getiri (%): bugünkü değer, satın alma gücü cinsinden
 * maliyete bölünür. Maliyet yoksa sonuç ÜRETİLMEZ (sıfıra bölme değil NaN).
 */
export function realReturnOfLots(
  currentValue: number,
  lots: readonly MaliyetLotu[],
  toUnix: number,
): number {
  const taban = realCostBasis(lots, toUnix);
  if (!(taban > 0) || !Number.isFinite(currentValue)) return NaN;
  return (currentValue / taban - 1) * 100;
}
