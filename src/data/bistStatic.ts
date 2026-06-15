import { Candles, emptyCandles } from './types';

// Reads pre-built BIST OHLCV from same-origin static JSON (generated in CI by
// scripts/build_bist.py). No proxy, no key, no CORS — the data ships with the
// site. Daily candles.

interface Rec {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const base = import.meta.env.BASE_URL; // './' (works under /aideneme/ on Pages)

export async function fetchBistStatic(symbol: string, signal?: AbortSignal): Promise<Candles> {
  const res = await fetch(`${base}data/bist/${symbol}.json`, { signal });
  if (!res.ok) {
    throw new Error(`"${symbol}" için statik BIST verisi yok (CI henüz üretmemiş olabilir)`);
  }
  const j = (await res.json()) as { data: Rec[] };
  const d = j.data ?? [];
  const c = emptyCandles(d.length);
  for (let i = 0; i < d.length; i++) {
    const r = d[i];
    c.time[i] = r.t;
    c.open[i] = r.o;
    c.high[i] = r.h;
    c.low[i] = r.l;
    c.close[i] = r.c;
    c.volume[i] = r.v;
  }
  return c;
}

export async function fetchBistSymbols(signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(`${base}data/bist/symbols.json`, { signal });
    if (!res.ok) return [];
    const j = (await res.json()) as { symbols: string[] };
    return j.symbols ?? [];
  } catch {
    return [];
  }
}

// Last close (c) + previous close (pc) for every symbol — one small file used by
// the watchlist and portfolio.
export type Quotes = Record<string, { c: number; pc: number }>;

export async function fetchBistQuotes(signal?: AbortSignal): Promise<Quotes> {
  try {
    const res = await fetch(`${base}data/bist/quotes.json`, { signal });
    if (!res.ok) return {};
    return (await res.json()) as Quotes;
  } catch {
    return {};
  }
}

// Market-wide strategy backtest aggregate (built in CI by scripts/strategies.py).
export interface StrategyAgg {
  name: string;
  avgRet: number;
  medRet: number;
  avgAnn?: number; // average annualized (per-day-normalized) return %
  medAnn?: number; // median annualized return %
  beatPct: number;
  avgWin: number;
  avgDD: number;
  avgHold?: number; // average holding period in bars
  avgTrades?: number;
  n: number;
}
// One (stock × strategy) combo for the overall Top-20 view.
export interface TopCombo {
  sym: string;
  name: string;
  ann: number; // annualized %
  ret: number; // total %
  trades: number;
  win: number;
  dd: number;
  hold: number;
}
export interface StrategiesFile {
  generated: number;
  nSymbols: number;
  holdAvg: number;
  holdAnnAvg?: number; // average annualized buy & hold %
  results: StrategyAgg[];
  top?: TopCombo[];
  topMinYears?: number; // Top-20 only includes firms with >= this many years of history
}

export async function fetchStrategies(signal?: AbortSignal): Promise<StrategiesFile | null> {
  try {
    const res = await fetch(`${base}data/bist/strategies.json`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as StrategiesFile;
  } catch {
    return null;
  }
}

export async function fetchBistNames(signal?: AbortSignal): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${base}data/bist/names.json`, { signal });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

// Per-symbol current indicator snapshot for the screener (built in CI by
// scripts/screener.py). Compact keys keep the file small for ~650 symbols.
export interface ScreenerItem {
  s: string; // symbol
  n?: string; // display name
  p: number; // last price
  ch: number; // daily change %
  rsi: number;
  e50: number; // above EMA50 (1/0)
  e200: number; // above EMA200 (1/0)
  gc: number; // golden cross EMA50>EMA200 (1/0)
  wr: number; // Williams %R (+100 convention, >50 strong)
  wre: number; // Williams %R EMA(260)
  mc: number; // NizamiCedid MACD (normalized)
  sg: number; // NizamiCedid Signal (normalized)
  em: number; // NizamiCedid eMACD / VWMA (normalized)
  dl: number; // NizamiCedid Δ = MACD − eMACD (normalized)
  mu: number; // MACD above signal (1/0)
  st: number; // Supertrend up (1/0)
  fh: number; // % vs 52w high (negative = below)
  r1m: number;
  r3m: number;
  r1y: number;
  vol: number; // annualized volatility %
  dd: number; // max drawdown %
  av: number; // avg volume (20d)
  yr: number; // years of history
  adx?: number; // ADX (28) trend strength
  wre2?: number; // Williams %R EMA (120)
  roc?: number; // Momentum / ROC (260) %
}
export interface ScreenerFile {
  generated: number;
  items: ScreenerItem[];
}

export async function fetchScreener(signal?: AbortSignal): Promise<ScreenerFile | null> {
  try {
    const res = await fetch(`${base}data/bist/screener.json`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as ScreenerFile;
  } catch {
    return null;
  }
}

export async function fetchBistSpark(signal?: AbortSignal): Promise<Record<string, number[]>> {
  try {
    const res = await fetch(`${base}data/bist/spark.json`, { signal });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, number[]>;
  } catch {
    return {};
  }
}
