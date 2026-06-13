import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  CrosshairMode,
  LineStyle,
  IChartApi,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { Candles, LiveBar } from '../data/types';
import { LodController, ExtraSpec } from '../chart/lod';
import { computeIndicators } from '../indicators/calc';

export interface HoverInfo {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartHandle {
  updateLast: (b: LiveBar) => void;
}

interface Props {
  candles: Candles | null;
  onHover?: (info: HoverInfo | null) => void;
}

const lineOpts = (color: string, width: 1 | 2 | 3 = 1, title = '') => ({
  color,
  lineWidth: width,
  priceLineVisible: false,
  lastValueVisible: false,
  title,
});

export const Chart = forwardRef<ChartHandle, Props>(function Chart({ candles, onHover }, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const lodRef = useRef<LodController | null>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const hoveringRef = useRef(false);

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

    // Pane 0 — price + long EMAs
    const candle = chart.addSeries(
      CandlestickSeries,
      { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' },
      0,
    );
    const ema377 = chart.addSeries(LineSeries, lineOpts('#f0b90b', 1, 'EMA 377'), 0);
    const ema610 = chart.addSeries(LineSeries, lineOpts('#9aa0b0', 1, 'EMA 610'), 0);

    // Pane 1 — volume
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);

    // Pane 2 — Williams %R (Williams Paşa)
    const wilR = chart.addSeries(LineSeries, lineOpts('#7E57C2', 2, 'Williams %R'), 2);
    const wilEma = chart.addSeries(LineSeries, lineOpts('#26a69a', 1), 2);
    wilR.createPriceLine({ price: 98, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '98' });
    wilR.createPriceLine({ price: 50, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    wilR.createPriceLine({ price: 5, color: '#787B86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '5' });

    // Pane 3 — NizamiCedid (MACD variant, normalized by fast EMA)
    const mHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3);
    const mDelta = chart.addSeries(
      AreaSeries,
      { lineColor: 'rgba(83,76,175,0.7)', topColor: 'rgba(83,76,175,0.35)', bottomColor: 'rgba(83,76,175,0.02)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      3,
    );
    const mMacd = chart.addSeries(LineSeries, lineOpts('#ff2fa6', 1, 'MACD'), 3);
    const mSignal = chart.addSeries(LineSeries, lineOpts('#FF6D00', 1, 'Signal'), 3);
    const mEma = chart.addSeries(LineSeries, lineOpts('#e6e6e6', 2, 'eMACD'), 3);
    mMacd.createPriceLine({ price: 0, color: '#4a4f5e', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    // Pane heights
    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(1.1);
    panes[2]?.setStretchFactor(2);
    panes[3]?.setStretchFactor(2.2);
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });

    const extras: ExtraSpec[] = [
      { series: ema377, kind: 'line' },
      { series: ema610, kind: 'line' },
      { series: wilR, kind: 'line' },
      { series: wilEma, kind: 'line' },
      { series: mHist, kind: 'hist', momentumColor: true },
      { series: mMacd, kind: 'line' },
      { series: mSignal, kind: 'line' },
      { series: mEma, kind: 'line' },
      { series: mDelta, kind: 'area' },
    ];
    const lod = new LodController(chart, candle, volume, extras);
    lodRef.current = lod;

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.size) {
        const c = param.seriesData.get(candle) as CandlestickData | undefined;
        const v = param.seriesData.get(volume) as HistogramData | undefined;
        if (c) {
          hoveringRef.current = true;
          onHoverRef.current?.({ time: Number(param.time), open: c.open, high: c.high, low: c.low, close: c.close, volume: v?.value ?? 0 });
          return;
        }
      }
      hoveringRef.current = false;
      onHoverRef.current?.(lod.lastBar());
    });

    return () => {
      lod.destroy();
      lodRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!lodRef.current || !candles) return;
    const ind = computeIndicators(candles);
    const extraVals = [
      ind.ema377p,
      ind.ema610p,
      ind.percentR,
      ind.emawil,
      ind.histN,
      ind.macdN,
      ind.signalN,
      ind.eMacDN,
      ind.deltaN,
    ];
    lodRef.current.setData(candles, extraVals);
    if (!hoveringRef.current) onHoverRef.current?.(lodRef.current.lastBar());
  }, [candles]);

  useImperativeHandle(
    ref,
    () => ({
      updateLast: (b) => {
        lodRef.current?.updateLast(b);
        if (!hoveringRef.current) onHoverRef.current?.(lodRef.current?.lastBar() ?? null);
      },
    }),
    [],
  );

  return <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />;
});
