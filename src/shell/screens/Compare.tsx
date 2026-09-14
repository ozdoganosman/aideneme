import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  IconButton,
  Select,
  Skeleton,
  Tooltip,
} from '../../ui';
import { Icon } from '../../ui/icons';
import type { Candles } from '../../core/data/types';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { NormalizedChart } from '../chart/NormalizedChart';
import { useAnalysis } from '../useAnalysis';
import { LoadNote } from '../LoadNote';
import { DataError } from '../DataError';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const MAX_SYMBOLS = 8;

/** Seri renkleri — token'lardan bağımsız sabit paleti burada tutuyoruz ki
 *  iki tema altında da ayırt edilebilir kalsınlar (renk körlüğü için sıra
 *  aynı zamanda etiketle de veriliyor). */
const SERIES_COLORS = [
  'var(--accent)',
  'var(--up)',
  'var(--down)',
  'var(--warn)',
  '#8b5cf6',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

const LOOKBACKS = [
  { value: '60', label: 'Son 60 bar' },
  { value: '120', label: 'Son 120 bar' },
  { value: '0', label: 'Paketin tamamı' },
];

function parseSymbols(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
}

function corrTone(r: number): string {
  if (!Number.isFinite(r)) return 'var(--surface-2)';
  // Pozitif → accent, negatif → down; şiddet alfa ile.
  const a = Math.min(1, Math.abs(r)) * 0.75 + 0.08;
  return r >= 0
    ? `color-mix(in srgb, var(--accent) ${(a * 100).toFixed(0)}%, transparent)`
    : `color-mix(in srgb, var(--down) ${(a * 100).toFixed(0)}%, transparent)`;
}

/** Karşılaştır — göreli performans, korelasyon ve küme komşuları. */
export default function Compare({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);
  const selected = useMemo(() => parseSymbols(state.cmp ?? ''), [state.cmp]);
  const [lookback, setLookback] = useState('120');

  const [series, setSeries] = useState<Record<string, Candles>>({});
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [corr, setCorr] = useState<{
    symbols: string[];
    matrix: Float64Array;
    clusterOf: number[];
    clusters: number;
    ms: number;
  } | null>(null);
  const [corrBusy, setCorrBusy] = useState(false);
  /** Korelasyon hesabının kendi hatası — "en az iki sembol seç" demek yanlış olurdu. */
  const [corrError, setCorrError] = useState<string | null>(null);

  // İlk açılışta boşsa piyasanın ilk üç sembolüyle başla — boş ekran yerine
  // çalışan bir örnek.
  useEffect(() => {
    if (selected.length === 0 && analysis.status === 'ready' && analysis.symbols.length >= 2) {
      push({ cmp: analysis.symbols.slice(0, 3).join(',') });
    }
  }, [selected.length, analysis.status, analysis.symbols, push]);

  // Seçili sembollerin tam geçmişi (önbellekten anında gelir).
  useEffect(() => {
    let cancelled = false;
    const missing = selected.filter((s) => !series[s]);
    if (missing.length === 0) return;
    setLoadingSeries(true);
    Promise.all(
      missing.map((symbol) =>
        dataClient
          .series(market, symbol)
          .then((r) => [symbol, r.candles] as const)
          .catch(() => null),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, Candles> = {};
        for (const entry of results) if (entry) next[entry[0]] = entry[1];
        setSeries((prev) => ({ ...prev, ...next }));
      })
      .finally(() => {
        if (!cancelled) setLoadingSeries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, series, market]);

  // İstemci referansı efekt bağımlılığı değil (bkz. ScreenerScreen).
  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  // Piyasa geneli korelasyon + kümeleme (worker'da, ~0,5 sn).
  useEffect(() => {
    const client = clientRef.current;
    if (analysis.status !== 'ready' || !client) return;
    let cancelled = false;
    setCorrBusy(true);
    setCorrError(null);
    client
      .correlate(market, { lookback: Number(lookback) || 0 })
      .then((result) => {
        if (!cancelled) setCorr(result);
      })
      .catch((err: unknown) => {
        // Sessizce null'a düşmek iskeleti SONSUZA KADAR açık bırakıyordu.
        if (cancelled) return;
        setCorr(null);
        setCorrError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCorrBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis.status, market, lookback]);

  const indexOf = useMemo(
    () => new Map((corr?.symbols ?? []).map((s, i) => [s, i])),
    [corr?.symbols],
  );

  const chartSeries = selected
    .map((symbol, i) => ({
      symbol,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      candles: series[symbol],
    }))
    .filter((s) => s.candles);

  const clusterMates = useMemo(() => {
    if (!corr || selected.length === 0) return [];
    return selected.map((symbol) => {
      const si = indexOf.get(symbol);
      if (si === undefined) return { symbol, mates: [] as { symbol: string; r: number }[] };
      const cluster = corr.clusterOf[si];
      const n = corr.symbols.length;
      const mates = corr.symbols
        .map((other, i) => ({
          symbol: other,
          r: corr.matrix[si * n + i],
          cluster: corr.clusterOf[i],
        }))
        .filter((m) => m.symbol !== symbol && m.cluster === cluster && Number.isFinite(m.r))
        .sort((a, b) => b.r - a.r)
        .slice(0, 5);
      return { symbol, mates };
    });
  }, [corr, selected, indexOf]);

  if (analysis.status === 'error') {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Karşılaştırma verisi yüklenemedi"
        description={analysis.error ?? ''}
      />
    );
  }

  return (
    <div className="compare">
      <section className="compare__bar" aria-label="Karşılaştırma seçimi">
        <Select
          label="Piyasa"
          value={market}
          onChange={(value) => push({ m: value, cmp: '' })}
          options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
        <Combobox
          label="Sembol ekle"
          value=""
          onChange={(value) => {
            if (selected.includes(value) || selected.length >= MAX_SYMBOLS) return;
            push({ cmp: [...selected, value].join(',') });
          }}
          options={analysis.symbols.map((s) => ({ value: s, label: s }))}
          placeholder={selected.length >= MAX_SYMBOLS ? 'En fazla 8 sembol' : 'Sembol ara…'}
        />
        <Select
          label="Pencere"
          value={lookback}
          onChange={setLookback}
          options={LOOKBACKS}
          hint="Korelasyon penceresi"
        />
        <div className="compare__chips">
          {selected.map((symbol, i) => (
            <span
              className="compare__chip"
              key={symbol}
              style={{ borderColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
            >
              <span
                className="compare__swatch"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                aria-hidden="true"
              />
              {symbol}
              <IconButton
                label={`${symbol} sembolünü çıkar`}
                size="sm"
                onClick={() => push({ cmp: selected.filter((s) => s !== symbol).join(',') })}
              >
                <Icon name="close" size={12} />
              </IconButton>
            </span>
          ))}
        </div>
      </section>

      <section className="compare__panel" aria-label="Normalize getiri">
        <header>
          <h2>Göreli performans</h2>
          <span className="desk__muted">
            Ortak başlangıç = 0; fiyat seviyeleri değil getiriler karşılaştırılır.
          </span>
        </header>
        {loadingSeries && chartSeries.length === 0 ? (
          <>
            <LoadNote progress={analysis.progress} />
            <Skeleton height="280px" />
          </>
        ) : chartSeries.length === 0 ? (
          <EmptyState title="Karşılaştırmak için sembol ekle" />
        ) : (
          <NormalizedChart series={chartSeries} />
        )}
      </section>

      <section className="compare__panel" aria-label="Korelasyon">
        <header>
          <h2>Korelasyon</h2>
          {corrBusy ? (
            <Badge tone="warn">Hesaplanıyor…</Badge>
          ) : corr ? (
            <span className="desk__muted">
              {corr.symbols.length} sembol · {corr.clusters} küme · worker {corr.ms.toFixed(0)} ms
            </span>
          ) : null}
        </header>

        {corr && selected.length > 1 ? (
          <table className="compare__matrix">
            <caption className="visually-hidden">
              Seçili sembollerin günlük log getirileri arasındaki Pearson korelasyonu
            </caption>
            <thead>
              <tr>
                <th scope="col" />
                {selected.map((s) => (
                  <th key={s} scope="col">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.map((row) => (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  {selected.map((col) => {
                    const a = indexOf.get(row);
                    const b = indexOf.get(col);
                    const r =
                      a === undefined || b === undefined
                        ? NaN
                        : corr.matrix[a * corr.symbols.length + b];
                    return (
                      <td key={col} className="num" style={{ background: corrTone(r) }}>
                        {Number.isFinite(r) ? r.toFixed(2) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : corrBusy ? (
          <Skeleton height="120px" />
        ) : corrError ? (
          // Hesap çöktüğünde "en az iki sembol seç" demek kullanıcıyı yanlış
          // yere bakmaya gönderiyordu: seçim zaten yapılmıştı.
          <DataError title="Korelasyon hesaplanamadı" detail={corrError} />
        ) : (
          <EmptyState title="En az iki sembol seç" />
        )}
      </section>

      <section className="compare__panel" aria-label="Küme komşuları">
        <header>
          <h2>Aynı kümedekiler</h2>
          <Tooltip text="Ortalama bağlantılı hiyerarşik kümeleme; uzaklık = 1 − korelasyon">
            <span className="desk__muted">Nasıl hesaplanıyor?</span>
          </Tooltip>
        </header>
        {corr ? (
          <ul className="compare__mates">
            {clusterMates.map(({ symbol, mates }) => (
              <li key={symbol}>
                <strong>{symbol}</strong>
                {mates.length === 0 ? (
                  <span className="desk__muted"> — kümesinde başka sembol yok</span>
                ) : (
                  <span>
                    {' '}
                    {mates.map((m) => (
                      <Button
                        key={m.symbol}
                        size="sm"
                        variant="ghost"
                        onClick={() => push({ v: 'sembol', s: m.symbol })}
                      >
                        {m.symbol} <span className="desk__muted">{m.r.toFixed(2)}</span>
                      </Button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton count={3} height="18px" />
        )}
      </section>
    </div>
  );
}
