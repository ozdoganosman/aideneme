import { Candles } from '../data/types';
import { emaArr, rollingHighest, rollingLowest } from './calc';

export interface StrategyResult {
  name: string;
  retPct: number; // total return %
  annPct: number; // annualized return % (period-normalized, ~per-day compounded)
  trades: number;
  winRate: number;
  maxDD: number;
  holdPct: number;
  holdAnn: number; // buy & hold annualized %
}

export interface StrategyDef {
  name: string;
  build: (c: Candles) => Uint8Array; // position per bar (1 = long, 0 = flat)
}

function emaCross(a: number, b: number): StrategyDef {
  return {
    name: `EMA ${a}/${b} kesişimi`,
    build: (c) => {
      const n = c.length;
      const ea = emaArr(c.close, a);
      const eb = emaArr(c.close, b);
      const p = new Uint8Array(n);
      for (let i = 0; i < n; i++) p[i] = ea[i] > eb[i] ? 1 : 0;
      return p;
    },
  };
}

function prArr(c: Candles, len: number): Float64Array {
  const n = c.length;
  const hh = rollingHighest(c.high, len);
  const ll = rollingLowest(c.low, len);
  const pr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = hh[i] - ll[i];
    pr[i] = d !== 0 ? (100 * (c.close[i] - hh[i])) / d + 100 : NaN;
  }
  return pr;
}

function prBounce(c: Candles, len: number, lo: number, hi: number): Uint8Array {
  const pr = prArr(c, len);
  const n = c.length;
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 1; i < n; i++) {
    const a = pr[i - 1];
    const b = pr[i];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (cur === 0 && a <= lo && b > lo) cur = 1;
      else if (cur === 1 && a >= hi && b < hi) cur = 0;
    }
    p[i] = cur;
  }
  return p;
}

// The full strategy registry — used both by the optimizer and to redraw a chosen
// strategy's signals on the chart.
export function strategyList(): StrategyDef[] {
  const defs: StrategyDef[] = [];

  for (const [a, b] of [[9, 21], [20, 50], [50, 200], [89, 377], [377, 610]]) {
    defs.push(emaCross(a, b));
  }

  for (const [f, sl, sg] of [[12, 26, 9], [120, 260, 50], [50, 100, 20], [8, 21, 5]]) {
    defs.push({
      name: `MACD ${f}/${sl}/${sg} > Sinyal`,
      build: (c) => {
        const n = c.length;
        const fast = emaArr(c.close, f);
        const slow = emaArr(c.close, sl);
        const macd = new Float64Array(n);
        for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
        const sig = emaArr(macd, sg);
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = macd[i] > sig[i] ? 1 : 0;
        return p;
      },
    });
    defs.push({
      name: `MACD ${f}/${sl} > 0`,
      build: (c) => {
        const n = c.length;
        const fast = emaArr(c.close, f);
        const slow = emaArr(c.close, sl);
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = fast[i] - slow[i] > 0 ? 1 : 0;
        return p;
      },
    });
  }

  for (const len of [14, 50, 260]) {
    for (const [lo, hi] of [[20, 80], [30, 70], [10, 90]]) {
      defs.push({ name: `%R ${len} (${lo}/${hi})`, build: (c) => prBounce(c, len, lo, hi) });
    }
    defs.push({
      name: `%R ${len} > 50`,
      build: (c) => {
        const pr = prArr(c, len);
        const n = c.length;
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = Number.isFinite(pr[i]) && pr[i] > 50 ? 1 : 0;
        return p;
      },
    });
  }

  return defs;
}

