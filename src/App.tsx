import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, IndicatorSettings } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Watchlist } from './components/Watchlist';
import { Portfolio, Holding } from './components/Portfolio';
import { IndicatorMenu } from './components/IndicatorMenu';
import { Candles, BIST_SYMBOLS } from './data/types';
import { fetchBistStatic, fetchBistSymbols, fetchBistQuotes, Quotes } from './data/bistStatic';
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

  const [quotes, setQuotes] = useState<Quotes>({});
  const [watchlist, setWatchlist] = useState<string[]>(() => lsGet('borsaWatch', ['THYAO', 'GARAN', 'ASELS']));
  const [portfolio, setPortfolio] = useState<Holding[]>(() => lsGet('borsaPortfolio', []));
  const [settings, setSettings] = useState<IndicatorSettings>(() =>
    lsGet('borsaIndicators', { ema: true, volume: true, williams: true, macd: true }),
  );

  const abortRef = useRef<AbortController | null>(null);
  const dailyRef = useRef<Candles | null>(null);
  const firstRef = useRef(true);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => localStorage.setItem('borsaWatch', JSON.stringify(watchlist)), [watchlist]);
  useEffect(() => localStorage.setItem('borsaPortfolio', JSON.stringify(portfolio)), [portfolio]);
  useEffect(() => localStorage.setItem('borsaIndicators', JSON.stringify(settings)), [settings]);

  const load = useCallback(
    async (opts?: { provider?: Provider; symbol?: string; tf?: TF }) => {
      const prov = opts?.provider ?? provider;
      const sym = (opts?.symbol ?? symbol).toUpperCase().trim();
      const tframe = opts?.tf ?? tf;
      if (prov === 'bist' && !sym) return;

      setLoading(true);
      setError(null);
      setStatus('Yükleniyor…');
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
  const toggleWatch = (s: string) =>
    setWatchlist((w) => (w.includes(s) ? w.filter((x) => x !== s) : [s, ...w]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    fetchBistSymbols()
      .then((s) => setSymbols(s.length ? s : BIST_SYMBOLS))
      .catch(() => setSymbols(BIST_SYMBOLS));
    fetchBistQuotes().then(setQuotes).catch(() => setQuotes({}));
  }, []);

  const tfLabel = provider === 'synthetic' ? 'SİM' : tf === 'D' ? '1G' : tf === 'W' ? '1H' : '1A';
  const starred = watchlist.includes(symbol);

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

        <IndicatorMenu settings={settings} onChange={setSettings} />

        <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
          ⟳
        </button>

        <span className="spacer" />
        <span className="hint">sürükle · tekerlek: zoom · çift tık: sığdır</span>
      </header>

      <div className="body">
        <aside className="sidebar">
          <Watchlist items={watchlist} quotes={quotes} active={symbol} onSelect={selectSymbol} onRemove={toggleWatch} />
          <Portfolio
            holdings={portfolio}
            quotes={quotes}
            symbols={symbols}
            onAdd={(h) => setPortfolio((p) => [...p, h])}
            onRemove={(i) => setPortfolio((p) => p.filter((_, idx) => idx !== i))}
            onSelect={selectSymbol}
          />
        </aside>

        <main className="main">
          <div className="chart-wrap">
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
            />
          </div>
        </main>
      </div>

      <footer className="status">
        <span>{provider === 'bist' ? `BIST · ${TF_LABEL[tf]}` : 'Sentetik · stres testi'}</span>
        <span>Mum: {candles ? candles.length.toLocaleString() : 0}</span>
        <span className={error ? 'down' : ''}>{error ? `Hata: ${error}` : status}</span>
      </footer>
    </div>
  );
}
