import { Candles } from '../data/types';
import { emaArr, rollingVWMA, rollingHighest, rollingLowest, rocArr, adxArr, IndicatorParams, DEFAULT_PARAMS } from './calc';

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
  { key: 'adx', label: 'ADX (trend gücü)', hasParam: true, defParam: 260 },
  { key: 'adxema', label: 'ADX EMA', hasParam: true, defParam: 120 },
  { key: 'roc', label: 'Momentum / ROC (%)', hasParam: true, defParam: 260 },
  { key: 'rocema', label: 'Momentum / ROC EMA', hasParam: true, defParam: 120 },
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

// A broad grid of candidate strategies — sweeps thresholds/periods for every
// supported indicator (+ crossovers, asymmetric hysteresis and 2-condition trend
// combos) so the optimizer can try "every reasonable possibility" and rank by
// the best average across stocks. Each has a BUY rule and a matching SELL rule.
export function candidateStrategies(): CustomStrategy[] {
  const C = (ind: string, op: Op, tgt: 'val' | 'ind', val = 0, ind2 = 'emacd', p = 0, p2 = 0): Cond => ({ ind, p, op, tgt, val, ind2, p2 });
  const list: { name: string; buy: Cond[]; sell: Cond[] }[] = [];

  // ── MACD (NizamiCedid) ──
  for (const th of [0, 0.02, 0.05]) list.push({ name: `MACD > ${th}`, buy: [C('macd', 'gt', 'val', th)], sell: [C('macd', 'lt', 'val', th)] });
  list.push({ name: 'MACD ↗ Signal', buy: [C('macd', 'cu', 'ind', 0, 'signal')], sell: [C('macd', 'cd', 'ind', 0, 'signal')] });
  list.push({ name: 'MACD ↗ eMACD', buy: [C('macd', 'cu', 'ind', 0, 'emacd')], sell: [C('macd', 'cd', 'ind', 0, 'emacd')] });
  list.push({ name: 'MACD > Signal', buy: [C('macd', 'gt', 'ind', 0, 'signal')], sell: [C('macd', 'lt', 'ind', 0, 'signal')] });
  list.push({ name: 'MACD > eMACD', buy: [C('macd', 'gt', 'ind', 0, 'emacd')], sell: [C('macd', 'lt', 'ind', 0, 'emacd')] });

  // ── Williams %R: cross-EMA + threshold sweep (symmetric) ──
  for (const p of [50, 100, 200, 260]) {
    list.push({ name: `%R(${p}) ↗ EMA`, buy: [C('wr', 'cu', 'ind', 0, 'wrema', p, p)], sell: [C('wr', 'cd', 'ind', 0, 'wrema', p, p)] });
    for (const th of [30, 40, 50, 60, 70]) list.push({ name: `%R(${p}) > ${th}`, buy: [C('wr', 'gt', 'val', th, 'emacd', p)], sell: [C('wr', 'lt', 'val', th, 'emacd', p)] });
  }
  // %R asymmetric hysteresis (buy high, sell lower → fewer whipsaws)
  for (const [hi, lo] of [[55, 45], [60, 40], [70, 30]]) list.push({ name: `%R(260) >${hi}/<${lo}`, buy: [C('wr', 'gt', 'val', hi, 'emacd', 260)], sell: [C('wr', 'lt', 'val', lo, 'emacd', 260)] });

  // ── RSI: threshold sweep + cross 50 ──
  for (const p of [14, 28, 50]) {
    for (const th of [45, 50, 55, 60]) list.push({ name: `RSI(${p}) > ${th}`, buy: [C('rsi', 'gt', 'val', th, 'emacd', p)], sell: [C('rsi', 'lt', 'val', th, 'emacd', p)] });
    list.push({ name: `RSI(${p}) ↗ 50`, buy: [C('rsi', 'cu', 'val', 50, 'emacd', p)], sell: [C('rsi', 'cd', 'val', 50, 'emacd', p)] });
  }

  // ── Price vs EMA (trend) ──
  for (const p of [20, 50, 100, 150, 200, 377, 610]) list.push({ name: `Fiyat > EMA(${p})`, buy: [C('price', 'gt', 'ind', 0, 'ema', 0, p)], sell: [C('price', 'lt', 'ind', 0, 'ema', 0, p)] });

  // ── EMA crossovers ──
  for (const [a, b] of [[9, 21], [20, 50], [50, 100], [50, 200], [89, 377], [100, 200], [20, 100]]) list.push({ name: `EMA(${a}) ↗ EMA(${b})`, buy: [C('ema', 'cu', 'ind', 0, 'ema', a, b)], sell: [C('ema', 'cd', 'ind', 0, 'ema', a, b)] });

  // ── Supertrend direction ──
  list.push({ name: 'Supertrend yukarı', buy: [C('stdir', 'gt', 'val', 0.5)], sell: [C('stdir', 'lt', 'val', 0.5)] });

  // ── Momentum / ROC (time-series momentum) ──
  for (const p of [126, 252]) {
    list.push({ name: `Momentum ${p} (ROC>0)`, buy: [C('roc', 'gt', 'val', 0, 'emacd', p)], sell: [C('roc', 'lt', 'val', 0, 'emacd', p)] });
    list.push({ name: `Momentum ${p} + Trend(200)`, buy: [C('roc', 'gt', 'val', 0, 'emacd', p), C('price', 'gt', 'ind', 0, 'ema', 0, 200)], sell: [C('roc', 'lt', 'val', 0, 'emacd', p)] });
  }

  // ── ADX trend-strength filter (only trade strong trends) ──
  for (const th of [20, 25, 30]) {
    const adxf = C('adx', 'gt', 'val', th, 'emacd', 14);
    list.push({ name: `MACD>0 + ADX>${th}`, buy: [C('macd', 'gt', 'val', 0), adxf], sell: [C('macd', 'lt', 'val', 0)] });
    list.push({ name: `%R(260)>50 + ADX>${th}`, buy: [C('wr', 'gt', 'val', 50, 'emacd', 260), adxf], sell: [C('wr', 'lt', 'val', 50, 'emacd', 260)] });
    list.push({ name: `Fiyat>EMA200 + ADX>${th}`, buy: [C('price', 'gt', 'ind', 0, 'ema', 0, 200), adxf], sell: [C('price', 'lt', 'ind', 0, 'ema', 0, 200)] });
  }

  // ── Trend-filtered momentum (2 conditions: momentum AND price > long EMA) ──
  const filters: [string, number][] = [['EMA200', 200], ['EMA377', 377]];
  for (const [fname, fp] of filters) {
    const trend = C('price', 'gt', 'ind', 0, 'ema', 0, fp);
    list.push({ name: `MACD>0 + ${fname}`, buy: [C('macd', 'gt', 'val', 0), trend], sell: [C('macd', 'lt', 'val', 0)] });
    list.push({ name: `%R(260)>50 + ${fname}`, buy: [C('wr', 'gt', 'val', 50, 'emacd', 260), trend], sell: [C('wr', 'lt', 'val', 50, 'emacd', 260)] });
    list.push({ name: `RSI(14)>50 + ${fname}`, buy: [C('rsi', 'gt', 'val', 50, 'emacd', 14), trend], sell: [C('rsi', 'lt', 'val', 50, 'emacd', 14)] });
    list.push({ name: `MACD↗Sig + ${fname}`, buy: [C('macd', 'cu', 'ind', 0, 'signal'), trend], sell: [C('macd', 'cd', 'ind', 0, 'signal')] });
  }

  return list.map((s, i) => ({ id: 'opt-' + i, name: s.name, buy: s.buy, sell: s.sell }));
}

