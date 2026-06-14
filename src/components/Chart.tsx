import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { computeIndicators, computeExtras } from '../indicators/calc';
import { signalsFor, buildPositionByName } from '../indicators/backtest';

export interface IndicatorSettings {
  ema: boolean;
  volume: boolean;
  williams: boolean;
  macd: boolean;
  bollinger: boolean;
  donchian: boolean;
  adx: boolean;
  roc: boolean;
}

export interface ChartHandle {
  updateLast: (b: LiveBar) => void;
}

interface Props {
  candles: Candles | null;
  fitOnLoad?: boolean;
  settings: IndicatorSettings;
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
  bbUp: number; bbMid: number; bbDn: number;
  donHi: number; donLo: number;
  adx: number; adxEma: number; roc: number;
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
  bbUp: ISeriesApi<'Line'>;
  bbMid: ISeriesApi<'Line'>;
  bbDn: ISeriesApi<'Line'>;
  donHi: ISeriesApi<'Line'>;
  donLo: ISeriesApi<'Line'>;
  adx: ISeriesApi<'Line'>;
  adxEma: ISeriesApi<'Line'>;
  roc: ISeriesApi<'Line'>;
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

const lineOpts = (color: string, width: 1 | 2 | 3 = 1, title = '') => ({
  color,
  lineWidth: width,
  priceLineVisible: false,
  lastValueVisible: false,
  title,
});

export const Chart = forwardRef<ChartHandle, Props>(function Chart(
  { candles, fitOnLoad, settings, symbol, tfLabel, strategy, costLine, log, focus },
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

  const [legend, setLegend] = useState<LegendVals | null>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [measure, setMeasure] = useState<MeasureView | null>(null);

  useEffect(() => {
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
    const ema377 = chart.addSeries(LineSeries, lineOpts('#f0b90b', 1, 'EMA 377'), 0);
    const ema610 = chart.addSeries(LineSeries, lineOpts('#9aa0b0', 1, 'EMA 610'), 0);

    // Volume overlays the bottom of the price pane on its own scale, so its
    // value label ("barem") shows at the bottom-right of the price window.
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceScaleId: 'volume', priceLineVisible: false, lastValueVisible: true },
      0,
    );

    const wilR = chart.addSeries(LineSeries, lineOpts('#7E57C2', 2, 'Williams %R'), 1);
    const wilEma = chart.addSeries(LineSeries, lineOpts('#26a69a', 1), 1);
    const wilEma120 = chart.addSeries(LineSeries, lineOpts('#42a5f5', 1), 1);
    wilR.createPriceLine({ price: 98, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '98' });
    wilR.createPriceLine({ price: 50, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    wilR.createPriceLine({ price: 5, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '5' });

    const mMacd = chart.addSeries(LineSeries, lineOpts('#ff2fa6', 1, 'MACD'), 2);
    const mSignal = chart.addSeries(LineSeries, lineOpts('#FF6D00', 1, 'Signal'), 2);
    const mEma = chart.addSeries(LineSeries, lineOpts('#e6e6e6', 2, 'eMACD'), 2);
    mMacd.createPriceLine({ price: 0, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    // Bollinger (20,2σ) + Donchian (20) — price-pane overlays.
    const bbUp = chart.addSeries(LineSeries, lineOpts('#5c9ded', 1, 'BB üst'), 0);
    const bbMid = chart.addSeries(LineSeries, lineOpts('#5c9ded', 1, 'BB orta'), 0);
    const bbDn = chart.addSeries(LineSeries, lineOpts('#5c9ded', 1, 'BB alt'), 0);
    bbUp.applyOptions({ lineStyle: LineStyle.Dashed });
    bbDn.applyOptions({ lineStyle: LineStyle.Dashed });
    const donHi = chart.addSeries(LineSeries, lineOpts('#d9a441', 1, 'Donchian üst'), 0);
    const donLo = chart.addSeries(LineSeries, lineOpts('#d9a441', 1, 'Donchian alt'), 0);
    // ADX (14) pane + ROC (100) pane — collapsed unless toggled on.
    const adx = chart.addSeries(LineSeries, lineOpts('#ab47bc', 2, 'ADX (28)'), 3);
    const adxEma = chart.addSeries(LineSeries, lineOpts('#26a69a', 1, 'ADX EMA (14)'), 3);
    adx.createPriceLine({ price: 25, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '25' });
    const roc = chart.addSeries(LineSeries, lineOpts('#26c6da', 2, 'ROC (260)'), 4);
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
      { series: bbUp, kind: 'line' },
      { series: bbMid, kind: 'line' },
      { series: bbDn, kind: 'line' },
      { series: donHi, kind: 'line' },
      { series: donLo, kind: 'line' },
      { series: adx, kind: 'line' },
      { series: adxEma, kind: 'line' },
      { series: roc, kind: 'line' },
    ];
    const lod = new LodController(chart, candle, volume, extras, bands);
    lodRef.current = lod;
    chartApiRef.current = chart;
    seriesRef.current = { candle, ema377, ema610, volume, wilR, wilEma, wilEma120, mMacd, mSignal, mEma, bbUp, bbMid, bbDn, donHi, donLo, adx, adxEma, roc };
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
      const m = measureRef.current;
      if (!param.point || param.time == null) return;
      if (!shiftRef.current) {
        if (m) {
          measureRef.current = null;
          setMeasure(null);
        }
        return;
      }
      const price = candle.coordinateToPrice(param.point.y);
      if (price == null) return;
      const pt: MPt = { time: param.time as number, price: price as number };
      if (!m || m.frozen) measureRef.current = { a: pt, b: pt, frozen: false };
      else measureRef.current = { a: m.a, b: pt, frozen: true };
      refreshMeasure();
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (measureRef.current?.b) refreshMeasure();
    });
    const onKey = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
      if (e.key === 'Escape' && measureRef.current) {
        measureRef.current = null;
        setMeasure(null);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    chart.subscribeCrosshairMove((param) => {
      const m = measureRef.current;
      if (m && !m.frozen && param.point && param.time != null) {
        const p = seriesRef.current?.candle.coordinateToPrice(param.point.y);
        if (p != null) {
          m.b = { time: param.time as number, price: p as number };
          refreshMeasure();
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
            bbUp: lv(s.bbUp), bbMid: lv(s.bbMid), bbDn: lv(s.bbDn),
            donHi: lv(s.donHi), donLo: lv(s.donLo),
            adx: lv(s.adx), adxEma: lv(s.adxEma), roc: lv(s.roc),
          });
          computeTops();
          return;
        }
      }
      hoveringRef.current = false;
      if (lastValsRef.current) setLegend(lastValsRef.current);
      computeTops();
    });

    const ro = new ResizeObserver(() => computeTops());
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
    const ind = computeIndicators(candles);
    const ex = computeExtras(candles);
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
      bbUp: lastFin(ex.bbUp), bbMid: lastFin(ex.bbMid), bbDn: lastFin(ex.bbDn),
      donHi: lastFin(ex.donHi), donLo: lastFin(ex.donLo),
      adx: lastFin(ex.adx), adxEma: lastFin(ex.adxEma), roc: lastFin(ex.roc),
    };
    lastValsRef.current = lv;

    lodRef.current.setData(
      candles,
      [
        ind.ema377p, ind.ema610p, ind.percentR, ind.emawil, ind.emawil120, ind.macdN, ind.signalN, ind.eMacDN,
        ex.bbUp, ex.bbMid, ex.bbDn, ex.donHi, ex.donLo, ex.adx, ex.adxEma, ex.roc,
      ],
      fitRef.current,
    );
    if (!hoveringRef.current) setLegend(lv);
  }, [candles]);

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
    [s.bbUp, s.bbMid, s.bbDn].forEach((x) => x.applyOptions({ visible: settings.bollinger }));
    [s.donHi, s.donLo].forEach((x) => x.applyOptions({ visible: settings.donchian }));
    [s.adx, s.adxEma].forEach((x) => x.applyOptions({ visible: settings.adx }));
    s.roc.applyOptions({ visible: settings.roc });
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
  }, [strategy, candles]);

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
                <span style={{ color: '#f0b90b' }}>EMA (377) {fp(legend.ema377)}</span>{' '}
                <span style={{ color: '#9aa0b0' }}>EMA (610) {fp(legend.ema610)}</span>
              </>
            )}
            {settings.volume && (
              <>
                {'  '}
                <span className="lg-muted">Hac</span> {fv(legend.v)}
              </>
            )}
            {settings.bollinger && (
              <>
                {'  '}
                <span style={{ color: '#5c9ded' }}>BB (260) {fp(legend.bbUp)}/{fp(legend.bbMid)}/{fp(legend.bbDn)}</span>
              </>
            )}
            {settings.donchian && (
              <>
                {'  '}
                <span style={{ color: '#d9a441' }}>Donchian (260) {fp(legend.donHi)}/{fp(legend.donLo)}</span>
              </>
            )}
          </div>

          {settings.adx && tops[3] != null && (
            <div className="pane-legend" style={{ top: tops[3] + 6 }}>
              <span style={{ color: '#ab47bc' }}>ADX (28)</span> {fn(legend.adx, 1)}{' '}
              <span style={{ color: '#26a69a' }}>EMA (14) {fn(legend.adxEma, 1)}</span>{' '}
              <span className="lg-muted">{legend.adx >= 25 ? '· güçlü trend' : '· zayıf/yatay'}</span>
            </div>
          )}

          {settings.roc && tops[4] != null && (
            <div className="pane-legend" style={{ top: tops[4] + 6 }}>
              <span style={{ color: '#26c6da' }}>Momentum / ROC (260)</span> {fn(legend.roc, 1)}%
            </div>
          )}

          {settings.williams && tops[1] != null && (
            <div className="pane-legend" style={{ top: tops[1] + 6 }}>
              <span style={{ color: '#7E57C2' }}>Williams %R (260)</span> {fn(legend.wilR, 1)}{' '}
              <span style={{ color: '#26a69a' }}>EMA (260) {fn(legend.wilEma, 1)}</span>{' '}
              <span style={{ color: '#42a5f5' }}>EMA (120) {fn(legend.wilEma120, 1)}</span>
            </div>
          )}

          {settings.macd && tops[2] != null && (
            <div className="pane-legend" style={{ top: tops[2] + 6 }}>
              <span className="lg-muted">NizamiCedid</span>{' '}
              <span style={{ color: '#ff2fa6' }}>MACD (120/260) {fn(legend.macd, 4)}</span>{' '}
              <span style={{ color: '#FF6D00' }}>Signal (50) {fn(legend.signal, 4)}</span>{' '}
              <span style={{ color: '#e6e6e6' }}>eMACD (185) {fn(legend.emacd, 4)}</span>
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
