import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
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
import { inspect, type HealthReport } from '../../core/data/health';
import { DAY_SECONDS } from '../../core/data/pack';
import { resample, type TF } from '../../core/data/resample';
import type { Candles } from '../../core/data/types';
import { emaArr } from '../../core/indicators/calc';
import { summarize, type Metric } from '../../core/stats/summary';
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

const VIEW_TABS = [
  { id: 'grafik', label: 'Grafik' },
  { id: 'finansal', label: 'Finansallar' },
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

  const [symbols, setSymbols] = useState<string[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [tab, setTab] = useState('grafik');
  const [showVolume, setShowVolume] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ ema50: true, ema200: false });
  const requestId = useRef(0);

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
  const candles = useMemo(() => (daily ? resample(daily, tf) : null), [daily, tf]);

  const overlays = useMemo(
    () =>
      OVERLAY_DEFS.map((def) => ({
        key: def.key,
        label: def.label,
        color: def.color,
        values: candles ? emaArr(candles.close, def.length) : new Float64Array(0),
        visible: !!enabled[def.key],
      })),
    [candles, enabled],
  );

  const metrics = useMemo(
    () => (candles ? summarize(candles, { realReturn: market === 'bist' }) : []),
    [candles, market],
  );

  const health: HealthReport | null = useMemo(() => {
    if (!daily) return null;
    return inspect(daily, { today: Math.floor(Date.now() / 1000 / DAY_SECONDS) });
  }, [daily]);

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

      {load.status === 'ready' && candles && tab === 'grafik' ? (
        <>
          <section className="desk__chart" aria-label={`${symbol} fiyat grafiği`}>
            <ChartPanel
              candles={candles}
              overlays={overlays}
              showVolume={showVolume}
              fitKey={`${market}:${symbol}:${tf}`}
            />
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
                        aria-label="Bu sayı nereden geliyor?"
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
