import { useEffect, useState } from 'react';
import { Candles } from '../data/types';
import { optimize, StrategyResult } from '../indicators/backtest';

interface Props {
  candles: Candles;
  symbol: string;
  onClose: () => void;
}

export function Backtest({ candles, symbol, onClose }: Props) {
  const [data, setData] = useState<{ results: StrategyResult[]; holdPct: number } | null>(null);

  useEffect(() => {
    setData(null);
    const t = setTimeout(() => setData(optimize(candles)), 20); // let the spinner paint
    return () => clearTimeout(t);
  }, [candles]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Strateji Taraması — {symbol}</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>

        {!data ? (
          <div className="modal-body" style={{ alignItems: 'center' }}>
            <div className="spinner" />
            <span className="lg-muted">Stratejiler test ediliyor…</span>
          </div>
        ) : (
          <div className="modal-body">
            <div className="bt-note">
              Geçmiş veride <b>{data.results.length}</b> strateji denendi (in-sample / geçmişe dönük). Al-Tut:{' '}
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
                {data.results.slice(0, 15).map((r, i) => (
                  <tr key={i} className={i === 0 ? 'best' : ''}>
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
            <div className="bt-note" style={{ marginTop: 8 }}>
              ⚠️ Geçmiş performans gelecekteki sonuçları garanti etmez; sonuçlar aynı veri üzerinde optimize edildiği
              için iyimser olabilir.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function pct(v: number): string {
  return isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';
}
