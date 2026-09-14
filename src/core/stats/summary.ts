import { inflationAvgAnnual } from '../data/inflation';
import type { Candles } from '../data/types';

/**
 * Özet metrikler — her biri kendi kanıtını taşır.
 *
 * Ürün ilkesi #2 ("her sayı tıklanabilir") burada yapısal: bir metrik yalnızca
 * sayı değil, formülü ve hesaplandığı pencereyi de taşır. UI bunları elle
 * yazmaz, metriğin kendisinden okur — böylece kart ile hesap asla ayrışmaz.
 */

export type Unit = 'pct' | 'price' | 'ratio' | 'volume' | 'years';

export interface Metric {
  key: string;
  label: string;
  /** Ham değer; biçimlendirme UI'ın işi. */
  value: number;
  unit: Unit;
  /** Nasıl hesaplandı (provenance). */
  formula: string;
  /** Hangi veri penceresi kullanıldı. */
  window: string;
  /** Pencereye giren bar sayısı. */
  bars: number;
  /** İşaretine göre renklensin mi (getiri evet, hacim hayır). */
  signed?: boolean;
}

const YEAR_DAYS = 365.25;
const DAY = 86400;

function fmtDay(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** `days` gün öncesine denk gelen ilk bar indeksi (zaman tabanlı, periyottan bağımsız). */
function indexSince(c: Candles, days: number): number {
  const cut = c.time[c.length - 1] - days * DAY;
  let i = c.length - 1;
  while (i > 0 && c.time[i - 1] >= cut) i--;
  return i;
}

/** Günlük logaritmik getirilerden yıllıklandırılmış volatilite (%). */
export function annualizedVolatility(c: Candles, lookbackDays = 365): number {
  const from = indexSince(c, lookbackDays);
  const n = c.length - from;
  if (n < 3) return NaN;

  const rets: number[] = [];
  for (let i = from + 1; i < c.length; i++) {
    const prev = c.close[i - 1];
    const cur = c.close[i];
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 2) return NaN;

  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);

  // Barlar takvim günü değil işlem günü; yıllıklandırma çarpanı gerçek bar
  // yoğunluğundan türetilir — haftalık/aylık seride de doğru kalır.
  const spanYears = (c.time[c.length - 1] - c.time[from]) / (YEAR_DAYS * DAY);
  const barsPerYear = spanYears > 0 ? rets.length / spanYears : 252;
  return Math.sqrt(variance * barsPerYear) * 100;
}

/** Tepe-dip en kötü düşüş (%) ve şu anki düşüş (%). */
export function drawdown(c: Candles): { max: number; current: number } {
  let peak = -Infinity;
  let max = 0;
  for (let i = 0; i < c.length; i++) {
    const v = c.close[i];
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > max) max = dd;
  }
  const last = c.close[c.length - 1];
  const current = peak > 0 ? (peak - last) / peak : 0;
  return { max: max * 100, current: current * 100 };
}

/** Bileşik yıllık getiri (%). */
export function cagr(c: Candles): number {
  const first = c.close[0];
  const last = c.close[c.length - 1];
  const years = (c.time[c.length - 1] - c.time[0]) / (YEAR_DAYS * DAY);
  if (!(first > 0) || years <= 0) return NaN;
  return (Math.pow(last / first, 1 / years) - 1) * 100;
}

/**
 * Enflasyondan arındırılmış yıllık getiri (%).
 * TL bazlı seride nominal getiri tek başına yanıltıcıdır: %60 nominal, %65
 * enflasyonda para KAYBETTİRİR. Fisher ilişkisi: (1+n)/(1+e) − 1.
 */
export function realCagr(c: Candles): number {
  const nominal = cagr(c);
  if (!Number.isFinite(nominal)) return NaN;
  const inflation = inflationAvgAnnual(c.time, c.length);
  return ((1 + nominal / 100) / (1 + inflation / 100) - 1) * 100;
}

export interface SummaryOptions {
  /** TL bazlı piyasada reel getiri anlamlı; USD/kripto için kapatılır. */
  realReturn?: boolean;
}

/** Sembol masasının özet kartları. */
export function summarize(c: Candles, options: SummaryOptions = {}): Metric[] {
  if (c.length < 2) return [];
  const n = c.length;
  const last = c.close[n - 1];
  const span = `${fmtDay(c.time[0])} → ${fmtDay(c.time[n - 1])}`;
  const years = (c.time[n - 1] - c.time[0]) / (YEAR_DAYS * DAY);

  const windowReturn = (days: number, key: string, label: string): Metric => {
    const from = indexSince(c, days);
    const base = c.close[from];
    return {
      key,
      label,
      value: base > 0 ? (last / base - 1) * 100 : NaN,
      unit: 'pct',
      signed: true,
      formula: `(son kapanış ÷ ${fmtDay(c.time[from])} kapanışı − 1) × 100`,
      window: `${fmtDay(c.time[from])} → ${fmtDay(c.time[n - 1])}`,
      bars: n - from,
    };
  };

  const dd = drawdown(c);
  const vol = annualizedVolatility(c);
  const volFrom = indexSince(c, 365);

  const metrics: Metric[] = [
    {
      key: 'last',
      label: 'Son kapanış',
      value: last,
      unit: 'price',
      formula: 'Serinin son barının kapanış fiyatı',
      window: fmtDay(c.time[n - 1]),
      bars: 1,
    },
    windowReturn(30, 'r1m', '1 aylık getiri'),
    windowReturn(365, 'r1y', '1 yıllık getiri'),
    {
      key: 'cagr',
      label: 'Yıllık bileşik (CAGR)',
      value: cagr(c),
      unit: 'pct',
      signed: true,
      formula: '(son ÷ ilk)^(1 ÷ yıl) − 1 — tüm geçmiş üzerinden',
      window: span,
      bars: n,
    },
    {
      key: 'vol',
      label: 'Volatilite (yıllık)',
      value: vol,
      unit: 'pct',
      formula: 'Günlük log getirilerin std. sapması × √(yıllık bar sayısı)',
      window: `${fmtDay(c.time[volFrom])} → ${fmtDay(c.time[n - 1])}`,
      bars: n - volFrom,
    },
    {
      key: 'maxdd',
      label: 'Maks. düşüş',
      value: -dd.max,
      unit: 'pct',
      signed: true,
      formula: 'Tüm geçmişte en kötü tepe → dip düşüşü (kapanış bazlı)',
      window: span,
      bars: n,
    },
    {
      key: 'curdd',
      label: 'Tepeden uzaklık',
      value: -dd.current,
      unit: 'pct',
      signed: true,
      formula: 'Şu anki fiyatın tarihsel zirveye göre düşüşü',
      window: span,
      bars: n,
    },
  ];

  if (options.realReturn) {
    metrics.push({
      key: 'real',
      label: 'Reel yıllık getiri',
      value: realCagr(c),
      unit: 'pct',
      signed: true,
      formula: '(1 + CAGR) ÷ (1 + ortalama TÜFE) − 1 — TÜİK yıllık TÜFE serisi',
      window: span,
      bars: n,
    });
  }

  metrics.push({
    key: 'history',
    label: 'Geçmiş',
    value: years,
    unit: 'years',
    formula: 'İlk bardan son bara geçen süre',
    window: span,
    bars: n,
  });

  return metrics;
}
