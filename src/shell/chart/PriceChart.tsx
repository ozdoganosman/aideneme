import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { LodController, type ExtraSpec } from '../../chart/lod';
import type { Candles } from '../../core/data/types';
import { useChartColors } from './useThemeColors';

export interface Overlay {
  key: string;
  label: string;
  color: string;
  values: Float64Array;
  visible: boolean;
}

export interface PriceChartProps {
  candles: Candles;
  overlays?: Overlay[];
  showVolume?: boolean;
  /** Sembol değişiminde görünümü koru (aynı zoom), veri değişiminde sığdır. */
  fitKey?: string;
  height?: number | string;
}

/**
 * Fiyat grafiği. Veriyi doğrudan kütüphaneye vermez — mevcut LOD çekirdeğine
 * (src/chart/lod.ts) verir: ekrana her zaman yalnızca görünen aralığın ekran
 * çözünürlüğüne indirgenmiş bir penceresi gider, böylece çizim maliyeti veri
 * boyutundan bağımsızdır.
 */
export function PriceChart({
  candles,
  overlays = [],
  showVolume = true,
  fitKey,
  height = '100%',
}: PriceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lodRef = useRef<LodController | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const lastFitKey = useRef<string | undefined>(undefined);
  const colors = useChartColors();

  // Grafik bir kez kurulur; overlay serileri sabit kalır, görünürlük değişir.
  // (LOD denetleyicisi seri listesini kuruluşta alır.)
  const overlayKeys = overlays.map((o) => o.key).join(',');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: colors.text,
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-sans'),
        fontSize: 11,
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: colors.muted, width: 1, style: LineStyle.LargeDashed },
        horzLine: { color: colors.muted, width: 1, style: LineStyle.LargeDashed },
      },
      rightPriceScale: { borderColor: colors.grid, ticksVisible: false, entireTextOnly: true },
      timeScale: {
        borderColor: colors.grid,
        timeVisible: false,
        ticksVisible: false,
        minBarSpacing: 0.06,
        rightOffset: 4,
        lockVisibleTimeRangeOnResize: true,
      },
    });

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: colors.up,
        downColor: colors.down,
        borderVisible: false,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
      },
      0,
    );

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        priceLineVisible: false,
        lastValueVisible: false,
        visible: showVolume,
      },
      0,
    );
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const specs: ExtraSpec[] = [];
    const map = new Map<string, ISeriesApi<'Line'>>();
    for (const overlay of overlays) {
      const series = chart.addSeries(
        LineSeries,
        {
          color: overlay.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: overlay.label,
          visible: overlay.visible,
        },
        0,
      );
      map.set(overlay.key, series);
      specs.push({ series, kind: 'line' });
    }

    chartRef.current = chart;
    volumeRef.current = volumeSeries;
    overlayRef.current = map;
    // Ekranın gösterebileceğinden fazla kova çizmenin faydası yok: 1366 px'lik
    // bir ekranda 4000 kova ≈ piksel başına 3 mum. Cihaz genişliğine göre
    // ölçeklemek zayıf makinede kare maliyetini belirgin düşürüyor; çekirdek
    // sayısı düşük cihazlarda ayrıca yarıya iniyor (ölçüm: 6× yavaşlatılmış
    // CPU'da grafik, sayfanın en pahalı tek işi).
    const cores = navigator.hardwareConcurrency ?? 4;
    const density = cores <= 2 ? 0.6 : cores <= 4 ? 0.9 : 1.2;
    const buckets = Math.round(
      Math.min(4000, Math.max(600, host.clientWidth * (window.devicePixelRatio || 1) * density)),
    );
    lodRef.current = new LodController(chart, candleSeries, volumeSeries, specs, [], buckets);

    // Grafik kütüphanesi bir atıf bağlantısı ekliyor; metni logo olduğu için
    // erişilebilir adı YOK (adsız bağlantı: WCAG 2.4.4/4.1.2). Atfı kaldırmak
    // yerine adlandırıyoruz — ekran okuyucu "boş bağlantı" okumasın.
    for (const link of host.querySelectorAll('a')) {
      if (!link.textContent?.trim() && !link.getAttribute('aria-label')) {
        link.setAttribute('aria-label', 'Grafik kütüphanesi hakkında (TradingView)');
      }
    }
    lastFitKey.current = undefined;

    return () => {
      chart.remove();
      chartRef.current = null;
      lodRef.current = null;
      overlayRef.current = new Map();
    };
    // Renk/görünürlük değişimleri aşağıdaki efektlerde uygulanır — grafik
    // yeniden kurulmaz, kullanıcının zoom'u korunur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKeys]);

  // Veri → LOD. Sembol/periyot değişince sığdır, aynı seride güncellemede koru.
  useEffect(() => {
    const lod = lodRef.current;
    if (!lod) return;
    const fit = fitKey !== lastFitKey.current;
    lastFitKey.current = fitKey;
    lod.setData(
      candles,
      overlays.map((o) => o.values),
      fit,
    );
    // overlays her render'da yeni dizi; değer kimliği yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, fitKey, overlayKeys, overlays.map((o) => o.values.length).join(',')]);

  // Tema değişimi: yeniden kurmadan renkleri uygula.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid },
    });
  }, [colors]);

  // Hacim görünürlüğü.
  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // Overlay görünürlüğü.
  useEffect(() => {
    for (const overlay of overlays) {
      overlayRef.current.get(overlay.key)?.applyOptions({ visible: overlay.visible });
    }
  }, [overlays]);

  return <div className="chart-host" ref={hostRef} style={{ height }} />;
}
