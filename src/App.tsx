import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type PointerEvent as RPointerEvent } from 'react';
import { Chart, IndicatorSettings } from './components/Chart';
import { IndicatorParams, DEFAULT_PARAMS } from './indicators/calc';
import { SymbolSearch } from './components/SymbolSearch';
import { Watchlist } from './components/Watchlist';
import { Portfolio, Holding, Txn, deriveLedger } from './components/Portfolio';
import { IndicatorMenu } from './components/IndicatorMenu';
import { Trades } from './components/Trades';
// Heavy, on-demand modals → split into their own chunks (faster first load).
const Backtest = lazy(() => import('./components/Backtest').then((m) => ({ default: m.Backtest })));
const PortfolioAnalysis = lazy(() => import('./components/PortfolioAnalysis').then((m) => ({ default: m.PortfolioAnalysis })));
const Screener = lazy(() => import('./components/Screener').then((m) => ({ default: m.Screener })));
const HeatMap = lazy(() => import('./components/HeatMap').then((m) => ({ default: m.HeatMap })));
import { computeStats } from './indicators/stats';
import { registerCustomStrategy, type Trade } from './indicators/backtest';
import { CustomStrategy, buildCustomPosition } from './indicators/customStrategy';
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

// Phone-sized viewport (narrow OR short, e.g. landscape) → use the mobile layout.
function isNarrow(): boolean {
  return typeof window !== 'undefined' && (window.innerWidth < 760 || window.innerHeight < 540);
}

// Multiple named watchlists. Migrates the old single 'borsaWatch' list on first run.
interface WatchList {
  id: string;
  name: string;
  items: string[];
}
function loadLists(): { lists: WatchList[]; activeId: string } {
  try {
    const lists = JSON.parse(localStorage.getItem('borsaWatchLists') || 'null') as WatchList[] | null;
    if (Array.isArray(lists) && lists.length) {
      const saved = localStorage.getItem('borsaActiveList') || '';
      return { lists, activeId: lists.some((l) => l.id === saved) ? saved : lists[0].id };
    }
  } catch {
    /* fall through to migration */
  }
  let items = ['THYAO', 'GARAN', 'ASELS'];
  try {
    const old = JSON.parse(localStorage.getItem('borsaWatch') || 'null');
    if (Array.isArray(old) && old.length) items = old;
  } catch {
    /* keep defaults */
  }
  return { lists: [{ id: 'default', name: 'Takip', items }], activeId: 'default' };
}