// Plain-language LOGIC of a strategy (no jargon) for beginners.
export function explainStrategy(name: string): string {
  let m: RegExpMatchArray | null;
  if ((m = name.match(/^EMA (\d+)\//)))
    return '📈 Trend takibi: Fiyat yükseliş eğilimine girince AL, eğilim bozulup düşüşe dönünce SAT. "Yükselen trende katıl, dönünce çık."' + speed(+m[1]);
  if ((m = name.match(/^MACD (\d+)\/.* > Sinyal/)))
    return '🚀 Momentum: Yükseliş ivmesi güç kazanınca AL, ivme zayıflamaya başlayınca SAT. Hızlanmayı yakalar.' + speed(+m[1]);
  if ((m = name.match(/^MACD (\d+)\/.* > 0/)))
    return '📈 Trend filtresi: Fiyat uzun vadeli ortalamasının üstüne (yükselişe) geçince AL, altına inince SAT.' + speed(+m[1]);
  if ((m = name.match(/^%R (\d+) \(/)))
    return '🔄 Dipten al, tepeden sat: Fiyat aşırı düşüp dipten dönünce AL, aşırı yükselip tepeden dönünce SAT (tepki/salınım stratejisi).' + speed(+m[1]);
  if ((m = name.match(/^%R (\d+) > 50/)))
    return '💪 Güç takibi: Fiyat son dönemin üst yarısında (güçlüyken) AL, alt yarısına düşünce (zayıflayınca) SAT.' + speed(+m[1]);
  return 'Gösterge tabanlı al/sat stratejisi.';
}

function speed(len: number): string {
  return len <= 20
    ? ' (Hızlı: sık işlem, kısa vadeli.)'
    : len >= 100
      ? ' (Yavaş: az işlem, uzun vadeli.)'
      : ' (Orta hızlı.)';
}

function simulate(
  close: Float64Array,
  long: Uint8Array,
  holdPct: number,
  holdAnn: number,
  name: string,
  years: number,
): StrategyResult {
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
  // Annualized (compound) return — normalizes by how long the trade was held so a
  // huge total that took 20 years can be compared fairly to a quick winner.
  const annPct = years > 0 && equity > 0 ? (Math.pow(equity, 1 / years) - 1) * 100 : 0;
  return {
    name,
    retPct: (equity - 1) * 100,
    annPct,
    trades,
    winRate: trades ? (wins / trades) * 100 : 0,
    maxDD: maxDD * 100,
    holdPct,
    holdAnn,
  };
}

export function optimize(c: Candles): { results: StrategyResult[]; holdPct: number; holdAnn: number } {
  const close = c.close;
  const n = c.length;
  const holdPct = n > 1 ? (close[n - 1] / close[0] - 1) * 100 : 0;
  // Real calendar span (time is unix seconds) — works for daily/weekly/monthly.
  const years = n > 1 ? Math.max((c.time[n - 1] - c.time[0]) / (365.25 * 86400), 1e-6) : 0;
  const holdAnn = years > 0 && close[0] > 0 ? (Math.pow(close[n - 1] / close[0], 1 / years) - 1) * 100 : 0;
  const out = strategyList().map((d) => simulate(close, d.build(c), holdPct, holdAnn, d.name, years));
  // Rank by annualized (per-day-normalized) return, not raw total.
  out.sort((x, y) => y.annPct - x.annPct);
  return { results: out, holdPct, holdAnn };
}

export function buildPositionByName(name: string, c: Candles): Uint8Array | null {
  const d = strategyList().find((d) => d.name === name);
  return d ? d.build(c) : null;
}

export interface Trade {
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number;
  retPct: number;
  open: boolean;
}

// Trades of a named strategy, newest first.
export function tradesFor(name: string, c: Candles): Trade[] {
  const pos = buildPositionByName(name, c);
  if (!pos) return [];
  const trades: Trade[] = [];
  const mk = (ei: number, xi: number, open: boolean): Trade => {
    const ep = c.close[ei];
    const xp = c.close[xi];
    return { entryTime: c.time[ei], exitTime: open ? null : c.time[xi], entryPrice: ep, exitPrice: xp, retPct: (xp / ep - 1) * 100, open };
  };
  let inPos = false;
  let ei = 0;
  for (let i = 1; i < c.length; i++) {
    if (pos[i] && !pos[i - 1]) {
      inPos = true;
      ei = i;
    } else if (!pos[i] && pos[i - 1] && inPos) {
      inPos = false;
      trades.push(mk(ei, i, false));
    }
  }
  if (inPos) trades.push(mk(ei, c.length - 1, true));
  return trades.reverse();
}

// Entry/exit signals (for chart markers) of a named strategy.
export function signalsFor(name: string, c: Candles): { time: number; kind: 'buy' | 'sell' }[] {
  const pos = buildPositionByName(name, c);
  if (!pos) return [];
  const out: { time: number; kind: 'buy' | 'sell' }[] = [];
  for (let i = 1; i < c.length; i++) {
    if (pos[i] && !pos[i - 1]) out.push({ time: c.time[i], kind: 'buy' });
    else if (!pos[i] && pos[i - 1]) out.push({ time: c.time[i], kind: 'sell' });
  }
  return out;
}
