import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  BaselineSeries,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  CandlestickData,
  HistogramData,
  LineData,
} from 'lightweight-charts';
import { Candles, LiveBar } from '../data/types';
import { LodController, ExtraSpec } from '../chart/lod';
import { computeIndicators, computeExtras, IndicatorParams, DEFAULT_PARAMS } from '../indicators/calc';
import { signalsFor, buildPositionByName } from '../indicators/backtest';

export interface IndicatorSettings {
  ema: boolean;
  volume: boolean;
  williams: boolean;
  macd: boolean;
  adx: boolean;
  roc: boolean;
  volprofile: boolean;
}

export interface ChartHandle {
  updateLast: (b: LiveBar) => void;
}

interface Props {
  candles: Candles | null;
  fitOnLoad?: boolean;
  settings: IndicatorSettings;
  params?: IndicatorParams; // editable indicator periods
  symbol: string;
  tfLabel: string;
  strategy?: string | null; // overlay this strategy's buy/sell signals
  costLine?: { price: number; label: string } | null; // portfolio avg-cost line
  log?: boolean; // logarithmic price scale
  focus?: { entryTime: number; exitTime: number | null } | null; // zoom to one trade
}

interface LegendVals {
  o: number; h: number; l: number; c: number; v: number;
  ema377: number; ema610: number;
  wilR: number; wilEma: number; wilEma120: number;
  macd: number; signal: number; emacd: number;
  adx: number; adxEma: number; roc: number; rocEma: number;
}

type SeriesBag = {
  candle: ISeriesApi<'Candlestick'>;
  ema377: ISeriesApi<'Line'>;
  ema610: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  wilR: ISeriesApi<'Line'>;
  wilEma: ISeriesApi<'Line'>;
  wilEma120: ISeriesApi<'Line'>;
  mMacd: ISeriesApi<'Line'>;
  mSignal: ISeriesApi<'Line'>;
  mEma: ISeriesApi<'Line'>;
  adx: ISeriesApi<'Line'>;
  adxEma: ISeriesApi<'Line'>;
  roc: ISeriesApi<'Line'>;
  rocEma: ISeriesApi<'Line'>;
};

const BAND_POOL = 48; // max trades shown as P&L bands (typical strategies have far fewer)

interface MPt {
  time: number;
  price: number;
}
interface MeasureView {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dPrice: number;
  dPct: number;
  days: number;
  up: boolean;
}

// ── Manual drawings (trend line / horizontal S-R / Fibonacci) ────────────────
type DrawTool = 'none' | 'trend' | 'hline' | 'fib';
interface Draw {
  id: number;
  type: 'trend' | 'hline' | 'fib';
  a: { t: number; p: number };
  b?: { t: number; p: number };
}
type PView =
  | { id: number; sel: boolean; kind: 'hline'; y: number; price: number }
  | { id: number; sel: boolean; kind: 'trend'; ax: number; ay: number; bx: number; by: number }
  | { id: number; sel: boolean; kind: 'fib'; ax: number; ay: number; bx: number; by: number; levels: { r: number; y: number; price: number }[] };
const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const drawKey = (sym: string) => 'borsaDraw:' + sym;
function loadDraws(sym: string): Draw[] {
  try {
    const v = JSON.parse(localStorage.getItem(drawKey(sym)) || 'null');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
// Distance from point (px,py) to segment (ax,ay)-(bx,by).
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const lineOpts = (color: string, width: 1 | 2 | 3 = 1, title = '') => ({
  color,
  lineWidth: width,
  priceLineVisible: false,
  lastValueVisible: false,
  title,
});

// ── Volume profile (horizontal volume-by-price over the visible window) ──────
interface VPBar { y: number; h: number; w: number; inVA: boolean; isPOC: boolean }
interface VPView {
  bars: VPBar[];
  right: number;
  pocY: number | null;
  vahY: number | null;
  valY: number | null;
  pocPrice: number;
  vah: number;
  val: number;
}
// First index whose time >= target (binary search on an ascending time array).
function idxGte(time: ArrayLike<number>, target: number, n: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (time[m] < target) lo = m + 1;
    else hi = m;
  }
  return lo;
}
// Bin volume by price across [i0,i1], find POC + 70% value area, and lay out
// right-anchored horizontal bars. `yOf` maps a price to a pixel Y.
function buildVP(c: Candles, i0: number, i1: number, nb: number, yOf: (p: number) => number | null, right: number, maxBarW: number): VPView | null {
  if (i1 < i0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    if (c.low[i] < lo) lo = c.low[i];
    if (c.high[i] > hi) hi = c.high[i];
  }
  if (!(hi > lo)) return null;
  const binSz = (hi - lo) / nb;
  const vol = new Float64Array(nb);
  for (let i = i0; i <= i1; i++) {
    const v = c.volume[i];
    if (!(v > 0)) continue;
    let b0 = Math.floor((c.low[i] - lo) / binSz);
    let b1 = Math.floor((c.high[i] - lo) / binSz);
    b0 = Math.max(0, Math.min(nb - 1, b0));
    b1 = Math.max(0, Math.min(nb - 1, b1));
    const share = v / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) vol[b] += share;
  }
  let poc = 0;
  let maxVol = 0;
  let total = 0;
  for (let b = 0; b < nb; b++) {
    total += vol[b];
    if (vol[b] > maxVol) {
      maxVol = vol[b];
      poc = b;
    }
  }
  if (!(maxVol > 0)) return null;
  // Value area: expand from the POC outward toward the heavier neighbour until
  // 70% of volume is captured.
  let lb = poc;
  let hb = poc;
  let acc = vol[poc];
  const tgt = total * 0.7;
  while (acc < tgt && (lb > 0 || hb < nb - 1)) {
    const below = lb > 0 ? vol[lb - 1] : -1;
    const above = hb < nb - 1 ? vol[hb + 1] : -1;
    if (above >= below) acc += vol[++hb];
    else acc += vol[--lb];
  }
  const bars: VPBar[] = [];
  for (let b = 0; b < nb; b++) {
    if (vol[b] <= 0) continue;
    const yT = yOf(lo + (b + 1) * binSz);
    const yB = yOf(lo + b * binSz);
    if (yT == null || yB == null) continue;
    bars.push({ y: yT, h: Math.max(1, yB - yT - 1), w: (vol[b] / maxVol) * maxBarW, inVA: b >= lb && b <= hb, isPOC: b === poc });
  }
  const pocPrice = lo + (poc + 0.5) * binSz;
  const vah = lo + (hb + 1) * binSz;
  const val = lo + lb * binSz;
  return { bars, right, pocY: yOf(pocPrice), vahY: yOf(vah), valY: yOf(val), pocPrice, vah, val };
}

