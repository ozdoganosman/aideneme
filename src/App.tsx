import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, HoverInfo } from './components/Chart';
import { SymbolSearch } from './components/SymbolSearch';
import { Candles, BIST_SYMBOLS } from './data/types';
import { fetchBistStatic, fetchBistSymbols } from './data/bistStatic';
import { generateSynthetic } from './data/synthetic';
import { resample, TF } from './data/resample';

type Provider = 'bist' | 'synthetic';

const SYNTH_BARS = 4_000_000; // sabit maksimum (seçilemez)

const TF_LABEL: Record<TF, string> = { D: 'Günlük', W: 'Haftalık', M: 'Aylık' };

export default function App() {
  const [provider, setProvider] = useState<Provider>('bist');
  const [symbol, setSymbol] = useState('THYAO');
  const [tf, setTf] = useState<TF>('D');
  const [candles, setCandles] = useState<Candles | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>(BIST_SYMBOLS);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [fitOnLoad, setFitOnLoad] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const dailyRef = useRef<Candles | null>(null); // cached daily BIST for resampling
  const firstRef = useRef(true);
  const lastKeyRef = useRef<string | null>(null);

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
          await new Promise((r) => setTimeout(r, 0)); // let the spinner paint
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

  // Switch BIST timeframe without re-fetching: resample the cached daily data.
  const changeTf = (newTf: TF) => {
    setTf(newTf);
    if (provider !== 'bist' || !dailyRef.current) return;
    const c = resample(dailyRef.current, newTf);
    setFitOnLoad(true);
    lastKeyRef.current = `bist|${newTf}`;
    setCandles(c);
    setStatus(`${c.length.toLocaleString()} mum`);
  };

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
  const tfLabel = provider === 'synthetic' ? 'SİM' : tf === 'D' ? '1G' : tf === 'W' ? '1H' : '1A';

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

        <button className="ctl" onClick={() => load()} disabled={loading} title="Yeniden yükle">
          ⟳
        </button>

        <span className="spacer" />
        <span className="hint">sürükle: kaydır · tekerlek: zoom · çift tık: sığdır</span>
      </header>

      <div className="chart-wrap">
        <div className="legend">
          <div className="legend-top">
            <b>{provider === 'bist' ? symbol : 'SENTETİK'}</b>
            <span className="muted">{tfLabel}</span>
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
        <span>{provider === 'bist' ? `BIST · ${TF_LABEL[tf]}` : 'Sentetik · stres testi'}</span>
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
