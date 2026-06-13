import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { Candles, LiveBar } from '../data/types';
import { LodController } from '../chart/lod';

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

    const candle: ISeriesApi<'Candlestick'> = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const volume: ISeriesApi<'Histogram'> = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    const lod = new LodController(chart, candle, volume);
    lodRef.current = lod;

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.size) {
        const c = param.seriesData.get(candle) as CandlestickData | undefined;
        const v = param.seriesData.get(volume) as HistogramData | undefined;
        if (c) {
          hoveringRef.current = true;
          onHoverRef.current?.({
            time: Number(param.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: v?.value ?? 0,
          });
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
    if (lodRef.current && candles) {
      lodRef.current.setData(candles);
      if (!hoveringRef.current) onHoverRef.current?.(lodRef.current.lastBar());
    }
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
