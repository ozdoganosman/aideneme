import { Candles } from '../data/types';
import { emaArr, rollingVWMA } from './calc';

// ── User-built, rule-based strategies ───────────────────────────────────────
// A strategy = BUY conditions (all must hold to enter) + SELL conditions (all
// must hold to exit). Each condition compares an indicator to a value or to
// another indicator with >, <, crosses-up, crosses-down.

export type Op = 'gt' | 'lt' | 'cu' | 'cd';

export interface Cond {
  ind: string; // indicator key
  p: number; // indicator param (period); ignored for param-less indicators
  op: Op;
  tgt: 'val' | 'ind'; // compare against a fixed value or another indicator
  val: number;
  ind2: string;
  p2: number;
}

export interface CustomStrategy {
  id: string;
  name: string;
  buy: Cond[];
  sell: Cond[];
}

export interface IndDef {
  key: string;
  label: string;
  hasParam: boolean;
  defParam: number;
}

export const INDS: IndDef[] = [
  { key: 'price', label: 'Fiyat', hasParam: false, defParam: 0 },
  { key: 'ema', label: 'EMA', hasParam: true, defParam: 50 },
  { key: 'rsi', label: 'RSI', hasParam: true, defParam: 14 },
  { key: 'wr', label: 'Williams %R', hasParam: true, defParam: 260 },
  { key: 'wrema', label: 'Williams %R EMA', hasParam: true, defParam: 260 },
  { key: 'macd', label: 'MACD (NizamiCedid)', hasParam: false, defParam: 0 },
  { key: 'signal', label: 'Signal', hasParam: false, defParam: 0 },
  { key: 'emacd', label: 'eMACD', hasParam: false, defParam: 0 },
  { key: 'stdir', label: 'Supertrend yön (1=yukarı)', hasParam: false, defParam: 0 },
];

export const OPS: { key: Op; label: string }[] = [
  { key: 'gt', label: '>' },
  { key: 'lt', label: '<' },
  { key: 'cu', label: 'yukarı keser' },
  { key: 'cd', label: 'aşağı keser' },
];

export function indLabel(key: string): string {
  return INDS.find((i) => i.key === key)?.label ?? key;
}
export function hasParam(key: string): boolean {
  return INDS.find((i) => i.key === key)?.hasParam ?? false;
}

export function newCond(): Cond {
  return { ind: 'wr', p: 260, op: 'gt', tgt: 'val', val: 50, ind2: 'ema', p2: 50 };
}

function computeSeries(c: Candles, ind: string, p: number): Float64Array {
  const close = c.close;
  switch (ind) {
    case 'price':
      return close;
    case 'ema':
      return emaArr(close, Math.max(1, p));
    case 'rsi':
      return rsiArr(close, Math.max(2, p));
    case 'wr':
      return williamsR(c, Math.max(1, p));
    case 'wrema':
      return emaArr(williamsR(c, Math.max(1, p)), Math.max(1, p));
    case 'macd':
      return macdSeries(c).macd;
    case 'signal':
      return macdSeries(c).signal;
    case 'emacd':
      return macdSeries(c).emacd;
    case 'stdir':
      return supertrendDir(c, 10, 3);
    default:
      return close;
  }
}

