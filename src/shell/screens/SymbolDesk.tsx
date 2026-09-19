import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { DEFAULT_PARAMS, type IndBundle, type IndicatorParams } from '../../core/indicators/calc';
import { useChartColors } from '../chart/useThemeColors';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { Announce } from '../Announce';
import {
  Button,
  Combobox,
  EmptyState,
  Popover,
  Select,
  Skeleton,
  Stat,
  Tabs,
  NumberField,
  Toggle,
  trPct,
  trNum,
} from '../../ui';
import { Icon } from '../../ui/icons';
import type { HealthReport } from '../../core/data/health';
import { DAY_SECONDS } from '../../core/data/pack';
import type { TF } from '../../core/data/resample';
import type { Candles } from '../../core/data/types';
import type { Metric } from '../../core/stats/summary';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import type { UrlState } from '../urlState';
import { tercihOku, tercihYaz } from '../tercih';

/** Grafik ayrı chunk'ta: lightweight-charts ilk yük bütçesine girmesin. */
const LazyPriceChart = lazy(() =>
  import('../chart/PriceChart').then((m) => ({ default: m.PriceChart })),
);

/** Finansal panel de ayrı chunk: grafiğe gelen kullanıcı bunu indirmesin. */
const LazyFinancials = lazy(() =>
  import('./FinancialsPanel').then((m) => ({ default: m.FinancialsPanel })),
);

/** Sektör paneli de ayrı chunk; paketi yalnızca o sekme isterse indirir. */
const LazySector = lazy(() => import('./SectorPanel').then((m) => ({ default: m.SectorPanel })));

/** Radar da ayrı chunk: açılmadıkça ne kodu ne de piyasa paketi iniyor. */
const LazyRadar = lazy(() => import('./Radar').then((m) => ({ default: m.Radar })));

/**
 * Grafik ekranının kalıcı tercihleri.
 *
 * Kullanıcı isteği: "son pozisyonumuz grafikte ve indikatör tercihlerimiz
 * kayıtlı kalsın". Piyasa/sembol/periyot URL'de de duruyor (paylaşılabilirlik
 * için) — burada saklanan, ADRES ÇIPLAKKEN nereden devam edileceği. URL bir
 * sembol taşıyorsa o kazanır; paylaşılan bir bağlantı başka birinin son
 * baktığı hisseye açılmamalı.
 */
const MASA_ANAHTARI = 'masa.v1';
const RADAR_ANAHTARI = 'radar.genislik.v1';

interface MasaTercihi {
  m?: string;
  s?: string;
  tf?: string;
  enabled?: Record<string, boolean>;
  panels?: Record<string, boolean>;
  indParams?: IndicatorParams;
  showVolume?: boolean;
  radar?: boolean;
}

const RADAR_MIN = 220;
const RADAR_MAX = 560;

const VIEW_TABS = [
  { id: 'grafik', label: 'Grafik' },
  { id: 'finansal', label: 'Finansallar' },
  { id: 'sektor', label: 'Sektör' },
];

const TF_ITEMS = [
  { id: 'D', label: 'Günlük' },
  { id: 'W', label: 'Haftalık' },
  { id: 'M', label: 'Aylık' },
];

// Renk TOKEN ADI olarak duruyor, `var(--x)` olarak değil.
//
// Kusur buydu: renk grafiğe düz metin `'var(--accent)'` olarak gidiyordu ve
// grafik canvas'a çiziyor — canvas CSS değişkeni ÇÖZEMEZ. Kütüphane geçersiz
// rengi yutup varsayılana (siyah) düşüyordu; yani EMA 50 yanlış renkte
// çiziliyor, EMA 200 de mumların üstünde ayırt edilemiyordu. Token artık
// `useChartColors` üzerinden GERÇEK değere çevriliyor.
const OVERLAY_DEFS = [
  { key: 'ema50', label: 'EMA 50', length: 50, token: 'accent' as const },
  { key: 'ema200', label: 'EMA 200', length: 200, token: 'warn' as const },
];

