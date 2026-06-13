import { useEffect, useState } from 'react';
import { Candles } from '../data/types';
import { optimize, StrategyResult } from '../indicators/backtest';
import { fetchStrategies, StrategiesFile } from '../data/bistStatic';

interface Props {
  candles: Candles;
  symbol: string;
  onClose: () => void;
  onSelect: (name: string) => void;
}

export function Backtest({ candles, symbol, onClose, onSelect }: Props) {
  const pick = (name: string) => {
    onSelect(name);
    onClose();
  };
  const [data, setData] = useState<{ results: StrategyResult[]; holdPct: number } | null>(null);
  const [market, setMarket] = useState<StrategiesFile | null>(null);
  const [marketLoaded, setMarketLoaded] = useState(false);

  useEffect(() => {
    setData(null);
    const t = setTimeout(() => setData(optimize(candles)), 20);
    return () => clearTimeout(t);
  }, [candles]);

  useEffect(() => {
    fetchStrategies()
      .then(setMarket)
      .catch(() => setMarket(null))
      .finally(() => setMarketLoaded(true));
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Strateji Taraması</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>

        <div className="modal-body">
          {/* Market-wide — the broad research across all BIST symbols */}
          <div className="bt-section-title">📊 Piyasa Geneli {market ? `(${market.nSymbols} hisse)` : ''}</div>
          {!marketLoaded ? (
            <div className="bt-note">Yükleniyor…</div>
          ) : !market || market.results.length === 0 ? (
            <div className="bt-note">
              Piyasa geneli sonuç henüz hazır değil (CI bir sonraki dağıtımda üretecek).
            </div>
          ) : (
            <>
              <div className="bt-note">
                Tüm BIST'te geçmiş günlük veride ortalama. Al-Tut ort.:{' '}
                <b className={market.holdAvg >= 0 ? 'up' : 'down'}>{pct(market.holdAvg)}</b>
              </div>
              <table className="bt-table">
                <thead>
                  <tr>
                    <th>Strateji</th>
                    <th>Ort. Getiri</th>
                    <th>Medyan</th>
                    <th>Al-Tut'u geçti</th>
                    <th>Ort. Kazanma</th>
                    <th>Ort. DD</th>
                  </tr>
                </thead>
                <tbody>
                  {market.results.slice(0, 12).map((r, i) => (
                    <tr key={r.name} className={'clickable' + (i === 0 ? ' best' : '')} onClick={() => pick(r.name)} title="Grafikte göster">
                      <td>{r.name}</td>
                      <td className={r.avgRet >= 0 ? 'up' : 'down'}>{pct(r.avgRet)}</td>
                      <td className={r.medRet >= 0 ? 'up' : 'down'}>{pct(r.medRet)}</td>
                      <td>{r.beatPct.toFixed(0)}%</td>
                      <td>{r.avgWin.toFixed(0)}%</td>
                      <td className="down">-{r.avgDD.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Current symbol */}
          <div className="bt-section-title" style={{ marginTop: 14 }}>📈 {symbol} (bu hisse)</div>
          {!data ? (
            <div className="bt-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="spinner" /> Hesaplanıyor…
            </div>
          ) : (
            <>
              <div className="bt-note">
                {data.results.length} strateji denendi. Al-Tut:{' '}
                <b className={data.holdPct >= 0 ? 'up' : 'down'}>{pct(data.holdPct)}</b>
              </div>
              <table className="bt-table">
                <thead>
                  <tr>
                    <th>Strateji</th>
                    <th>Getiri</th>
                    <th>Al-Tut'a fark</th>
                    <th>İşlem</th>
                    <th>Kazanma</th>
                    <th>Max DD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.slice(0, 12).map((r, i) => (
                    <tr key={r.name} className={'clickable' + (i === 0 ? ' best' : '')} onClick={() => pick(r.name)} title="Grafikte göster">
                      <td>{r.name}</td>
                      <td className={r.retPct >= 0 ? 'up' : 'down'}>{pct(r.retPct)}</td>
                      <td className={r.retPct - r.holdPct >= 0 ? 'up' : 'down'}>{pct(r.retPct - r.holdPct)}</td>
                      <td>{r.trades}</td>
                      <td>{r.winRate.toFixed(0)}%</td>
                      <td className="down">-{r.maxDD.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="bt-note" style={{ marginTop: 8 }}>
            ⚠️ Geçmişe dönük (in-sample); geçmiş performans geleceği garanti etmez.
          </div>
        </div>
      </div>
    </div>
  );
}

function pct(v: number): string {
  return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';
}
