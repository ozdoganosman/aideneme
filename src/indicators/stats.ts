import { Candles } from '../data/types';

export interface Stats {
  hi52: number;
  lo52: number;
  r1m: number;
  r3m: number;
  r1y: number;
  avgVol: number;
  cagr: number; // annualized (per-year) return over full history %
  maxDD: number; // worst peak-to-trough drawdown over full history %
  years: number; // length of available history in years
}

// Time-based so it's correct for daily/weekly/monthly alike.
export function computeStats(c: Candles | null): Stats | null {
  if (!c || c.length === 0) return null;
  const n = c.length;
  const last = c.close[n - 1];
  const tlast = c.time[n - 1];

  const idxSince = (days: number) => {
    const cut = tlast - days * 86400;
    let i = n - 1;
    while (i > 0 && c.time[i - 1] >= cut) i--;
    return i;
  };

  const i1y = idxSince(365);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = i1y; i < n; i++) {
    if (c.high[i] > hi) hi = c.high[i];
    if (c.low[i] < lo) lo = c.low[i];
  }

  const ret = (days: number) => (last / c.close[idxSince(days)] - 1) * 100;

  const vc = Math.min(20, n);
  let vs = 0;
  for (let i = n - vc; i < n; i++) vs += c.volume[i];

  // Full-history annualized return (CAGR) + worst drawdown — same per-year basis
  // as the strategy ranking, so "this stock" speaks the same language.
  const years = (tlast - c.time[0]) / (365.25 * 86400);
  const first = c.close[0];
  const cagr = years > 0 && first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0;
  let peak = -Infinity;
  let maxDD = 0;
  for (let i = 0; i < n; i++) {
    const v = c.close[i];
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    hi52: hi,
    lo52: lo,
    r1m: ret(30),
    r3m: ret(90),
    r1y: ret(365),
    avgVol: vs / vc,
    cagr,
    maxDD: maxDD * 100,
    years,
  };
}
