import {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
  LineData,
  LogicalRange,
  Logical,
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
  private bandSegs: { a: number; b: number }[] = []; // per-trade P&L band ranges

  constructor(
    private chart: IChartApi,
    private candle: ISeriesApi<'Candlestick'>,
    private volume: ISeriesApi<'Histogram'>,
    private extras: ExtraSpec[],
    private bandPool: ISeriesApi<'Baseline'>[] = [],
  ) {
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
  }

  // fit=true frames the latest bars; fit=false keeps the SAME zoom when only the
  // symbol changes — same visible bar count AND the same gap from the right edge,
  // including any whitespace the user left on either side.
  setData(full: Candles, extraVals: Float64Array[], fit = true) {
    // New dataset → drop any P&L bands from the previous symbol/strategy.
    this.bandSegs = [];
    for (const b of this.bandPool) b.setData([]);
    let keep: { visReal: number; gapReal: number } | null = null;
    if (!fit && this.hasView && this.full) {
      const lr = this.chart.timeScale().getVisibleLogicalRange();
      if (lr) {
        // Convert the visible logical range → REAL bar coords of the OLD symbol.
        const { i0, stride } = this.win;
        const viewR = i0 + lr.to * stride;
        const viewL = i0 + lr.from * stride;
        // gapReal < 0 ⇒ whitespace to the right of the last bar (kept on purpose).
        keep = { visReal: Math.max(1, viewR - viewL), gapReal: this.full.length - viewR };
      }
    }

    this.full = full;
    this.extraVals = extraVals;
    if (full.length === 0) {
      this.candle.setData([]);
      this.volume.setData([]);
      this.extras.forEach((e) => e.series.setData([]));
      this.hasView = false;
      return;
    }

    if (keep) this.renderForView(keep.visReal, keep.gapReal);
    else {
      const show = Math.min(400, full.length);
      this.renderWindow(full.length - show, full.length, true);
    }
    this.hasView = true;
  }

  // Re-frame the new dataset to show `visReal` bars with `gapReal` bars between the
  // view's right edge and the last bar (negative gapReal = right-side whitespace).
  // Left/right whitespace is preserved by letting the visible logical range extend
  // beyond [0, decLen]; only the decimation window is clamped to real data.
  private renderForView(visReal: number, gapReal: number) {
    if (!this.full) return;
    const len = this.full.length;
    const toReal = len - gapReal; // right edge in real coords (may exceed len → whitespace)
    const fromReal = toReal - visReal; // left edge (may be < 0 → whitespace)
    // If the preserved window no longer overlaps real data (e.g. scrolled far back
    // then switched to a much shorter symbol), just frame the latest bars.
    if (toReal <= 1 || fromReal >= len - 1) {
      const show = Math.min(400, len);
      this.renderWindow(len - show, len, true);
      return;
    }
    const stride = strideFor(visReal, this.targetBuckets);
    const margin = Math.max(visReal, this.targetBuckets);
    let w0 = Math.floor(Math.max(0, fromReal) - margin);
    let w1 = Math.ceil(Math.min(len, toReal) + margin);
    if (w0 < 0) w0 = 0;
    if (w1 > len) w1 = len;

    const { candles, volumes } = decimate(this.full, w0, w1, stride);
    if (candles.length === 0) {
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
    this.renderBands();
    // Map the desired real-index viewport into decimated logical coords; values
    // outside [0, decLen] render as the preserved whitespace.
    this.chart.timeScale().setVisibleLogicalRange({ from: (fromReal - w0) / stride, to: (toReal - w0) / stride });
    requestAnimationFrame(() => {
      this.applying = false;
    });
  }

  // Zoom to a specific date range (used to inspect one trade, and to keep the
  // same date window when only the symbol changes). padFrac=0 → exact window.
  focusRange(t0: number, t1: number, padFrac = 0.3) {
    if (!this.full || this.full.length === 0) return;
    const len = this.full.length;
    const i0 = lb(this.full.time, t0);
    let i1 = lb(this.full.time, t1);
    if (i1 > len - 1) i1 = len - 1;
    if (i1 < i0) i1 = i0;
    const span = Math.max(2, i1 - i0);
    const pad = padFrac > 0 ? Math.max(3, Math.round(span * padFrac)) : 0;
    const visLo = Math.max(0, i0 - pad);
    const visHi = Math.min(len - 1, i1 + pad);
    const stride = strideFor(visHi - visLo + 1, this.targetBuckets);
    const margin = Math.max(span, this.targetBuckets);
    let w0 = Math.floor(visLo - margin);
    let w1 = Math.ceil(visHi + margin + 1);
    if (w0 < 0) w0 = 0;
    if (w1 > len) w1 = len;

    const { candles, volumes } = decimate(this.full, w0, w1, stride);
    if (candles.length === 0) return;

    this.applying = true;
    this.candle.setData(candles);
    this.volume.setData(volumes);
    for (let k = 0; k < this.extras.length; k++) {
      const vals = this.extraVals[k];
      if (!vals) continue;
      this.extras[k].series.setData(buildExtra(this.full, vals, w0, w1, stride, this.extras[k]) as never);
    }
    this.win = { i0: w0, i1: w1, stride };
    this.renderBands();
    this.chart.timeScale().setVisibleRange({
      from: this.full.time[visLo] as UTCTimestamp,
      to: this.full.time[visHi] as UTCTimestamp,
    });
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

    // Current viewport expressed in REAL data indices (range is in decimated
    // logical coords). Preserved exactly so a reflow never snaps the view.
    const visLo = w0 + range.from * stride;
    const visHi = w0 + range.to * stride;
    const visBars = Math.max(1, visHi - visLo);
    const desiredStride = strideFor(visBars, this.targetBuckets);

    const pad = (w1 - w0) * 0.15;
    const nearLeft = visLo < w0 + pad;
    const nearRight = visHi > w1 - pad;

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
    this.renderRealView(i0, i1, desiredStride, visLo, visHi);
  }

  // Re-decimate the window and restore the *exact* real-index viewport in the new
  // decimated coordinates. Deterministic — never reads getVisibleRange (which can
  // momentarily return null mid-gesture and snap the chart to the right edge).
  private renderRealView(w0: number, w1: number, stride: number, visLo: number, visHi: number) {
    if (!this.full) return;
    const { candles, volumes } = decimate(this.full, w0, w1, stride);
    if (candles.length === 0) return;
    this.applying = true;
    this.candle.setData(candles);
    this.volume.setData(volumes);
    for (let k = 0; k < this.extras.length; k++) {
      const vals = this.extraVals[k];
      if (!vals) continue;
      this.extras[k].series.setData(buildExtra(this.full, vals, w0, w1, stride, this.extras[k]) as never);
    }
    this.win = { i0: w0, i1: w1, stride };
    this.renderBands();
    this.chart.timeScale().setVisibleLogicalRange({
      from: (visLo - w0) / stride,
      to: (visHi - w0) / stride,
    });
    requestAnimationFrame(() => {
      this.applying = false;
    });
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
    this.renderBands();

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
      const j = this.full.length - 1; // draw the MERGED bar extremes, not the raw tick
      this.candle.update({ time: t, open: this.full.open[j], high: this.full.high[j], low: this.full.low[j], close: this.full.close[j] });
      this.volume.update({ time: t, value: this.full.volume[j], color: this.full.close[j] >= this.full.open[j] ? UP_VOL : DOWN_VOL });
      this.win.i1 = this.full.length;
      requestAnimationFrame(() => {
        this.applying = false;
      });
    } else if (appended) {
      this.renderWindow(this.win.i0, this.full.length, false, this.win.stride);
    }
  }

  // Swap one extra series' full-resolution values and redraw just that series
  // for the current window (no view reset). Used for the strategy position shade.
  updateExtra(series: ExtraSpec['series'], vals: Float64Array) {
    const i = this.extras.findIndex((e) => e.series === series);
    if (i < 0) return;
    this.extraVals[i] = vals;
    if (!this.full) return;
    const { i0, i1, stride } = this.win;
    this.applying = true;
    this.extras[i].series.setData(buildExtra(this.full, vals, i0, i1, stride, this.extras[i]) as never);
    requestAnimationFrame(() => {
      this.applying = false;
    });
  }

  // P&L bands: one baseline series per trade (entry→exit). Each fills between the
  // price and its entry price (set as the series' baseValue in Chart): green when
  // price is above entry (profit), red below (loss). Decimated in lockstep with
  // the candles — band points reuse candle bucket timestamps so the time scale
  // (and the LOD's logical-range math) stays consistent.
  setBands(segs: { a: number; b: number }[]) {
    this.applying = true;
    this.bandSegs = segs;
    for (let k = segs.length; k < this.bandPool.length; k++) this.bandPool[k].setData([]);
    this.renderBands();
    requestAnimationFrame(() => {
      this.applying = false;
    });
  }

  private renderBands() {
    if (!this.full || this.bandPool.length === 0) return;
    const { i0, i1, stride } = this.win;
    const lim = Math.min(this.bandSegs.length, this.bandPool.length);
    for (let k = 0; k < lim; k++) {
      const seg = this.bandSegs[k];
      this.bandPool[k].setData(buildBand(this.full, seg.a, seg.b, i0, i1, stride) as never);
    }
  }

  // Nearest full-data index for a timestamp (binary search). Used by drawings to
  // re-anchor across zoom/pan even when the bar isn't in the current window.
  indexForTime(t: number): number {
    if (!this.full || this.full.length === 0) return 0;
    const arr = this.full.time;
    const hi0 = this.full.length - 1;
    if (t <= arr[0]) return 0;
    if (t >= arr[hi0]) return hi0;
    let lo = 0;
    let hi = hi0;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (arr[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  // Screen x for a timestamp, via the current decimated window → logical coord.
  // Works for off-window times too (extrapolated), so drawings stay anchored.
  xForTime(t: number): number | null {
    if (!this.full) return null;
    const ri = this.indexForTime(t);
    const logical = (ri - this.win.i0) / this.win.stride;
    return this.chart.timeScale().logicalToCoordinate(logical as Logical);
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

// Decimated close points for one trade segment [a,b], aligned to the SAME bucket
// timestamps as the candles (c.time[s]) so no new time points enter the scale.
function buildBand(c: Candles, a: number, b: number, i0: number, i1: number, stride: number): LineData[] {
  const out: LineData[] = [];
  if (i1 > c.length) i1 = c.length;
  if (i0 < 0) i0 = 0;
  if (stride < 1) stride = 1;
  for (let s = i0; s < i1; s += stride) {
    if (s < a || s > b) continue;
    const e = Math.min(s + stride, i1);
    out.push({ time: c.time[s] as UTCTimestamp, value: c.close[e - 1] });
  }
  return out;
}

function strideFor(bars: number, target: number): number {
  const s = Math.max(1, Math.ceil(bars / target));
  return 1 << Math.ceil(Math.log2(s));
}

// First index whose time is >= x (ascending binary search).
function lb(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (arr[m] < x) lo = m + 1;
    else hi = m;
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
