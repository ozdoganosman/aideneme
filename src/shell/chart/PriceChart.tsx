import { useEffect, useId, useRef, type MutableRefObject } from 'react';
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
import { LodController, type ExtraSpec, type KorunanGorunum } from '../../chart/lod';
import type { Candles } from '../../core/data/types';
import { trDay } from '../../core/format/date';
import { useChartColors } from './useThemeColors';

export interface Overlay {
  key: string;
  label: string;
  color: string;
  values: Float64Array;
  visible: boolean;
  /**
   * Hangi panele çizilecek. 0 = fiyat paneli (EMA örtüleri).
   * 1, 2… = fiyatın ALTINDA ayrı panel (Williams %R, MACD).
   *
   * Ayrı panel şart: %R 0–100, MACD ise fiyata bölünmüş küçük bir sayı.
   * Fiyatla aynı eksende çizilseler ikisi de düz çizgiye iner.
   */
  pane?: number;
  /** Çizgi mi sütun mu (MACD histogramı sütun). */
  kind?: 'line' | 'hist';
  /** Histogramı yönüne göre renklendir (MACD betiğindeki gibi). */
  momentumColor?: boolean;
  /** Bu panelde çizilecek sabit yatay çizgi (%R'de 50, MACD'de 0). */
  baseline?: number;
}

/**
 * Bileşen SÖKÜLÜNCE de yaşayan görünüm.
 *
 * Sembol değişince yükleme ekranı grafiğin yerini alıyor, yani bileşen
 * gerçekten sökülüyor ve grafik nesnesi yok ediliyor. Görünümü denetleyicinin
 * içinde saklamak bu yüzden yetmiyordu: onu bileşenin DIŞINDAKİ bir ref'te
 * tutup yeniden kurulumda geri veriyoruz. `anahtar` da taşınmalı — yoksa
 * yeniden kurulan bileşen `fitKey`i "yeni" sanıp görünümü sığdırır.
 */
export interface GrafikGorunumu extends KorunanGorunum {
  anahtar?: string;
}

