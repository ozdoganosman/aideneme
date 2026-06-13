import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, ChartHandle, HoverInfo } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Candles, TIMEFRAMES, BUILTIN_SYMBOLS } from './data/types';
import { generateSynthetic } from './data/synthetic';
import { fetchHistory, fetchSymbols, openKlineStream } from './data/binance';

type Provider = 'synthetic' | 'binance';

const BAR_OPTIONS = [10_000, 50_000, 100_000, 500_000, 1_000_000, 4_000_000];

interface LoadOpts {
  symbol?: string;
  tfIndex?: number;
  provider?: Provider;
  bars?: number;
}

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
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const chartRef = useRef<ChartHandle>(null);
  const candlesRef = useRef<Candles | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (opts?: LoadOpts) => {
      const prov = opts?.provider ?? provider;
      const sym = (opts?.symbol ?? symbol).toUpperCase().trim();
      const tf = opts?.tfIndex ?? tfIndex;
      const n = opts?.bars ?? bars;
      if (!sym) return;

      setLoading(true);
      setError(null);
      setStatus('Yükleniyor…');
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        let c: Candles;
        if (prov === 'synthetic') {
          await new Promise((r) => setTimeout(r, 0)); // let the spinner paint
          c = generateSynthetic(sym, n, TIMEFRAMES[tf].seconds);
        } else {
          c = await fetchHistory(
            sym,
            TIMEFRAMES[tf].binance,
            n,
            (cur, tot) => setStatus(`Yükleniyor ${cur.toLocaleString()}/${tot.toLocaleString()}`),
            ac.signal,
          );
        }
        candlesRef.current = c;
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
    [provider, symbol, tfIndex, bars],
  );

  // Auto-load on startup.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull the full Binance symbol universe for autocomplete when needed.
  useEffect(() => {
    if (provider === 'binance') {
      fetchSymbols().then(setSymbols).catch(() => {/* keep built-in list offline */});
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

  const up = hover ? hover.close >= hover.open : true;
  const chg = hover ? hover.close - hover.open : 0;
  const chgPct = hover && hover.open ? (chg / hover.open) * 100 : 0;

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
          <option value="synthetic">Sentetik</option>
          <option value="binance">Binance</option>
        </select>

        <SymbolSearch value={symbol} symbols={symbols} onChange={setSymbol} onSubmit={(s) => load({ symbol: s })} />

        <div className="seg">
          {TIMEFRAMES.map((tf, i) => (
            <button
              key={tf.label}
              className={i === tfIndex ? 'active' : ''}
              onClick={() => {
                setTfIndex(i);
                void load({ tfIndex: i });
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <select
          className="ctl"
          value={bars}
          title="Mum sayısı"
          onChange={(e) => {
            const n = Number(e.target.value);
            setBars(n);
            void load({ bars: n });
          }}
        >
          {BAR_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} mum
            </option>
          ))}
        </select>

        <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
          ⟳
        </button>

        <label className={'live-toggle' + (live ? ' on' : '')}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <span className="dot" /> Canlı
        </label>

        <span className="spacer" />
        <span className="hint">sürükle: kaydır · tekerlek: zoom · çift tık: sığdır</span>
      </header>

      <div className="chart-wrap">
        {/* Crosshair / live OHLC readout */}
        <div className="legend">
          <div className="legend-top">
            <b>{symbol}</b>
            <span className="muted">{TIMEFRAMES[tfIndex].label}</span>
            {hover && (
              <>
                <span className={up ? 'price up' : 'price down'}>{fmtPrice(hover.close)}</span>
                <span className={up ? 'up' : 'down'}>
                  {chg >= 0 ? '+' : ''}
                  {fmtPrice(chg)} ({chgPct >= 0 ? '+' : ''}
                  {chgPct.toFixed(2)}%)
                </span>
              </>
            )}
          </div>
          {hover && (
            <div className="legend-ohlc">
              <span>A <b>{fmtPrice(hover.open)}</b></span>
              <span>Y <b>{fmtPrice(hover.high)}</b></span>
              <span>D <b>{fmtPrice(hover.low)}</b></span>
              <span>K <b className={up ? 'up' : 'down'}>{fmtPrice(hover.close)}</b></span>
              <span>Hac <b>{fmtVol(hover.volume)}</b></span>
            </div>
          )}
        </div>

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <span>{status}</span>
          </div>
        )}

        <Chart ref={chartRef} candles={candles} onHover={setHover} />
      </div>

      <footer className="status">
        <span>{provider === 'binance' ? 'Binance · canlı veri' : 'Sentetik · offline'}</span>
        <span>Mum: {candles ? candles.length.toLocaleString() : 0}</span>
        <span className={error ? 'down' : ''}>{error ? `Hata: ${error}` : status}</span>
      </footer>
    </div>
  );
}

function fmtPrice(v: number): string {
  if (!isFinite(v)) return '-';
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}
