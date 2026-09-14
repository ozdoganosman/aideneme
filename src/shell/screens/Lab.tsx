import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Combobox,
  EmptyState,
  IconButton,
  NumberField,
  Popover,
  Select,
  Skeleton,
  Stat,
  VirtualTable,
  type Column,
  trPct,
  trNum,
} from '../../ui';
import { Icon } from '../../ui/icons';
import type { Candles } from '../../core/data/types';
import { DEFAULT_COSTS, type Trade } from '../../core/backtest/engine';
import type { Badge as ValidationBadge } from '../../core/backtest/validate';
import { REGIME_CAVEAT, regimeVerdict } from '../../core/stats/regime';
import { BACKTEST_METRIC_FORMULA } from '../../core/backtest/metrics';
import { Prov } from '../Prov';
import { Announce } from '../Announce';
import { describeCondition, type Operand, type Strategy } from '../../core/strategy/dsl';
import { STRATEGY_PRESETS } from '../../core/strategy/presets';
import { decodeStrategy, encodeStrategy } from '../../core/strategy/share';
import {
  baseOf,
  factorOf,
  fromForm,
  shiftOf,
  toForm,
  withFactor,
  withShift,
  type SimpleOp,
  type SimpleRule,
} from './labRules';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import type { BacktestOutcome } from '../../workers/analysisClient';
import { LineChart } from '../chart/LineChart';
import { useAnalysis } from '../useAnalysis';
import { CopyLink } from '../CopyLink';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
  /** Kural düzenlerken geçmişi kirletmemek için. */
  replace?: (patch: UrlState) => void;
}

const OP_LABEL: Record<SimpleOp, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  crossAbove: 'yukarı keser',
  crossBelow: 'aşağı keser',
};

const OPERAND_KINDS = [
  { value: 'close', label: 'Kapanış' },
  { value: 'open', label: 'Açılış' },
  { value: 'volume', label: 'Hacim' },
  { value: 'const', label: 'Sabit' },
  { value: 'ema', label: 'EMA' },
  { value: 'sma', label: 'SMA' },
  { value: 'rsi', label: 'RSI' },
  { value: 'adx', label: 'ADX' },
  { value: 'atr', label: 'ATR' },
  { value: 'roc', label: 'ROC' },
  { value: 'highest', label: 'En yüksek' },
  { value: 'lowest', label: 'En düşük' },
];

const BADGE_TONE: Record<ValidationBadge['level'], 'up' | 'warn' | 'down' | 'neutral'> = {
  pass: 'up',
  warn: 'warn',
  fail: 'down',
  unknown: 'neutral',
};

const BADGE_ICON: Record<ValidationBadge['level'], string> = {
  pass: '✓',
  warn: '!',
  fail: '✕',
  unknown: '?',
};

function fmt(v: number, digits = 2, suffix = ''): string {
  return suffix === '%' ? trPct(v, digits, true) : trNum(v, digits);
}

/** Prov metni: formül + ölçüldüğü pencere (aynı yerde, ayrışamaz). */
function provText(key: string, metrics: { bars: number; years: number } | undefined): string {
  const formula = BACKTEST_METRIC_FORMULA[key] ?? '';
  if (!metrics) return formula;
  return `${formula} Pencere: ${metrics.bars} bar · ${metrics.years.toFixed(1)} yıl (ısınma hariç).`;
}

/** İşaretsiz yüzde: pay ve isabet oranında "+" yanıltıcı olurdu. */
function plainPct(v: number, digits = 0): string {
  return trPct(v, digits);
}

