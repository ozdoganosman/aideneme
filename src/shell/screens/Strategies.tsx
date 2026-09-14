import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Combobox, EmptyState, Select, Skeleton, Stat, Toggle } from '../../ui';
import { Icon } from '../../ui/icons';
import { DEFAULT_COSTS, ZERO_COSTS } from '../../core/backtest/engine';
import type { BacktestMetrics } from '../../core/backtest/metrics';
import { STRATEGY_PRESETS } from '../../core/strategy/presets';
import {
  INDEPENDENCE_CAVEAT,
  rankStrategies,
  type RankRow,
  type SymbolResult,
} from '../../core/strategy/rank';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const pct = (v: number, digits = 1): string =>
  Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '—';
const plain = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');
const pval = (v: number): string =>
  !Number.isFinite(v) ? '—' : v < 0.001 ? '< 0,001' : v.toFixed(3).replace('.', ',');

const VERDICT_TONE: Record<RankRow['verdict'], 'up' | 'warn' | 'down' | 'neutral'> = {
  anlamlı: 'up',
  belirsiz: 'warn',
  zayıf: 'down',
  ölçülemedi: 'neutral',
};

/**
 * Stratejiler — "hangi strateji gerçekten çalışıyor?"
 *
 * İki kapsam var ve ikisi de farklı soruya cevap verir:
 *
 *   Piyasa  — aynı kurallar tüm sembollerde, son 250 barlık ortak pencerede.
 *             Soru: "bu kural bu piyasada genel olarak işe yarıyor mu?"
 *   Sembol  — tüm presetler tek sembolün TAM geçmişinde.
 *             Soru: "bu hisse için hangi kural doğru?"
 *
 * Her iki tabloda da karşılaştırma tabanı al-tut ve al-tut AYNI maliyeti öder.
 * Sıralama tek başına kanıt değildir: onlarca kombinasyon denendiğinde en iyisi
 * şans eseri de çıkabilir, bu yüzden p-değeri Holm ile düzeltilir ve sembollerin
 * bağımsız olmadığı uyarısı tablodan ayrılmaz.
 */
