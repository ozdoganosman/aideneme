import {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
  LineData,
  LogicalRange,
} from 'lightweight-charts';
import { Candles, LiveBar, emptyCandles } from '../data/types';

const UP_VOL = 'rgba(38,166,154,0.5)';
const DOWN_VOL = 'rgba(239,83,80,0.5)';
const UP = '#26a69a';
const UP_SOFT = '#1b5e54';
const DOWN = '#ef5350';
const DOWN_SOFT = '#7f3a39';

// An extra indicator series rendered alongside the candles. Its full-data values
// are decimated with the same buckets as the candles each frame.
export interface ExtraSpec {
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Area'>;
  kind: 'line' | 'hist' | 'area';
  momentumColor?: boolean; // histogram coloring like the MACD script
}

// Level-of-detail controller: holds the full dataset and only ever feeds the
// chart a viewport-sized, decimated window — so render cost is bounded by the
// screen, not the dataset size. Indicators ride along on the same buckets.
export class LodController {
  private full: Candles | null = null;
  private extraVals: Float64Array[] = [];
  private readonly targetBuckets = 4000;
  private applying = false;
  private win = { i0: 0, i1: 0, stride: 1 };
  private raf = 0;
  private hasView = false; // becomes true after the first render

  constructor(
    private chart: IChartApi,
    private candle: ISeriesApi<'Candlestick'>,
    private volume: ISeriesApi<'Histogram'>,
    private extras: ExtraSpec[],
  ) {
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
  }

  // fit=true frames the latest bars; fit=false preserves the current visible
  // time range + zoom (used when only the symbol changes).
  setData(full: Candles, extraVals: Float64Array[], fit = true) {
    const savedRange =
      !fit && this.hasView ? this.chart.timeScale().getVisibleRange() : null;

    this.full = full;
    this.extraVals = extraVals;
    if (full.length === 0) {
      this.candle.setData([]);
      this.volume.setData([]);
      this.extras.forEach((e) => e.series.setData([]));
      this.hasView = false;
      return;
    }

    if (savedRange) {
      this.renderForRange(Number(savedRange.from), Number(savedRange.to));
    } else {
      const show = Math.min(400, full.length);
      this.renderWindow(full.length - show, full.length, true);
    }
    this.hasView = true;
  }

  // Render the new dataset keeping the given time window (preserves zoom + X).
  private renderForRange(t0: number, t1: number) {
    if (!this.full) return;
    const len = this.full.length;
    const i0 = lowerBound(this.full.time, t0);
    const i1 = Math.max(i0, lowerBound(this.full.time, t1));
    const visBars = Math.max(1, i1 - i0);
    const stride = strideFor(visBars, this.targetBuckets);
    const margin = Math.max(visBars, this.targetBuckets);
    let w0 = Math.floor(i0 - margin);
    let w1 = Math.ceil(i1 + margin);
    if (w0 < 0) w0 = 0;
    if (w1 > len) w1 = len;

    const { candles, volumes } = decimate(this.full, w0, w1, stride);
    if (candles.length === 0) {
      // Saved window doesn't overlap the new data — just frame the latest.
      const show = Math.min(400, len);
      this.renderWindow(len - show, len, true);
      return;
    }

    this.applying = true;
    this.candle.setData(candles);
    this.volume.setData(volumes);
    for (let k = 0; k < this.extras.length; k++) {
      const vals = this.extraVals[k];
      if (!vals) continue;
      this.extras[k].series.setData(buildExtra(this.full, vals, w0, w1, stride, this.extras[k]) as never);
    }
    this.win = { i0: w0, i1: w1, stride };
    this.chart.timeScale().setVisibleRange({ from: t0 as UTCTimestamp, to: t1 as UTCTimestamp });
    requestAnimationFrame(() => {
      this.applying = false;
    });
  }