export function buildCustomPosition(c: Candles, s: CustomStrategy): Uint8Array {
  const n = c.length;
  const cache = new Map<string, Float64Array>();
  const ser = (ind: string, p: number) => {
    const k = ind + ':' + p;
    let v = cache.get(k);
    if (!v) {
      v = computeSeries(c, ind, p);
      cache.set(k, v);
    }
    return v;
  };
  const evalConds = (conds: Cond[], i: number): boolean => {
    for (const cd of conds) {
      const a = ser(cd.ind, cd.p);
      const bSer = cd.tgt === 'ind' ? ser(cd.ind2, cd.p2) : null;
      const av = a[i];
      const bv = bSer ? bSer[i] : cd.val;
      if (!Number.isFinite(av) || (bSer && !Number.isFinite(bv))) return false;
      let ok = false;
      if (cd.op === 'gt') ok = av > bv;
      else if (cd.op === 'lt') ok = av < bv;
      else {
        if (i === 0) return false;
        const ap = a[i - 1];
        const bp = bSer ? bSer[i - 1] : cd.val;
        if (!Number.isFinite(ap) || (bSer && !Number.isFinite(bp))) return false;
        ok = cd.op === 'cu' ? ap <= bp && av > bv : ap >= bp && av < bv;
      }
      if (!ok) return false; // all conditions AND-ed
    }
    return true;
  };
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    const buyOk = s.buy.length > 0 && evalConds(s.buy, i);
    // No sell rules → exit when the buy condition stops holding.
    const sellOk = s.sell.length ? evalConds(s.sell, i) : !buyOk;
    // Enter only on a clean buy, exit only on a clean sell. If both fire on the
    // same bar (contradictory), HOLD the current position — no whipsaw: buy once,
    // then sit until a real sell.
    if (cur === 0) {
      if (buyOk && !sellOk) cur = 1;
    } else if (sellOk && !buyOk) {
      cur = 0;
    }
    p[i] = cur;
  }
  return p;
}

// ── self-contained indicator math ───────────────────────────────────────────
function rsiArr(close: Float64Array, len: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n <= len) return out;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= len; i++) {
    const ch = close[i] - close[i - 1];
    ag += Math.max(ch, 0);
    al += Math.max(-ch, 0);
  }
  ag /= len;
  al /= len;
  out[len] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = len + 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    ag = (ag * (len - 1) + Math.max(ch, 0)) / len;
    al = (al * (len - 1) + Math.max(-ch, 0)) / len;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function williamsR(c: Candles, len: number): Float64Array {
  const n = c.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = Math.max(0, i - len + 1); j <= i; j++) {
      if (c.high[j] > hh) hh = c.high[j];
      if (c.low[j] < ll) ll = c.low[j];
    }
    const d = hh - ll;
    out[i] = d !== 0 ? (100 * (c.close[i] - hh)) / d + 100 : NaN;
  }
  return out;
}

function macdSeries(c: Candles): { macd: Float64Array; signal: Float64Array; emacd: Float64Array } {
  const n = c.length;
  const fast = emaArr(c.close, 120);
  const slow = emaArr(c.close, 260);
  const macd = new Float64Array(n);
  for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
  const signal = emaArr(macd, 50);
  const emacd = rollingVWMA(macd, c.volume, 185);
  // Normalize by the fast EMA — exactly like the on-chart NizamiCedid plot — so a
  // threshold like "MACD > 0.01" means the same value shown in the chart legend.
  const macdN = new Float64Array(n);
  const sigN = new Float64Array(n);
  const emN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const inv = fast[i] !== 0 ? 1 / fast[i] : NaN;
    macdN[i] = macd[i] * inv;
    sigN[i] = signal[i] * inv;
    emN[i] = emacd[i] * inv;
  }
  return { macd: macdN, signal: sigN, emacd: emN };
}

function supertrendDir(c: Candles, len: number, mult: number): Float64Array {
  const n = c.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  // Wilder ATR
  const atr = new Float64Array(n);
  let prev = c.high[0] - c.low[0];
  atr[0] = prev;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      c.high[i] - c.low[i],
      Math.abs(c.high[i] - c.close[i - 1]),
      Math.abs(c.low[i] - c.close[i - 1]),
    );
    prev = (prev * (len - 1) + tr) / len;
    atr[i] = prev;
  }
  let fu = (c.high[0] + c.low[0]) / 2 + mult * atr[0];
  let fl = (c.high[0] + c.low[0]) / 2 - mult * atr[0];
  let dir = 1;
  out[0] = 1;
  for (let i = 1; i < n; i++) {
    const hl2 = (c.high[i] + c.low[i]) / 2;
    const ub = hl2 + mult * atr[i];
    const lb = hl2 - mult * atr[i];
    fu = ub < fu || c.close[i - 1] > fu ? ub : fu;
    fl = lb > fl || c.close[i - 1] < fl ? lb : fl;
    if (c.close[i] > fu) dir = 1;
    else if (c.close[i] < fl) dir = 0;
    out[i] = dir;
  }
  return out;
}
