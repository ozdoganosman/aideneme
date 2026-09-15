/** Finansal tablo alanları — üretici (scripts/build_fundamentals.py) ile aynı. */
export const FUNDAMENTAL_FIELDS = [
  'revenue',
  'grossProfit',
  'operatingProfit',
  'netIncome',
  'assets',
  'equity',
  'paidCapital',
  'currentAssets',
  'currentLiabilities',
  'longLiabilities',
  'inventory',
  'cash',
  'operatingCashFlow',
  'capex',
] as const;

export type FieldId = (typeof FUNDAMENTAL_FIELDS)[number];

export interface Financials {
  symbol: string;
  /** "2024/12", "2025/3" … artan. Çeyrekler KÜMÜLATİFTİR. */
  periods: string[];
  fields: Record<FieldId, (number | null)[]>;
  /** Bu sembolde bulunamayan alanlar — gizlenmez, raporlanır. */
  missing: FieldId[];
  /** İş Yatırım finansal grup kodu ("1" sanayi, "2" banka). */
  group?: string;
}

export interface SnapshotRow {
  period: string;
  revenueTtm: number | null;
  grossProfitTtm: number | null;
  operatingProfitTtm: number | null;
  netIncomeTtm: number | null;
  operatingCashFlowTtm: number | null;
  equity: number | null;
  assets: number | null;
  paidCapital: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  longLiabilities: number | null;
  inventory: number | null;
  cash: number | null;
}

export interface FundamentalsSnapshot {
  version: number;
  generated: number;
  /** Kaynağın point-in-time sınırını anlatan not; UI bunu gösterir. */
  note: string;
  symbols: Record<string, SnapshotRow>;
}

export function isSnapshot(value: unknown): value is FundamentalsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<FundamentalsSnapshot>;
  return s.version === 1 && typeof s.generated === 'number' && !!s.symbols;
}