/**
 * Fiyatın ALTINDAKİ paneller. Eski arayüzün iki indikatörü taşındı; ikisi de
 * "260 günlük paradigma" parametreleriyle geliyor.
 *
 * Ayrı panel şart: %R 0–100 aralığında, MACD ise fiyata bölünmüş küçük bir
 * sayı. Fiyatla aynı eksende çizilseler ikisi de düz çizgiye iner.
 */
const PANELLER = [
  {
    key: 'wr',
    label: 'Williams %R',
    pane: 1,
    // Parametre ADI → etiket. Değerler `indParams` içinde tutuluyor.
    params: [
      ['wr', '%R'],
      ['wrEmaA', 'EMA yavaş'],
      ['wrEmaB', 'EMA hızlı'],
    ] as const,
  },
  {
    key: 'macd',
    label: 'MACD (NizamiCedid)',
    pane: 2,
    params: [
      ['macdFast', 'hızlı'],
      ['macdSlow', 'yavaş'],
      ['macdSig', 'sinyal'],
      ['macdVwma', 'eMACD'],
    ] as const,
  },
] as const;

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; candles: Candles; symbol: string; fromCache: boolean; generated: number }
  | { status: 'error'; message: string; missingData: boolean };

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

function fmt(metric: Metric): string {
  const v = metric.value;
  if (!Number.isFinite(v)) return '—';
  switch (metric.unit) {
    case 'pct':
      return trPct(v, 2, !!metric.signed);
    case 'price':
      return trNum(v, v < 10 ? 4 : 2);
    case 'years':
      return `${trNum(v, 1)} yıl`;
    case 'volume':
      return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    default:
      return trNum(v, 2);
  }
}

