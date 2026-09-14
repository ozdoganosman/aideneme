import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  Popover,
  Select,
  Skeleton,
  Stat,
  Tabs,
  Toggle,
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

const OVERLAY_DEFS = [
  { key: 'ema50', label: 'EMA 50', length: 50, color: 'var(--accent)' },
  { key: 'ema200', label: 'EMA 200', length: 200, color: 'var(--warn)' },
];

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
      return `${v > 0 && metric.signed ? '+' : ''}${v.toFixed(2)}%`;
    case 'price':
      return v.toLocaleString('tr-TR', { maximumFractionDigits: v < 10 ? 4 : 2 });
    case 'years':
      return `${v.toFixed(1)} yıl`;
    case 'volume':
      return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    default:
      return v.toFixed(2);
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
  const [showVolume, setShowVolume] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ ema50: true, ema200: false });
  const requestId = useRef(0);

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
  }, [daily, tf, market]);

  const candles = analysisResult?.candles ?? null;
  const metrics = analysisResult?.metrics ?? [];
  const health = analysisResult?.health ?? null;

  const overlays = useMemo(
    () =>
      OVERLAY_DEFS.map((def, i) => ({
        key: def.key,
        label: def.label,
        color: def.color,
        values: analysisResult?.overlayValues[i] ?? new Float64Array(0),
        visible: !!enabled[def.key],
      })),
    [analysisResult, enabled],
  );

  return (
    <div className="desk">
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
        </div>
      </div>

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
          />
        </Suspense>
      ) : null}

      {tab === 'sektor' ? (
        <Suspense fallback={<Skeleton count={4} height="40px" />}>
          <LazySector market={market} symbol={symbol} onSelect={(next) => push({ s: next })} />
        </Suspense>
      ) : null}

      {load.status === 'ready' && candles && tab === 'grafik' ? (
        <>
          <section className="desk__chart" aria-label={`${symbol} fiyat grafiği`}>
            {chartReady ? (
              <ChartPanel
                candles={candles}
                overlays={overlays}
                showVolume={showVolume}
                fitKey={`${market}:${symbol}:${tf}`}
              />
            ) : (
              <Skeleton height="320px" />
            )}
          </section>

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

          {health ? (
            <HealthPanel health={health} generated={load.generated} cached={load.fromCache} />
          ) : null}
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

function HealthPanel({
  health,
  generated,
  cached,
}: {
  health: HealthReport;
  generated: number;
  cached: boolean;
}) {
  const tone = health.level === 'error' ? 'down' : health.level === 'warn' ? 'warn' : 'up';
  const label = health.level === 'error' ? 'Sorunlu' : health.level === 'warn' ? 'Dikkat' : 'Temiz';
  return (
    <section className="desk__health" aria-label="Veri sağlığı">
      <header>
        <h2>Veri sağlığı</h2>
        <Badge tone={tone}>{label}</Badge>
        <span className="desk__muted">
          {health.bars} bar · üretim {new Date(generated * 1000).toLocaleString('tr-TR')}
          {cached ? ' · önbellekten' : ''}
        </span>
      </header>
      <ul>
        {health.findings.map((finding) => (
          <li key={finding}>{finding}</li>
        ))}
      </ul>
      <p className="desk__muted">
        Bulgular düzeltilmez, yalnızca görünür kılınır — düzeltme kararı veriyi üreten katmana
        aittir.
      </p>
    </section>
  );
}