export default function Strategies({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);
  const symbol = state.s || analysis.symbols[0] || '';

  const [scope, setScope] = useState<'market' | 'symbol'>('market');
  const [withCosts, setWithCosts] = useState(true);
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [skipped, setSkipped] = useState<Record<string, number>>({});
  const [info, setInfo] = useState<{ symbols: number; bars: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  const options = useMemo(() => ({ costs: withCosts ? DEFAULT_COSTS : ZERO_COSTS }), [withCosts]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || analysis.status !== 'ready') return;
    let cancelled = false;
    setRows(null);
    setError(null);

    (async () => {
      try {
        if (scope === 'market') {
          const outcome = await client.rank(
            market,
            STRATEGY_PRESETS.map((p) => ({ id: p.id, strategy: p.strategy })),
            options,
            60,
          );
          if (cancelled) return;
          setSkipped(outcome.skipped);
          setInfo({ symbols: outcome.symbols, bars: analysis.bars, ms: outcome.ms });
          setRows(
            rankStrategies(
              STRATEGY_PRESETS.map((preset) => ({
                preset,
                results: outcome.results[preset.id] ?? [],
              })),
            ),
          );
          return;
        }

        if (!symbol) return;
        const { candles } = await dataClient.series(market, symbol);
        const outcomes = await Promise.all(
          STRATEGY_PRESETS.map((preset) => client.backtest(candles, preset.strategy, options)),
        );
        if (cancelled) return;
        // Tek sembolde "kaç sembolde yendi" sorusu yok: her satır tek gözlem.
        // Bu yüzden p-değeri hesaplanmıyor, tablo ham farkı gösteriyor.
        setSkipped({});
        setInfo({ symbols: 1, bars: candles.length, ms: Math.max(...outcomes.map((o) => o.ms)) });
        setRows(
          STRATEGY_PRESETS.map((preset, i) =>
            singleSymbolRow(preset.id, symbol, outcomes[i].metrics),
          ),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market, scope, symbol, analysis.status, analysis.bars, options]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    return [...rows].sort((a, b) => {
      const av = Number.isFinite(a.medianExcessPct) ? a.medianExcessPct : -Infinity;
      const bv = Number.isFinite(b.medianExcessPct) ? b.medianExcessPct : -Infinity;
      return bv - av;
    });
  }, [rows]);

  if (error) {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Sıralama hesaplanamadı"
        description={error}
      />
    );
  }

  return (
    <div className="rank">
      <section className="rank__controls" aria-label="Sıralama ayarları">
        <Select
          label="Piyasa"
          value={market}
          onChange={(value) => push({ m: value, s: '' })}
          options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
        <Select
          label="Kapsam"
          value={scope}
          onChange={(value) => setScope(value as 'market' | 'symbol')}
          options={[
            { value: 'market', label: 'Piyasa (ortak pencere)' },
            { value: 'symbol', label: 'Tek sembol (tüm geçmiş)' },
          ]}
        />
        {scope === 'symbol' ? (
          <Combobox
            label="Sembol"
            value={symbol}
            onChange={(value) => push({ s: value })}
            options={analysis.symbols.map((s) => ({ value: s, label: s }))}
            placeholder={symbol || 'Sembol ara…'}
          />
        ) : null}
        <Toggle label="Maliyet dahil" checked={withCosts} onChange={setWithCosts} />
        <span className="desk__muted">
          komisyon {DEFAULT_COSTS.commissionBps} bps + slipaj {DEFAULT_COSTS.slippageBps} bps
        </span>
      </section>

      <p className="rank__lead">
        {scope === 'market'
          ? 'Aynı kurallar tüm sembollerde, ortak pencerede. Karşılaştırma tabanı al-tut ve al-tut aynı maliyeti öder.'
          : `Tüm hazır stratejiler ${symbol} sembolünün tam geçmişinde. Tek gözlem olduğu için p-değeri hesaplanmaz.`}
        {scope === 'market' ? ` ${INDEPENDENCE_CAVEAT}` : ''}
      </p>

      {!sorted ? (
        <Skeleton count={6} height="52px" />
      ) : (
        <>
          <div className="rank__meta">
            <Stat
              label={scope === 'market' ? 'Sembol' : 'Bar'}
              value={String(scope === 'market' ? (info?.symbols ?? 0) : (info?.bars ?? 0))}
              hint={scope === 'market' ? `${info?.bars ?? 0} barlık ortak pencere` : 'tam geçmiş'}
            />
            <Stat
              label="Strateji"
              value={String(STRATEGY_PRESETS.length)}
              hint={scope === 'market' ? 'p-değeri Holm ile düzeltildi' : 'düzeltme gerekmez'}
            />
            <Stat label="Hesap" value={`${Math.round(info?.ms ?? 0)} ms`} hint="worker" />
          </div>

          <table className="rank__table">
            <thead>
              <tr>
                <th scope="col">Strateji</th>
                <th scope="col" className="num">
                  Al-tut farkı
                </th>
                <th scope="col" className="num">
                  Yıllık
                </th>
                <th scope="col" className="num">
                  Maks. düşüş
                </th>
                <th scope="col" className="num">
                  İşlem
                </th>
                {scope === 'market' ? (
                  <>
                    <th scope="col" className="num">
                      Yenme oranı
                    </th>
                    <th scope="col" className="num">
                      p (iki yönlü, düzeltilmiş)
                    </th>
                  </>
                ) : null}
                <th scope="col">Hüküm</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="rank__name"
                      aria-expanded={open === row.id}
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                    >
                      {row.name}
                    </button>
                    <span className="desk__muted">{row.detail}</span>
                    {row.verdict === 'ölçülemedi' ? (
                      <span className="desk__muted">
                        Bu pencerede ölçülemedi: kural {skipped[row.id] ?? 0} sembolde ısınma
                        barlarına sığmıyor. Tek sembol kapsamında tam geçmişle ölçülebilir.
                      </span>
                    ) : null}
                    {open === row.id ? (
                      <div className="rank__detail">
                        <p className="desk__muted">{row.premise}</p>
                        {skipped[row.id] ? (
                          <p className="desk__muted">
                            {skipped[row.id]} sembolde ısınma pencereye sığmadı; o semboller
                            ölçülmedi.
                          </p>
                        ) : null}
                        {row.best.length > 0 ? (
                          <ul className="rank__best">
                            {row.best.map((best) => (
                              <li key={best.symbol}>
                                <button
                                  type="button"
                                  onClick={() => push({ v: 'sembol', s: best.symbol })}
                                >
                                  {best.symbol}
                                </button>{' '}
                                <span className="num">{pct(best.excessPct)}</span>{' '}
                                <span className="desk__muted">{best.trades} işlem</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </th>
                  <td className="num">{pct(row.medianExcessPct)}</td>
                  <td className="num">{pct(row.medianCagrPct)}</td>
                  <td className="num">{plain(row.medianMaxDDPct)}%</td>
                  <td className="num">{plain(row.medianTrades, 0)}</td>
                  {scope === 'market' ? (
                    <>
                      <td className="num">{plain(row.beatPct, 0)}%</td>
                      <td className="num">{pval(row.adjustedP)}</td>
                    </>
                  ) : null}
                  <td>
                    <Badge tone={VERDICT_TONE[row.verdict]}>{row.verdict}</Badge>
                    <button
                      type="button"
                      className="rank__open"
                      onClick={() => push({ v: 'laboratuvar', s: symbol, st: row.id })}
                    >
                      Laboratuvarda aç
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="desk__muted">
            "Anlamlı", stratejinin kazandıracağı anlamına gelmez: geçmiş pencerede al-tut'u
            tesadüfle açıklanamayacak sıklıkta yendiği anlamına gelir. Kuralı kendi
            parametrelerinizle sınamak için laboratuvarı kullanın.
          </p>
          <Button onClick={() => push({ v: 'laboratuvar', s: symbol })}>
            Laboratuvarda kendi kuralını kur
          </Button>
        </>
      )}
    </div>
  );
}

/** Tek sembol kapsamı: her satır tek gözlem, istatistik testi yok. */
function singleSymbolRow(id: string, symbol: string, metrics: BacktestMetrics): RankRow {
  const preset = STRATEGY_PRESETS.find((p) => p.id === id)!;
  const result: SymbolResult = { symbol, metrics };
  return {
    id,
    name: preset.name,
    detail: preset.detail,
    premise: preset.premise,
    symbols: 1,
    withTrades: metrics.trades > 0 ? 1 : 0,
    medianCagrPct: metrics.cagrPct,
    medianExcessPct: metrics.excessCagrPct,
    medianMaxDDPct: metrics.maxDrawdownPct,
    medianSharpe: metrics.sharpe,
    medianTrades: metrics.trades,
    medianExposurePct: metrics.exposurePct,
    beatPct: NaN,
    pValue: NaN,
    adjustedP: NaN,
    verdict: metrics.trades === 0 ? 'zayıf' : metrics.excessCagrPct > 0 ? 'belirsiz' : 'zayıf',
    best: [
      {
        symbol: result.symbol,
        excessPct: metrics.excessCagrPct,
        cagrPct: metrics.cagrPct,
        trades: metrics.trades,
      },
    ],
  };
}
