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

export async function fetchBistSpark(signal?: AbortSignal): Promise<Record<string, number[]>> {
  try {
    const res = await fetch(`${base}data/bist/spark.json`, { signal });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, number[]>;
  } catch {
    return {};
  }
}