export interface PriceChartProps {
  candles: Candles;
  overlays?: Overlay[];
  showVolume?: boolean;
  /** Sembol değişiminde görünümü koru (aynı zoom), veri değişiminde sığdır. */
  fitKey?: string;
  /** Sökülme/yeniden kurulma arasında görünümü taşıyan ref. */
  gorunumRef?: MutableRefObject<GrafikGorunumu | null>;
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
  gorunumRef,
  height = '100%',
}: PriceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lodRef = useRef<LodController | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRef = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>(new Map());
  const lastFitKey = useRef<string | undefined>(undefined);
  const ozetRef = useRef<HTMLParagraphElement>(null);
  const ozetId = useId();
  const ozetYazRef = useRef<(() => void) | null>(null);
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
      // Eksen dili TARAYICIYA bırakılmıştı: kütüphane yerel ayardan okuyor ve
      // tarayıcısı İngilizce olan makinede eksen "May, Jun, Jul" yazıyordu —
      // ürünün geri kalanı Türkçe biçimdeyken. Tek kaynak: tr-TR.
      localization: { locale: 'tr-TR' },
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
    const map = new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>();
    for (const overlay of overlays) {
      const pane = overlay.pane ?? 0;
      const hist = overlay.kind === 'hist';
      const series = hist
        ? chart.addSeries(
            HistogramSeries,
            {
              color: overlay.color,
              priceLineVisible: false,
              lastValueVisible: false,
              title: overlay.label,
              visible: overlay.visible,
            },
            pane,
          )
        : chart.addSeries(
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
            pane,
          );
      // Sabit yatay çizgi (%R'de 50, MACD'de 0): eşiği görmeden çizginin
      // "yukarıda" mı "aşağıda" mı olduğu okunamaz.
      if (overlay.baseline !== undefined) {
        series.createPriceLine({
          price: overlay.baseline,
          // Izgara rengi DEĞİL: eşik çizgisi ızgaranın kendisiyle aynı renkte
          // olunca görünmüyordu (ölçüldü: %R'de 50, MACD'de 0 çizgisi yok
          // sanılıyordu). Eşik bir ızgara çizgisi değil, okunması gereken bir
          // sınır.
          color: colors.muted,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        });
      }
      map.set(overlay.key, series);
      specs.push({ series, kind: hist ? 'hist' : 'line', momentumColor: overlay.momentumColor });
    }

    // Panel yükseklikleri. Varsayılan dağıtımda indikatör panelleri fiyatla
    // neredeyse eşit pay alıyor ve mumlar eziliyordu; fiyat bu grafiğin asıl
    // işi. Esneme katsayısı: fiyat 3, her indikatör 1.
    const paneCount = 1 + Math.max(0, ...overlays.map((o) => o.pane ?? 0));
    if (paneCount > 1) {
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3);
      for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(1);
    }

    // Kütüphanenin ATIF bağlantısının erişilebilir adı yok: ekran okuyucu
    // "bağlantı" deyip susuyor, kullanıcı nereye gittiğini bilmiyor. Lisans
    // gereği bağlantı kaldırılamaz ama adlandırılabilir.
    //
    // Denetimden zamanlama şansıyla kaçıyordu: hazır-seçici değişince ortaya
    // çıktı. Bağlantı kurulum ANINDA henüz yok (kütüphane sonradan ekliyor),
    // o yüzden gözlemciyle bekleniyor; etiketlenince gözlemci kapanıyor.
    const etiketle = (): boolean => {
      const atif = host.querySelector<HTMLAnchorElement>('a[href*="tradingview"]');
      if (!atif) return false;
      if (!atif.getAttribute('aria-label')) {
        atif.setAttribute('aria-label', 'Grafik kütüphanesi: TradingView (yeni sekmede açılır)');
      }
      return true;
    };
    // Gözlemci ilk başarıda KAPANMIYOR: kütüphane yeniden boyutlanmada atıf
    // düğümünü yeniden kuruyor ve bir kez konan etiket siliniyor (ölçüldü:
    // etiket kurulumda konuyor, 500 ms sonra yok). Grafik ömrü boyunca açık
    // kalıyor, temizlikte kapanıyor.
    etiketle();
    const atifGozlemci = new MutationObserver(() => etiketle());
    atifGozlemci.observe(host, { childList: true, subtree: true });

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
    /**
     * Görünen tarih aralığını METİN olarak da yayınla.
     *
     * Grafik bir canvas: ekran okuyucu için tamamen opak, "ne görüyorum"
     * sorusunun yanıtı yok. Kap `aria-describedby` ile bu özete bağlı.
     * React durumu DEĞİL doğrudan DOM yazımı: kaydırma sırasında saniyede
     * onlarca kez yeniden render etmek zayıf makinede ölçülebilir maliyet.
     * `aria-live` de yok — her karede konuşan bir grafik işkence olurdu.
     */
    let sonOzet = '';
    const ozetYaz = () => {
      const el = ozetRef.current;
      const g = lodRef.current?.gorunumOku();
      if (!el || !g) return;
      const metin = `Görünen aralık: ${trDay(g.t0)} – ${trDay(g.t1)} · ${Math.round(g.bar)} bar`;
      if (metin === sonOzet) return;
      sonOzet = metin;
      el.textContent = metin;
    };
    ozetYazRef.current = ozetYaz;
    chart.timeScale().subscribeVisibleLogicalRangeChange(ozetYaz);

    // Önceki kurulumdan kalan görünümü geri ver. `lastFitKey` de oradan gelir:
    // eşitse `fit=false` olur ve görünüm korunur.
    const kayitli = gorunumRef?.current ?? null;
    lastFitKey.current = kayitli?.anahtar;
    if (kayitli) lodRef.current.gorunumYaz(kayitli);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(ozetYaz);
      ozetYazRef.current = null;
      if (gorunumRef) {
        const g = lodRef.current?.gorunumOku();
        if (g) gorunumRef.current = { ...g, anahtar: lastFitKey.current };
      }
      chart.remove();
      chartRef.current = null;
      lodRef.current = null;
      atifGozlemci?.disconnect();
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
    ozetYazRef.current?.();
    // overlays her render'da yeni dizi; değer kimliği yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, fitKey, overlayKeys, overlays.map((o) => o.values.length).join(',')]);

  /**
   * KAPALI panel yer kaplamamalı.
   *
   * Paneller kurulumda oluşuyor (seriler önceden yaratılıyor) ve esneme
   * katsayıları sabitti: her ikisi de kapalıyken grafiğin yaklaşık %40'ı boş
   * duruyordu — ölçüldü, ekran görüntüsünde fiyatın altındaki alanın tamamı
   * boştu. Kullanıcının isteği tam tersiydi: "grafiği olabildiğince genişlet".
   *
   * Kapalı panel sıfıra yakın bir katsayı alıyor; kütüphane paneli tamamen
   * kaldırmıyor ama payı ölçülemez hâle geliyor.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const panes = chart.panes();
    if (panes.length < 2) return;
    const acik = new Set(
      overlays.filter((o) => (o.pane ?? 0) > 0 && o.visible).map((o) => o.pane as number),
    );
    panes[0]?.setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(acik.has(i) ? 1 : 0.0001);
    // Görünürlük imzası yeterli: seri kimlikleri kurulumda sabitlendi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays.map((o) => `${o.pane ?? 0}:${o.visible ? 1 : 0}`).join(',')]);

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
    // Görünürlüğü açılan seriye veri YAZILMALI: gizliyken seyreltme atlandığı
    // için elinde çizilecek bir şey yok (bkz. lod.refreshExtras).
    lodRef.current?.refreshExtras();
  }, [overlays]);

  return (
    <>
      <div className="chart-host" ref={hostRef} style={{ height }} aria-describedby={ozetId} />
      <p className="chart-ozet visually-hidden" id={ozetId} ref={ozetRef} />
    </>
  );
}
