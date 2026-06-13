import {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
  LogicalRange,
} from 'lightweight-charts';
import { Candles, LiveBar, emptyCandles } from '../data/types';

const UP_VOL = 'rgba(38,166,154,0.5)';
const DOWN_VOL = 'rgba(239,83,80,0.5)';

// Level-of-detail controller. Holds the *full* dataset and only ever feeds the
// chart a viewport-sized, decimated window (min/max OHLC buckets, ~one per
// pixel-ish). So the number of points the chart renders is bounded regardless of
// dataset size — this is what keeps pan/zoom smooth at millions of bars.
export class LodController {
  private full: Candles | null = null;
  private readonly targetBuckets = 4000;
  private applying = false;
  private win = { i0: 0, i1: 0, stride: 1 };
  private raf = 0;

  constructor(
    private chart: IChartApi,
    private candle: ISeriesApi<'Candlestick'>,
    private volume: ISeriesApi<'Histogram'>,
  ) {
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
  }

  setData(full: Candles) {
    this.full = full;
    if (full.length === 0) {
      this.candle.setData([]);
      this.volume.setData([]);
      return;
    }
    const show = Math.min(400, full.length);
    this.renderWindow(full.length - show, full.length, true);
  }

  private onRange = (range: LogicalRange | null) => {
    if (this.applying || !this.full || !range) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.maybeReflow(range));
  };

  private maybeReflow(range: LogicalRange) {
    if (!this.full) return;
    const count = Math.ceil((this.win.i1 - this.win.i0) / this.win.stride);
    const visFrom = this.win.i0 + Math.max(0, Math.floor(range.from)) * this.win.stride;
    const visTo = this.win.i0 + Math.min(count, Math.ceil(range.to)) * this.win.stride;
    const visBars = Math.max(1, visTo - visFrom);
    const desiredStride = strideFor(visBars, this.targetBuckets);

    // If detail is right and the view sits inside the loaded window, the chart's
    // own panning handles it — nothing to do.
    const innerPad = (this.win.i1 - this.win.i0) * 0.15;
    const inside = visFrom > this.win.i0 + innerPad && visTo < this.win.i1 - innerPad;
    if (desiredStride === this.win.stride && inside) return;

    const margin = visBars * 1.5;
    let i0 = Math.floor(visFrom - margin);
    let i1 = Math.ceil(visTo + margin);
    if (i0 < 0) i0 = 0;
    if (i1 > this.full.length) i1 = this.full.length;
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

  // Live update: mutate the last bar (or append a new one) and reflect it.
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
    if (!atEdge) return; // viewing history; it'll appear when panned to

    if (this.win.stride === 1) {
      // Full detail at the edge: cheapest path, lets the chart auto-scroll.
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

// Round the needed stride up to a power of two so detail changes in stable steps
// (avoids re-decimating on every tiny zoom).
function strideFor(bars: number, target: number): number {
  const s = Math.max(1, Math.ceil(bars / target));
  return 1 << Math.ceil(Math.log2(s));
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