/** Strateji Laboratuvarı — kural kur, maliyetli sına, doğrulamayı gör. */
export default function Lab({ state, push, replace }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);
  const symbol = state.s || analysis.symbols[0] || '';

  /**
   * İlk durum üç kaynaktan gelebilir, öncelik sırasıyla:
   *   1. `str=` — bağlantıyla paylaşılmış tam kural
   *   2. `st=`  — sıralama ekranından gelen hazır strateji kimliği
   *   3. kitaplığın ilk stratejisi
   */
  const initial = useMemo(() => {
    const link = decodeStrategy(state.str ?? '');
    if (link.strategy) {
      const converted = toForm(link.strategy);
      if (converted.form) {
        return { id: '', form: converted.form, dropped: link.dropped };
      }
      return {
        id: '',
        form: toForm(STRATEGY_PRESETS[0].strategy).form!,
        dropped: [...link.dropped, ...converted.unsupported],
      };
    }
    const wanted = STRATEGY_PRESETS.find((p) => p.id === state.st) ?? STRATEGY_PRESETS[0];
    return { id: wanted.id, form: toForm(wanted.strategy).form!, dropped: link.dropped };
    // Yalnızca ilk okumada; sonraki URL yazımları bizim yazımlarımız.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [preset, setPreset] = useState(initial.id);
  const [entryRules, setEntryRules] = useState<SimpleRule[]>(initial.form.entry);
  const [exitRules, setExitRules] = useState<SimpleRule[]>(initial.form.exit);
  const [stopLossPct, setStopLossPct] = useState(initial.form.stopLossPct);
  const [takeProfitPct, setTakeProfitPct] = useState(initial.form.takeProfitPct);
  const [atrStopLength, setAtrStopLength] = useState(initial.form.atrStopLength);
  const [atrStopMult, setAtrStopMult] = useState(initial.form.atrStopMult);
  const [unsupported, setUnsupported] = useState<string[]>(initial.dropped);
  const [commissionBps, setCommissionBps] = useState(DEFAULT_COSTS.commissionBps);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_COSTS.slippageBps);
  const [cashAnnualPct, setCashAnnualPct] = useState(0);

  const [candles, setCandles] = useState<Candles | null>(null);
  const [outcome, setOutcome] = useState<BacktestOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  const strategy: Strategy = useMemo(
    () =>
      fromForm({
        entry: entryRules,
        exit: exitRules,
        stopLossPct,
        takeProfitPct,
        atrStopLength,
        atrStopMult,
      }),
    [entryRules, exitRules, stopLossPct, takeProfitPct, atrStopLength, atrStopMult],
  );

  const options = useMemo(
    () => ({
      costs: { commissionBps, slippageBps, volumeCapPct: DEFAULT_COSTS.volumeCapPct },
      cashAnnualPct,
    }),
    [commissionBps, slippageBps, cashAnnualPct],
  );

  // Kural değişince URL'i güncelle (replace: her düzenleme geçmiş girdisi olmasın).
  const encoded = useMemo(() => encodeStrategy(strategy), [strategy]);
  useEffect(() => {
    if (!replace || encoded.text === '' || encoded.text === state.str) return;
    replace({ str: encoded.text, st: '' });
    // state.str bağımlılık değil: kendi yazdığımızı geri okuyup döngü kurmayalım.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded, replace]);

  // Sembol serisi (tam geçmiş).
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setCandles(null);
    dataClient
      .series(market, symbol)
      .then((r) => {
        if (!cancelled) setCandles(r.candles);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [market, symbol]);

  // Hızlı backtest: kural/maliyet değişince otomatik (doğrulama hariç).
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !candles || analysis.status !== 'ready') return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    client
      .backtest(candles, strategy, options, false)
      .then((result) => {
        if (!cancelled) setOutcome(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candles, strategy, options, analysis.status]);

  async function runValidation() {
    const client = clientRef.current;
    if (!client || !candles) return;
    setValidating(true);
    setError(null);
    try {
      const result = await client.backtest(candles, strategy, options, {
        permutationRuns: 150,
        folds: 4,
        trials: 1,
        seed: 7,
      });
      setOutcome(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  function applyPreset(id: string) {
    const found = STRATEGY_PRESETS.find((p) => p.id === id);
    if (!found) return;
    const { form, unsupported: missing } = toForm(found.strategy);
    setPreset(id);
    // Editöre sığmayan bir kural sessizce KIRPILMAZ: kurallar olduğu gibi
    // kalır ve neyin sığmadığı ekranda yazar (bkz. labRules.ts).
    setUnsupported(missing);
    if (!form) return;
    setEntryRules(form.entry);
    setExitRules(form.exit);
    setStopLossPct(form.stopLossPct);
    setTakeProfitPct(form.takeProfitPct);
    setAtrStopLength(form.atrStopLength);
    setAtrStopMult(form.atrStopMult);
  }

  const metrics = outcome?.metrics;
  const prov = (key: string) => provText(key, metrics);
  const tradeColumns: Column<Trade>[] = useMemo(
    () => [
      {
        key: 'entry',
        header: 'Giriş',
        width: '110px',
        render: (t) => new Date(t.entryTime * 1000).toISOString().slice(0, 10),
        sortValue: (t) => t.entryTime,
      },
      {
        key: 'exit',
        header: 'Çıkış',
        width: '110px',
        render: (t) => new Date(t.exitTime * 1000).toISOString().slice(0, 10),
      },
      {
        key: 'bars',
        header: 'Bar',
        numeric: true,
        render: (t) => t.bars,
        sortValue: (t) => t.bars,
      },
      {
        key: 'net',
        header: 'Net %',
        numeric: true,
        sortValue: (t) => t.netPct,
        render: (t) => (
          <span style={{ color: t.netPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {fmt(t.netPct, 2, '%')}
          </span>
        ),
      },
      { key: 'mae', header: 'MAE %', numeric: true, render: (t) => fmt(t.maePct, 1, '%') },
      { key: 'mfe', header: 'MFE %', numeric: true, render: (t) => fmt(t.mfePct, 1, '%') },
      {
        key: 'reason',
        header: 'Çıkış nedeni',
        render: (t) =>
          ({ signal: 'kural', stop: 'stop', target: 'hedef', end: 'seri sonu' })[t.reason],
      },
    ],
    [],
  );

  if (analysis.status === 'error') {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Laboratuvar verisi yüklenemedi"
        description={analysis.error ?? ''}
      />
    );
  }

  return (
    <div className="lab">
      <section className="lab__panel" aria-label="Strateji tanımı">
        <div className="lab__row">
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
          <Select
            label="Hazır strateji"
            value={preset}
            onChange={applyPreset}
            options={STRATEGY_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>

        <p className="desk__muted">{STRATEGY_PRESETS.find((p) => p.id === preset)?.detail}</p>
        {unsupported.length > 0 ? (
          <p className="lab__warn" role="status">
            Kuralın bir kısmı uygulanamadı ({unsupported.join(', ')}); görünen strateji
            paylaşılandan farklı olabilir.
          </p>
        ) : null}

        <RuleList title="Giriş kuralları" rules={entryRules} onChange={setEntryRules} />
        <RuleList title="Çıkış kuralları" rules={exitRules} onChange={setExitRules} />

        <div className="lab__row">
          <NumberField
            label="Stop %"
            value={stopLossPct}
            min={0}
            max={50}
            step={0.5}
            onChange={setStopLossPct}
            hint="0 = yok"
          />
          <NumberField
            label="Hedef %"
            value={takeProfitPct}
            min={0}
            max={200}
            step={0.5}
            onChange={setTakeProfitPct}
            hint="0 = yok"
          />
          <NumberField
            label="ATR stop katı"
            value={atrStopMult}
            min={0}
            max={10}
            step={0.5}
            onChange={setAtrStopMult}
            hint="0 = yok"
          />
          <NumberField
            label="ATR uzunluk"
            value={atrStopLength}
            min={2}
            max={100}
            onChange={setAtrStopLength}
          />
          <NumberField
            label="Komisyon (bps)"
            value={commissionBps}
            min={0}
            max={100}
            onChange={setCommissionBps}
          />
          <NumberField
            label="Slipaj (bps)"
            value={slippageBps}
            min={0}
            max={100}
            onChange={setSlippageBps}
          />
          <NumberField
            label="Nakit getirisi %"
            value={cashAnnualPct}
            min={0}
            max={100}
            onChange={setCashAnnualPct}
            hint="pozisyonsuzken"
          />
        </div>

        <p className="desk__muted">
          Kural: {describeCondition(strategy.entry)}
          {strategy.exit ? ` · Çıkış: ${describeCondition(strategy.exit)}` : ''}
        </p>

        <div className="lab__actions">
          <Announce
            message={
              !busy && outcome && metrics ? `Backtest tamamlandı: ${metrics.trades} işlem.` : ''
            }
          />
          <CopyLink label="Stratejiyi paylaş" />
          <Button variant="primary" busy={validating} onClick={runValidation}>
            Doğrulamayı çalıştır
          </Button>
          {busy ? <Badge tone="warn">Hesaplanıyor…</Badge> : null}
          {outcome ? <span className="desk__muted">worker {outcome.ms.toFixed(0)} ms</span> : null}
        </div>
      </section>

      {error ? (
        <EmptyState
          tone="error"
          icon={<Icon name="alert" size={28} />}
          title="Backtest çalışmadı"
          description={error}
        />
      ) : null}

      {!outcome || !metrics ? (
        <Skeleton height="240px" />
      ) : (
        <>
          <section className="lab__badges" aria-label="Doğrulama rozetleri">
            {outcome.badges.length === 0 ? (
              <p className="desk__muted">
                Sonuç <strong>doğrulanmadı</strong>: maliyet dahil ama OOS, sağlamlık, tesadüf ve
                çoklu test sınamaları çalıştırılmadı. "Doğrulamayı çalıştır" ile sına.
              </p>
            ) : (
              outcome.badges.map((badge) => (
                <Popover
                  key={badge.id}
                  title={badge.label}
                  trigger={(p) => (
                    <button type="button" className="lab__badge" {...p}>
                      <Badge tone={BADGE_TONE[badge.level]} icon={BADGE_ICON[badge.level]}>
                        {badge.label}
                      </Badge>
                    </button>
                  )}
                >
                  {badge.detail}
                </Popover>
              ))
            )}
          </section>

          <section className="lab__stats" aria-label="Performans">
            <Stat
              label="Yıllık (CAGR)"
              value={fmt(metrics.cagrPct, 1, '%')}
              hint={`al-tut ${fmt(metrics.buyHoldCagrPct, 1, '%')}`}
              provenance={<Prov label="Yıllık (CAGR)">{prov('cagrPct')}</Prov>}
            />
            <Stat
              label="Al-tut farkı"
              value={fmt(metrics.excessCagrPct, 1, '%')}
              hint="yıllık puan"
              provenance={<Prov label="Al-tut farkı">{prov('excessCagrPct')}</Prov>}
            />
            <Stat
              label="Maks. düşüş"
              value={fmt(-metrics.maxDrawdownPct, 1, '%')}
              hint={`${metrics.maxDrawdownBars} bar sürdü`}
              provenance={<Prov label="Maks. düşüş">{prov('maxDrawdownPct')}</Prov>}
            />
            <Stat
              label="Sharpe / Sortino"
              value={`${fmt(metrics.sharpe, 2)} / ${fmt(metrics.sortino, 2)}`}
              provenance={
                <Prov label="Sharpe / Sortino">
                  {prov('sharpe')}
                  <br />
                  {prov('sortino')}
                </Prov>
              }
            />
            <Stat
              label="Calmar / Ulcer"
              value={`${fmt(metrics.calmar, 2)} / ${fmt(metrics.ulcer, 1)}`}
              provenance={
                <Prov label="Calmar / Ulcer">
                  {prov('calmar')}
                  <br />
                  {prov('ulcer')}
                </Prov>
              }
            />
            <Stat
              label="İşlem"
              value={String(metrics.trades)}
              hint={`kazanma %${metrics.winRatePct.toFixed(0)} · ort. ${metrics.avgBars.toFixed(0)} bar`}
              provenance={<Prov label="İşlem">{prov('trades')}</Prov>}
            />
            <Stat
              label="Profit factor"
              value={fmt(metrics.profitFactor, 2)}
              hint={`beklenti ${fmt(metrics.expectancyPct, 2, '%')}`}
              provenance={<Prov label="Profit factor">{prov('profitFactor')}</Prov>}
            />
            <Stat
              label="Maliyet yükü"
              // İŞARETSİZ: "yük" bir kazanç değil. `+%6,2` yazmak maliyeti
              // getiriye katkı gibi gösteriyordu.
              value={plainPct(metrics.costDragPct, 1)}
              hint={`piyasada %${metrics.exposurePct.toFixed(0)} kalındı`}
              provenance={
                <Prov label="Maliyet yükü">
                  {prov('costDragPct')}
                  <br />
                  {prov('exposurePct')}
                </Prov>
              }
            />
          </section>

          <section className="lab__panel" aria-label="Sermaye eğrisi">
            <header className="lab__header">
              <h2>Sermaye eğrisi</h2>
              <span className="desk__muted">Strateji ve al-tut, aynı maliyet modeliyle</span>
            </header>
            <LineChart
              normalize
              height={260}
              ariaLabel="Strateji ve al-tut sermaye eğrisi"
              series={[
                {
                  label: 'Strateji',
                  color: 'var(--accent)',
                  time: outcome.time.slice(outcome.warmup),
                  values: outcome.equity.slice(outcome.warmup),
                },
                {
                  label: 'Al-tut',
                  color: 'var(--text-muted)',
                  dashed: true,
                  time: outcome.time.slice(outcome.warmup),
                  values: outcome.buyHold.slice(outcome.warmup),
                },
              ]}
            />
          </section>

          <section className="lab__panel" aria-label="Rejim kırılımı">
            <header className="lab__header">
              <h2>Rejim kırılımı</h2>
              <span className="desk__muted">İşlemler, GİRİŞ barındaki piyasa rejimine göre</span>
            </header>
            <table className="lab__regimes">
              <caption className="visually-hidden">
                Oynaklık ve yön rejimlerine göre işlem sayısı ve getiri
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rejim</th>
                  <th scope="col" className="num">
                    Bar payı
                  </th>
                  <th scope="col" className="num">
                    İşlem
                  </th>
                  <th scope="col" className="num">
                    Medyan
                  </th>
                  <th scope="col" className="num">
                    Ortalama
                  </th>
                  <th scope="col" className="num">
                    İsabet
                  </th>
                </tr>
              </thead>
              <tbody>
                {outcome.regimes.buckets.map((bucket) => (
                  <tr key={bucket.key}>
                    <th scope="row">{bucket.label}</th>
                    <td className="num">{plainPct(bucket.barsPct)}</td>
                    <td className="num">{bucket.trades}</td>
                    <td className="num">
                      {bucket.enough ? (
                        fmt(bucket.medianPct, 2, '%')
                      ) : (
                        <span className="desk__muted">yetersiz örnek</span>
                      )}
                    </td>
                    <td className="num">{bucket.enough ? fmt(bucket.meanPct, 2, '%') : '—'}</td>
                    <td className="num">{bucket.enough ? plainPct(bucket.winRatePct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="desk__muted">{regimeVerdict(outcome.regimes)}</p>
            {outcome.regimes.unknown > 0 ? (
              <p className="desk__muted">
                {outcome.regimes.unknown} işlem ısınma döneminde açıldı; rejimi bilinmiyor ve hiçbir
                satıra yazılmadı.
              </p>
            ) : null}
            <p className="desk__muted">{REGIME_CAVEAT}</p>
          </section>

          <section className="lab__panel lab__trades" aria-label="İşlemler">
            <header className="lab__header">
              <h2>İşlemler</h2>
              <span className="desk__muted">{outcome.trades.length} işlem</span>
            </header>
            <VirtualTable
              rows={outcome.trades}
              columns={tradeColumns}
              rowKey={(t) => `${t.entryIndex}-${t.exitIndex}`}
              label="İşlem listesi"
              height={280}
              empty={<EmptyState title="Bu kurallarla hiç işlem açılmadı" />}
            />
          </section>
        </>
      )}
    </div>
  );
}

function RuleList({
  title,
  rules,
  onChange,
}: {
  title: string;
  rules: SimpleRule[];
  onChange: (rules: SimpleRule[]) => void;
}) {
  const update = (index: number, patch: Partial<SimpleRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <div className="lab__rules">
      <h3>{title}</h3>
      {rules.map((rule, i) => (
        <div className="lab__rule" key={i}>
          <OperandEditor value={rule.left} onChange={(left) => update(i, { left })} />
          <Select
            label="Koşul"
            value={rule.op}
            onChange={(value) => update(i, { op: value as SimpleOp })}
            options={(Object.keys(OP_LABEL) as SimpleOp[]).map((op) => ({
              value: op,
              label: OP_LABEL[op],
            }))}
          />
          <OperandEditor value={rule.right} onChange={(right) => update(i, { right })} />
          <IconButton
            label={`${title}: ${i + 1}. kuralı kaldır`}
            onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
          >
            <Icon name="close" size={14} />
          </IconButton>
        </div>
      ))}
      <Button
        size="sm"
        aria-label={`${title}: kural ekle`}
        onClick={() =>
          onChange([
            ...rules,
            { left: { kind: 'close' }, op: 'gt', right: { kind: 'ema', length: 50 } },
          ])
        }
      >
        + Kural
      </Button>
    </div>
  );
}

function OperandEditor({ value, onChange }: { value: Operand; onChange: (o: Operand) => void }) {
  // Ölçek (ör. "EMA(50)'nin %97'si") operandın DIŞINDA bir sarmalayıcı; editör
  // onu ayırıp ayrı bir katsayı alanı olarak gösteriyor, tür seçimi sadelensin.
  const base = baseOf(value);
  const factor = factorOf(value);
  const shift = shiftOf(value);
  const kind = base.kind;
  const hasLength = 'length' in base;
  const isConst = kind === 'const';
  // Katsayı alanı yalnızca anlamlı olduğu yerde: göstergelerde ve zaten
  // ölçeklenmiş operandlarda. Ham fiyat satırlarında gürültü olurdu.
  const showFactor = !isConst && (hasLength || factor !== 1);

  return (
    <div className="lab__operand">
      <Select
        label="Veri"
        value={kind}
        onChange={(next) => {
          if (next === 'const') onChange({ kind: 'const', value: 50 });
          else if (['close', 'open', 'high', 'low', 'volume'].includes(next))
            onChange(withShift(withFactor({ kind: next as 'close' }, factor), shift));
          else onChange(withShift(withFactor({ kind: next as 'ema', length: 20 }, factor), shift));
        }}
        options={OPERAND_KINDS}
      />
      {hasLength ? (
        <NumberField
          label="Uzunluk"
          value={(base as { length: number }).length}
          min={2}
          max={1000}
          onChange={(length) =>
            onChange(withFactor({ ...(base as { kind: 'ema'; length: number }), length }, factor))
          }
        />
      ) : null}
      {isConst ? (
        <NumberField
          label="Değer"
          value={(base as { value: number }).value}
          step={0.5}
          onChange={(v) => onChange({ kind: 'const', value: v })}
        />
      ) : null}
      {showFactor ? (
        <NumberField
          label="× katsayı"
          value={factor}
          min={0.1}
          max={3}
          step={0.01}
          onChange={(next) => onChange(withFactor(value, next))}
          hint="1 = olduğu gibi"
        />
      ) : null}
      {!isConst ? (
        <NumberField
          label="Kaç bar önce"
          value={shift}
          min={0}
          max={50}
          onChange={(next) => onChange(withShift(value, next))}
          hint="0 = bu bar"
        />
      ) : null}
    </div>
  );
}