function computeSeries(c: Candles, ind: string, p: number, gp: IndicatorParams): Float64Array {
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
      return macdSeries(c, gp).macd;
    case 'signal':
      return macdSeries(c, gp).signal;
    case 'emacd':
      return macdSeries(c, gp).emacd;
    case 'stdir':
      return supertrendDir(c, 10, 3);
    case 'adx':
      return adxArr(c, Math.max(2, p));
    case 'adxema':
      return emaArr(adxArr(c, gp.adx), Math.max(1, p));
    case 'roc':
      return rocArr(close, Math.max(1, p));
    case 'rocema':
      return emaArr(rocArr(close, gp.roc), Math.max(1, p));
    default:
      return close;
  }
}

// `sharedCache` lets the optimizer reuse indicator series across many candidate
// strategies on the same symbol (keyed by indicator:period) instead of
// recomputing EMAs/%R/MACD for every candidate.
export function buildCustomPosition(
  c: Candles,
  s: CustomStrategy,
  sharedCache?: Map<string, Float64Array>,
  gp: IndicatorParams = DEFAULT_PARAMS,
): Uint8Array {
  const n = c.length;
  const cache = sharedCache ?? new Map<string, Float64Array>();
  const ser = (ind: string, p: number) => {
    const k = ind + ':' + p;
    let v = cache.get(k);
    if (!v) {
      v = computeSeries(c, ind, p, gp);
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
  const hh = rollingHighest(c.high, len); // O(n) sliding window (same trailing window as before)
  const ll = rollingLowest(c.low, len);
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const d = hh[i] - ll[i];
    out[i] = d !== 0 ? (100 * (c.close[i] - hh[i])) / d + 100 : NaN;
  }
  return out;
}

function macdSeries(c: Candles, gp: IndicatorParams): { macd: Float64Array; signal: Float64Array; emacd: Float64Array } {
  const n = c.length;
  const fast = emaArr(c.close, gp.macdFast);
  const slow = emaArr(c.close, gp.macdSlow);
  const macd = new Float64Array(n);
  for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
  const signal = emaArr(macd, gp.macdSig);
  const emacd = rollingVWMA(macd, c.volume, gp.macdVwma);
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
