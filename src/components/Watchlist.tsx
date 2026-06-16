import { Quotes } from '../data/bistStatic';

interface Props {
  items: string[];
  quotes: Quotes;
  spark: Record<string, number[]>;
  added: Record<string, { t: number; p: number }>;
  active: string;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
  onHide: () => void;
}

export function Watchlist({ items, quotes, spark, added, active, onSelect, onRemove, onHide }: Props) {
  return (
    <div className="panel">
      <div className="panel-title wl-head">
        <span>İzleme Listesi</span>
        <span className="wl-head-sp" />
        {items.length > 0 && <span className="wl-count">{items.length}</span>}
        <button className="lt-hide" onClick={onHide} title="Paneli gizle (geniş grafik)">⟩</button>
      </div>
      {items.length === 0 && <div className="panel-empty">Üstteki ★ ile hisse ekle</div>}
      {items.map((sym) => {
        const q = quotes[sym];
        const pct = q && q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;
        const up = pct >= 0;
        const a = added[sym];
        const since = a && a.p > 0 && q ? ((q.c - a.p) / a.p) * 100 : null;
        const days = a ? Math.max(0, Math.round((Date.now() / 1000 - a.t) / 86400)) : 0;
        return (
          <div
            key={sym}
            className={'row wl-row' + (sym === active ? ' active' : '')}
            onClick={() => onSelect(sym)}
          >
            <span className="row-sym">
              {sym}
              {since !== null ? (
                <small
                  className={'wl-since ' + (since >= 0 ? 'up' : 'down')}
                  title={`Takibe alındığından beri (${days} gün) · giriş ${fmt(a!.p)}`}
                >
                  {(since >= 0 ? '+' : '') + since.toFixed(1)}% · {days}g
                </small>
              ) : !q ? (
                <small className="lg-muted" title="Bu sembol için veri yok — kod yanlış olabilir">
                  veri yok
                </small>
              ) : null}
            </span>
            <Spark data={spark[sym]} />
            <span className="row-num">
              {q ? fmt(q.c) : '—'}
              {q && (
                <small className={up ? 'up' : 'down'}>
                  {(pct >= 0 ? '+' : '') + pct.toFixed(2)}%
                </small>
              )}
            </span>
            <button
              className="row-x"
              title="Kaldır"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(sym);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Spark({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return <svg className="spark" width="42" height="20" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * 40 + 1).toFixed(1)},${(19 - ((v - min) / rng) * 18).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="spark" width="42" height="20">
      <polyline points={pts} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.2" />
    </svg>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
