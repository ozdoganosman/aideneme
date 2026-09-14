import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  buildLedger,
  moneyWeightedReturn,
  valuePortfolio,
  type Txn,
} from '../../core/portfolio/ledger';
import { realReturnPct } from '../../core/portfolio/real';
import { returnInCurrency, type FxSeries } from '../../core/portfolio/fx';
import { fxClient } from '../../data-client/fx';
import {
  BIST_SCENARIOS,
  concentration,
  portfolioReturns,
  runScenario,
  tailRisk,
  type Holding,
} from '../../core/portfolio/risk';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const STORAGE_KEY = 'portfolio.txns';

function loadTxns(): Txn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Txn[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTxns(txns: Txn[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txns));
  } catch {
    /* depolama yoksa oturum içinde çalışmaya devam eder */
  }
}

const money = (v: number): string =>
  Number.isFinite(v) ? v.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) : '—';

const pct = (v: number, digits = 1): string => trPct(v, digits, true);

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Portföy — "param nerede, riskim ne?" */
export default function Portfolio({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);

  const [txns, setTxns] = useState<Txn[]>(loadTxns);
  const [draft, setDraft] = useState({
    symbol: '',
    side: 'buy' as Txn['side'],
    shares: 100,
    price: 0,
    fee: 0,
    date: todayISO(),
  });
  const [series, setSeries] = useState<Record<string, Candles>>({});
  const [loading, setLoading] = useState(false);

  const ledger = useMemo(() => buildLedger(txns), [txns]);
  const open = useMemo(() => ledger.positions.filter((p) => p.shares > 0), [ledger]);

  // Açık pozisyonların tam geçmişi: değerleme, risk ve senaryolar için.
  useEffect(() => {
    const missing = open.map((p) => p.symbol).filter((s) => !series[s]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, series, market]);

  const priceOf = useCallback(
    (symbol: string): number | undefined => {
      const candles = series[symbol];
      return candles && candles.length ? candles.close[candles.length - 1] : undefined;
    },
    [series],
  );

  const valuation = useMemo(() => valuePortfolio(open, priceOf), [open, priceOf]);

  const holdings: Holding[] = useMemo(
    () => valuation.rows.map((row) => ({ symbol: row.symbol, weight: row.weightPct / 100 })),
    [valuation],
  );

  const risk = useMemo(() => {
    const { returns, used } = portfolioReturns(holdings, (s) => series[s], 500);
    return { tail: tailRisk(returns, 0.95), samples: returns.length, used };
  }, [holdings, series]);

  const conc = useMemo(() => concentration(valuation.rows.map((r) => r.value)), [valuation]);

  const scenarios = useMemo(
    () => BIST_SCENARIOS.map((s) => runScenario(holdings, (sym) => series[sym], s)),
    [holdings, series],
  );

  const firstDate = useMemo(() => (txns.length ? Math.min(...txns.map((t) => t.date)) : 0), [txns]);

  /**
   * Değerleme tarihi = elimizdeki SON fiyat günü, "bugün" değil.
   * Veri birkaç gün (bayat veride aylarca) geride olabilir; enflasyon ve IRR
   * düzeltmesini bugüne kadar uygulamak, fiyatı olmayan bir dönemi de hesaba
   * katıp reel getiriyi sistematik olarak kötü gösterirdi.
   */
  const valuationDate = useMemo(() => {
    let last = 0;
    for (const row of valuation.rows) {
      const candles = series[row.symbol];
      if (candles && candles.length) last = Math.max(last, candles.time[candles.length - 1]);
    }
    return last || Math.floor(Date.now() / 1000);
  }, [valuation.rows, series]);

  const [fx, setFx] = useState<FxSeries | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFx(null);
    fxClient.series(market).then((series) => {
      if (!cancelled) setFx(series);
    });
    return () => {
      cancelled = true;
    };
  }, [market]);

  const irr = useMemo(
    () =>
      txns.length && valuation.totalValue > 0
        ? moneyWeightedReturn(ledger.cashFlows, valuation.totalValue, valuationDate)
        : NaN,
    [ledger, valuation.totalValue, txns.length, valuationDate],
  );

  const nominalPct =
    valuation.totalCost > 0 ? (valuation.unrealizedPnl / valuation.totalCost) * 100 : NaN;
  const realPct =
    Number.isFinite(nominalPct) && firstDate
      ? realReturnPct(nominalPct, firstDate, valuationDate)
      : NaN;

  /**
   * Döviz bazlı getiri: maliyet ilk işlem GÜNÜNÜN kuruyla, güncel değer
   * DEĞERLEME GÜNÜNÜN kuruyla çevrilir. Kur serisi yoksa ya da ilk işlem
   * serinin başlangıcından eskiyse sonuç üretilmez — eksik kuru "en eski kur"
   * ile doldurmak getiriyi çarpıtırdı.
   */
  const fxReturn = useMemo(
    () =>
      firstDate && valuation.totalCost > 0
        ? returnInCurrency(
            fx,
            Math.floor(firstDate / 86400),
            Math.floor(valuationDate / 86400),
            valuation.totalCost,
            valuation.totalValue,
          )
        : null,
    [fx, firstDate, valuationDate, valuation.totalCost, valuation.totalValue],
  );

  function addTxn() {
    if (!draft.symbol || !(draft.shares > 0) || !(draft.price > 0)) return;
    const date = Math.floor(new Date(`${draft.date}T00:00:00Z`).getTime() / 1000);
    const next = [
      ...txns,
      {
        id: `${Date.now()}-${draft.symbol}`,
        symbol: draft.symbol,
        side: draft.side,
        shares: draft.shares,
        price: draft.price,
        fee: draft.fee || undefined,
        date: Number.isFinite(date) ? date : Math.floor(Date.now() / 1000),
      },
    ];
    setTxns(next);
    saveTxns(next);
  }

  const removeTxn = useCallback((id: string) => {
    setTxns((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveTxns(next);
      return next;
    });
  }, []);

  const txnColumns: Column<Txn>[] = useMemo(
    () => [
      {
        key: 'date',
        header: 'Tarih',
        width: '110px',
        render: (t) => new Date(t.date * 1000).toISOString().slice(0, 10),
        sortValue: (t) => t.date,
      },
      { key: 'symbol', header: 'Sembol', render: (t) => t.symbol, sortValue: (t) => t.symbol },
      { key: 'side', header: 'İşlem', render: (t) => (t.side === 'buy' ? 'Alış' : 'Satış') },
      { key: 'shares', header: 'Adet', numeric: true, render: (t) => t.shares },
      { key: 'price', header: 'Fiyat', numeric: true, render: (t) => trNum(t.price, 2) },
      { key: 'total', header: 'Tutar', numeric: true, render: (t) => money(t.shares * t.price) },
      {
        key: 'remove',
        header: '',
        width: '60px',
        render: (t) => (
          <IconButton label={`${t.symbol} işlemini sil`} size="sm" onClick={() => removeTxn(t.id)}>
            <Icon name="close" size={12} />
          </IconButton>
        ),
      },
    ],
    [removeTxn],
  );

  const positionColumns: Column<(typeof valuation.rows)[number]>[] = useMemo(
    () => [
      {
        key: 'symbol',
        header: 'Sembol',
        width: '110px',
        render: (r) => r.symbol,
        sortValue: (r) => r.symbol,
      },
      {
        key: 'shares',
        header: 'Adet',
        numeric: true,
        render: (r) => r.shares,
        sortValue: (r) => r.shares,
      },
      { key: 'avg', header: 'Ort. maliyet', numeric: true, render: (r) => trNum(r.avgCost, 2) },
      { key: 'price', header: 'Fiyat', numeric: true, render: (r) => trNum(r.price, 2) },
      {
        key: 'value',
        header: 'Değer',
        numeric: true,
        render: (r) => money(r.value),
        sortValue: (r) => r.value,
      },
      {
        key: 'pnl',
        header: 'K/Z',
        numeric: true,
        sortValue: (r) => r.unrealizedPct,
        render: (r) => (
          <span style={{ color: r.unrealizedPnl >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {pct(r.unrealizedPct, 1)}
          </span>
        ),
      },
      {
        key: 'weight',
        header: 'Ağırlık',
        numeric: true,
        render: (r) => trPct(r.weightPct, 1),
      },
    ],
    [],
  );

  return (
    <div className="pf">
      <section className="pf__panel" aria-label="İşlem ekle">
        <div className="pf__row">
          <Select
            label="Piyasa"
            value={market}
            onChange={(value) => push({ m: value })}
            options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
          />
          <Combobox
            label="Sembol"
            value={draft.symbol}
            onChange={(symbol) => setDraft((d) => ({ ...d, symbol }))}
            options={analysis.symbols.map((s) => ({ value: s, label: s }))}
            placeholder="Sembol ara…"
          />
          <Select
            label="İşlem"
            value={draft.side}
            onChange={(side) => setDraft((d) => ({ ...d, side: side as Txn['side'] }))}
            options={[
              { value: 'buy', label: 'Alış' },
              { value: 'sell', label: 'Satış' },
            ]}
          />
          <NumberField
            label="Adet"
            value={draft.shares}
            min={1}
            onChange={(shares) => setDraft((d) => ({ ...d, shares }))}
          />
          <NumberField
            label="Fiyat"
            value={draft.price}
            min={0}
            step={0.01}
            onChange={(price) => setDraft((d) => ({ ...d, price }))}
          />
          <NumberField
            label="Komisyon"
            value={draft.fee}
            min={0}
            step={0.5}
            onChange={(fee) => setDraft((d) => ({ ...d, fee }))}
          />
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="pf-date">
              Tarih
            </label>
            <input
              id="pf-date"
              type="date"
              className="ui-input"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </div>
          <Button variant="primary" onClick={addTxn}>
            Ekle
          </Button>
        </div>
        <p className="desk__muted">
          Maliyet yöntemi: <strong>ağırlıklı ortalama</strong> (komisyon dahil). İşlemler yalnızca
          bu tarayıcıda saklanır; sunucuya gönderilmez.
        </p>
        {ledger.warnings.length > 0 ? (
          <ul className="pf__warnings">
            {ledger.warnings.map((w) => (
              <li key={w}>
                <Badge tone="warn" icon="!">
                  Uyarı
                </Badge>{' '}
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {txns.length === 0 ? (
        <EmptyState
          icon={<Icon name="wallet" size={28} />}
          title="Henüz işlem yok"
          description="Bir alış ekleyerek başla; değerleme, risk ve senaryolar otomatik hesaplanır."
        />
      ) : (
        <>
          <section className="pf__stats" aria-label="Portföy özeti">
            <Stat
              label="Portföy değeri"
              value={money(valuation.totalValue)}
              hint={`maliyet ${money(valuation.totalCost)} · değerleme ${new Date(
                valuationDate * 1000,
              )
                .toISOString()
                .slice(0, 10)}`}
            />
            <Stat
              label="Açık K/Z"
              value={money(valuation.unrealizedPnl)}
              delta={Number.isFinite(nominalPct) ? nominalPct : undefined}
            />
            <Stat
              label={fx ? `${fx.currency} bazında` : 'Döviz bazında'}
              value={fxReturn ? pct(fxReturn.returnPct, 1) : '—'}
              hint={
                !fx
                  ? 'kur serisi yok'
                  : fxReturn
                    ? `${trNum(fxReturn.rateFrom, 2)} → ${trNum(fxReturn.rateTo, 2)} · ${fx.source}`
                    : 'ilk işlem kur serisinden eski'
              }
            />
            <Stat
              label="Reel K/Z"
              value={pct(realPct, 1)}
              hint="TÜFE düzeltmeli"
              provenance={
                <Popover
                  title="Reel getiri"
                  trigger={(p) => (
                    <button
                      type="button"
                      className="desk__prov"
                      aria-label="Reel getiri: bu sayı nereden geliyor?"
                      {...p}
                    >
                      ?
                    </button>
                  )}
                >
                  Nominal getiri, ilk işlem tarihinden DEĞERLEME GÜNÜNE (elimizdeki son fiyat günü,
                  bugüne değil) birikimli TÜFE çarpanına bölünür. TL'de %60 nominal kazanç, %65
                  enflasyonda satın alma gücü kaybıdır.
                </Popover>
              }
            />
            <Stat
              label="Gerçekleşen K/Z"
              value={money(ledger.realizedPnl)}
              hint={`komisyon ${money(ledger.fees)}`}
            />
            <Stat
              label="Para ağırlıklı getiri"
              value={pct(irr, 1)}
              hint="yıllık (IRR)"
              provenance={
                <Popover
                  title="Para ağırlıklı getiri (IRR)"
                  trigger={(p) => (
                    <button
                      type="button"
                      className="desk__prov"
                      aria-label="Para ağırlıklı getiri (IRR): bu sayı nereden geliyor?"
                      {...p}
                    >
                      ?
                    </button>
                  )}
                >
                  Nakit akışlarının zamanlamasını hesaba katar. Zirvede para eklediyseniz zaman
                  ağırlıklı getiri bunu göremez, IRR görür.
                </Popover>
              }
            />
          </section>

          {valuation.missingPrices.length > 0 ? (
            <p className="desk__muted">
              Fiyatı bulunamayan (değerlemeye girmeyen): {valuation.missingPrices.join(', ')}
            </p>
          ) : null}

          <section className="pf__panel" aria-label="Pozisyonlar">
            <header className="pf__header">
              <h2>Pozisyonlar</h2>
              {loading ? <Badge tone="warn">Fiyatlar yükleniyor…</Badge> : null}
            </header>
            <VirtualTable
              rows={valuation.rows}
              columns={positionColumns}
              rowKey={(r) => r.symbol}
              label="Açık pozisyonlar"
              height={Math.min(320, 60 + valuation.rows.length * 34)}
              onRowClick={(r) => push({ v: 'sembol', s: r.symbol })}
              empty={<EmptyState title="Açık pozisyon yok" />}
            />
          </section>

          <section className="pf__panel" aria-label="Risk">
            <header className="pf__header">
              <h2>Risk</h2>
              <span className="desk__muted">
                {risk.samples} günlük gözlem · ağırlıklar sabit varsayıldı (yeniden dengelenmiş
                gibi)
              </span>
            </header>
            <div className="pf__stats">
              <Stat
                label="Günlük VaR %95"
                value={pct(risk.tail.varPct, 2)}
                hint="bu eşiği 20 günde 1 aşar"
              />
              <Stat
                label="CVaR (kuyruk ort.)"
                value={pct(risk.tail.cvarPct, 2)}
                hint="eşik aşıldığında"
              />
              <Stat
                label="En büyük pozisyon"
                // PAY işaretsiz: "+%95" bir getiri gibi okunuyordu, oysa bu
                // portföyün ne kadarının tek pozisyonda olduğunu söylüyor.
                value={trPct(conc.top1Pct, 0)}
                hint={`ilk üç ${trPct(conc.top3Pct, 0)}`}
              />
              <Stat
                label="Etkin pozisyon"
                value={
                  Number.isFinite(conc.effectivePositions) ? trNum(conc.effectivePositions, 1) : '—'
                }
                hint={`${valuation.rows.length} pozisyon açık`}
              />
            </div>
          </section>

          <section className="pf__panel" aria-label="Senaryolar">
            <header className="pf__header">
              <h2>Tarihsel senaryolar</h2>
              <span className="desk__muted">Simülasyon değil: gerçekten yaşanmış dönemler</span>
            </header>
            <table className="pf__scenarios">
              <caption className="visually-hidden">
                Portföyün geçmiş şok dönemlerindeki getirisi
              </caption>
              <thead>
                <tr>
                  <th scope="col">Dönem</th>
                  <th scope="col">Ne olmuştu</th>
                  <th scope="col" className="num">
                    Portföy
                  </th>
                  <th scope="col" className="num">
                    Kapsam
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.scenario.id}>
                    <th scope="row">{s.scenario.label}</th>
                    <td className="desk__muted">{s.scenario.note}</td>
                    <td
                      className="num"
                      style={{ color: s.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}
                    >
                      {pct(s.returnPct, 1)}
                    </td>
                    <td className="num desk__muted">
                      {s.covered}/{s.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="pf__panel" aria-label="İşlemler">
            <header className="pf__header">
              <h2>İşlem geçmişi</h2>
              <span className="desk__muted">{txns.length} işlem</span>
            </header>
            <VirtualTable
              rows={txns}
              columns={txnColumns}
              rowKey={(t) => t.id}
              label="İşlem listesi"
              height={Math.min(300, 60 + txns.length * 34)}
            />
          </section>
        </>
      )}

      {analysis.status === 'loading' && txns.length === 0 ? <Skeleton height="60px" /> : null}
    </div>
  );
}