export const Chart = forwardRef<ChartHandle, Props>(function Chart(
  { candles, fitOnLoad, settings, params = DEFAULT_PARAMS, symbol, tfLabel, strategy, costLine, log, focus },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const lodRef = useRef<LodController | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesBag | null>(null);
  const bandsRef = useRef<ISeriesApi<'Baseline'>[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const costLineRef = useRef<IPriceLine | null>(null);
  const lastValsRef = useRef<LegendVals | null>(null);
  const hoveringRef = useRef(false);
  const fitRef = useRef(true);
  fitRef.current = fitOnLoad ?? true;
  // Measure tool: Shift+click an anchor, move to compare, Shift+click again to
  // freeze. Tracks two {time, price} points → Δ price, Δ % and days between.
  const shiftRef = useRef(false);
  const measureRef = useRef<{ a: MPt; b: MPt | null; frozen: boolean } | null>(null);
  const prevCandlesRef = useRef<Candles | null>(null);
  // Manual drawings
  const drawToolRef = useRef<DrawTool>('none');
  const drawingsRef = useRef<Draw[]>([]);
  const pendingRef = useRef<{ t: number; p: number } | null>(null);
  const lastCrossRef = useRef<{ t: number; p: number } | null>(null);
  const selDrawRef = useRef<number | null>(null);
  const drawViewRef = useRef<PView[]>([]);
  const symRef = useRef(symbol);
  symRef.current = symbol;
  // Volume profile: kept in refs so the long-lived chart subscriptions can read
  // the current candles / toggle without re-binding.
  const candlesRef = useRef<Candles | null>(candles);
  candlesRef.current = candles;
  const vpOnRef = useRef(settings.volprofile);
  vpOnRef.current = settings.volprofile;
  const refreshVPRef = useRef<() => void>(() => {});
  const [vp, setVp] = useState<VPView | null>(null);
  const [drawTool, setDrawTool] = useState<DrawTool>('none');
  const [drawView, setDrawView] = useState<PView[]>([]);
  const [drawCount, setDrawCount] = useState(0);

  // Re-project all drawings (+ the in-progress one) to pixels for the overlay.
  const recomputeDraw = useCallback(() => {
    const chart = chartApiRef.current;
    const s = seriesRef.current;
    const lod = lodRef.current;
    if (!chart || !s || !lod) return;
    const yOf = (p: number) => s.candle.priceToCoordinate(p);
    const out: PView[] = [];
    const push = (d: Draw) => {
      const sel = selDrawRef.current === d.id;
      if (d.type === 'hline') {
        const y = yOf(d.a.p);
        if (y != null) out.push({ id: d.id, sel, kind: 'hline', y: y as number, price: d.a.p });
        return;
      }
      if (!d.b) return;
      const ax = lod.xForTime(d.a.t);
      const bx = lod.xForTime(d.b.t);
      const ay = yOf(d.a.p);
      const by = yOf(d.b.p);
      if (ax == null || bx == null || ay == null || by == null) return;
      if (d.type === 'trend') out.push({ id: d.id, sel, kind: 'trend', ax, ay, bx, by });
      else {
        const levels = FIBS.map((r) => {
          const price = d.a.p + (d.b!.p - d.a.p) * r;
          const yy = yOf(price);
          return { r, y: yy == null ? NaN : (yy as number), price };
        }).filter((l) => Number.isFinite(l.y));
        out.push({ id: d.id, sel, kind: 'fib', ax, ay, bx, by, levels });
      }
    };
    for (const d of drawingsRef.current) push(d);
    const pend = pendingRef.current;
    const cross = lastCrossRef.current;
    const tool = drawToolRef.current;
    if (pend && cross && (tool === 'trend' || tool === 'fib')) push({ id: -1, type: tool, a: pend, b: cross });
    drawViewRef.current = out;
    setDrawView(out);
  }, []);

  const persistDraws = useCallback(() => {
    try {
      localStorage.setItem(drawKey(symRef.current), JSON.stringify(drawingsRef.current));
    } catch {
      /* quota */
    }
  }, []);
  const addDraw = useCallback(
    (d: Draw) => {
      drawingsRef.current = [...drawingsRef.current, d];
      setDrawCount(drawingsRef.current.length);
      persistDraws();
      recomputeDraw();
    },
    [persistDraws, recomputeDraw],
  );
  const removeDraw = useCallback(
    (id: number) => {
      drawingsRef.current = drawingsRef.current.filter((d) => d.id !== id);
      if (selDrawRef.current === id) selDrawRef.current = null;
      setDrawCount(drawingsRef.current.length);
      persistDraws();
      recomputeDraw();
    },
    [persistDraws, recomputeDraw],
  );
  const pickTool = (t: DrawTool) => {
    const nt = drawToolRef.current === t ? 'none' : t;
    drawToolRef.current = nt;
    pendingRef.current = null;
    setDrawTool(nt);
    recomputeDraw();
  };
  const undoDraw = () => {
    const arr = drawingsRef.current;
    if (arr.length) removeDraw(arr[arr.length - 1].id);
  };
  const clearDraws = () => {
    drawingsRef.current = [];
    selDrawRef.current = null;
    pendingRef.current = null;
    setDrawCount(0);
    persistDraws();
    recomputeDraw();
  };
  // Load this symbol's drawings whenever the symbol changes.
  useEffect(() => {
    drawingsRef.current = loadDraws(symbol);
    pendingRef.current = null;
    selDrawRef.current = null;
    setDrawCount(drawingsRef.current.length);
    recomputeDraw();
  }, [symbol, recomputeDraw]);

  const [legend, setLegend] = useState<LegendVals | null>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [measure, setMeasure] = useState<MeasureView | null>(null);

  useEffect(() => {
    // On phones the right-axis series-title labels (EMA/MACD/ADX/…) pile up and
    // overlap; the top legend already names every line, so drop the axis titles
    // on narrow screens. `t()` blanks a title only in compact mode.
    const compact = typeof window !== 'undefined' && window.innerWidth < 768;
    const t = (s: string) => (compact ? '' : s);

    const chart: IChartApi = createChart(elRef.current!, {
      autoSize: true,
      layout: {
        background: { color: '#0e0f13' },
        textColor: '#9aa0b0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      grid: { vertLines: { color: '#161922' }, horzLines: { color: '#161922' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a4150', labelBackgroundColor: '#2a3142' },
        horzLine: { color: '#3a4150', labelBackgroundColor: '#2a3142' },
      },
      rightPriceScale: { borderColor: '#222632' },
      // minBarSpacing default is 0.5 px/bar — the wall you hit when zooming out.
      // Lower it so bars can compress much further (more zoom-out / whitespace).
      timeScale: { borderColor: '#222632', timeVisible: true, secondsVisible: false, minBarSpacing: 0.06 },
    });

    // Strategy P&L bands pool: one BaselineSeries per trade, created BEFORE the
    // candles so they render behind them. Each fills between the price and its
    // entry price — green above entry (in profit), red below (at a loss) — and
    // fades to transparent at the entry line. baseValue (entry) is set per trade
    // when a strategy is applied; the LOD feeds decimated data per window.
    const bands: ISeriesApi<'Baseline'>[] = [];
    for (let i = 0; i < BAND_POOL; i++) {
      bands.push(
        chart.addSeries(
          BaselineSeries,
          {
            baseValue: { type: 'price', price: 0 },
            topLineColor: 'rgba(38,166,154,0.5)',
            bottomLineColor: 'rgba(239,83,80,0.5)',
            topFillColor1: 'rgba(38,166,154,0.32)', // near price (profit): tinted
            topFillColor2: 'rgba(38,166,154,0.0)', // at entry line: transparent
            bottomFillColor1: 'rgba(239,83,80,0.0)', // at entry line: transparent
            bottomFillColor2: 'rgba(239,83,80,0.32)', // near price (loss): tinted
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            baseLineVisible: false,
            // Bands are decorative (values are within candle range) — never let
            // them drive the price scale (esp. the empty pool's baseValue 0).
            autoscaleInfoProvider: () => null,
          },
          0,
        ),
      );
    }
    bandsRef.current = bands;

    const candle = chart.addSeries(
      CandlestickSeries,
      { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' },
      0,
    );
    const ema377 = chart.addSeries(LineSeries, lineOpts('#f0b90b', 1, t('EMA 377')), 0);
    const ema610 = chart.addSeries(LineSeries, lineOpts('#9aa0b0', 1, t('EMA 610')), 0);

    // Volume overlays the bottom of the price pane on its own scale, so its
    // value label ("barem") shows at the bottom-right of the price window.
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: true },
      0,
    );

    const wilR = chart.addSeries(LineSeries, lineOpts('#7E57C2', 2, t('Williams %R')), 1);
    const wilEma = chart.addSeries(LineSeries, lineOpts('#26a69a', 1), 1);
    const wilEma120 = chart.addSeries(LineSeries, lineOpts('#42a5f5', 1), 1);
    wilR.createPriceLine({ price: 98, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '98' });
    wilR.createPriceLine({ price: 50, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    wilR.createPriceLine({ price: 5, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '5' });

    const mMacd = chart.addSeries(LineSeries, lineOpts('#ff2fa6', 1, t('MACD')), 2);
    const mSignal = chart.addSeries(LineSeries, lineOpts('#FF6D00', 1, t('Signal')), 2);
    const mEma = chart.addSeries(LineSeries, lineOpts('#e6e6e6', 2, t('eMACD')), 2);
    mMacd.createPriceLine({ price: 0, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    // ADX (260) pane + ROC (260) pane — collapsed unless toggled on.
    const adx = chart.addSeries(LineSeries, lineOpts('#ab47bc', 2, t('ADX (260)')), 3);
    const adxEma = chart.addSeries(LineSeries, lineOpts('#26a69a', 1, t('ADX EMA (120)')), 3);
    adx.createPriceLine({ price: 25, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '25' });
    const roc = chart.addSeries(LineSeries, lineOpts('#26c6da', 2, t('ROC (260)')), 4);
    const rocEma = chart.addSeries(LineSeries, lineOpts('#42a5f5', 1, t('ROC EMA (120)')), 4);
    roc.createPriceLine({ price: 0, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(2); // Williams %R
    panes[2]?.setStretchFactor(2.2); // MACD
    panes[3]?.setStretchFactor(0.0001); // ADX (off by default)
    panes[4]?.setStretchFactor(0.0001); // ROC (off by default)
    // Volume fills the bottom ~22% of the price pane; price keeps the top ~78%.
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

    const extras: ExtraSpec[] = [
      { series: ema377, kind: 'line' },
      { series: ema610, kind: 'line' },
      { series: wilR, kind: 'line' },
      { series: wilEma, kind: 'line' },
      { series: wilEma120, kind: 'line' },
      { series: mMacd, kind: 'line' },
      { series: mSignal, kind: 'line' },
      { series: mEma, kind: 'line' },
      { series: adx, kind: 'line' },
      { series: adxEma, kind: 'line' },
      { series: roc, kind: 'line' },
      { series: rocEma, kind: 'line' },
    ];
    const lod = new LodController(chart, candle, volume, extras, bands);
    lodRef.current = lod;
    chartApiRef.current = chart;
    seriesRef.current = { candle, ema377, ema610, volume, wilR, wilEma, wilEma120, mMacd, mSignal, mEma, adx, adxEma, roc, rocEma };
    markersRef.current = createSeriesMarkers(candle, []);

    const computeTops = () => {
      try {
        const panes = chart.panes();
        const t: number[] = [];
        let acc = 0;
        for (let i = 0; i < panes.length; i++) {
          t.push(acc);
          acc += panes[i].getHeight() + 1;
        }
        setTops(t);
      } catch {
        /* chart not laid out yet — legends position on the next tick */
      }
    };

    const num = (x: unknown): number => (typeof x === 'number' && isFinite(x) ? x : NaN);

    // ── Measure tool ──────────────────────────────────────────────────────────
    const refreshMeasure = () => {
      const m = measureRef.current;
      if (!m || !m.b) {
        setMeasure(null);
        return;
      }
      const ts = chart.timeScale();
      const ax = ts.timeToCoordinate(m.a.time as Time);
      const bx = ts.timeToCoordinate(m.b.time as Time);
      const ay = candle.priceToCoordinate(m.a.price);
      const by = candle.priceToCoordinate(m.b.price);
      if (ax == null || bx == null || ay == null || by == null) {
        setMeasure(null);
        return;
      }
      const dPrice = m.b.price - m.a.price;
      const dPct = m.a.price ? (m.b.price / m.a.price - 1) * 100 : 0;
      setMeasure({ ax, ay, bx, by, dPrice, dPct, days: Math.round((m.b.time - m.a.time) / 86400), up: dPrice >= 0 });
    };
    chart.subscribeClick((param) => {
      if (!param.point || param.time == null) return;
      const price = candle.coordinateToPrice(param.point.y);
      const tool = drawToolRef.current;
      // Drawing tool active (no Shift) → place anchors instead of measuring.
      if (tool !== 'none' && !shiftRef.current) {
        if (price == null) return;
        const pt = { t: param.time as number, p: price as number };
        if (tool === 'hline') addDraw({ id: Date.now(), type: 'hline', a: pt });
        else if (!pendingRef.current) {
          pendingRef.current = pt;
          recomputeDraw();
        } else {
          addDraw({ id: Date.now(), type: tool, a: pendingRef.current, b: pt });
          pendingRef.current = null;
        }
        return;
      }
      // Cursor mode (no tool, no Shift): click a drawing to delete it.
      if (tool === 'none' && !shiftRef.current) {
        const { x, y } = param.point;
        let hit: number | null = null;
        for (const v of drawViewRef.current) {
          const near = v.kind === 'hline' ? Math.abs(y - v.y) <= 6 : distToSeg(x, y, v.ax, v.ay, v.bx, v.by) <= 6;
          if (near) hit = v.id;
        }
        if (hit != null) {
          removeDraw(hit);
          return;
        }
      }
      // Otherwise: measure tool (Shift+click).
      const m = measureRef.current;
      if (!shiftRef.current) {
        if (m) {
          measureRef.current = null;
          setMeasure(null);
        }
        return;
      }
      if (price == null) return;
      const pt: MPt = { time: param.time as number, price: price as number };
      if (!m || m.frozen) measureRef.current = { a: pt, b: pt, frozen: false };
      else measureRef.current = { a: m.a, b: pt, frozen: true };
      refreshMeasure();
    });
    // Volume profile over the visible window (recomputed on zoom/pan/resize).
    const refreshVP = () => {
      if (!vpOnRef.current) {
        setVp(null);
        return;
      }
      const c = candlesRef.current;
      const ts = chart.timeScale();
      const vr = c && c.length ? ts.getVisibleRange() : null;
      if (!c || !vr) {
        setVp(null);
        return;
      }
      const n = c.length;
      const from = vr.from as number;
      const to = vr.to as number;
      let i0 = Math.max(0, idxGte(c.time, from, n));
      let i1 = idxGte(c.time, to, n);
      if (i1 >= n || c.time[i1] > to) i1--;
      i1 = Math.min(n - 1, i1);
      if (i1 < i0) {
        setVp(null);
        return;
      }
      const paneH = chart.panes()[0]?.getHeight() ?? 300;
      const nb = Math.max(12, Math.min(48, Math.round(paneH / 12)));
      const right = ts.width();
      const maxBarW = Math.min(right * 0.32, 160);
      setVp(buildVP(c, i0, i1, nb, (p) => candle.priceToCoordinate(p), right, maxBarW));
    };
    refreshVPRef.current = refreshVP;

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (measureRef.current?.b) refreshMeasure();
      recomputeDraw();
      refreshVP();
    });
    const onKey = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
      if (e.key === 'Escape') {
        if (measureRef.current) {
          measureRef.current = null;
          setMeasure(null);
        }
        if (pendingRef.current || drawToolRef.current !== 'none') {
          pendingRef.current = null;
          drawToolRef.current = 'none';
          setDrawTool('none');
          recomputeDraw();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    chart.subscribeCrosshairMove((param) => {
      const m = measureRef.current;
      if (param.point && param.time != null) {
        const p = seriesRef.current?.candle.coordinateToPrice(param.point.y);
        if (p != null) {
          lastCrossRef.current = { t: param.time as number, p: p as number };
          if (m && !m.frozen) {
            m.b = { time: param.time as number, price: p as number };
            refreshMeasure();
          }
          if (pendingRef.current) recomputeDraw(); // live preview of the 2nd anchor
        }
      }
      const s = seriesRef.current!;
      if (param.time && param.seriesData.size) {
        const c = param.seriesData.get(s.candle) as CandlestickData | undefined;
        if (c) {
          hoveringRef.current = true;
          const lv = (ser: ISeriesApi<'Line'>) => num((param.seriesData.get(ser) as LineData | undefined)?.value);
          const hv = (ser: ISeriesApi<'Histogram'>) => num((param.seriesData.get(ser) as HistogramData | undefined)?.value);
          setLegend({
            o: c.open, h: c.high, l: c.low, c: c.close, v: hv(s.volume),
            ema377: lv(s.ema377), ema610: lv(s.ema610),
            wilR: lv(s.wilR), wilEma: lv(s.wilEma), wilEma120: lv(s.wilEma120),
            macd: lv(s.mMacd), signal: lv(s.mSignal), emacd: lv(s.mEma),
            adx: lv(s.adx), adxEma: lv(s.adxEma), roc: lv(s.roc), rocEma: lv(s.rocEma),
          });
          computeTops();
          return;
        }
      }
      hoveringRef.current = false;
      if (lastValsRef.current) setLegend(lastValsRef.current);
      computeTops();
    });

    const ro = new ResizeObserver(() => {
      computeTops();
      refreshVP();
    });
    ro.observe(elRef.current!);
    computeTops();

    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      lod.destroy();
      lodRef.current = null;
      chartApiRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      chart.remove();
    };
  }, []);

  // Load data + compute indicators; cache last values for the (non-hover) legend.
  useEffect(() => {
    if (!lodRef.current || !candles) return;
    const ind = computeIndicators(candles, params);
    const ex = computeExtras(candles, params);
    const n = candles.length;
    const lastFin = (a: Float64Array) => {
      for (let i = a.length - 1; i >= 0; i--) if (isFinite(a[i])) return a[i];
      return NaN;
    };
    const lv: LegendVals = {
      o: candles.open[n - 1], h: candles.high[n - 1], l: candles.low[n - 1],
      c: candles.close[n - 1], v: candles.volume[n - 1],
      ema377: lastFin(ind.ema377p), ema610: lastFin(ind.ema610p),
      wilR: lastFin(ind.percentR), wilEma: lastFin(ind.emawil), wilEma120: lastFin(ind.emawil120),
      macd: lastFin(ind.macdN), signal: lastFin(ind.signalN), emacd: lastFin(ind.eMacDN),
      adx: lastFin(ex.adx), adxEma: lastFin(ex.adxEma), roc: lastFin(ex.roc), rocEma: lastFin(ex.rocEma),
    };
    lastValsRef.current = lv;

    // New symbol → frame per fitOnLoad; a mere param tweak → preserve the view.
    const fit = prevCandlesRef.current !== candles ? fitRef.current : false;
    prevCandlesRef.current = candles;
    lodRef.current.setData(
      candles,
      [
        ind.ema377p, ind.ema610p, ind.percentR, ind.emawil, ind.emawil120, ind.macdN, ind.signalN, ind.eMacDN,
        ex.adx, ex.adxEma, ex.roc, ex.rocEma,
      ],
      fit,
    );
    if (!hoveringRef.current) setLegend(lv);
    recomputeDraw(); // re-anchor manual drawings to the new window
    refreshVPRef.current(); // recompute the volume profile for the new data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, params]);

  // Recompute / clear the volume profile when it's toggled on/off.
  useEffect(() => {
    refreshVPRef.current();
  }, [settings.volprofile]);

  // Indicator visibility toggles.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartApiRef.current;
    if (!s || !chart) return;
    s.ema377.applyOptions({ visible: settings.ema });
    s.ema610.applyOptions({ visible: settings.ema });
    s.volume.applyOptions({ visible: settings.volume });
    [s.wilR, s.wilEma, s.wilEma120].forEach((x) => x.applyOptions({ visible: settings.williams }));
    [s.mMacd, s.mSignal, s.mEma].forEach((x) => x.applyOptions({ visible: settings.macd }));
    [s.adx, s.adxEma].forEach((x) => x.applyOptions({ visible: settings.adx }));
    [s.roc, s.rocEma].forEach((x) => x.applyOptions({ visible: settings.roc }));
    const panes = chart.panes();
    panes[1]?.setStretchFactor(settings.williams ? 2 : 0.0001);
    panes[2]?.setStretchFactor(settings.macd ? 2.2 : 0.0001);
    panes[3]?.setStretchFactor(settings.adx ? 1.6 : 0.0001);
    panes[4]?.setStretchFactor(settings.roc ? 1.6 : 0.0001);
    // Reserve the bottom slice of the price pane for volume only when shown.
    s.candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: settings.volume ? 0.22 : 0.04 } });
  }, [settings]);

  // Overlay a chosen strategy's buy/sell signals as markers + draw a per-trade
  // P&L band: between each AL→SAT, fill between price and the entry price —
  // green while in profit, red while at a loss, fading to transparent at entry.
  useEffect(() => {
    const m = markersRef.current;
    const lod = lodRef.current;
    const bands = bandsRef.current;
    if (!m) return;
    if (!strategy || !candles) {
      m.setMarkers([]);
      if (lod) lod.setBands([]);
      return;
    }
    const markers: SeriesMarker<Time>[] = signalsFor(strategy, candles).map((sig) =>
      sig.kind === 'buy'
        ? { time: sig.time as UTCTimestamp, position: 'belowBar' as const, color: '#26a69a', shape: 'arrowUp' as const, text: 'AL' }
        : { time: sig.time as UTCTimestamp, position: 'aboveBar' as const, color: '#ef5350', shape: 'arrowDown' as const, text: 'SAT' },
    );
    m.setMarkers(markers);
    // Split the position array into trade segments [a..b] (b includes the sell bar).
    const pos = buildPositionByName(strategy, candles);
    const segs: { a: number; b: number }[] = [];
    if (pos) {
      const n = pos.length;
      let i = 0;
      while (i < n) {
        if (pos[i]) {
          const a = i;
          let j = i;
          while (j + 1 < n && pos[j + 1]) j++;
          segs.push({ a, b: Math.min(j + 1, n - 1) });
          i = j + 1;
        } else i++;
      }
    }
    // Each band's entry price (the AL close) is the green/red split level.
    segs.slice(0, bands.length).forEach((seg, k) => {
      bands[k].applyOptions({ baseValue: { type: 'price', price: candles.close[seg.a] } });
    });
    if (lod) lod.setBands(segs.slice(0, bands.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, candles, params]); // params → re-draw signals/bands when periods change

  // Portfolio average-cost line on the price pane (Portföy sekmesi açıkken).
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    if (costLineRef.current) {
      s.candle.removePriceLine(costLineRef.current);
      costLineRef.current = null;
    }
    if (costLine && isFinite(costLine.price)) {
      costLineRef.current = s.candle.createPriceLine({
        price: costLine.price,
        color: '#f0b90b',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: costLine.label,
      });
    }
  }, [costLine]);

  // Logarithmic / normal price scale.
  useEffect(() => {
    seriesRef.current?.candle
      .priceScale()
      .applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [log]);

  // Zoom to a single trade when one is picked from the trade list.
  useEffect(() => {
    if (!focus || !candles) return;
    const t1 = focus.exitTime ?? candles.time[candles.length - 1];
    lodRef.current?.focusRange(focus.entryTime, t1);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    ref,
    () => ({
      updateLast: (b) => {
        lodRef.current?.updateLast(b);
      },
    }),
    [],
  );

  const up = legend ? legend.c >= legend.o : true;

  return (
    <>
      <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Volume profile (horizontal volume-by-price; POC + value area) */}
      {settings.volprofile && vp && (
        <svg className="vp-overlay" width="100%" height="100%">
          {vp.bars.map((b, i) => (
            <rect
              key={i}
              x={vp.right - b.w}
              y={b.y}
              width={b.w}
              height={b.h}
              className={b.isPOC ? 'vp-poc' : b.inVA ? 'vp-va' : 'vp-bar'}
            />
          ))}
          {vp.valY != null && vp.vahY != null && (
            <>
              <line x1={vp.right - 168} y1={vp.vahY} x2={vp.right} y2={vp.vahY} className="vp-valine" />
              <line x1={vp.right - 168} y1={vp.valY} x2={vp.right} y2={vp.valY} className="vp-valine" />
            </>
          )}
          {vp.pocY != null && (
            <>
              <line x1={0} y1={vp.pocY} x2={vp.right} y2={vp.pocY} className="vp-pocline" />
              <text x={4} y={vp.pocY - 3} className="vp-poclbl">POC {fp(vp.pocPrice)}</text>
            </>
          )}
        </svg>
      )}

      {/* Drawing toolbar */}
      <div className="draw-tools">
        <button className={'draw-btn' + (drawTool === 'trend' ? ' on' : '')} onClick={() => pickTool('trend')} title="Trend çizgisi (2 nokta)">╱</button>
        <button className={'draw-btn' + (drawTool === 'hline' ? ' on' : '')} onClick={() => pickTool('hline')} title="Yatay çizgi (destek/direnç)">─</button>
        <button className={'draw-btn' + (drawTool === 'fib' ? ' on' : '')} onClick={() => pickTool('fib')} title="Fibonacci (2 nokta)">≣</button>
        <button className="draw-btn" onClick={undoDraw} disabled={drawCount === 0} title="Son çizimi geri al">↶</button>
        <button className="draw-btn" onClick={clearDraws} disabled={drawCount === 0} title="Tüm çizimleri sil">🗑</button>
        {drawTool !== 'none' && <div className="draw-hint">{drawTool === 'hline' ? 'tıkla' : pendingRef.current ? '2. nokta' : '1. nokta'}</div>}
      </div>

      {/* Manual drawings overlay */}
      {drawView.length > 0 && (
        <svg className="measure-overlay" width="100%" height="100%">
          {drawView.map((v) =>
            v.kind === 'hline' ? (
              <g key={v.id}>
                <line x1={0} y1={v.y} x2="100%" y2={v.y} stroke={v.sel ? '#f0b90b' : '#5c9ded'} strokeWidth={v.sel ? 1.8 : 1.3} />
              </g>
            ) : v.kind === 'trend' ? (
              <line key={v.id} x1={v.ax} y1={v.ay} x2={v.bx} y2={v.by} stroke={v.id < 0 ? '#888' : v.sel ? '#f0b90b' : '#5c9ded'} strokeWidth={1.6} strokeDasharray={v.id < 0 ? '4 3' : undefined} />
            ) : (
              <g key={v.id}>
                <line x1={v.ax} y1={v.ay} x2={v.bx} y2={v.by} stroke={v.id < 0 ? '#888' : '#777'} strokeWidth={1} strokeDasharray="2 3" />
                {v.levels.map((l) => (
                  <g key={l.r}>
                    <line x1={Math.min(v.ax, v.bx)} y1={l.y} x2={Math.max(v.ax, v.bx)} y2={l.y} stroke={v.sel ? '#f0b90b' : '#d9a441'} strokeWidth={1} />
                    <text x={Math.max(v.ax, v.bx) + 4} y={l.y + 3} fill="#d9a441" fontSize="10">{(l.r * 100).toFixed(1)}%</text>
                  </g>
                ))}
              </g>
            ),
          )}
        </svg>
      )}

      {measure && (
        <>
          <svg className="measure-overlay" width="100%" height="100%">
            <rect
              x={Math.min(measure.ax, measure.bx)}
              y={Math.min(measure.ay, measure.by)}
              width={Math.abs(measure.bx - measure.ax)}
              height={Math.abs(measure.by - measure.ay)}
              fill={measure.up ? 'rgba(38,166,154,0.10)' : 'rgba(239,83,80,0.10)'}
            />
            <line
              x1={measure.ax}
              y1={measure.ay}
              x2={measure.bx}
              y2={measure.by}
              stroke={measure.up ? '#26a69a' : '#ef5350'}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <circle cx={measure.ax} cy={measure.ay} r={3} fill={measure.up ? '#26a69a' : '#ef5350'} />
            <circle cx={measure.bx} cy={measure.by} r={3} fill={measure.up ? '#26a69a' : '#ef5350'} />
          </svg>
          <div
            className="measure-label"
            style={{ left: Math.min(measure.bx + 10, 9999), top: Math.max(measure.by - 12, 2), borderColor: measure.up ? '#26a69a' : '#ef5350' }}
          >
            <b className={measure.up ? 'up' : 'down'}>{(measure.dPct >= 0 ? '+' : '') + measure.dPct.toFixed(2)}%</b>{' '}
            <span className="lg-muted">
              {(measure.dPrice >= 0 ? '+' : '') + measure.dPrice.toFixed(2)} · {measure.days}g
            </span>
          </div>
        </>
      )}
      {legend && (
        <>
          <div className="pane-legend" style={{ top: (tops[0] ?? 0) + 6 }}>
            <b>{symbol}</b> <span className="lg-muted">{tfLabel}</span>{' '}
            <span className="lg-muted">A</span> {fp(legend.o)} <span className="lg-muted">Y</span> {fp(legend.h)}{' '}
            <span className="lg-muted">D</span> {fp(legend.l)} <span className="lg-muted">K</span>{' '}
            <span className={up ? 'up' : 'down'}>{fp(legend.c)}</span>
            {settings.ema && (
              <>
                {'  '}
                <span style={{ color: '#f0b90b' }}>EMA ({params.emaFast}) {fp(legend.ema377)}</span>{' '}
                <span style={{ color: '#9aa0b0' }}>EMA ({params.emaSlow}) {fp(legend.ema610)}</span>
              </>
            )}
            {settings.volume && (
              <>
                {'  '}
                <span className="lg-muted">Hac</span> {fv(legend.v)}
              </>
            )}
          </div>

          {settings.adx && tops[3] != null && (
            <div className="pane-legend" style={{ top: tops[3] + 6 }}>
              <span style={{ color: '#ab47bc' }}>ADX ({params.adx})</span> {fn(legend.adx, 1)}{' '}
              <span style={{ color: '#26a69a' }}>EMA ({params.adxEma}) {fn(legend.adxEma, 1)}</span>{' '}
              <span className="lg-muted">{legend.adx >= 25 ? '· güçlü trend' : '· zayıf/yatay'}</span>
            </div>
          )}

          {settings.roc && tops[4] != null && (
            <div className="pane-legend" style={{ top: tops[4] + 6 }}>
              <span style={{ color: '#26c6da' }}>Momentum / ROC ({params.roc})</span> {fn(legend.roc, 1)}%{' '}
              <span style={{ color: '#42a5f5' }}>EMA ({params.rocEma}) {fn(legend.rocEma, 1)}</span>
            </div>
          )}

          {settings.williams && tops[1] != null && (
            <div className="pane-legend" style={{ top: tops[1] + 6 }}>
              <span style={{ color: '#7E57C2' }}>Williams %R ({params.wr})</span> {fn(legend.wilR, 1)}{' '}
              <span style={{ color: '#26a69a' }}>EMA ({params.wrEmaA}) {fn(legend.wilEma, 1)}</span>{' '}
              <span style={{ color: '#42a5f5' }}>EMA ({params.wrEmaB}) {fn(legend.wilEma120, 1)}</span>
            </div>
          )}

          {settings.macd && tops[2] != null && (
            <div className="pane-legend" style={{ top: tops[2] + 6 }}>
              <span className="lg-muted">NizamiCedid</span>{' '}
              <span style={{ color: '#ff2fa6' }}>MACD ({params.macdFast}/{params.macdSlow}) {fn(legend.macd, 4)}</span>{' '}
              <span style={{ color: '#FF6D00' }}>Signal ({params.macdSig}) {fn(legend.signal, 4)}</span>{' '}
              <span style={{ color: '#e6e6e6' }}>eMACD ({params.macdVwma}) {fn(legend.emacd, 4)}</span>
            </div>
          )}
        </>
      )}
    </>
  );
});

function fp(v: number): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fn(v: number, d: number): string {
  return isFinite(v) ? v.toFixed(d) : '—';
}
function fv(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(0);
}
