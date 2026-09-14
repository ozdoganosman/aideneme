import {
  computeRatios,
  growth,
  percentileRank,
  qualityScore,
  type Ratios,
} from '../fundamentals/metrics';
import type { Financials, FundamentalsSnapshot } from '../fundamentals/types';
import type { MetricDef, ScreenRow } from './metrics';

/**
 * Temel analiz metriklerini tarama satırlarına ekler.
 *
 * Böylece "RSI 40–70 arası VE F/K sektör medyanının altında VE ciro büyümesi
 * %20+" gibi teknik + temel karışık filtreler, ayrı bir makineye gerek kalmadan
 * mevcut kural motoruyla çalışır.
 */

export type FundamentalMetricId =
  | 'pe'
  | 'pb'
  | 'ps'
  | 'roe'
  | 'netMargin'
  | 'grossMargin'
  | 'debtToEquity'
  | 'currentRatio'
  | 'revenueGrowth'
  | 'netIncomeGrowth'
  | 'quality'
  | 'marketCap'
  | 'pePercentile'
  | 'roePercentile';

export const FUNDAMENTAL_METRIC_DEFS: MetricDef[] = [
  {
    id: 'pe',
    label: 'F/K',
    unit: 'ratio',
    decimals: 1,
    formula: () => 'Piyasa değeri ÷ son 12 ay net kâr (zarar edende boş bırakılır)',
  },
  {
    id: 'pb',
    label: 'PD/DD',
    unit: 'ratio',
    decimals: 2,
    formula: () => 'Piyasa değeri ÷ özkaynak',
  },
  {
    id: 'ps',
    label: 'PD/Satış',
    unit: 'ratio',
    decimals: 2,
    formula: () => 'Piyasa değeri ÷ son 12 ay satış',
  },
  {
    id: 'roe',
    label: 'Özkaynak kârlılığı',
    unit: 'pct',
    signed: true,
    formula: () => 'Son 12 ay net kâr ÷ özkaynak × 100',
  },
  {
    id: 'netMargin',
    label: 'Net marj',
    unit: 'pct',
    signed: true,
    formula: () => 'Son 12 ay net kâr ÷ satış × 100',
  },
  {
    id: 'grossMargin',
    label: 'Brüt marj',
    unit: 'pct',
    signed: true,
    formula: () => 'Son 12 ay brüt kâr ÷ satış × 100',
  },
  {
    id: 'debtToEquity',
    label: 'Borç/Özkaynak',
    unit: 'ratio',
    decimals: 2,
    formula: () => '(Kısa + uzun vadeli yükümlülükler) ÷ özkaynak',
  },
  {
    id: 'currentRatio',
    label: 'Cari oran',
    unit: 'ratio',
    decimals: 2,
    formula: () => 'Dönen varlıklar ÷ kısa vadeli yükümlülükler',
  },
  {
    id: 'revenueGrowth',
    label: 'Ciro büyümesi',
    unit: 'pct',
    signed: true,
    formula: () => 'Son 12 ay satış ÷ bir yıl önceki son 12 ay − 1',
  },
  {
    id: 'netIncomeGrowth',
    label: 'Kâr büyümesi',
    unit: 'pct',
    signed: true,
    formula: () => 'Son 12 ay net kâr ÷ bir yıl önceki son 12 ay − 1',
  },
  {
    id: 'quality',
    label: 'Kalite skoru',
    unit: 'level',
    decimals: 1,
    formula: () => 'Piotroski benzeri 9 ölçütün karşılananları (veri eksikse payda küçülür)',
  },
  {
    id: 'marketCap',
    label: 'Piyasa değeri',
    unit: 'price',
    decimals: 0,
    formula: () => 'Son fiyat × ödenmiş sermaye (nominal 1 TL varsayımı)',
  },
  {
    id: 'pePercentile',
    label: 'F/K yüzdelik',
    unit: 'level',
    formula: () => 'Piyasadaki tüm F/K değerlerine göre yüzdelik (100 = en ucuz)',
  },
  {
    id: 'roePercentile',
    label: 'ROE yüzdelik',
    unit: 'level',
    formula: () => 'Piyasadaki tüm ROE değerlerine göre yüzdelik (100 = en yüksek)',
  },
];

export interface FundamentalContext {
  snapshot: FundamentalsSnapshot;
  /** Sembol başına tam tablo (kalite ve büyüme için); yoksa o metrikler boş kalır. */
  financialsOf?: (symbol: string) => Financials | undefined;
}

/**
 * Satırlara temel metrikleri ekler (kopya döndürür).
 * Fiyat, teknik satırın `last` değerinden alınır — iki kaynak arasında fiyat
 * tutarsızlığı olmasın.
 */
export function withFundamentals(rows: ScreenRow[], context: FundamentalContext): ScreenRow[] {
  const { snapshot, financialsOf } = context;

  // Önce ham oranlar, sonra yüzdelikler (yüzdelik tüm evreni ister).
  const ratios = new Map<string, Ratios>();
  for (const row of rows) {
    const snapshotRow = snapshot.symbols[row.symbol];
    const price = row.values.last;
    if (!snapshotRow || !Number.isFinite(price)) continue;
    ratios.set(row.symbol, computeRatios({ row: snapshotRow, price }));
  }

  const peUniverse = [...ratios.values()].map((r) => r.pe);
  const roeUniverse = [...ratios.values()].map((r) => r.roePct);

  return rows.map((row) => {
    const r = ratios.get(row.symbol);
    const fin = financialsOf?.(row.symbol);
    const g = fin ? growth(fin) : null;
    const q = fin ? qualityScore(fin) : null;

    return {
      ...row,
      values: {
        ...row.values,
        pe: num(r?.pe),
        pb: num(r?.pb),
        ps: num(r?.ps),
        roe: num(r?.roePct),
        netMargin: num(r?.netMarginPct),
        grossMargin: num(r?.grossMarginPct),
        debtToEquity: num(r?.debtToEquity),
        currentRatio: num(r?.currentRatio),
        marketCap: num(r?.marketCap),
        revenueGrowth: num(g?.revenueYoyPct),
        netIncomeGrowth: num(g?.netIncomeYoyPct),
        // Kalite: 9 üzerinden normalize edilir ki farklı paydalar kıyaslanabilsin.
        quality: q && q.available > 0 ? (q.score / q.available) * 9 : NaN,
        pePercentile: num(percentileRank(peUniverse, r?.pe ?? null, true)),
        roePercentile: num(percentileRank(roeUniverse, r?.roePct ?? null)),
      },
    };
  });
}

function num(value: number | null | undefined): number {
  return value === null || value === undefined ? NaN : value;
}
