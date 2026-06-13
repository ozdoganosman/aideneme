import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, ChartHandle } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Candles, TIMEFRAMES, BUILTIN_SYMBOLS } from './data/types';
import { generateSynthetic } from './data/synthetic';
import { fetchHistory, fetchSymbols, openKlineStream } from './data/binance';

type Provider = 'synthetic' | 'binance';

const BAR_OPTIONS = [10_000, 50_000, 100_000, 500_000, 1_000_000, 4_000_000];

export default function App() {
  const [provider, setProvider] = useState<Provider>('synthetic');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tfIndex, setTfIndex] = useState(0);
  const [bars, setBars] = useState(100_000);
  const [candles, setCandles] = useState<Candles | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [symbols, setSymbols] = useState<string[]>(BUILTIN_SYMBOLS);

  const chartRef = useRef<ChartHandle>(null);
  const candlesRef = useRef<Candles | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (symbolOverride?: string) => {
      const sym = (symbolOverride ?? symbol).toUpperCase().trim();
      if (!sym) return;
      setLoading(true);
      setError(null);
      setStatus('Yükleniyor…');
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let c: Candles;
        if (provider === 'synthetic') {
          await new Promise((r) => setTimeout(r, 0)); // let the UI paint first
          c = generateSynthetic(sym, bars, TIMEFRAMES[tfIndex].seconds);
        } else {
          c = await fetchHistory(
            sym,
            TIMEFRAMES[tfIndex].binance,
            bars,
            (cur, tot) => setStatus(`Yükleniyor ${cur.toLocaleString()}/${tot.toLocaleString()}`),
            ac.signal,
          );
        }
        candlesRef.current = c;
        setCandles(c);
        setStatus(`Yüklendi: ${c.length.toLocaleString()} mum`);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setError((e as Error)?.message ?? String(e));
        setStatus('Hata');
      } finally {
        setLoading(false);
      }
    },
    [provider, symbol, tfIndex, bars],
  );

  // Auto-load on startup so the chart isn't empty.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull the full Binance symbol universe for autocomplete when needed.
  useEffect(() => {
    if (provider === 'binance') {
      fetchSymbols()
        .then(setSymbols)
        .catch(() => {/* keep built-in list offline */});
    }
  }, [provider]);

  // Live feed: WebSocket for Binance, simulated ticks for synthetic.
  useEffect(() => {
    if (!live) return;
    const tf = TIMEFRAMES[tfIndex];
    if (provider === 'binance') {
      return openKlineStream(symbol, tf.binance, (b) => chartRef.current?.updateLast(b));
    }
    const c = candlesRef.current;
    let last = c && c.length > 0 ? c.close[c.length - 1] : 100;
    const id = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const t = now - (now % tf.seconds);
      const close = last * Math.exp(0.001 * (Math.random() * 2 - 1));
      chartRef.current?.updateLast({
        time: t,
        open: last,
        high: Math.max(last, close),
        low: Math.min(last, close),
        close,
        volume: Math.random() * 500,
        closed: false,
      });
      last = close;
    }, 1000);
    return () => clearInterval(id);
  }, [live, provider, symbol, tfIndex]);

  return (
    <div className="app">
      <div className="toolbar">
        <label>Kaynak</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          <option value="synthetic">Sentetik (offline)</option>
          <option value="binance">Binance (canlı)</option>
        </select>

        <SymbolSearch value={symbol} symbols={symbols} onChange={setSymbol} onSubmit={(s) => load(s)} />

        <label>Periyot</label>
        <select value={tfIndex} onChange={(e) => setTfIndex(Number(e.target.value))}>
          {TIMEFRAMES.map((tf, i) => (
            <option key={tf.label} value={i}>
              {tf.label}
            </option>
          ))}
        </select>

        <label>Mum</label>
        <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
          {BAR_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </select>

        <button className="accent" onClick={() => load()} disabled={loading}>
          {loading ? 'Yükleniyor…' : 'Yükle'}
        </button>

        <label style={{ marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            style={{ verticalAlign: 'middle', marginRight: 4 }}
          />
          Canlı
        </label>

        <span className="spacer" />
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          sürükle: kaydır · tekerlek: zoom · çift tık: sığdır
        </span>
      </div>

      <div className="chart-wrap">
        <Chart ref={chartRef} candles={candles} />
      </div>

      <div className="status">
        <span>{provider === 'binance' ? 'Binance' : 'Sentetik'} · {symbol} · {TIMEFRAMES[tfIndex].label}</span>
        <span>Mum: {candles ? candles.length.toLocaleString() : 0}</span>
        <span style={{ color: error ? '#ef5350' : '#8b90a0' }}>{error ? `Hata: ${error}` : status}</span>
      </div>
    </div>
  );
}
