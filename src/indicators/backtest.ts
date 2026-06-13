import { Candles } from '../data/types';
import { emaArr, rollingHighest, rollingLowest } from './calc';

export interface StrategyResult {
  name: string;
  retPct: number; // strategy total return %
  trades: number;
  winRate: number;
  maxDD: number; // max drawdown %
  holdPct: number; // buy & hold return % (baseline)
}

// Long-only, all-in backtest. position[i-1] decides whether we hold the i-1 → i
// return (no look-ahead).
function simulate(close: Float64Array, long: Uint8Array, holdPct: number, name: string): StrategyResult {
  const n = close.length;
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  let trades = 0;
  let wins = 0;
  let entry = 0;
  let inPos = false;
  for (let i = 1; i < n; i++) {
    if (long[i - 1]) equity *= close[i] / close[i - 1];
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
    if (long[i - 1] && !inPos) {
      inPos = true;
      entry = close[i - 1];
    } else if (!long[i - 1] && inPos) {
      inPos = false;
      trades++;
      if (close[i - 1] > entry) wins++;
    }
  }
  if (inPos) {
    trades++;
    if (close[n - 1] > entry) wins++;
  }
  return {
    name,
    retPct: (equity - 1) * 100,
    trades,
    winRate: trades ? (wins / trades) * 100 : 0,
    maxDD: maxDD * 100,
    holdPct,
  };
}

// Grid-search a bunch of indicator strategies and rank by total return.
export function optimize(c: Candles): { results: StrategyResult[]; holdPct: number } {
  const close = c.close;
  const n = c.length;
  const holdPct = n > 1 ? (close[n - 1] / close[0] - 1) * 100 : 0;
  const out: StrategyResult[] = [];
  const run = (name: string, long: Uint8Array) => out.push(simulate(close, long, holdPct, name));

  // EMA crossover (golden/death): long while fast EMA > slow EMA.
  for (const [a, b] of [[9, 21], [20, 50], [50, 200], [89, 377], [377, 610]]) {
    const ea = emaArr(close, a);
    const eb = emaArr(close, b);
    const long = new Uint8Array(n);
    for (let i = 0; i < n; i++) long[i] = ea[i] > eb[i] ? 1 : 0;
    run(`EMA ${a}/${b} kesişimi`, long);
  }

  // MACD: long while MACD > Signal, and a "MACD > 0" variant.
  for (const [f, sl, sg] of [[12, 26, 9], [120, 260, 50], [50, 100, 20], [8, 21, 5]]) {
    const fast = emaArr(close, f);
    const slow = emaArr(close, sl);
    const macd = new Float64Array(n);
    for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
    const sig = emaArr(macd, sg);
    const a = new Uint8Array(n);
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = macd[i] > sig[i] ? 1 : 0;
      b[i] = macd[i] > 0 ? 1 : 0;
    }
    run(`MACD ${f}/${sl}/${sg} > Sinyal`, a);
    run(`MACD ${f}/${sl} > 0`, b);
  }

  // Williams %R (their +100 form): bounce strategy + ">50" momentum variant.
  for (const len of [14, 50, 260]) {
    const hh = rollingHighest(c.high, len);
    const ll = rollingLowest(c.low, len);
    const pr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = hh[i] - ll[i];
      pr[i] = d !== 0 ? (100 * (close[i] - hh[i])) / d + 100 : NaN;
    }
    for (const [lo, hi] of [[20, 80], [30, 70], [10, 90]]) {
      const long = new Uint8Array(n);
      let pos = 0;
      for (let i = 1; i < n; i++) {
        const a = pr[i - 1];
        const b = pr[i];
        if (Number.isFinite(a) && Number.isFinite(b)) {
          if (pos === 0 && a <= lo && b > lo) pos = 1; // leaving oversold → buy
          else if (pos === 1 && a >= hi && b < hi) pos = 0; // leaving overbought → sell
        }
        long[i] = pos;
      }
      run(`%R ${len} (${lo}/${hi})`, long);
    }
    const mid = new Uint8Array(n);
    for (let i = 0; i < n; i++) mid[i] = Number.isFinite(pr[i]) && pr[i] > 50 ? 1 : 0;
    run(`%R ${len} > 50`, mid);
  }

  out.sort((x, y) => y.retPct - x.retPct);
  return { results: out, holdPct };
}
