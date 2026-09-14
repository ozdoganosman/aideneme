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
