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

// ── Extra long-term indicators (shared by the chart + strategy engine) ───────
// Rate of change (%) vs `len` bars ago — time-series momentum.
export function rocArr(close: Float64Array, len: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = len; i < n; i++) out[i] = close[i - len] > 0 ? (close[i] / close[i - len] - 1) * 100 : NaN;
  return out;
}

// Wilder ADX (trend strength, 0–100). High = strong trend (worth following).
export function adxArr(c: Candles, len: number): Float64Array {
  const n = c.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < len + 1) return out;
  const tr = new Float64Array(n);
  const pdm = new Float64Array(n);
  const ndm = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = c.high[i] - c.high[i - 1];
    const dn = c.low[i - 1] - c.low[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    ndm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(c.high[i] - c.low[i], Math.abs(c.high[i] - c.close[i - 1]), Math.abs(c.low[i] - c.close[i - 1]));
  }
  let str = 0;
  let spdm = 0;
  let sndm = 0;
  for (let i = 1; i <= len; i++) {
    str += tr[i];
    spdm += pdm[i];
    sndm += ndm[i];
  }
  const dx = new Float64Array(n).fill(NaN);
  for (let i = len + 1; i < n; i++) {
    str = str - str / len + tr[i];
    spdm = spdm - spdm / len + pdm[i];
    sndm = sndm - sndm / len + ndm[i];
    const pdi = str ? (100 * spdm) / str : 0;
    const ndi = str ? (100 * sndm) / str : 0;
    const s = pdi + ndi;
    dx[i] = s ? (100 * Math.abs(pdi - ndi)) / s : 0;
  }
  const firstDx = len + 1;
  if (firstDx + len > n) return out;
  let adx = 0;
  for (let i = firstDx; i < firstDx + len; i++) adx += dx[i];
  adx /= len;
  out[firstDx + len - 1] = adx;
  for (let i = firstDx + len; i < n; i++) {
    adx = (adx * (len - 1) + dx[i]) / len;
    out[i] = adx;
  }
  return out;
}

// Display-period bundle for the chart overlays/panes.
export interface ExtraBundle {
  adx: Float64Array;
  adxEma: Float64Array;
  roc: Float64Array;
  rocEma: Float64Array;
}
export function computeExtras(c: Candles, p: IndicatorParams = DEFAULT_PARAMS): ExtraBundle {
  // All long-term by the 260-day paradigm (ADX 260 / EMA 120 too). Note ADX(260)
  // flattens to ~5 and rarely crosses 25 — kept long for paradigm consistency.
  const adx = adxArr(c, p.adx);
  const roc = rocArr(c.close, p.roc);
  return {
    adx,
    adxEma: emaArr(adx, p.adxEma),
    roc,
    rocEma: emaArr(roc, p.rocEma),
  };
}

export interface IndBundle {
  ema377p: Float64Array; // ema(close, 377) — price overlay
  ema610p: Float64Array; // ema(close, 610) — price overlay
  percentR: Float64Array; // Williams %R + 100
  emawil: Float64Array; // ema of %R (260)
  emawil120: Float64Array; // ema of %R (120) — faster
  macdN: Float64Array; // macd / fast
  signalN: Float64Array;
  histN: Float64Array;
  eMacDN: Float64Array; // vwma(macd) / fast
  deltaN: Float64Array; // (macd - eMacD) / fast
}

// User-editable indicator periods (defaults = the app's 260-day paradigm).
export interface IndicatorParams {
  emaFast: number; // price EMA #1 (377)
  emaSlow: number; // price EMA #2 (610)
  wr: number; // Williams %R lookback (260)
  wrEmaA: number; // %R EMA slow (260)
  wrEmaB: number; // %R EMA fast (120)
  macdFast: number; // NizamiCedid fast (120)
  macdSlow: number; // slow (260)
  macdSig: number; // signal (50)
  macdVwma: number; // eMACD vwma (185)
  adx: number; // ADX (28)
  adxEma: number; // ADX EMA (14)
  roc: number; // Momentum/ROC (260)
  rocEma: number; // ROC EMA (120)
}
export const DEFAULT_PARAMS: IndicatorParams = {
  emaFast: 377, emaSlow: 610, wr: 260, wrEmaA: 260, wrEmaB: 120,
  macdFast: 120, macdSlow: 260, macdSig: 50, macdVwma: 185,
  adx: 260, adxEma: 120, roc: 260, rocEma: 120,
};

// Period currently active on the chart for a builder/screener indicator key, so
// new strategy conditions and live filters default to what the user sees on the
// chart. Returns 0 when the key has no chart-period concept (e.g. price, macd).
export function activePeriod(key: string, p: IndicatorParams = DEFAULT_PARAMS): number {
  switch (key) {
    case 'ema':
    case 'emadist':
      return p.emaFast;
    case 'wr':
      return p.wr;
    case 'wrema':
      return p.wrEmaA;
    case 'adx':
      return p.adx;
    case 'adxema':
      return p.adxEma;
    case 'roc':
      return p.roc;
    case 'rocema':
      return p.rocEma;
    case 'rsi':
      return 14;
    default:
      return 0;
  }
}

// Translates the user's "Williams Paşa" (%R) and "NizamiCedid" (MACD) Pine
// indicators. MACD plots are normalized by the fast EMA, exactly as in the
// original script.
export function computeIndicators(c: Candles, p: IndicatorParams = DEFAULT_PARAMS): IndBundle {
  const n = c.length;

  const fast = emaArr(c.close, p.macdFast);
  const slow = emaArr(c.close, p.macdSlow);
  const macd = new Float64Array(n);
  for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
  const signal = emaArr(macd, p.macdSig);
  const hist = new Float64Array(n);
  for (let i = 0; i < n; i++) hist[i] = macd[i] - signal[i];
  const eMacD = rollingVWMA(macd, c.volume, p.macdVwma);

  const ema377p = emaArr(c.close, p.emaFast);
  const ema610p = emaArr(c.close, p.emaSlow);

  const hh = rollingHighest(c.high, p.wr);
  const ll = rollingLowest(c.low, p.wr);

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

  const emawil = emaArr(percentR, p.wrEmaA);
  const emawil120 = emaArr(percentR, p.wrEmaB);

  return { ema377p, ema610p, percentR, emawil, emawil120, macdN, signalN, histN, eMacDN, deltaN };
}
