import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, HoverInfo } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Candles, BIST_SYMBOLS } from './data/types';
import { fetchBistStatic, fetchBistSymbols } from './data/bistStatic';

export default function App() {
  const [symbol, setSymbol] = useState('THYAO');
  const [candles, setCandles] = useState<Candles | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>(BIST_SYMBOLS);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [fitOnLoad, setFitOnLoad] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const firstRef = useRef(true);

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
        const c = await fetchBistStatic(sym, ac.signal);
        // First load frames the latest bars; later loads (symbol switches) keep
        // the current zoom + visible date range.
        setFitOnLoad(firstRef.current);
        firstRef.current = false;
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
    [symbol],
  );

  // Initial load + symbol list.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    fetchBistSymbols()
      .then((s) => setSymbols(s.length ? s : BIST_SYMBOLS))
      .catch(() => setSymbols(BIST_SYMBOLS));
  }, []);

  const up = hover ? hover.close >= hover.open : true;
  const chg = hover ? hover.close - hover.open : 0;
  const chgPct = hover && hover.open ? (chg / hover.open) * 100 : 0;

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">⚡ Borsa · BIST</span>

        <SymbolSearch value={symbol} symbols={symbols} onChange={setSymbol} onSubmit={(s) => load(s)} />

        <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
          ⟳
        </button>

        <span className="spacer" />
        <span className="hint">sürükle: kaydır · tekerlek: zoom · çift tık: sığdır</span>
      </header>

      <div className="chart-wrap">
        <div className="legend">
          <div className="legend-top">
            <b>{symbol}</b>
            <span className="muted">1G</span>
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

        <Chart candles={candles} onHover={setHover} fitOnLoad={fitOnLoad} />
      </div>

      <footer className="status">
        <span>BIST · günlük (statik)</span>
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
