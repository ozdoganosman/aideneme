import { adxArr, emaArr } from '../indicators/calc';
import { atrArr, rsiArr } from '../indicators/rsi';
import type { Candles } from '../data/types';

/**
 * Tarama metrikleri — saf, sembol başına bir kez hesaplanır.
 *
 * Referans projede tarama sonucu CI'da pişirilip `scan.json` olarak donduruluyor;
 * kullanıcı RSI uzunluğunu değiştiremiyor. Burada metrikler parametreden
 * türetiliyor ve Worker'da anında yeniden hesaplanıyor.
 */

export type MetricId =
  | 'last'
  | 'chg1'
  | 'chg5'
  | 'chg21'
  | 'chg63'
  | 'rsi'
  | 'adx'
  | 'emaFastGap'
  | 'emaSlowGap'
  | 'volRatio'
  | 'atrPct'
  | 'fromHigh';

export interface ScreenParams {
  rsiLength: number;
  adxLength: number;
  emaFast: number;
  emaSlow: number;
  atrLength: number;
  /** Hacim oranında referans alınan ortalama penceresi. */
  volLookback: number;
  /** "Zirveden uzaklık" penceresi (bar). */
  highLookback: number;
}

export const DEFAULT_SCREEN_PARAMS: ScreenParams = {
  rsiLength: 14,
  adxLength: 14,
  emaFast: 20,
  emaSlow: 50,
  atrLength: 14,
  volLookback: 20,
  highLookback: 250,
};

export interface MetricDef {
  id: string;
  label: string;
  unit: 'pct' | 'price' | 'ratio' | 'level';
  /** Provenance: metrik nasıl hesaplanıyor (parametreler yerine konur). */
  formula: (p: ScreenParams) => string;
  /** Değer işaretine göre renklensin mi. */
  signed?: boolean;
  decimals?: number;
}

export const METRIC_DEFS: MetricDef[] = [
  {
    id: 'last',
    label: 'Fiyat',
    unit: 'price',
    formula: () => 'Son barın kapanışı',
    decimals: 2,
  },
  {
    id: 'chg1',
    label: '1 gün',
    unit: 'pct',
    signed: true,
    formula: () => '(kapanış ÷ önceki kapanış − 1) × 100',
  },
  {
    id: 'chg5',
    label: '1 hafta',
    unit: 'pct',
    signed: true,
    formula: () => '(kapanış ÷ 5 bar önceki kapanış − 1) × 100',
  },
  {
    id: 'chg21',
    label: '1 ay',
    unit: 'pct',
    signed: true,
    formula: () => '(kapanış ÷ 21 bar önceki kapanış − 1) × 100',
  },
  {
    id: 'chg63',
    label: '3 ay',
    unit: 'pct',
    signed: true,
    formula: () => '(kapanış ÷ 63 bar önceki kapanış − 1) × 100',
  },
  {
    id: 'rsi',
    label: 'RSI',
    unit: 'level',
    formula: (p) => `Wilder RSI, uzunluk ${p.rsiLength}`,
  },
  {
    id: 'adx',
    label: 'ADX',
    unit: 'level',
    formula: (p) => `Wilder ADX, uzunluk ${p.adxLength} — trend gücü (yön değil)`,
  },
  {
    id: 'emaFastGap',
    label: 'EMA hızlı fark',
    unit: 'pct',
    signed: true,
    formula: (p) => `(kapanış ÷ EMA${p.emaFast} − 1) × 100`,
  },
  {
    id: 'emaSlowGap',
    label: 'EMA yavaş fark',
    unit: 'pct',
    signed: true,
    formula: (p) => `(kapanış ÷ EMA${p.emaSlow} − 1) × 100`,
  },
  {
    id: 'volRatio',
    label: 'Hacim oranı',
    unit: 'ratio',
    formula: (p) => `Son bar hacmi ÷ son ${p.volLookback} barın ortalama hacmi`,
  },
  {
    id: 'atrPct',
    label: 'ATR %',
    unit: 'pct',
    formula: (p) => `ATR(${p.atrLength}) ÷ kapanış × 100 — bar içi oynaklık`,
  },
  {
    id: 'fromHigh',
    label: 'Zirveden',
    unit: 'pct',
    signed: true,
    formula: (p) => `(kapanış ÷ son ${p.highLookback} barın en yükseği − 1) × 100`,
  },
];

export const METRIC_BY_ID = new Map(METRIC_DEFS.map((d) => [d.id, d]));

/**
 * Metrik değerleri string anahtarlı: teknik metrikler (bu dosya) ve temel
 * metrikler (fundamentalMetrics.ts) aynı satırda yaşar, filtre/sıralama
 * makinesi ikisini ayırt etmek zorunda kalmaz.
 */
export type MetricValues = Record<string, number>;

export interface ScreenRow {
  symbol: string;
  values: MetricValues;
  /** Hesaba giren bar sayısı — az barlı sembol sonuçları yanıltmasın. */
  bars: number;
  /** Sektör (varsa) — sayısal olmadığı için `values` içinde duramaz. */
  sector?: string;
}

