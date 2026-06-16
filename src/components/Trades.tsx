import { Candles } from '../data/types';
import { tradesFor, Trade } from '../indicators/backtest';

interface Props {
  strategy: string | null;
  candles: Candles | null;
  onSelectTrade: (t: Trade) => void;
}

export function Trades({ strategy, candles, onSelectTrade }: Props) {
  if (!strategy || !candles)
    return (
      <div className="panel-empty">
        Önce bir strateji seç: <b>Strateji Taraması</b>'ndan bir stratejiye tıkla. İşlemler burada tablo olarak listelenir ve
        grafiğe AL/SAT işaretlenir.
      </div>
    );

  const trades = tradesFor(strategy, candles);
  if (trades.length === 0) return <div className="cb-head"><b className="cb-name">{strategy}</b><span className="lg-muted">işlem yok</span></div>;

  const n = trades.length;
  const wins = trades.filter((t) => t.retPct >= 0).length;
  const avg = trades.reduce((s, t) => s + t.retPct, 0) / n;
  const best = Math.max(...trades.map((t) => t.retPct));
  const worst = Math.min(...trades.map((t) => t.retPct));
  const days = (t: Trade) => Math.round(((t.exitTime ?? Date.now() / 1000) - t.entryTime) / 86400);

  return (
    <>
      <div className="cb-head">
        <b className="cb-name" title={strategy}>{strategy}</b>
        <span className="lg-muted">
          {n} işlem · %{Math.round((wins / n) * 100)} kazanç · ort{' '}
          <span className={avg >= 0 ? 'up' : 'down'}>{sg(avg)}</span> · en iyi <span className="up">{sg(best)}</span> · en kötü{' '}
          <span className="down">{sg(worst)}</span>
        </span>
      </div>
      <table className="cb-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Giriş</th>
            <th className="cb-r">Fiyat</th>
            <th>Çıkış</th>
            <th className="cb-r">Fiyat</th>
            <th className="cb-r">Getiri</th>
            <th className="cb-r">Süre</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} onClick={() => onSelectTrade(t)} title="Grafikte göster">
              <td className="lg-muted">{i + 1}</td>
              <td>{fmtDate(t.entryTime)}</td>
              <td className="cb-r">{fp(t.entryPrice)}</td>
              <td>{t.open ? <span className="lg-muted">açık</span> : fmtDate(t.exitTime as number)}</td>
              <td className="cb-r">{t.open ? '—' : fp(t.exitPrice)}</td>
              <td className={'cb-r ' + (t.retPct >= 0 ? 'up' : 'down')}>{sg(t.retPct)}</td>
              <td className="cb-r lg-muted">{days(t)}g</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function sg(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fp(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