// Drag the bottom sheet down by its grab handle; release past a threshold closes.
function dragSheet(e: RPointerEvent<HTMLElement>, close: () => void): void {
  const sheet = e.currentTarget.closest('.sidebar') as HTMLElement | null;
  if (!sheet) return;
  const startY = e.clientY;
  let dy = 0;
  const move = (ev: globalThis.PointerEvent) => {
    dy = Math.max(0, ev.clientY - startY);
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const up = (ev?: globalThis.PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    sheet.style.transition = '';
    sheet.style.transform = '';
    // Don't close on pointercancel (gesture interrupted), only on a real release.
    if (dy > 90 && ev?.type !== 'pointercancel') close();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
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
  const [showScreener, setShowScreener] = useState(false);
  const [showHeat, setShowHeat] = useState(false);
  const [tbMenu, setTbMenu] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [log, setLog] = useState<boolean>(() => lsGet('borsaLog', false));
  const [focusTrade, setFocusTrade] = useState<Trade | null>(null);
  const [leftTab, setLeftTab] = useState<'portfolio' | 'trades'>(() => lsGet('borsaLeftTab', 'portfolio'));
  const wide0 = !isNarrow();
  const [showLeft, setShowLeft] = useState<boolean>(() => lsGet('borsaShowLeft', wide0));
  const [showRight, setShowRight] = useState<boolean>(() => lsGet('borsaShowRight', wide0));

  const [quotes, setQuotes] = useState<Quotes>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const initLists = useMemo(() => loadLists(), []);
  const [lists, setLists] = useState<WatchList[]>(initLists.lists);
  const [activeListId, setActiveListId] = useState<string>(initLists.activeId);
  const activeList = lists.find((l) => l.id === activeListId) ?? lists[0];
  const watchlist = activeList ? activeList.items : [];
  // Update the ACTIVE list's items (keeps every existing setWatchlist call site
  // working). Writes target the SAME list the UI reads (activeList), so a stale
  // activeListId can't make updates silently no-op.
  const setWatchlist = (updater: string[] | ((w: string[]) => string[])) =>
    setLists((ls) => ls.map((l) => (l.id === activeList?.id ? { ...l, items: typeof updater === 'function' ? updater(l.items) : updater } : l)));
  const [watchAdded, setWatchAdded] = useState<Record<string, { t: number; p: number }>>(() =>
    lsGet('borsaWatchAdded', {}),
  );
  // Portfolio is a transaction ledger (source of truth); open positions + closed
  // trades + realized P&L are derived from it.
  const [txns, setTxns] = useState<Txn[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('borsaTxns') || 'null');
      if (Array.isArray(raw)) return raw as Txn[];
    } catch {
      /* ignore */
    }
    try {
      const old = JSON.parse(localStorage.getItem('borsaPortfolio') || 'null'); // migrate legacy holdings
      if (Array.isArray(old))
        return old.map((h: Holding, i: number) => ({ id: 'mig' + i, t: Math.floor(Date.now() / 1000), symbol: h.symbol, side: 'buy' as const, qty: h.qty, price: h.cost }));
    } catch {
      /* ignore */
    }
    return [];
  });
  const ledger = useMemo(() => deriveLedger(txns), [txns]);
  const portfolio = ledger.open;
  const [customStrats, setCustomStrats] = useState<CustomStrategy[]>(() => lsGet('borsaStrats', []));
  const [settings, setSettings] = useState<IndicatorSettings>(() =>
    lsGet('borsaIndicators', { ema: true, volume: true, williams: true, macd: true, adx: false, roc: false, volprofile: false }),
  );
  const [indParams, setIndParams] = useState<IndicatorParams>(() => migrateIndParams({ ...DEFAULT_PARAMS, ...lsGet('borsaIndParams', {}) }));

  const abortRef = useRef<AbortController | null>(null);
  const dailyRef = useRef<Candles | null>(null);
  const firstRef = useRef(true);
  const loadingRef = useRef(false); // true while a load is in flight (for changeTf)
  const tfRef = useRef(tf); // latest timeframe, read at load-resolve time (avoids stale capture)
  tfRef.current = tf;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => localStorage.setItem('borsaWatchLists', JSON.stringify(lists)), [lists]);
  useEffect(() => localStorage.setItem('borsaActiveList', activeListId), [activeListId]);
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
  useEffect(() => localStorage.setItem('borsaTxns', JSON.stringify(txns)), [txns]);
  useEffect(() => localStorage.setItem('borsaStrats', JSON.stringify(customStrats)), [customStrats]);
  // Register custom strategies so the chart/trades can draw them by name (using
  // the user's indicator periods for MACD etc.). Done during render (not in an
  // effect) so the registry is current BEFORE the child Chart's effects read it
  // — child effects fire before the parent's, so an effect here would be too late.
  useMemo(() => {
    customStrats.forEach((s) => registerCustomStrategy({ name: s.name, build: (c) => buildCustomPosition(c, s, undefined, indParams) }));
  }, [customStrats, indParams]);
  useEffect(() => localStorage.setItem('borsaIndicators', JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem('borsaIndParams', JSON.stringify(indParams)), [indParams]);
  useEffect(() => localStorage.setItem('borsaLog', JSON.stringify(log)), [log]);
  useEffect(() => localStorage.setItem('borsaLeftTab', JSON.stringify(leftTab)), [leftTab]);
  useEffect(() => localStorage.setItem('borsaShowLeft', JSON.stringify(showLeft)), [showLeft]);
  useEffect(() => localStorage.setItem('borsaShowRight', JSON.stringify(showRight)), [showRight]);

  const load = useCallback(
    async (opts?: { provider?: Provider; symbol?: string; tf?: TF }) => {
      const prov = opts?.provider ?? provider;
      const sym = (opts?.symbol ?? symbol).toUpperCase().trim();
      if (prov === 'bist' && !sym) return;

      setLoading(true);
      loadingRef.current = true;
      setError(null);
      setStatus('Yükleniyor…');
      setFocusTrade(null);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let c: Candles;
        let key: string;
        if (prov === 'synthetic') {
          await new Promise((r) => setTimeout(r, 0));
          if (ac.signal.aborted) return; // a newer load superseded this one
          c = generateSynthetic(sym || 'SYNTH', SYNTH_BARS, 60);
          dailyRef.current = null;
          key = 'synthetic';
        } else {
          const daily = await fetchBistStatic(sym, ac.signal);
          if (ac.signal.aborted) return;
          dailyRef.current = daily;
          const tframe = opts?.tf ?? tfRef.current; // latest tf at resolve time
          c = resample(daily, tframe);
          key = `bist|${tframe}`;
        }
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
        // Only the still-current load resets the flags (an aborted/superseded
        // load must not flip loading off while a newer one is running).
        if (abortRef.current === ac) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [provider, symbol],
  );

  const changeTf = (newTf: TF) => {
    setTf(newTf);
    setFocusTrade(null);
    if (provider !== 'bist' || !dailyRef.current) return;
    // A symbol load is in flight → don't resample the PREVIOUS symbol's daily;
    // the in-flight load resolves with the new symbol at the latest tf (tfRef).
    if (loadingRef.current) return;
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
    // On mobile the sidebars are slide-over drawers — close them after picking.
    if (isNarrow()) {
      setShowLeft(false);
      setShowRight(false);
    }
  };
  // On mobile the panels are bottom sheets — only one open at a time.
  const toggleLeft = () => {
    const nv = !showLeft;
    setShowLeft(nv);
    if (nv && isNarrow()) setShowRight(false);
  };
  const toggleRight = () => {
    const nv = !showRight;
    setShowRight(nv);
    if (nv && isNarrow()) setShowLeft(false);
  };
  const addToWatch = (syms: string[], mode: 'add' | 'new') => {
    const uniq = Array.from(new Set(syms));
    if (!uniq.length) return;
    if (mode === 'new') {
      // Genuinely create a new named list from the scan results and switch to it.
      const name = (window.prompt('Yeni liste adı:', `Tarama ${lists.length}`) || '').trim();
      if (!name) return;
      const id = String(Date.now());
      setLists((ls) => [...ls, { id, name, items: uniq }]);
      setActiveListId(id);
      setShowRight(true); // reveal the watchlist so the new list is visible
    } else {
      setWatchlist((w) => Array.from(new Set([...uniq, ...w])));
    }
  };
  const toggleWatch = (s: string) => {
    if (watchlist.includes(s)) {
      setWatchlist((w) => w.filter((x) => x !== s));
      // Drop the "tracked since" baseline only if it isn't kept in another list.
      const elsewhere = lists.some((l) => l.id !== activeListId && l.items.includes(s));
      if (!elsewhere)
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

  // ── Watchlist management ───────────────────────────────────────────────────
  const addList = () => {
    const name = (window.prompt('Yeni liste adı:', `Liste ${lists.length + 1}`) || '').trim();
    if (!name) return;
    const id = String(Date.now());
    setLists((ls) => [...ls, { id, name, items: [] }]);
    setActiveListId(id);
  };
  const renameList = (id: string) => {
    const cur = lists.find((l) => l.id === id);
    const name = (window.prompt('Liste adı:', cur?.name || '') || '').trim();
    if (name) setLists((ls) => ls.map((l) => (l.id === id ? { ...l, name } : l)));
  };
  const deleteList = (id: string) => {
    if (lists.length <= 1) return;
    const cur = lists.find((l) => l.id === id);
    if (!window.confirm(`"${cur?.name}" listesi silinsin mi?`)) return;
    const next = lists.filter((l) => l.id !== id);
    setLists(next);
    if (activeListId === id) setActiveListId(next[0].id);
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

  useEffect(() => {
    if (showBt || showScreener || showAnalysis || showHeat) setTbMenu(false);
  }, [showBt, showScreener, showAnalysis, showHeat]);

  const tfLabel = provider === 'synthetic' ? 'SİM' : tf === 'D' ? '1G' : tf === 'W' ? '1H' : '1A';
  const starred = watchlist.includes(symbol);
  const stats = useMemo(() => computeStats(candles), [candles]);

  // Bounded universe for the custom-strategy "En İyi 20" client-side scan.
  const universe = useMemo(() => {
    const core = [
      'THYAO', 'GARAN', 'AKBNK', 'ASELS', 'KCHOL', 'SISE', 'EREGL', 'BIMAS', 'SAHOL', 'TUPRS',
      'FROTO', 'PGSUS', 'TCELL', 'ISCTR', 'YKBNK', 'KOZAL', 'KOZAA', 'SASA', 'HEKTS', 'TOASO',
      'TTKOM', 'PETKM', 'ENKAI', 'KRDMD', 'VESTL', 'GUBRF', 'ARCLK', 'OYAKC', 'TAVHL', 'DOHOL',
      'EKGYO', 'ALARK', 'MGROS', 'ULKER', 'SOKM', 'TKFEN', 'AEFES', 'BRSAN', 'KONTR', 'SMRTG',
    ];
    return Array.from(new Set([...watchlist, ...portfolio.map((h) => h.symbol), ...core])).slice(0, 80);
  }, [watchlist, portfolio]);

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

  // Fallback shown while a lazy-loaded modal chunk downloads.
  const modalLoader = (
    <div className="modal-backdrop">
      <div className="modal modal-loader">
        <div className="bt-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="spinner" /> Yükleniyor…
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="toolbar">
        <button className="menu-btn ctl" onClick={() => setTbMenu((v) => !v)} title="Menü">
          ☰
        </button>
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

        {provider === 'bist' && (
          <>
            <SymbolSearch value={symbol} symbols={symbols} onChange={setSymbol} onSubmit={(s) => load({ symbol: s })} />
            <button
              className={'ctl star' + (starred ? ' on' : '')}
              title={starred ? 'İzlemeden çıkar' : 'İzlemeye ekle'}
              onClick={() => toggleWatch(symbol)}
            >
              {starred ? '★' : '☆'}
            </button>
            {isFinite(lastC) && (
              <span className="tb-quote" title={company}>
                <span className="tb-price">{fp(lastC)}</span>
                <span className={'tb-badge ' + (dChg >= 0 ? 'pos' : 'neg')}>
                  {dChg >= 0 ? '▲' : '▼'} {Math.abs(dChg).toFixed(2)}%
                </span>
              </span>
            )}
          </>
        )}

        <div className={'tb-menu' + (tbMenu ? ' open' : '')}>
          {provider === 'bist' ? (
            <div className="seg">
              {(['D', 'W', 'M'] as TF[]).map((t) => (
                <button key={t} className={t === tf ? 'active' : ''} onClick={() => changeTf(t)}>
                  {t === 'D' ? '1G' : t === 'W' ? '1H' : '1A'}
                </button>
              ))}
            </div>
          ) : (
            <span className="hint">4.000.000 mum (maks)</span>
          )}

          <IndicatorMenu settings={settings} onChange={setSettings} params={indParams} onParams={setIndParams} />

          <button className={'ctl' + (log ? ' on' : '')} onClick={() => setLog((v) => !v)} title="Logaritmik fiyat ölçeği">
            Log
          </button>
          <button className="ctl primary" onClick={() => setShowBt(true)} disabled={!candles} title="Strateji taraması (backtest)">
            Strateji
          </button>
          <button className="ctl" onClick={() => setShowScreener(true)} title="Hisse tarama (filtreler)">
            Tara
          </button>
          <button className="ctl" onClick={() => setShowHeat(true)} title="Piyasa ısı haritası (treemap)">
            Isı
          </button>
          <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
            <span className={loading ? 'spinning' : ''}>⟳</span>
          </button>
          {strategy && (
            <span className="chip">
              <span className="chip-name">{strategy}</span>
              <button onClick={() => setStrategy(null)} title="İşaretleri kaldır">×</button>
            </span>
          )}
        </div>

        <span className="spacer" />
        <div className="tb-group">
          <button
            className={'ctl tgl' + (showLeft ? ' on' : '')}
            onClick={toggleLeft}
            title="Sol panel (Portföy / İşlemler) — kısayol ["
          >
            ◧
          </button>
          <button
            className={'ctl tgl' + (showRight ? ' on' : '')}
            onClick={toggleRight}
            title="Sağ panel (İzleme Listesi) — kısayol ]"
          >
            ◨
          </button>
        </div>
      </header>

      {tbMenu && <div className="tb-menu-backdrop" onClick={() => setTbMenu(false)} />}

      <div className="body">
        {showLeft ? (
          <aside className="sidebar">
            <div className="sheet-grab" onPointerDown={(e) => dragSheet(e, () => setShowLeft(false))} />
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
                  txns={txns}
                  positions={portfolio}
                  closed={ledger.closed}
                  realized={ledger.realized}
                  quotes={quotes}
                  spark={spark}
                  symbols={symbols}
                  onAddTxn={(t) => setTxns((x) => [...x, t])}
                  onRemoveTxn={(id) => setTxns((x) => x.filter((t) => t.id !== id))}
                  onSelect={selectSymbol}
                  onAnalyze={() => setShowAnalysis(true)}
                  onImport={(h) =>
                    setTxns(h.map((x, i) => ({ id: 'imp' + Date.now().toString(36) + i, t: Math.floor(Date.now() / 1000), symbol: x.symbol, side: 'buy' as const, qty: x.qty, price: x.cost })))
                  }
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
          {stats && (
            <div className="symstats">
              <span>
                <span className="lg-muted">52H</span> {fp(stats.hi52)} / {fp(stats.lo52)}
              </span>
              <span>
                <span className="lg-muted">1A</span> <span className={stats.r1m >= 0 ? 'up' : 'down'}>{pct(stats.r1m)}</span>
              </span>
              <span>
                <span className="lg-muted">3A</span> <span className={stats.r3m >= 0 ? 'up' : 'down'}>{pct(stats.r3m)}</span>
              </span>
              <span>
                <span className="lg-muted">1Y</span> <span className={stats.r1y >= 0 ? 'up' : 'down'}>{pct(stats.r1y)}</span>
              </span>
              <span title={`Geçmiş ${stats.years.toFixed(1)} yılın yıllık ortalama bileşik getirisi (CAGR)`}>
                <span className="lg-muted">Yıllık</span> <span className={stats.cagr >= 0 ? 'up' : 'down'}>{pct(stats.cagr)}</span>
              </span>
              <span>
                <span className="lg-muted">Max düşüş</span> <span className="down">-{stats.maxDD.toFixed(0)}%</span>
              </span>
              <span>
                <span className="lg-muted">Ort.Hac</span> {fv(stats.avgVol)}
              </span>
            </div>
          )}
          <div className="chart-wrap">
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

            {error && !loading && (
              <div className="chart-error" role="alert">
                <div className="chart-error-box">
                  <span>⚠️ {error}</span>
                  <button className="ctl primary" onClick={() => load()}>Tekrar dene</button>
                </div>
              </div>
            )}

            <Chart
              candles={candles}
              fitOnLoad={fitOnLoad}
              settings={settings}
              params={indParams}
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
            <div className="sheet-grab" onPointerDown={(e) => dragSheet(e, () => setShowRight(false))} />
            <div className="wl-tabs" role="tablist">
              {lists.map((l) => (
                <button
                  key={l.id}
                  className={'wl-tab' + (l.id === activeListId ? ' active' : '')}
                  onClick={() => setActiveListId(l.id)}
                  onDoubleClick={() => renameList(l.id)}
                  title="Tıkla: seç · çift tıkla: yeniden adlandır"
                >
                  {l.name} <span className="wl-tab-n">{l.items.length}</span>
                  {l.id === activeListId && lists.length > 1 && (
                    <span
                      className="wl-tab-x"
                      role="button"
                      title="Listeyi sil"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteList(l.id);
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
              <button className="wl-tab wl-tab-add" onClick={addList} title="Yeni liste">
                ＋
              </button>
            </div>
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

        {(showLeft || showRight) && (
          <div
            className="drawer-backdrop"
            onClick={() => {
              setShowLeft(false);
              setShowRight(false);
            }}
          />
        )}
      </div>

      <footer className="status">
        <span>{provider === 'bist' ? `BIST · ${TF_LABEL[tf]}` : 'Sentetik · stres testi'}</span>
        <span>Mum: {candles ? candles.length.toLocaleString() : 0}</span>
        <span className="lg-muted">sürükle · tekerlek: zoom · çift tık: sığdır</span>
        <span className={error ? 'down' : ''}>{error ? `Hata: ${error}` : status}</span>
      </footer>

      <nav className="mobilebar">
        <button className={showLeft ? 'active' : ''} onClick={toggleLeft}>
          📊 Portföy / İşlemler
        </button>
        <button className={showRight ? 'active' : ''} onClick={toggleRight}>
          ⭐ Favoriler
        </button>
      </nav>

      {showBt && candles && (
        <Suspense fallback={modalLoader}>
        <Backtest
          candles={candles}
          symbol={provider === 'bist' ? symbol : 'SENTETİK'}
          universe={universe}
          strats={customStrats}
          params={indParams}
          onSave={setCustomStrats}
          onApply={(s) => {
            registerCustomStrategy({ name: s.name, build: (c) => buildCustomPosition(c, s, undefined, indParams) });
            setStrategy(s.name);
            setLeftTab('trades');
            setShowLeft(true);
            setShowBt(false);
          }}
          onPickCombo={(sym, s) => {
            registerCustomStrategy({ name: s.name, build: (c) => buildCustomPosition(c, s, undefined, indParams) });
            selectSymbol(sym);
            setStrategy(s.name);
            setLeftTab('trades');
            setShowLeft(true);
            setShowBt(false);
          }}
          onClose={() => setShowBt(false)}
        />
        </Suspense>
      )}

      {showAnalysis && (
        <Suspense fallback={modalLoader}>
          <PortfolioAnalysis
            holdings={portfolio}
            quotes={quotes}
            strats={customStrats}
            params={indParams}
            onClose={() => setShowAnalysis(false)}
            onSelect={selectSymbol}
          />
        </Suspense>
      )}

      {showScreener && (
        <Suspense fallback={modalLoader}>
          <Screener onClose={() => setShowScreener(false)} onSelect={selectSymbol} onAddToWatch={addToWatch} params={indParams} />
        </Suspense>
      )}

      {showHeat && (
        <Suspense fallback={modalLoader}>
          <HeatMap onClose={() => setShowHeat(false)} onSelect={selectSymbol} />
        </Suspense>
      )}
    </div>
  );
}

function pct(v: number): string {
  return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';
}

// One-time: adopt the long-period ADX defaults (ADX 260 / EMA 120, per the
// 260-day paradigm) for users whose saved settings still carry old short values.
// Runs once (version flag), then respects whatever the user sets afterwards.
function migrateIndParams(p: IndicatorParams): IndicatorParams {
  if (lsGet('borsaIndParamsV', 0) < 2) {
    try {
      localStorage.setItem('borsaIndParamsV', '2');
    } catch {
      /* ignore */
    }
    return { ...p, adx: DEFAULT_PARAMS.adx, adxEma: DEFAULT_PARAMS.adxEma };
  }
  return p;
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
