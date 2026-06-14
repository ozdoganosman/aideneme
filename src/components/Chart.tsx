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
import { computeIndicators } from '../indicators/calc';
import { signalsFor, buildPositionByName } from '../indicators/backtest';

export interface IndicatorSettings {
  ema: boolean;
  volume: boolean;
  williams: boolean;
  macd: boolean;
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
  wilR: number; wilEma: number;
  macd: number; signal: number; emacd: number;
}

type SeriesBag = {
  candle: ISeriesApi<'Candlestick'>;
  ema377: ISeriesApi<'Line'>;
  ema610: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  wilR: ISeriesApi<'Line'>;
  wilEma: ISeriesApi<'Line'>;
  mMacd: ISeriesApi<'Line'>;
  mSignal: ISeriesApi<'Line'>;
  mEma: ISeriesApi<'Line'>;
  posShade: ISeriesApi<'Histogram'>;
};

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
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const costLineRef = useRef<IPriceLine | null>(null);
  const lastValsRef = useRef<LegendVals | null>(null);
  const hoveringRef = useRef(false);
  const fitRef = useRef(true);
  fitRef.current = fitOnLoad ?? true;

  const [legend, setLegend] = useState<LegendVals | null>(null);
  const [tops, setTops] = useState<number[]>([]);

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
      timeScale: { borderColor: '#222632', timeVisible: true, secondsVisible: false },
    });

    // Strategy "in-position" shade: full-height histogram on its own scale,
    // created first so it sits behind the candles; fills bars where long.
    const posShade = chart.addSeries(
      HistogramSeries,
      { priceScaleId: 'posshade', base: 0, color: 'rgba(38,166,154,0.12)', priceLineVisible: false, lastValueVisible: false },
      0,
    );
    posShade.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });

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
    wilR.createPriceLine({ price: 98, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '98' });
    wilR.createPriceLine({ price: 50, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    wilR.createPriceLine({ price: 5, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '5' });

    const mMacd = chart.addSeries(LineSeries, lineOpts('#ff2fa6', 1, 'MACD'), 2);
    const mSignal = chart.addSeries(LineSeries, lineOpts('#FF6D00', 1, 'Signal'), 2);
    const mEma = chart.addSeries(LineSeries, lineOpts('#e6e6e6', 2, 'eMACD'), 2);
    mMacd.createPriceLine({ price: 0, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(2); // Williams %R
    panes[2]?.setStretchFactor(2.2); // MACD
    // Volume fills the bottom ~22% of the price pane; price keeps the top ~78%.
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });

    const extras: ExtraSpec[] = [
      { series: ema377, kind: 'line' },
      { series: ema610, kind: 'line' },
      { series: wilR, kind: 'line' },
      { series: wilEma, kind: 'line' },
      { series: mMacd, kind: 'line' },
      { series: mSignal, kind: 'line' },
      { series: mEma, kind: 'line' },
      { series: posShade, kind: 'hist' },
    ];
    const lod = new LodController(chart, candle, volume, extras);
    lodRef.current = lod;
    chartApiRef.current = chart;
    seriesRef.current = { candle, ema377, ema610, volume, wilR, wilEma, mMacd, mSignal, mEma, posShade };
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

    chart.subscribeCrosshairMove((param) => {
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
            wilR: lv(s.wilR), wilEma: lv(s.wilEma),
            macd: lv(s.mMacd), signal: lv(s.mSignal), emacd: lv(s.mEma),
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
    const n = candles.length;
    const lastFin = (a: Float64Array) => {
      for (let i = a.length - 1; i >= 0; i--) if (isFinite(a[i])) return a[i];
      return NaN;
    };
    const lv: LegendVals = {
      o: candles.open[n - 1], h: candles.high[n - 1], l: candles.low[n - 1],
      c: candles.close[n - 1], v: candles.volume[n - 1],
      ema377: lastFin(ind.ema377p), ema610: lastFin(ind.ema610p),
      wilR: lastFin(ind.percentR), wilEma: lastFin(ind.emawil),
      macd: lastFin(ind.macdN), signal: lastFin(ind.signalN), emacd: lastFin(ind.eMacDN),
    };
    lastValsRef.current = lv;

    lodRef.current.setData(
      candles,
      [ind.ema377p, ind.ema610p, ind.percentR, ind.emawil, ind.macdN, ind.signalN, ind.eMacDN, new Float64Array(n).fill(NaN)],
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
    [s.wilR, s.wilEma].forEach((x) => x.applyOptions({ visible: settings.williams }));
    [s.mMacd, s.mSignal, s.mEma].forEach((x) => x.applyOptions({ visible: settings.macd }));
    const panes = chart.panes();
    panes[1]?.setStretchFactor(settings.williams ? 2 : 0.0001);
    panes[2]?.setStretchFactor(settings.macd ? 2.2 : 0.0001);
    // Reserve the bottom slice of the price pane for volume only when shown.
    s.candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: settings.volume ? 0.22 : 0.04 } });
  }, [settings]);

  // Overlay a chosen strategy's buy/sell signals as markers + shade the periods
  // the strategy is in a position (full-height green band behind the candles).
  useEffect(() => {
    const m = markersRef.current;
    const s = seriesRef.current;
    const lod = lodRef.current;
    if (!m || !s) return;
    if (!strategy || !candles) {
      m.setMarkers([]);
      if (lod) lod.updateExtra(s.posShade, new Float64Array(0));
      return;
    }
    const markers: SeriesMarker<Time>[] = signalsFor(strategy, candles).map((sig) =>
      sig.kind === 'buy'
        ? { time: sig.time as UTCTimestamp, position: 'belowBar' as const, color: '#26a69a', shape: 'arrowUp' as const, text: 'AL' }
        : { time: sig.time as UTCTimestamp, position: 'aboveBar' as const, color: '#ef5350', shape: 'arrowDown' as const, text: 'SAT' },
    );
    m.setMarkers(markers);
    const pos = buildPositionByName(strategy, candles);
    const shade = new Float64Array(candles.length).fill(NaN);
    if (pos) for (let i = 0; i < pos.length; i++) if (pos[i]) shade[i] = 1;
    if (lod) lod.updateExtra(s.posShade, shade);
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
          </div>

          {settings.williams && tops[1] != null && (
            <div className="pane-legend" style={{ top: tops[1] + 6 }}>
              <span style={{ color: '#7E57C2' }}>Williams %R (260)</span> {fn(legend.wilR, 1)}{' '}
              <span style={{ color: '#26a69a' }}>EMA (260) {fn(legend.wilEma, 1)}</span>
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
