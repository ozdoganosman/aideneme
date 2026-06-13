import { Candles } from '../data/types';
import { tradesFor } from '../indicators/backtest';

interface Props {
  strategy: string;
  candles: Candles;
}

export function Trades({ strategy, candles }: Props) {
  const trades = tradesFor(strategy, candles);
  const wins = trades.filter((t) => t.retPct >= 0).length;

  return (
    <div className="panel">
      <div className="panel-title">İşlemler · {strategy}</div>
      {trades.length === 0 ? (
        <div className="panel-empty">İşlem yok</div>
      ) : (
        <>
          <div className="bt-note" style={{ marginBottom: 4 }}>
            {trades.length} işlem · {Math.round((wins / trades.length) * 100)}% kazanç
          </div>
          {trades.map((t, i) => (
            <div key={i} className="row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="row-sym" style={{ fontWeight: 400 }}>
                {fmtDate(t.entryTime)} → {t.open ? 'açık' : fmtDate(t.exitTime as number)}
                <small>
                  {fp(t.entryPrice)} → {fp(t.exitPrice)}
                  {t.open ? ' (son)' : ''}
                </small>
              </span>
              <span className={'row-num ' + (t.retPct >= 0 ? 'up' : 'down')} style={{ alignSelf: 'center' }}>
                {(t.retPct >= 0 ? '+' : '') + t.retPct.toFixed(1)}%
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fp(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
