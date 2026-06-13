import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createChart, CrosshairMode, IChartApi, ISeriesApi } from 'lightweight-charts';
import { Candles, LiveBar } from '../data/types';
import { LodController } from '../chart/lod';

export interface ChartHandle {
  updateLast: (b: LiveBar) => void;
}

interface Props {
  candles: Candles | null;
}

export const Chart = forwardRef<ChartHandle, Props>(function Chart({ candles }, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const lodRef = useRef<LodController | null>(null);

  useEffect(() => {
    const chart: IChartApi = createChart(elRef.current!, {
      autoSize: true,
      layout: { background: { color: '#0e0f13' }, textColor: '#cfd2dc' },
      grid: { vertLines: { color: '#171a23' }, horzLines: { color: '#171a23' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e3a' },
      timeScale: { borderColor: '#2a2e3a', timeVisible: true, secondsVisible: false },
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
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    lodRef.current = new LodController(chart, candle, volume);

    return () => {
      lodRef.current?.destroy();
      lodRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (lodRef.current && candles) lodRef.current.setData(candles);
  }, [candles]);

  useImperativeHandle(ref, () => ({ updateLast: (b) => lodRef.current?.updateLast(b) }), []);

  return <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />;
});
