import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  NumberField,
  Select,
  Skeleton,
  Stat,
  Toggle,
} from '../../ui';
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
import { DataError } from '../DataError';
import { LoadNote } from '../LoadNote';
import { Prov } from '../Prov';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

type Scope = 'market' | 'symbol' | 'deep' | 'liste';

/** Aynı anda kaç sembol indirilip hesaplansın (zayıf makinede de akıcı kalsın). */
const DEEP_CONCURRENCY = 3;

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const pct = (v: number, digits = 1): string =>
  Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)}%` : '—';
const plain = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');
/**
 * Maks. düşüş işaretli gösteriliyor: Laboratuvar aynı sayıyı "-45,6%" diye
 * yazıyordu, burada "45,6%" görünüyordu. Aynı sayının iki ekranda iki farklı
 * işaretle çıkması gereksiz bir tereddüt üretiyor.
 */
const drawdown = (v: number): string => (Number.isFinite(v) ? `-${v.toFixed(1)}%` : '—');
const pval = (v: number): string =>
  !Number.isFinite(v) ? '—' : v < 0.001 ? '< 0,001' : v.toFixed(3).replace('.', ',');

const VERDICT_TONE: Record<RankRow['verdict'], 'up' | 'warn' | 'down' | 'neutral'> = {
  anlamlı: 'up',
  belirsiz: 'warn',
  zayıf: 'down',
  ölçülemedi: 'neutral',
  'sinyal yok': 'neutral',
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

  // Tarayıcıdan gelen sembol listesi (`sy=`): "bulduğum hisselerde hangi
  // strateji çalışıyor?" sorusunun cevabı buradan başlıyor.
  const listed = useMemo(() => (state.sy ? state.sy.split(',').filter(Boolean) : []), [state.sy]);
  const [scope, setScope] = useState<Scope>(listed.length > 0 ? 'liste' : 'market');
  const [deepCount, setDeepCount] = useState(30);
  const [deep, setDeep] = useState<{ done: number; total: number } | null>(null);
  const [plan, setPlan] = useState<{ symbols: string[]; bytes: number } | null>(null);
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

    if (scope === 'deep' || scope === 'liste') {
      // Derin tarama KENDİLİĞİNDEN başlamaz: megabaytlarca indirme demek.
      // Önce ne indirileceği hesaplanıp kullanıcıya söylenir.
      (async () => {
        try {
          const [manifest, pulse] = await Promise.all([
            dataClient.manifest(market),
            client.pulse(market),
          ]);
          if (cancelled) return;
          const ranked = [...pulse.rows].sort((a, b) => b.value - a.value);
          const symbols =
            scope === 'liste'
              ? // Listedekilerin sırası da işlem değerine göre; ilerleme çubuğu
                // en likitten başlasın.
                ranked.filter((r) => listed.includes(r.symbol)).map((r) => r.symbol)
              : ranked.slice(0, deepCount).map((r) => r.symbol);
          const bytes = symbols.reduce((sum, s) => sum + (manifest.symbols[s]?.b ?? 0), 0);
          setPlan({ symbols, bytes });
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        }
      })();
      return () => {
        cancelled = true;
      };
    }

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
  }, [market, scope, symbol, deepCount, listed, analysis.status, analysis.bars, options]);

  /**
   * Derin tarama: en likit N sembolün TAM geçmişi indirilir ve tüm stratejiler
   * gerçek tarih üzerinde koşar. Ortak pencere kısıtı kalktığı için EMA(200)
   * tabanlı kurallar da ölçülebilir hale gelir.
   */
  async function runDeep() {
    const client = clientRef.current;
    if (!client || !plan) return;
    setRows(null);
    setError(null);
    setDeep({ done: 0, total: plan.symbols.length });

    const collected: Record<string, SymbolResult[]> = {};
    const missed: Record<string, number> = {};
    for (const preset of STRATEGY_PRESETS) {
      collected[preset.id] = [];
      missed[preset.id] = 0;
    }

    const strategies = STRATEGY_PRESETS.map((p) => ({ id: p.id, strategy: p.strategy }));
    const queue = [...plan.symbols];
    let bars = 0;
    let ms = 0;
    let done = 0;

    async function worker() {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          const { candles } = await dataClient.series(market, next);
          const outcome = await client!.rankSeries(next, candles, strategies, options, 120);
          for (const [id, metrics] of Object.entries(outcome.metrics)) {
            collected[id].push({ symbol: next, metrics });
          }
          for (const id of outcome.skipped) missed[id]++;
          bars = Math.max(bars, outcome.bars);
          ms += outcome.ms;
        } catch {
          // Tek sembolün indirilememesi taramayı düşürmez; sayım eksik kalır
          // ve tabloda "ölçülen sembol" sayısı bunu gösterir.
        }
        done++;
        setDeep({ done, total: plan!.symbols.length });
      }
    }

    try {
      await Promise.all(Array.from({ length: DEEP_CONCURRENCY }, worker));
      setSkipped(missed);
      setInfo({ symbols: plan.symbols.length, bars, ms: Math.round(ms) });
      setRows(
        rankStrategies(
          STRATEGY_PRESETS.map((preset) => ({ preset, results: collected[preset.id] })),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeep(null);
    }
  }

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
          onChange={(value) => {
            setScope(value as Scope);
            setRows(null);
            setPlan(null);
          }}
          options={[
            ...(listed.length > 0
              ? [{ value: 'liste', label: `Tarama sonucu (${listed.length} sembol)` }]
              : []),
            { value: 'market', label: 'Piyasa (ortak pencere)' },
            { value: 'symbol', label: 'Tek sembol (tüm geçmiş)' },
            { value: 'deep', label: 'Derin (en likitler, tam geçmiş)' },
          ]}
        />
        {scope === 'deep' ? (
          <NumberField
            label="Sembol sayısı"
            value={deepCount}
            min={5}
            max={100}
            step={5}
            onChange={setDeepCount}
            hint="işlem değerine göre en likitler"
          />
        ) : null}
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
          ? 'Aynı kurallar tüm sembollerde, ortak 250 barlık pencerede — paket zaten inmiş olduğu için ek indirme yok. Karşılaştırma tabanı al-tut ve al-tut aynı maliyeti öder.'
          : scope === 'liste'
            ? 'Tarayıcıda bulduğunuz sembollerin TAM geçmişinde tüm hazır stratejiler. Seçim tarama kriterlerinden geldiği için sonuçlar o kriterlere koşulludur — piyasanın tamamı için genelleme değildir.'
            : scope === 'deep'
              ? 'En likit sembollerin TAM geçmişi indirilip stratejiler gerçek tarih üzerinde koşar. Ortak pencere kısıtı kalkar; EMA(200) tabanlı kurallar da ölçülebilir.'
              : `Tüm hazır stratejiler ${symbol} sembolünün tam geçmişinde. Tek gözlem olduğu için p-değeri hesaplanmaz.`}
        {scope !== 'symbol' ? ` ${INDEPENDENCE_CAVEAT}` : ''}
      </p>

      {scope === 'deep' || scope === 'liste' ? (
        <section className="rank__deep" aria-label="Derin tarama">
          {deep ? (
            <>
              <p>
                {deep.done} / {deep.total} sembol işlendi.
              </p>
              <progress value={deep.done} max={deep.total} />
            </>
          ) : plan ? (
            <>
              <p>
                {plan.symbols.length} sembol · <strong>{mb(plan.bytes)}</strong> indirilecek ve{' '}
                {plan.symbols.length * STRATEGY_PRESETS.length} backtest koşacak. Boyut manifestten
                okundu, tahmin değil.
              </p>
              <Button variant="primary" onClick={runDeep}>
                {scope === 'liste' ? 'Bu sembollerde test et' : 'Derin taramayı başlat'}
              </Button>
              <span className="desk__muted">
                İnen seriler tarayıcı önbelleğinde kalır; ikinci çalıştırma ağa çıkmaz.
              </span>
            </>
          ) : (
            <p className="desk__muted">İndirme boyutu hesaplanıyor…</p>
          )}
        </section>
      ) : null}

      {analysis.status === 'error' ? (
        <DataError title="Strateji verisi yüklenemedi" detail={analysis.error} />
      ) : !sorted ? (
        scope === 'deep' && !deep ? null : (
          <>
            <LoadNote progress={analysis.progress} />
            <Skeleton count={6} height="52px" />
          </>
        )
      ) : (
        <>
          <div className="rank__meta">
            <Stat
              label={scope === 'symbol' ? 'Bar' : 'Sembol'}
              value={String(scope === 'symbol' ? (info?.bars ?? 0) : (info?.symbols ?? 0))}
              hint={
                scope === 'market'
                  ? `${info?.bars ?? 0} barlık ortak pencere`
                  : scope === 'deep'
                    ? `tam geçmiş · en uzunu ${info?.bars ?? 0} bar`
                    : 'tam geçmiş'
              }
              provenance={
                <Prov label={scope === 'symbol' ? 'Bar' : 'Sembol'}>
                  {scope === 'market'
                    ? 'Paketteki tüm semboller, HEPSİNDE ortak olan son N barlık pencerede. Ortak pencere şart: farklı uzunluklarda ölçülen sonuçlar yan yana sıralanamaz.'
                    : scope === 'deep'
                      ? 'En likit semboller, her birinin TAM geçmişiyle. Pencereler farklı olduğu için semboller arası karşılaştırma değil, strateji başına dağılım okunur.'
                      : 'Tek sembol, tam geçmişi. Çoklu test düzeltmesi gerekmez çünkü tek bir seri üzerinde ölçülüyor.'}
                </Prov>
              }
            />
            <Stat
              label="Strateji"
              value={String(STRATEGY_PRESETS.length)}
              hint={scope === 'symbol' ? 'düzeltme gerekmez' : 'p-değeri Holm ile düzeltildi'}
              provenance={
                <Prov label="Strateji">
                  Aynı anda sınanan hazır kural sayısı. Ne kadar çok strateji denenirse birinin ŞANS
                  ESERİ iyi görünme olasılığı o kadar artar; bu yüzden p-değeri Holm–Bonferroni ile
                  düzeltiliyor (tek sembol kapsamında düzeltme gerekmez).
                </Prov>
              }
            />
            <Stat
              label="Hesap"
              value={`${Math.round(info?.ms ?? 0)} ms`}
              hint="worker"
              provenance={
                <Prov label="Hesap">
                  En yavaş worker'ın süresi (paralel duvar saati yaklaşımı), indirme hariç. Bir
                  performans göstergesi; analizin doğruluğuyla ilgisi yok.
                </Prov>
              }
            />
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
                {scope !== 'symbol' ? (
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
                        barlarına sığmıyor. Derin kapsamda tam geçmişle ölçülebilir.
                      </span>
                    ) : null}
                    {row.verdict === 'sinyal yok' ? (
                      <span className="desk__muted">
                        Backtest koştu ama kural {row.symbols} sembolün hiçbirinde tetiklenmedi —
                        kaybetmedi, hiç denemedi.
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
                  <td className="num">{drawdown(row.medianMaxDDPct)}</td>
                  <td className="num">{plain(row.medianTrades, 0)}</td>
                  {scope !== 'symbol' ? (
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
                      aria-label={`${row.name} stratejisini laboratuvarda aç`}
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
