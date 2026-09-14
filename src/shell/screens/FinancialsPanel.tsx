import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Popover, Skeleton, Stat, trPct, trNum } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  annualSeries,
  computeRatios,
  growth,
  qualityScore,
  type Ratios,
} from '../../core/fundamentals/metrics';
import type { Financials, FundamentalsSnapshot } from '../../core/fundamentals/types';
import { fundamentalsClient } from '../../data-client/fundamentals';
import type { Market } from '../../data-client/markets';
import { LineChart } from '../chart/LineChart';

interface Props {
  market: Market;
  symbol: string;
  /** Son kapanış — çarpanlar bununla hesaplanır. */
  price: number;
}

const fmtRatio = (v: number | null, digits = 2): string => (v === null ? '—' : trNum(v, digits));

const fmtPct = (v: number | null, digits = 1): string =>
  v === null || !Number.isFinite(v) ? '—' : trPct(v, digits, true);

const fmtMoney = (v: number | null): string => {
  if (v === null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trNum(v / 1e9, 1)} mlr`;
  if (abs >= 1e6) return `${trNum(v / 1e6, 1)} mn`;
  if (abs >= 1e3) return `${trNum(v / 1e3, 1)} b`;
  return v.toFixed(0);
};

function prov(title: string, body: string) {
  return (
    <Popover
      title={title}
      trigger={(p) => (
        <button
          type="button"
          className="desk__prov"
          aria-label={`${title}: bu sayı nereden geliyor?`}
          {...p}
        >
          ?
        </button>
      )}
    >
      {body}
    </Popover>
  );
}

/** Sembol Masası'nın finansal sekmesi: çarpanlar, kalite, büyüme, tablolar. */
export function FinancialsPanel({ market, symbol, price }: Props) {
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFin(null);
    Promise.all([
      fundamentalsClient.snapshot(market),
      fundamentalsClient.financials(market, symbol),
    ])
      .then(([snap, financials]) => {
        if (cancelled) return;
        setSnapshot(snap);
        setFin(financials);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [market, symbol]);

  const row = snapshot?.symbols[symbol] ?? null;
  const ratios: Ratios | null = useMemo(
    () => (row ? computeRatios({ row, price }) : null),
    [row, price],
  );
  const quality = useMemo(() => (fin ? qualityScore(fin) : null), [fin]);
  const g = useMemo(() => (fin ? growth(fin) : null), [fin]);

  const charts = useMemo(() => {
    if (!fin) return null;
    const revenue = annualSeries(fin, 'revenue');
    const netIncome = annualSeries(fin, 'netIncome');
    const equity = annualSeries(fin, 'equity');
    if (revenue.labels.length < 2) return null;

    // Yıl etiketlerini zaman eksenine çevir (grafik ortak bileşen).
    const time = revenue.labels.map((year) => Date.UTC(Number(year), 11, 31) / 1000);
    const clean = (values: (number | null)[]) => values.map((v) => (v === null ? NaN : v));

    return {
      time,
      series: [
        { label: 'Satış', color: 'var(--accent)', time, values: clean(revenue.values) },
        { label: 'Net kâr', color: 'var(--up)', time, values: clean(netIncome.values) },
        {
          label: 'Özkaynak',
          color: 'var(--text-muted)',
          dashed: true,
          time,
          values: clean(equity.values),
        },
      ],
    };
  }, [fin]);

  if (loading) return <Skeleton count={4} height="60px" />;

  if (!row && !fin) {
    return (
      <EmptyState
        icon={<Icon name="report" size={28} />}
        title="Bu sembol için finansal veri yok"
        description={
          <>
            Finansal tablolar CI'da <code>scripts/build_fundamentals.py</code> ile üretiliyor
            (kaynak: İş Yatırım). Üretim çalışmadıysa ya da bu sembol için tablo bulunamadıysa
            burası boş kalır.
          </>
        }
      />
    );
  }

  return (
    <div className="fin">
      <section className="fin__stats" aria-label="Çarpanlar">
        <Stat
          label="F/K"
          value={fmtRatio(ratios?.pe ?? null, 1)}
          hint={row ? `dönem ${row.period}` : undefined}
          provenance={prov(
            'F/K',
            'Piyasa değeri ÷ son 12 ay net kâr. Zarar eden şirkette boş bırakılır: negatif F/K sıralamada "ucuz" gibi görünür.',
          )}
        />
        <Stat
          label="PD/DD"
          value={fmtRatio(ratios?.pb ?? null)}
          provenance={prov('PD/DD', 'Piyasa değeri ÷ özkaynak (ana ortaklık payı).')}
        />
        <Stat label="PD/Satış" value={fmtRatio(ratios?.ps ?? null)} />
        <Stat label="Özkaynak kârlılığı" value={fmtPct(ratios?.roePct ?? null)} />
        <Stat label="Net marj" value={fmtPct(ratios?.netMarginPct ?? null)} />
        <Stat label="Brüt marj" value={fmtPct(ratios?.grossMarginPct ?? null)} />
        <Stat
          label="Borç/Özkaynak"
          value={fmtRatio(ratios?.debtToEquity ?? null)}
          hint={`net borç ${fmtMoney(ratios?.netDebt ?? null)}`}
        />
        <Stat
          label="Piyasa değeri"
          value={fmtMoney(ratios?.marketCap ?? null)}
          provenance={prov(
            'Piyasa değeri',
            "Son fiyat × ödenmiş sermaye. BIST'te nominal değer 1 TL olduğu için ödenmiş sermaye ≈ pay adedi; nominal değeri farklı şirketlerde bu yaklaşım sapar.",
          )}
        />
      </section>

      {g ? (
        <section className="fin__stats" aria-label="Büyüme">
          <Stat label="Ciro büyümesi" value={fmtPct(g.revenueYoyPct)} hint="son 12 ay, yıllık" />
          <Stat label="Kâr büyümesi" value={fmtPct(g.netIncomeYoyPct)} hint="son 12 ay, yıllık" />
          <Stat label="Özkaynak büyümesi" value={fmtPct(g.equityYoyPct)} hint="yıllık" />
          <Stat
            label="Nakde dönüşüm"
            value={fmtRatio(ratios?.cashConversion ?? null)}
            hint="faaliyet nakit akışı ÷ net kâr"
            provenance={prov(
              'Nakde dönüşüm',
              '1’in altı, kârın nakde dönmediğini gösterir (alacak/stok şişmesi). Tahakkuk kalitesinin en basit ölçüsü.',
            )}
          />
        </section>
      ) : null}

      {charts ? (
        <section className="fin__panel" aria-label="Yıllık seriler">
          <header>
            <h3>Yıllık seyir</h3>
            <span className="desk__muted">Satış, net kâr ve özkaynak (yıl sonu dönemleri)</span>
          </header>
          <LineChart
            series={charts.series}
            height={240}
            unit="compact"
            ariaLabel={`${symbol} yıllık satış, net kâr ve özkaynak`}
          />
        </section>
      ) : null}

      {quality ? (
        <section className="fin__panel" aria-label="Kalite ölçütleri">
          <header>
            <h3>Kalite</h3>
            <Badge
              tone={
                quality.score >= quality.available * 0.7
                  ? 'up'
                  : quality.score >= quality.available * 0.4
                    ? 'warn'
                    : 'down'
              }
            >
              {quality.score} / {quality.available}
            </Badge>
            <span className="desk__muted">
              Piotroski benzeri ölçütler; veri eksikse madde değerlendirilmez ve payda küçülür.
            </span>
          </header>
          <ul className="fin__checks">
            {quality.checks.map((check) => (
              <li
                key={check.id}
                className={`is-${check.passed === null ? 'unknown' : check.passed}`}
              >
                <span aria-hidden="true">
                  {check.passed === null ? '–' : check.passed ? '✓' : '✕'}
                </span>{' '}
                {check.label}
                {check.passed === null ? <span className="desk__muted"> (veri yok)</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fin && fin.missing.length > 0 ? (
        <p className="desk__muted">
          Bu şirketin tablosunda bulunamayan kalemler: {fin.missing.join(', ')} — ilgili oranlar boş
          bırakıldı.
        </p>
      ) : null}

      {snapshot ? <p className="desk__muted">{snapshot.note}</p> : null}
    </div>
  );
}
