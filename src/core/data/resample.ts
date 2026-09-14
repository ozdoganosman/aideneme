import { Candles, emptyCandles } from './types';

export type TF = 'D' | 'W' | 'M';

// Aggregate daily candles into weekly/monthly OHLCV (client-side). 'D' returns
// the input unchanged.
export function resample(d: Candles, tf: TF): Candles {
  if (tf === 'D' || d.length === 0) return d;

  const t: number[] = [];
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  const v: number[] = [];

  let key = '';
  for (let i = 0; i < d.length; i++) {
    const k = tf === 'M' ? monthKey(d.time[i]) : weekKey(d.time[i]);
    if (k !== key) {
      // start a new bucket
      t.push(d.time[i]);
      o.push(d.open[i]);
      h.push(d.high[i]);
      l.push(d.low[i]);
      c.push(d.close[i]);
      v.push(d.volume[i]);
      key = k;
    } else {
      const j = t.length - 1;
      if (d.high[i] > h[j]) h[j] = d.high[i];
      if (d.low[i] < l[j]) l[j] = d.low[i];
      c[j] = d.close[i];
      v[j] += d.volume[i];
    }
  }

  const r = emptyCandles(t.length);
  for (let i = 0; i < t.length; i++) {
    r.time[i] = t[i];
    r.open[i] = o[i];
    r.high[i] = h[i];
    r.low[i] = l[i];
    r.close[i] = c[i];
    r.volume[i] = v[i];
  }
  return r;
}

function monthKey(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

// Key by the Monday of the week (UTC).
function weekKey(sec: number): string {
  const d = new Date(sec * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return String(monday);
}
