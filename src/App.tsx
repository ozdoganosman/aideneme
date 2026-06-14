import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, IndicatorSettings } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Watchlist } from './components/Watchlist';
import { Portfolio, Holding } from './components/Portfolio';
import { IndicatorMenu } from './components/IndicatorMenu';
import { Trades } from './components/Trades';
import { Backtest } from './components/Backtest';
import { PortfolioAnalysis } from './components/PortfolioAnalysis';
import { computeStats } from './indicators/stats';
import type { Trade } from './indicators/backtest';
import { Candles, BIST_SYMBOLS } from './data/types';
import {
  fetchBistStatic,
  fetchBistSymbols,
  fetchBistQuotes,
  fetchBistNames,
  fetchBistSpark,
  Quotes,
} from './data/bistStatic';
import { generateSynthetic } from './data/synthetic';
import { resample, TF } from './data/resample';

type Provider = 'bist' | 'synthetic';

const SYNTH_BARS = 4_000_000;
const TF_LABEL: Record<TF, string> = { D: 'Günlük', W: 'Haftalık', M: 'Aylık' };

function lsGet<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}

export default function App() {
  const [provider, setProvider] = useState<Provider>('bist');
  const [symbol, setSymbol] = useState('THYAO');
  const [tf, setTf] = useState<TF>('D');
  const [candles, setCandles] = useState<Candles | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>(BIST_SYMBOLS);
  const [fitOnLoad, setFitOnLoad] = useState(true);
  const [showBt, setShowBt] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [log, setLog] = useState<boolean>(() => lsGet('borsaLog', false));
  const [focusTrade, setFocusTrade] = useState<Trade | null>(null);
  const [leftTab, setLeftTab] = useState<'portfolio' | 'trades'>(() => lsGet('borsaLeftTab', 'portfolio'));
  const [showLeft, setShowLeft] = useState<boolean>(() => lsGet('borsaShowLeft', true));
  const [showRight, setShowRight] = useState<boolean>(() => lsGet('borsaShowRight', true));

  const [quotes, setQuotes] = useState<Quotes>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [watchlist, setWatchlist] = useState<string[]>(() => lsGet('borsaWatch', ['THYAO', 'GARAN', 'ASELS']));
  const [watchAdded, setWatchAdded] = useState<Record<string, { t: number; p: number }>>(() =>
    lsGet('borsaWatchAdded', {}),
  );
  const [portfolio, setPortfolio] = useState<Holding[]>(() => lsGet('borsaPortfolio', []));
  const [settings, setSettings] = useState<IndicatorSettings>(() =>
    lsGet('borsaIndicators', { ema: true, volume: true, williams: true, macd: true }),
  );

  const abortRef = useRef<AbortController | null>(null);
  const dailyRef = useRef<Candles | null>(null);
  const firstRef = useRef(true);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => localStorage.setItem('borsaWatch', JSON.stringify(watchlist)), [watchlist]);
  useEffect(() => localStorage.setItem('borsaWatchAdded', JSON.stringify(watchAdded)), [watchAdded]);
  // Backfill the "tracked since" baseline (date + price) for any watched symbol
  // that has none yet (e.g. added before this feature) once its quote is known.
  useEffect(() => {
    if (!watchlist.length) return;
    setWatchAdded((m) => {
      let changed = false;
      const n = { ...m };
      const now = Math.floor(Date.now() / 1000);
      for (const s of watchlist) {
        const q = quotes[s];
        if (!q || !(q.c > 0)) continue;
        if (!n[s] || !(n[s].p > 0)) {
          n[s] = { t: n[s]?.t || now, p: q.c };
          changed = true;
        }
      }
      return changed ? n : m;
    });
  }, [quotes, watchlist]);
  useEffect(() => localStorage.setItem('borsaPortfolio', JSON.stringify(portfolio)), [portfolio]);
  useEffect(() => localStorage.setItem('borsaIndicators', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('borsaLog', JSON.stringify(log)), [log]);
  useEffect(() => localStorage.setItem('borsaLeftTab', JSON.stringify(leftTab)), [leftTab]);
  useEffect(() => localStorage.setItem('borsaShowLeft', JSON.stringify(showLeft)), [showLeft]);
  useEffect(() => localStorage.setItem('borsaShowRight', JSON.stringify(showRight)), [showRight]);

  const load = useCallback(
    async (opts?: { provider?: Provider; symbol?: string; tf?: TF }) => {
      const prov = opts?.provider ?? provider;
      const sym = (opts?.symbol ?? symbol).toUpperCase().trim();
      const tframe = opts?.tf ?? tf;
      if (prov === 'bist' && !sym) return;

      setLoading(true);
      setError(null);
      setStatus('Yükleniyor…');
      setFocusTrade(null);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let c: Candles;
        if (prov === 'synthetic') {
          await new Promise((r) => setTimeout(r, 0));
          c = generateSynthetic(sym || 'SYNTH', SYNTH_BARS, 60);
          dailyRef.current = null;
        } else {
          const daily = await fetchBistStatic(sym, ac.signal);
          dailyRef.current = daily;
          c = resample(daily, tframe);
        }
        const key = prov === 'synthetic' ? 'synthetic' : `bist|${tframe}`;
        setFitOnLoad(firstRef.current || key !== lastKeyRef.current);
        firstRef.current = false;
        lastKeyRef.current = key;
        setCandles(c);
        setStatus(`${c.length.toLocaleString()} mum`);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setError((e as Error)?.message ?? String(e));
        setStatus('Hata');
      } finally {
        setLoading(false);
      }
    },
    [provider, symbol, tf],
  );

  const changeTf = (newTf: TF) => {
    setTf(newTf);
    setFocusTrade(null);
    if (provider !== 'bist' || !dailyRef.current) return;
    const c = resample(dailyRef.current, newTf);
    setFitOnLoad(true);
    lastKeyRef.current = `bist|${newTf}`;
    setCandles(c);
    setStatus(`${c.length.toLocaleString()} mum`);
  };

  // Select a symbol from the sidebar → always BIST.
  const selectSymbol = (s: string) => {
    setProvider('bist');
    setSymbol(s);
    void load({ provider: 'bist', symbol: s });
  };
  const toggleWatch = (s: string) => {
    if (watchlist.includes(s)) {
      setWatchlist((w) => w.filter((x) => x !== s));
      setWatchAdded((m) => {
        const n = { ...m };
        delete n[s];
        return n;
      });
    } else {
      setWatchlist((w) => [s, ...w]);
      setWatchAdded((m) => ({ ...m, [s]: { t: Math.floor(Date.now() / 1000), p: quotes[s]?.c ?? 0 } }));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    fetchBistSymbols()
      .then((s) => setSymbols(s.length ? s : BIST_SYMBOLS))
      .catch(() => setSymbols(BIST_SYMBOLS));
    fetchBistQuotes().then(setQuotes).catch(() => setQuotes({}));
    fetchBistNames().then(setNames).catch(() => setNames({}));
    fetchBistSpark().then(setSpark).catch(() => setSpark({}));
  }, []);

  // Keyboard shortcuts: / search, L log, 1/2/3 timeframe, [ ] panels, F backtest.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '/') {
        e.preventDefault();
        (document.querySelector('.search input') as HTMLInputElement | null)?.focus();
      } else if (e.key === 'l' || e.key === 'L') setLog((v) => !v);
      else if (e.key === '1') changeTf('D');
      else if (e.key === '2') changeTf('W');
      else if (e.key === '3') changeTf('M');
      else if (e.key === '[') setShowLeft((v) => !v);
      else if (e.key === ']') setShowRight((v) => !v);
      else if (e.key === 'f' || e.key === 'F') {
        if (candles) setShowBt(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, provider]);

  const tfLabel = provider === 'synthetic' ? 'SİM' : tf === 'D' ? '1G' : tf === 'W' ? '1H' : '1A';
  const starred = watchlist.includes(symbol);
  const stats = useMemo(() => computeStats(candles), [candles]);

  // Active left tab reflects onto the chart: Portföy → avg-cost line for the held
  // symbol; İşlemler → strategy markers. Collapsed → neither.
  const reflectTrades = showLeft && leftTab === 'trades';
  const costLine = useMemo(() => {
    if (!showLeft || leftTab !== 'portfolio' || provider !== 'bist') return null;
    const h = portfolio.find((x) => x.symbol === symbol);
    if (!h || !(h.cost > 0)) return null;
    const q = quotes[symbol];
    const last = q ? q.c : NaN;
    const pnlPct = isFinite(last) && h.cost ? ((last - h.cost) / h.cost) * 100 : NaN;
    const c = h.cost.toLocaleString('en-US', { maximumFractionDigits: h.cost >= 1000 ? 0 : 2 });
    const label = isFinite(pnlPct) ? `Maliyet ${c} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)` : `Maliyet ${c}`;
    return { price: h.cost, label };
  }, [showLeft, leftTab, provider, portfolio, symbol, quotes]);
  const lastC = candles && candles.length ? candles.close[candles.length - 1] : NaN;
  const prevC = candles && candles.length > 1 ? candles.close[candles.length - 2] : NaN;
  const dChg = isFinite(lastC) && isFinite(prevC) && prevC ? ((lastC - prevC) / prevC) * 100 : 0;
  const company = provider === 'bist' ? names[symbol] || '' : 'Sentetik veri';

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">⚡ Borsa</span>

        <select
          className="ctl"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as Provider;
            setProvider(p);
            void load({ provider: p });
          }}
        >
          <option value="bist">BIST</option>
          <option value="synthetic">Sentetik (stres)</option>
        </select>

        <span className="tb-div" />

        {provider === 'bist' ? (
          <>
            <SymbolSearch value={symbol} symbols={symbols} onChange={setSymbol} onSubmit={(s) => load({ symbol: s })} />
            <button
              className={'ctl star' + (starred ? ' on' : '')}
              title={starred ? 'İzlemeden çıkar' : 'İzlemeye ekle'}
              onClick={() => toggleWatch(symbol)}
            >
              {starred ? '★' : '☆'}
            </button>
            <div className="seg">
              {(['D', 'W', 'M'] as TF[]).map((t) => (
                <button key={t} className={t === tf ? 'active' : ''} onClick={() => changeTf(t)}>
                  {TF_LABEL[t]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="hint">4.000.000 mum (maks)</span>
        )}

        <span className="tb-div" />

        <IndicatorMenu settings={settings} onChange={setSettings} />

        <button
          className={'ctl' + (log ? ' on' : '')}
          onClick={() => setLog((v) => !v)}
          title="Logaritmik fiyat ölçeği"
        >
          Log
        </button>

        <button className="ctl primary" onClick={() => setShowBt(true)} disabled={!candles} title="Strateji taraması (backtest)">
          Strateji
        </button>

        <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
          <span className={loading ? 'spinning' : ''}>⟳</span>
        </button>

        {strategy && (
          <span className="chip">
            {strategy}
            <button onClick={() => setStrategy(null)} title="İşaretleri kaldır">×</button>
          </span>
        )}

        <span className="spacer" />
        <div className="tb-group">
          <button
            className={'ctl tgl' + (showLeft ? ' on' : '')}
            onClick={() => setShowLeft((v) => !v)}
            title="Sol panel (Portföy / İşlemler) — kısayol ["
          >
            ◧
          </button>
          <button
            className={'ctl tgl' + (showRight ? ' on' : '')}
            onClick={() => setShowRight((v) => !v)}
            title="Sağ panel (İzleme Listesi) — kısayol ]"
          >
            ◨
          </button>
        </div>
        <span className="hint">sürükle · tekerlek: zoom · çift tık: sığdır</span>
      </header>

      <div className="body">
        {showLeft ? (
          <aside className="sidebar">
            <div className="panel">
              <div className="lefttabs">
                <button
                  className={leftTab === 'portfolio' ? 'active' : ''}
                  onClick={() => setLeftTab('portfolio')}
                >
                  Portföy{portfolio.length ? ` · ${portfolio.length}` : ''}
                </button>
                <button className={leftTab === 'trades' ? 'active' : ''} onClick={() => setLeftTab('trades')}>
                  İşlemler
                </button>
                <button className="lt-hide" onClick={() => setShowLeft(false)} title="Paneli gizle (geniş grafik)">
                  ⟨
                </button>
              </div>
              {leftTab === 'portfolio' ? (
                <Portfolio
                  holdings={portfolio}
                  quotes={quotes}
                  spark={spark}
                  symbols={symbols}
                  onAdd={(h) => setPortfolio((p) => [...p, h])}
                  onRemove={(i) => setPortfolio((p) => p.filter((_, idx) => idx !== i))}
                  onSelect={selectSymbol}
                  onAnalyze={() => setShowAnalysis(true)}
                />
              ) : (
                <Trades
                  strategy={strategy}
                  candles={candles}
                  onSelectTrade={(t) => {
                    setFocusTrade(t);
                    setLog(true);
                  }}
                />
              )}
            </div>
          </aside>
        ) : (
          <button className="edge-handle left" onClick={() => setShowLeft(true)} title="Portföy / İşlemler göster">
            <span className="edge-ic">›</span>
            <span className="edge-label">Portföy · İşlemler</span>
          </button>
        )}

        <main className="main">
          <div className="symhead">
            <span className="sh-ticker">{provider === 'bist' ? symbol : 'SENTETİK'}</span>
            {company && <span className="sh-name">{company}</span>}
            <span className="spacer" />
            {isFinite(lastC) && (
              <>
                <span className="sh-price">{fp(lastC)}</span>
                <span className={'sh-badge ' + (dChg >= 0 ? 'pos' : 'neg')}>
                  {dChg >= 0 ? '▲' : '▼'} {Math.abs(dChg).toFixed(2)}%
                </span>
              </>
            )}
          </div>
          <div className="chart-wrap">
            {stats && (
              <div className="statsbox">
                <div>
                  <span className="lg-muted">52H</span> {fp(stats.hi52)} / {fp(stats.lo52)}
                </div>
                <div>
                  <span className="lg-muted">1A</span> <span className={stats.r1m >= 0 ? 'up' : 'down'}>{pct(stats.r1m)}</span>{' · '}
                  <span className="lg-muted">3A</span> <span className={stats.r3m >= 0 ? 'up' : 'down'}>{pct(stats.r3m)}</span>{' · '}
                  <span className="lg-muted">1Y</span> <span className={stats.r1y >= 0 ? 'up' : 'down'}>{pct(stats.r1y)}</span>
                </div>
                <div title={`Geçmiş ${stats.years.toFixed(1)} yılın yıllık ortalama bileşik getirisi (CAGR)`}>
                  <span className="lg-muted">Yıllık</span> <span className={stats.cagr >= 0 ? 'up' : 'down'}>{pct(stats.cagr)}</span>{' · '}
                  <span className="lg-muted">Max düşüş</span> <span className="down">-{stats.maxDD.toFixed(0)}%</span>
                </div>
                <div>
                  <span className="lg-muted">Ort.Hac</span> {fv(stats.avgVol)}
                </div>
              </div>
            )}

            {reflectTrades && focusTrade && (
              <div className="tradecard">
                <button className="tradecard-x" onClick={() => setFocusTrade(null)} title="Kapat">×</button>
                <div className="tradecard-row">
                  <span className="up">AL</span> {fmtD(focusTrade.entryTime)} @ {fp(focusTrade.entryPrice)}
                  {'  →  '}
                  {focusTrade.open ? (
                    <span className="lg-muted">açık</span>
                  ) : (
                    <>
                      <span className="down">SAT</span> {fmtD(focusTrade.exitTime as number)} @ {fp(focusTrade.exitPrice)}
                    </>
                  )}
                </div>
                <div className="tradecard-pnl">
                  <b className={focusTrade.retPct >= 0 ? 'up' : 'down'}>
                    {(focusTrade.retPct >= 0 ? '+' : '') + focusTrade.retPct.toFixed(2)}% kâr/zarar
                  </b>
                  <span className="lg-muted">
                    {' · '}
                    {Math.round(((focusTrade.exitTime ?? Date.now() / 1000) - focusTrade.entryTime) / 86400)} gün
                  </span>
                </div>
              </div>
            )}

            {loading && (
              <div className="loading">
                <div className="spinner" />
                <span>{status}</span>
              </div>
            )}

            <Chart
              candles={candles}
              fitOnLoad={fitOnLoad}
              settings={settings}
              symbol={provider === 'bist' ? symbol : 'SENTETİK'}
              tfLabel={tfLabel}
              strategy={reflectTrades ? strategy : null}
              costLine={costLine}
              log={log}
              focus={reflectTrades && focusTrade ? { entryTime: focusTrade.entryTime, exitTime: focusTrade.exitTime } : null}
            />
          </div>
        </main>

        {showRight ? (
          <aside className="sidebar right">
            <Watchlist
              items={watchlist}
              quotes={quotes}
              spark={spark}
              added={watchAdded}
              active={symbol}
              onSelect={selectSymbol}
              onRemove={toggleWatch}
              onHide={() => setShowRight(false)}
            />
          </aside>
        ) : (
          <button className="edge-handle right" onClick={() => setShowRight(true)} title="İzleme Listesi göster">
            <span className="edge-ic">‹</span>
            <span className="edge-label">İzleme Listesi</span>
          </button>
        )}
      </div>

      <footer className="status">
        <span>{provider === 'bist' ? `BIST · ${TF_LABEL[tf]}` : 'Sentetik · stres testi'}</span>
        <span>Mum: {candles ? candles.length.toLocaleString() : 0}</span>
        <span className={error ? 'down' : ''}>{error ? `Hata: ${error}` : status}</span>
      </footer>

      {showBt && candles && (
        <Backtest
          candles={candles}
          symbol={provider === 'bist' ? symbol : 'SENTETİK'}
          onClose={() => setShowBt(false)}
          onSelect={(name) => {
            setStrategy(name);
            setLeftTab('trades');
            setShowLeft(true);
          }}
          onPickSymbolStrategy={(sym, name) => {
            selectSymbol(sym);
            setStrategy(name);
            setLeftTab('trades');
            setShowLeft(true);
          }}
        />
      )}

      {showAnalysis && (
        <PortfolioAnalysis
          holdings={portfolio}
          quotes={quotes}
          onClose={() => setShowAnalysis(false)}
          onSelect={selectSymbol}
        />
      )}
    </div>
  );
}

function pct(v: number): string {
  return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';
}

function fp(v: number): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fv(v: number): string {
  if (!isFinite(v)) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(0);
}

function fmtD(t: number): string {
  return new Date(t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
