import { Candles } from '../data/types';

// Indicator math, computed over the full dataset with O(N) algorithms so it
// stays fast at millions of bars. Values are NaN during warmup; the chart layer
// simply skips NaN points.

export function emaArr(src: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  const a = 2 / (length + 1);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    prev = Number.isFinite(prev) ? a * v + (1 - a) * prev : v;
    out[i] = prev;
  }
  return out;
}

// Sliding-window maximum via a monotonic deque (O(N)).
export function rollingHighest(arr: Float64Array, length: number): Float64Array {
  const n = arr.length;
  const out = new Float64Array(n);
  const dq: number[] = [];
  for (let i = 0; i < n; i++) {
    while (dq.length && arr[dq[dq.length - 1]] <= arr[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - length) dq.shift();
    out[i] = arr[dq[0]];
  }
  return out;
}

export function rollingLowest(arr: Float64Array, length: number): Float64Array {
  const n = arr.length;
  const out = new Float64Array(n);
  const dq: number[] = [];
  for (let i = 0; i < n; i++) {
    while (dq.length && arr[dq[dq.length - 1]] >= arr[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - length) dq.shift();
    out[i] = arr[dq[0]];
  }
  return out;
}

// Volume-weighted moving average over a sliding window (O(N)).
export function rollingVWMA(src: Float64Array, vol: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  let sw = 0;
  let sv = 0;
  for (let i = 0; i < n; i++) {
    sw += src[i] * vol[i];
    sv += vol[i];
    if (i >= length) {
      sw -= src[i - length] * vol[i - length];
      sv -= vol[i - length];
    }
    out[i] = sv !== 0 ? sw / sv : NaN;
  }
  return out;
}

export interface IndBundle {
  ema377p: Float64Array; // ema(close, 377) — price overlay
  ema610p: Float64Array; // ema(close, 610) — price overlay
  percentR: Float64Array; // Williams %R + 100
  emawil: Float64Array; // ema of %R
  macdN: Float64Array; // macd / fast
  signalN: Float64Array;
  histN: Float64Array;
  eMacDN: Float64Array; // vwma(macd) / fast
  deltaN: Float64Array; // (macd - eMacD) / fast
}

// Translates the user's "Williams Paşa" (%R) and "NizamiCedid" (MACD) Pine
// indicators. MACD plots are normalized by the fast EMA, exactly as in the
// original script.
export function computeIndicators(c: Candles): IndBundle {
  const n = c.length;

  const fast = emaArr(c.close, 120);
  const slow = emaArr(c.close, 260);
  const macd = new Float64Array(n);
  for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
  const signal = emaArr(macd, 50);
  const hist = new Float64Array(n);
  for (let i = 0; i < n; i++) hist[i] = macd[i] - signal[i];
  const eMacD = rollingVWMA(macd, c.volume, 185);

  const ema377p = emaArr(c.close, 377);
  const ema610p = emaArr(c.close, 610);

  const hh = rollingHighest(c.high, 260);
  const ll = rollingLowest(c.low, 260);

  const percentR = new Float64Array(n);
  const macdN = new Float64Array(n);
  const signalN = new Float64Array(n);
  const histN = new Float64Array(n);
  const eMacDN = new Float64Array(n);
  const deltaN = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const den = hh[i] - ll[i];
    percentR[i] = den !== 0 ? (100 * (c.close[i] - hh[i])) / den + 100 : NaN;
    const f = fast[i];
    const inv = f !== 0 ? 1 / f : NaN;
    macdN[i] = macd[i] * inv;
    signalN[i] = signal[i] * inv;
    histN[i] = hist[i] * inv;
    eMacDN[i] = eMacD[i] * inv;
    deltaN[i] = (macd[i] - eMacD[i]) * inv;
  }

  const emawil = emaArr(percentR, 260);

  return { ema377p, ema610p, percentR, emawil, macdN, signalN, histN, eMacDN, deltaN };
}