  private onRange = (range: LogicalRange | null) => {
    if (this.applying || !this.full || !range) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.maybeReflow(range));
  };

  private maybeReflow(range: LogicalRange) {
    if (!this.full) return;
    const len = this.full.length;
    const { i0: w0, i1: w1, stride } = this.win;
    const count = Math.ceil((w1 - w0) / stride);

    const fromIdx = Math.max(0, Math.floor(range.from));
    const toIdx = Math.min(count, Math.ceil(range.to));
    const visLo = w0 + fromIdx * stride;
    const visHi = w0 + toIdx * stride;
    const visBars = Math.max(1, visHi - visLo);
    const desiredStride = strideFor(visBars, this.targetBuckets);

    const rawLo = w0 + range.from * stride;
    const rawHi = w0 + range.to * stride;
    const pad = (w1 - w0) * 0.15;
    const nearLeft = rawLo < w0 + pad;
    const nearRight = rawHi > w1 - pad;

    // At the data boundary we do nothing, so the chart scrolls into whitespace
    // instead of snapping/zooming.
    const needReflow =
      desiredStride !== stride || (nearLeft && w0 > 0) || (nearRight && w1 < len);
    if (!needReflow) return;

    const margin = Math.max(visBars, this.targetBuckets);
    let i0 = Math.floor(visLo - margin);
    let i1 = Math.ceil(visHi + margin);
    if (i0 < 0) i0 = 0;
    if (i1 > len) i1 = len;
    this.renderWindow(i0, i1, false, desiredStride);
  }

  private renderWindow(i0: number, i1: number, fit: boolean, stride?: number) {
    if (!this.full) return;
    const s = stride ?? strideFor(i1 - i0, this.targetBuckets);
    const prev = fit ? null : this.chart.timeScale().getVisibleRange();

    const { candles, volumes } = decimate(this.full, i0, i1, s);
    if (candles.length === 0) return;

    this.applying = true;
    this.candle.setData(candles);
    this.volume.setData(volumes);
    for (let k = 0; k < this.extras.length; k++) {
      const vals = this.extraVals[k];
      if (!vals) continue;
      this.extras[k].series.setData(buildExtra(this.full, vals, i0, i1, s, this.extras[k]) as never);
    }
    this.win = { i0, i1, stride: s };

    if (fit) {
      const from = candles[Math.max(0, candles.length - 120)].time;
      const to = candles[candles.length - 1].time;
      this.chart.timeScale().setVisibleRange({ from, to });
    } else if (prev) {
      this.chart.timeScale().setVisibleRange(prev);
    }
    requestAnimationFrame(() => {
      this.applying = false;
    });
  }

  updateLast(b: LiveBar) {
    if (!this.full) return;
    const n = this.full.length;
    let appended = false;

    if (n > 0 && b.time <= this.full.time[n - 1]) {
      this.full.close[n - 1] = b.close;
      if (b.high > this.full.high[n - 1]) this.full.high[n - 1] = b.high;
      if (b.low < this.full.low[n - 1]) this.full.low[n - 1] = b.low;
      this.full.volume[n - 1] = b.volume;
    } else {
      this.full = appendCandle(this.full, b);
      appended = true;
    }

    const atEdge = this.win.i1 >= n - 1;
    if (!atEdge) return;

    if (this.win.stride === 1) {
      this.applying = true;
      const t = b.time as UTCTimestamp;
      this.candle.update({ time: t, open: b.open, high: b.high, low: b.low, close: b.close });
      this.volume.update({ time: t, value: b.volume, color: b.close >= b.open ? UP_VOL : DOWN_VOL });
      this.win.i1 = this.full.length;
      requestAnimationFrame(() => {
        this.applying = false;
      });
    } else if (appended) {
      this.renderWindow(this.win.i0, this.full.length, false, this.win.stride);
    }
  }

  lastBar(): { time: number; open: number; high: number; low: number; close: number; volume: number } | null {
    if (!this.full || this.full.length === 0) return null;
    const n = this.full.length - 1;
    return {
      time: this.full.time[n],
      open: this.full.open[n],
      high: this.full.high[n],
      low: this.full.low[n],
      close: this.full.close[n],
      volume: this.full.volume[n],
    };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange);
  }
}

function decimate(c: Candles, i0: number, i1: number, stride: number) {
  const candles: CandlestickData[] = [];
  const volumes: HistogramData[] = [];
  if (i1 > c.length) i1 = c.length;
  if (i0 < 0) i0 = 0;
  if (stride < 1) stride = 1;

  for (let s = i0; s < i1; s += stride) {
    const e = Math.min(s + stride, i1);
    let hi = c.high[s];
    let lo = c.low[s];
    let vol = 0;
    for (let i = s; i < e; i++) {
      if (c.high[i] > hi) hi = c.high[i];
      if (c.low[i] < lo) lo = c.low[i];
      vol += c.volume[i];
    }
    const open = c.open[s];
    const close = c.close[e - 1];
    const t = c.time[s] as UTCTimestamp;
    candles.push({ time: t, open, high: hi, low: lo, close });
    volumes.push({ time: t, value: vol, color: close >= open ? UP_VOL : DOWN_VOL });
  }
  return { candles, volumes };
}

function buildExtra(
  c: Candles,
  vals: Float64Array,
  i0: number,
  i1: number,
  stride: number,
  spec: ExtraSpec,
): Array<LineData | HistogramData> {
  const out: Array<LineData | HistogramData> = [];
  if (i1 > c.length) i1 = c.length;
  let prev = NaN;
  for (let s = i0; s < i1; s += stride) {
    const e = Math.min(s + stride, i1);
    const v = vals[e - 1];
    if (v === undefined || !Number.isFinite(v)) continue;
    const t = c.time[s] as UTCTimestamp;
    if (spec.kind === 'hist') {
      let color: string;
      if (spec.momentumColor) {
        color = v >= 0 ? (v >= prev ? UP : UP_SOFT) : v <= prev ? DOWN : DOWN_SOFT;
      } else {
        color = v >= 0 ? UP : DOWN;
      }
      out.push({ time: t, value: v, color });
    } else {
      out.push({ time: t, value: v });
    }
    prev = v;
  }
  return out;
}

function strideFor(bars: number, target: number): number {
  const s = Math.max(1, Math.ceil(bars / target));
  return 1 << Math.ceil(Math.log2(s));
}

// First index whose time is >= x (binary search over ascending times).
function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function appendCandle(c: Candles, b: LiveBar): Candles {
  const n = c.length;
  const nc = emptyCandles(n + 1);
  nc.time.set(c.time);
  nc.open.set(c.open);
  nc.high.set(c.high);
  nc.low.set(c.low);
  nc.close.set(c.close);
  nc.volume.set(c.volume);
  nc.time[n] = b.time;
  nc.open[n] = b.open;
  nc.high[n] = b.high;
  nc.low[n] = b.low;
  nc.close[n] = b.close;
  nc.volume[n] = b.volume;
  return nc;
}