/** Sembol Masası — "bu hisse ne durumda?" sorusunun tek ekranlık cevabı. */
export default function SymbolDesk({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const tf = (['D', 'W', 'M'].includes(state.tf) ? state.tf : 'D') as TF;

  // Paket indirilmez: bu ekran tek sembolle çalışır, worker havuzu yeter.
  const analysis = useAnalysis(market, { bundle: false });
  const [symbols, setSymbols] = useState<string[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [tab, setTab] = useState('grafik');
  const [chartReady, setChartReady] = useState(false);
  const kayit = useRef<MasaTercihi>(tercihOku<MasaTercihi>(MASA_ANAHTARI, {}));
  const [showVolume, setShowVolume] = useState(() => kayit.current.showVolume ?? true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => kayit.current.enabled ?? { ema50: true, ema200: false },
  );
  // Panel kapalıyken indikatör HİÇ hesaplanmıyor (worker isteğinde yok).
  const [panels, setPanels] = useState<Record<string, boolean>>(
    () => kayit.current.panels ?? { wr: false, macd: false },
  );
  const [indParams, setIndParams] = useState<IndicatorParams>(() => ({
    ...DEFAULT_PARAMS,
    // Eski bir sürümden kalan kayıt eksik alan taşıyabilir: varsayılanın
    // üstüne yazılıyor, böylece yeni bir parametre eklendiğinde kayıt
    // yüzünden `undefined` gelmiyor.
    ...(kayit.current.indParams ?? {}),
  }));
  const [radarAcik, setRadarAcik] = useState(() => kayit.current.radar ?? false);
  const [radarGenislik, setRadarGenislik] = useState(() =>
    // VARSAYILAN 300 DEĞİL 420. 300 px'te radar tablosunun görünen alanı 272
    // px kalıyordu ve varsayılan sütunlar 520 px yer istiyordu: kullanıcı
    // fiyatı görmek için bile yatay kaydırmak zorundaydı (ölçüldü). 420 px'te
    // sembol + fiyat + 1 gün + hacim oranı + eylem sığıyor; sektör sütunu
    // ayırıcı genişletilince kendiliğinden geliyor.
    Math.min(RADAR_MAX, Math.max(RADAR_MIN, tercihOku<number>(RADAR_ANAHTARI, 420))),
  );
  const requestId = useRef(0);
  const surukleme = useRef<{ x: number; w: number } | null>(null);

  const radarAyarla = (px: number) => {
    const kirpik = Math.min(RADAR_MAX, Math.max(RADAR_MIN, Math.round(px)));
    setRadarGenislik(kirpik);
    tercihYaz(RADAR_ANAHTARI, kirpik);
  };

  // Grafik kütüphanesi zayıf makinede ~230 ms CPU istiyor (profille ölçüldü).
  // Mount'u boş zamana bırakınca metrikler ve sağlık paneli önce boyanıyor;
  // kullanıcı sayfayı "donmuş" görmüyor.
  useEffect(() => {
    const idle = (
      window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) {
      const id = idle(() => setChartReady(true), { timeout: 600 });
      return () =>
        (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(
          id,
        );
    }
    const id = setTimeout(() => setChartReady(true), 60);
    return () => clearTimeout(id);
  }, []);

  // Manifest → sembol listesi. Piyasa değişince yeniden.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setSymbols([]);
    dataClient
      .manifest(market, controller.signal)
      .then((manifest) => {
        if (cancelled) return;
        setSymbols(Object.keys(manifest.symbols).sort());
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [market]);

  const symbol = state.s || symbols[0] || '';

  /**
   * ÇIPLAK adreste son bakılan yere dön.
   *
   * Yalnızca URL hiçbir sembol taşımıyorken ve YALNIZCA bir kez: adres
   * paylaşıldığında o adres kazanmalı, kullanıcının kendi geçmişi başkasının
   * bağlantısını ezmemeli. `replace` kullanılıyor — geri tuşu boş bir
   * adrese dönmek zorunda kalmasın.
   */
  const geriYuklendi = useRef(false);
  useEffect(() => {
    if (geriYuklendi.current) return;
    geriYuklendi.current = true;
    const son = kayit.current;
    if (state.s || !son.s) return;
    push({ m: son.m ?? market, s: son.s, tf: son.tf ?? tf });
    // Tek seferlik: bağımlılıklar bilerek dar tutuldu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tercihler değiştikçe kaydediliyor. Sembol/piyasa/periyot da burada:
  // adres çıplakken buradan devam edilecek.
  useEffect(() => {
    if (!symbol) return;
    kayit.current = {
      m: market,
      s: symbol,
      tf,
      enabled,
      panels,
      indParams,
      showVolume,
      radar: radarAcik,
    };
    tercihYaz(MASA_ANAHTARI, kayit.current);
  }, [market, symbol, tf, enabled, panels, indParams, showVolume, radarAcik]);

  // Seri yükleme.
  useEffect(() => {
    if (!symbol) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    setLoad({ status: 'loading' });

    (async () => {
      try {
        const manifest = await dataClient.manifest(market, controller.signal);
        const result = await dataClient.series(market, symbol, controller.signal);
        if (id !== requestId.current) return;
        setLoad({
          status: 'ready',
          candles: result.candles,
          symbol,
          fromCache: result.fromCache,
          generated: manifest.generated,
        });
      } catch (err) {
        if (id !== requestId.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({
          status: 'error',
          message,
          missingData: /manifest|HTTP 404/i.test(message),
        });
      }
    })();

    return () => controller.abort();
  }, [market, symbol]);

  const daily = load.status === 'ready' ? load.candles : null;

  /**
   * Periyot dönüşümü, indikatörler, özet metrikler ve veri sağlığı WORKER'da.
   * Ana iş parçacığında yapıldıklarında zayıf makinede (6× CPU yavaşlatma)
   * tek parça ~150 ms blok ölçülmüştü; artık ana thread yalnızca çiziyor.
   */
  const [analysisResult, setAnalysisResult] = useState<{
    candles: Candles;
    metrics: Metric[];
    health: HealthReport;
    overlayValues: Float64Array[];
    /** Panel açıksa: Williams %R ve NizamiCedid MACD serileri. */
    indicators?: IndBundle;
  } | null>(null);
  /** Analiz (worker) hatası — seri indi ama hesap yapılamadı. */
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  useEffect(() => {
    const client = clientRef.current;
    if (!daily || !client) return;
    let cancelled = false;
    setAnalysisError(null);
    client
      .symbol(daily, {
        tf,
        overlays: OVERLAY_DEFS.map((d) => ({ key: d.key, length: d.length })),
        // Hiçbir panel açık değilse indikatör hesaplanmıyor.
        indicators: panels.wr || panels.macd ? indParams : undefined,
        todayDay: Math.floor(Date.now() / 1000 / DAY_SECONDS),
        realReturn: market === 'bist',
      })
      .then((result) => {
        if (!cancelled) setAnalysisResult(result);
      })
      .catch((err: unknown) => {
        // Sessizce null'a düşmek ekranı BOŞ bırakıyordu: grafik yok, metrik
        // yok, hata da yok. Kullanıcı neyin eksik olduğunu göremiyordu.
        if (cancelled) return;
        setAnalysisResult(null);
        setAnalysisError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [daily, tf, market, panels.wr, panels.macd, indParams]);

  const candles = analysisResult?.candles ?? null;
  const metrics = analysisResult?.metrics ?? [];

  const chartColors = useChartColors();

  const overlays = useMemo(() => {
    const bos = new Float64Array(0);
    const ind = analysisResult?.indicators;
    const fiyat = OVERLAY_DEFS.map((def, i) => ({
      key: def.key,
      label: def.label,
      color: chartColors[def.token],
      values: analysisResult?.overlayValues[i] ?? bos,
      visible: !!enabled[def.key],
    }));

    // Williams %R paneli. 50 çizgisi eşiğin kendisi: yayındaki stratejilerin
    // çoğu "%R 50'yi yukarı kesince al" diyor, çizgi olmadan okunmuyor.
    const wr = [
      {
        key: 'wr:r',
        label: '%R',
        color: chartColors.accent,
        values: ind?.percentR ?? bos,
        baseline: 50,
      },
      {
        key: 'wr:a',
        label: `EMA ${indParams.wrEmaA}`,
        color: chartColors.warn,
        values: ind?.emawil ?? bos,
      },
      {
        key: 'wr:b',
        label: `EMA ${indParams.wrEmaB}`,
        color: chartColors.muted,
        values: ind?.emawil120 ?? bos,
      },
    ].map((o) => ({ ...o, pane: 1, visible: !!panels.wr }));

    // NizamiCedid MACD paneli. Seriler hızlı EMA'ya bölünmüş (ölçekten
    // arındırılmış), yani farklı fiyat seviyelerindeki semboller arasında
    // karşılaştırılabilir. Sıfır çizgisi yön eşiği.
    const macd = [
      {
        key: 'macd:h',
        label: 'Histogram',
        color: chartColors.muted,
        values: ind?.histN ?? bos,
        kind: 'hist' as const,
        momentumColor: true,
        baseline: 0,
      },
      { key: 'macd:m', label: 'MACD', color: chartColors.accent, values: ind?.macdN ?? bos },
      { key: 'macd:s', label: 'Sinyal', color: chartColors.warn, values: ind?.signalN ?? bos },
      { key: 'macd:e', label: 'eMACD', color: chartColors.down, values: ind?.eMacDN ?? bos },
    ].map((o) => ({ ...o, pane: 2, visible: !!panels.macd }));

    return [...fiyat, ...wr, ...macd];
  }, [analysisResult, enabled, panels, indParams, chartColors]);

  return (
    <div className="desk">
      <Announce
        message={
          analysisResult && !analysisError
            ? `${symbol} hazır: ${analysisResult.candles.length} bar.`
            : ''
        }
      />
      <div className="desk__bar">
        <Select
          label="Piyasa"
          value={market}
          onChange={(value) => push({ m: value, s: '' })}
          options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
        <Combobox
          label="Sembol"
          value={symbol}
          onChange={(value) => push({ s: value })}
          options={symbols.map((s) => ({ value: s, label: s }))}
          placeholder={symbol || 'Sembol ara…'}
          emptyText={symbols.length ? 'Eşleşme yok' : 'Sembol listesi yüklenemedi'}
        />
        <div className="desk__tf">
          <Tabs label="Görünüm" items={VIEW_TABS} value={tab} onChange={setTab} />
        </div>
        {tab === 'grafik' ? (
          <div className="desk__tf">
            <Tabs label="Periyot" items={TF_ITEMS} value={tf} onChange={(id) => push({ tf: id })} />
          </div>
        ) : null}
        <div className="desk__toggles" hidden={tab !== 'grafik'}>
          {OVERLAY_DEFS.map((def) => (
            <Toggle
              key={def.key}
              label={def.label}
              checked={!!enabled[def.key]}
              onChange={(v) => setEnabled((prev) => ({ ...prev, [def.key]: v }))}
            />
          ))}
          <Toggle label="Hacim" checked={showVolume} onChange={setShowVolume} />
          {/* Radar piyasa paketini indiriyor; kapalıyken o bedel ödenmiyor. */}
          <Toggle label="Radar" checked={radarAcik} onChange={setRadarAcik} />
        </div>
      </div>

      {/*
        İndikatör panelleri ayrı bir satırda: parametre alanlarıyla birlikte
        üst çubuğa sığmıyorlar ve üst çubuk zaten piyasa/sembol/periyot
        taşıyor. Parametreler yalnızca panel AÇIKKEN görünüyor — kapalı bir
        indikatörün dört sayı kutusu ekranda yer kaplamamalı.
      */}
      {tab === 'grafik' ? (
        <div className="desk__panels">
          {PANELLER.map((panel) => (
            <div key={panel.key} className="desk__panel">
              <Toggle
                label={panel.label}
                checked={!!panels[panel.key]}
                onChange={(v) => setPanels((prev) => ({ ...prev, [panel.key]: v }))}
              />
              {panels[panel.key] ? (
                <div className="desk__panelparams">
                  {panel.params.map(([alan, etiket]) => (
                    <NumberField
                      key={alan}
                      label={etiket}
                      value={indParams[alan]}
                      min={2}
                      max={1000}
                      onChange={(v) =>
                        setIndParams((prev) => ({ ...prev, [alan]: Math.max(2, Math.round(v)) }))
                      }
                    />
                  ))}
                  <button
                    type="button"
                    className="desk__reset"
                    onClick={() => setIndParams(DEFAULT_PARAMS)}
                  >
                    Varsayılan
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {load.status !== 'error' && (analysisError || analysis.status === 'error') ? (
        <DataError title="Analiz çalıştırılamadı" detail={analysisError ?? analysis.error} />
      ) : null}

      {load.status === 'error' ? (
        <EmptyState
          tone="error"
          icon={<Icon name="alert" size={28} />}
          title={load.missingData ? 'Bu piyasa için paketlenmiş veri yok' : 'Veri yüklenemedi'}
          description={
            load.missingData ? (
              <>
                Veri CI'da üretiliyor (<code>scripts/pack_data.py</code>); yerel geliştirmede
                <code> public/data/&lt;piyasa&gt;/pack/</code> boş olabilir. Ayrıntı:{' '}
                <code>docs/plan/veri-formati.md</code>.
              </>
            ) : (
              load.message
            )
          }
          action={
            <Button onClick={() => push({ s: symbol })} variant="secondary">
              Yeniden dene
            </Button>
          }
        />
      ) : null}

      {load.status === 'loading' || load.status === 'idle' ? (
        <div className="desk__loading">
          <Skeleton height="320px" />
          <Skeleton count={2} height="64px" />
        </div>
      ) : null}

      {load.status === 'ready' && candles && tab === 'finansal' ? (
        <Suspense fallback={<Skeleton count={4} height="60px" />}>
          <LazyFinancials
            market={market}
            symbol={symbol}
            price={candles.close[candles.length - 1]}
            candles={candles}
          />
        </Suspense>
      ) : null}

      {tab === 'sektor' ? (
        <Suspense fallback={<Skeleton count={4} height="40px" />}>
          <LazySector
            market={market}
            symbol={symbol}
            client={analysis.status === 'ready' ? analysis.client : null}
            onSelect={(next) => push({ s: next })}
          />
        </Suspense>
      ) : null}

      {load.status === 'ready' && candles && tab === 'grafik' ? (
        <>
          <div className="desk__alan">
            <section className="desk__chart" aria-label={`${symbol} fiyat grafiği`}>
              {chartReady ? (
                <ChartPanel
                  candles={candles}
                  overlays={overlays}
                  showVolume={showVolume}
                  /*
                    Sembol ARTIK anahtarda değil.

                    Kullanıcı isteği: "hisseler arası geçince de grafikteki
                    zaman aralığı korunsun". LOD katmanı bunu zaten
                    destekliyordu (aynı görünür bar sayısı ve sağ kenardan
                    aynı boşluk) ama anahtar sembolü içerdiği için her geçişte
                    yeniden sığdırılıyordu. Periyot ya da piyasa değişince
                    sığdırmak DOĞRU: bar uzunluğu değişince eski aralık başka
                    bir zamana denk gelir.
                  */
                  fitKey={`${market}:${tf}`}
                />
              ) : (
                <Skeleton height="320px" />
              )}
            </section>

            {radarAcik ? (
              <>
                {/* Ayırıcı: sürüklemeyle genişlik. Klavyeyle de çalışıyor —
                    yalnızca fareyle ayarlanabilen bir bölme erişilemez olurdu. */}
                {/* Ayarlanan şey bir DEĞER (piksel genişliği), o yüzden
                    `slider`: ekran okuyucu "Radar genişliği, 300" diye
                    okuyup ok tuşlarıyla değiştirilebileceğini söylüyor.
                    Odaklanabilir `separator` da ARIA'nın bölücü kalıbı ama
                    düz bir `div`e tabIndex vermek odak davranışını elle
                    yazmayı gerektiriyordu. */}
                <button
                  type="button"
                  className="desk__ayirici"
                  role="slider"
                  aria-label="Radar genişliği"
                  aria-valuenow={radarGenislik}
                  aria-valuemin={RADAR_MIN}
                  aria-valuemax={RADAR_MAX}
                  aria-valuetext={`${radarGenislik} piksel`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    surukleme.current = { x: e.clientX, w: radarGenislik };
                  }}
                  onPointerMove={(e) => {
                    const d = surukleme.current;
                    if (!d) return;
                    // Sola sürükleme radarı BÜYÜTÜR: radar sağda.
                    radarAyarla(d.w + (d.x - e.clientX));
                  }}
                  onPointerUp={() => {
                    surukleme.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') radarAyarla(radarGenislik + 24);
                    else if (e.key === 'ArrowRight') radarAyarla(radarGenislik - 24);
                    else return;
                    e.preventDefault();
                  }}
                />
                <div className="desk__radar" style={{ width: radarGenislik }}>
                  <Suspense fallback={<Skeleton count={3} height="40px" />}>
                    <LazyRadar
                      market={market}
                      symbol={symbol}
                      // Havuz paylaşılıyor: radar açıldığında paketi bu
                      // havuza yüklüyor ve taramayı worker'da yapıyor.
                      client={analysis.client}
                      onSelect={(next) => push({ s: next })}
                      onClose={() => setRadarAcik(false)}
                    />
                  </Suspense>
                </div>
              </>
            ) : null}
          </div>

          <section className="desk__metrics" aria-label="Özet metrikler">
            {metrics.map((metric) => (
              <Stat
                key={metric.key}
                label={metric.label}
                value={fmt(metric)}
                hint={`${metric.bars} bar`}
                provenance={
                  <Popover
                    title={metric.label}
                    align="start"
                    trigger={(p) => (
                      <button
                        type="button"
                        className="desk__prov"
                        {...p}
                        aria-label={`${metric.label}: bu sayı nereden geliyor?`}
                      >
                        ?
                      </button>
                    )}
                  >
                    <dl className="desk__provlist">
                      <dt>Formül</dt>
                      <dd>{metric.formula}</dd>
                      <dt>Pencere</dt>
                      <dd>
                        {metric.window} · {metric.bars} bar
                      </dd>
                      <dt>Kaynak</dt>
                      <dd>
                        {MARKET_LABEL[market]} günlük OHLCV,{' '}
                        {TF_ITEMS.find((t) => t.id === tf)?.label} periyoda indirgenmiş
                      </dd>
                    </dl>
                  </Popover>
                }
              />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

function ChartPanel(props: ComponentProps<typeof LazyPriceChart>) {
  return (
    <Suspense fallback={<Skeleton height="320px" />}>
      <LazyPriceChart {...props} />
    </Suspense>
  );
}