const pctChange = (c: Candles, back: number): number => {
  const i = c.length - 1 - back;
  if (i < 0) return NaN;
  const base = c.close[i];
  return base > 0 ? (c.close[c.length - 1] / base - 1) * 100 : NaN;
};

/** Bir sembolün tüm metrikleri. Yetersiz veride null (satır hiç üretilmez). */
export function metricsFor(
  symbol: string,
  c: Candles,
  params: ScreenParams = DEFAULT_SCREEN_PARAMS,
): ScreenRow | null {
  const n = c.length;
  if (n < 2) return null;

  const last = c.close[n - 1];
  const rsi = rsiArr(c.close, params.rsiLength);
  const adx = adxArr(c, params.adxLength);
  const atr = atrArr(c.high, c.low, c.close, params.atrLength);
  const fast = emaArr(c.close, params.emaFast);
  const slow = emaArr(c.close, params.emaSlow);

  let volSum = 0;
  let volCount = 0;
  for (let i = Math.max(0, n - params.volLookback); i < n; i++) {
    volSum += c.volume[i];
    volCount++;
  }
  const avgVol = volCount ? volSum / volCount : NaN;

  let high = -Infinity;
  for (let i = Math.max(0, n - params.highLookback); i < n; i++) {
    if (c.high[i] > high) high = c.high[i];
  }

  return {
    symbol,
    bars: n,
    values: {
      last,
      chg1: pctChange(c, 1),
      chg5: pctChange(c, 5),
      chg21: pctChange(c, 21),
      chg63: pctChange(c, 63),
      rsi: rsi[n - 1],
      adx: adx[n - 1],
      emaFastGap: fast[n - 1] > 0 ? (last / fast[n - 1] - 1) * 100 : NaN,
      emaSlowGap: slow[n - 1] > 0 ? (last / slow[n - 1] - 1) * 100 : NaN,
      volRatio: avgVol > 0 ? c.volume[n - 1] / avgVol : NaN,
      atrPct: last > 0 ? (atr[n - 1] / last) * 100 : NaN,
      fromHigh: high > 0 ? (last / high - 1) * 100 : NaN,
    },
  };
}

// ── Filtre ───────────────────────────────────────────────────────────────────

export type Operator = 'gt' | 'lt' | 'between';

export interface Rule {
  /** Teknik ya da temel metrik kimliği. */
  metric: string;
  op: Operator;
  a: number;
  b?: number;
}

export interface ScreenSpec {
  rules: Rule[];
  sort?: { metric: string; dir: 'asc' | 'desc' };
  /** Bu kadar bardan az veriye sahip semboller elenir. */
  minBars?: number;
  /**
   * Seçili sektörler. Boş/verilmemiş = sektöre göre eleme yok.
   *
   * Sayısal kural olarak modellenmedi: sektör kategoriktir, "> 3" gibi bir
   * karşılaştırması yoktur ve sayıya çevirmek sıralamayı anlamlıymış gibi
   * gösterirdi.
   */
  sectors?: string[];
}

/** Tek satır kuralları geçiyor mu? NaN metrik ASLA geçmez (bilinmeyen ≠ uygun). */
export function passes(row: ScreenRow, rules: Rule[]): boolean {
  for (const rule of rules) {
    const v = row.values[rule.metric];
    if (!Number.isFinite(v)) return false;
    if (rule.op === 'gt' && !(v > rule.a)) return false;
    if (rule.op === 'lt' && !(v < rule.a)) return false;
    if (rule.op === 'between') {
      const lo = Math.min(rule.a, rule.b ?? rule.a);
      const hi = Math.max(rule.a, rule.b ?? rule.a);
      if (v < lo || v > hi) return false;
    }
  }
  return true;
}

/** Filtrele + sırala. Girdi dizisi değiştirilmez. */
export function applyScreen(rows: ScreenRow[], spec: ScreenSpec): ScreenRow[] {
  const minBars = spec.minBars ?? 0;
  // Sektör filtresi seçiliyse sektörü BİLİNMEYEN sembol de elenir: "bilinmiyor"
  // seçilen sektöre ait sayılamaz (NaN'ın kuralı geçmemesiyle aynı ilke).
  const wanted = spec.sectors && spec.sectors.length > 0 ? new Set(spec.sectors) : null;
  const out = rows.filter(
    (r) =>
      r.bars >= minBars &&
      (!wanted || (r.sector !== undefined && wanted.has(r.sector))) &&
      passes(r, spec.rules),
  );
  if (!spec.sort) return out;

  const { metric, dir } = spec.sort;
  const sign = dir === 'asc' ? 1 : -1;
  return out.sort((x, y) => {
    const a = x.values[metric];
    const b = y.values[metric];
    // NaN her zaman sona — "bilinmiyor" listenin başında durmamalı.
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return (a - b) * sign;
  });
}
