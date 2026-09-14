import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Combobox, EmptyState, Select, Skeleton, trPct } from '../../ui';
import { Icon } from '../../ui/icons';
import type { HealthReport } from '../../core/data/health';
import { DAY_SECONDS } from '../../core/data/pack';
import type { Candles } from '../../core/data/types';
import { computeRatios, qualityScore, type Ratios } from '../../core/fundamentals/metrics';
import type { Financials, FundamentalsSnapshot } from '../../core/fundamentals/types';
import type { Metric } from '../../core/stats/summary';
import { dataClient } from '../../data-client/client';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { LineChart } from '../chart/LineChart';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { CopyLink } from '../CopyLink';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const fmtMetric = (metric: Metric): string => {
  const v = metric.value;
  if (!Number.isFinite(v)) return '—';
  switch (metric.unit) {
    case 'pct':
      return trPct(v, 2, !!metric.signed);
    case 'price':
      return v.toLocaleString('tr-TR', { maximumFractionDigits: v < 10 ? 4 : 2 });
    case 'years':
      return `${v.toFixed(1)} yıl`;
    default:
      return v.toFixed(2);
  }
};

const fmtRatio = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/**
 * Rapor — tek sayfalık, paylaşılabilir ve YAZDIRILABİLİR özet.
 *
 * Ürün ilkesi #2 burada da geçerli: her sayının yanında nereden geldiği yazılı,
 * çünkü rapor ekrandan kopup başkasına gittiğinde açıklamayı yanında taşımalı.
 */
export default function Report({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market, { bundle: false });
  const symbol = state.s || analysis.symbols[0] || '';

  const [result, setResult] = useState<{
    candles: Candles;
    metrics: Metric[];
    health: HealthReport;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  useEffect(() => {
    const client = clientRef.current;
    if (!symbol || !client || analysis.status !== 'ready') return;
    let cancelled = false;
    setResult(null);
    setError(null);

    (async () => {
      try {
        const { candles } = await dataClient.series(market, symbol);
        const analysed = await client.symbol(candles, {
          tf: 'D',
          overlays: [],
          todayDay: Math.floor(Date.now() / 1000 / DAY_SECONDS),
          realReturn: market === 'bist',
        });
        if (cancelled) return;
        setResult({
          candles: analysed.candles,
          metrics: analysed.metrics,
          health: analysed.health,
        });

        const [snap, financials] = await Promise.all([
          fundamentalsClient.snapshot(market),
          fundamentalsClient.financials(market, symbol),
        ]);
        if (cancelled) return;
        setSnapshot(snap);
        setFin(financials);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market, symbol, analysis.status]);

  const ratios: Ratios | null = useMemo(() => {
    const row = snapshot?.symbols[symbol];
    if (!row || !result) return null;
    return computeRatios({ row, price: result.candles.close[result.candles.length - 1] });
  }, [snapshot, symbol, result]);

  const quality = useMemo(() => (fin ? qualityScore(fin) : null), [fin]);

  if (error) {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Rapor hazırlanamadı"
        description={error}
      />
    );
  }

  return (
    <div className="report">
      <div className="report__toolbar">
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
          options={analysis.symbols.map((s) => ({ value: s, label: s }))}
          placeholder={symbol || 'Sembol ara…'}
        />
        <Button variant="primary" onClick={() => window.print()}>
          Yazdır / PDF
        </Button>
        <CopyLink />
        <span className="desk__muted">
          Bağlantı tüm seçimleri taşır; karşı taraf aynı raporu görür.
        </span>
      </div>

      {error || analysis.status === 'error' ? (
        // Hata durumu daha önce HİÇ gösterilmiyordu: ekran sonsuza kadar
        // iskelet kalıyor, kullanıcı hâlâ yükleniyor sanıyordu.
        <DataError title="Rapor verisi yüklenemedi" detail={error ?? analysis.error} />
      ) : !result ? (
        <Skeleton count={5} height="60px" />
      ) : (
        <article className="report__sheet">
          <header className="report__head">
            <div>
              <h2>
                {symbol} · {MARKET_LABEL[market]}
              </h2>
              <p className="desk__muted">
                Veri {day(result.candles.time[0])} –{' '}
                {day(result.candles.time[result.candles.length - 1])} · {result.candles.length} bar
                · rapor {new Date().toISOString().slice(0, 10)}
              </p>
            </div>
            <Badge
              tone={
                result.health.level === 'error'
                  ? 'down'
                  : result.health.level === 'warn'
                    ? 'warn'
                    : 'up'
              }
            >
              Veri:{' '}
              {result.health.level === 'ok'
                ? 'temiz'
                : result.health.level === 'warn'
                  ? 'dikkat'
                  : 'sorunlu'}
            </Badge>
          </header>

          <section className="report__section" aria-label="Fiyat">
            <h3>Fiyat</h3>
            <LineChart
              height={220}
              unit="raw"
              ariaLabel={`${symbol} kapanış fiyatı`}
              series={[
                {
                  label: symbol,
                  color: 'var(--accent)',
                  time: result.candles.time,
                  values: result.candles.close,
                },
              ]}
            />
          </section>

          <section className="report__section" aria-label="Özet metrikler">
            <h3>Özet</h3>
            <table className="report__table report__table--metrics">
              <thead>
                <tr>
                  <th scope="col">Metrik</th>
                  <th scope="col" className="num">
                    Değer
                  </th>
                  <th scope="col">Nasıl hesaplandı</th>
                  <th scope="col">Pencere</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((metric) => (
                  <tr key={metric.key}>
                    <th scope="row">{metric.label}</th>
                    <td className="num">{fmtMetric(metric)}</td>
                    <td className="desk__muted">{metric.formula}</td>
                    <td className="desk__muted">
                      {metric.window} · {metric.bars} bar
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {ratios ? (
            <section className="report__section" aria-label="Temel göstergeler">
              <h3>Temel göstergeler</h3>
              <table className="report__table report__table--pairs">
                <tbody>
                  <tr>
                    <th scope="row">F/K</th>
                    <td className="num">{fmtRatio(ratios.pe, 1)}</td>
                    <th scope="row">PD/DD</th>
                    <td className="num">{fmtRatio(ratios.pb)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Özkaynak kârlılığı</th>
                    <td className="num">{fmtRatio(ratios.roePct, 1)}%</td>
                    <th scope="row">Net marj</th>
                    <td className="num">{fmtRatio(ratios.netMarginPct, 1)}%</td>
                  </tr>
                  <tr>
                    <th scope="row">Borç/Özkaynak</th>
                    <td className="num">{fmtRatio(ratios.debtToEquity)}</td>
                    <th scope="row">Kalite</th>
                    <td className="num">
                      {quality ? `${quality.score} / ${quality.available}` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="desk__muted">
                Dönem {snapshot?.symbols[symbol]?.period ?? '—'}. {snapshot?.note}
              </p>
            </section>
          ) : null}

          <section className="report__section" aria-label="Veri sağlığı">
            <h3>Veri sağlığı</h3>
            <ul className="report__list">
              {result.health.findings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          </section>

          <footer className="report__foot">
            Bu rapor yalnızca bilgilendirme amaçlıdır ve yatırım tavsiyesi değildir. Veriler
            gecikmelidir; geçmiş performans gelecek getirinin göstergesi değildir.
          </footer>
        </article>
      )}
    </div>
  );
}
