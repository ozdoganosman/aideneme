import { Quotes } from '../data/bistStatic';

interface Props {
  items: string[];
  quotes: Quotes;
  spark: Record<string, number[]>;
  active: string;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
}

export function Watchlist({ items, quotes, spark, active, onSelect, onRemove }: Props) {
  return (
    <div className="panel">
      <div className="panel-title">İzleme Listesi</div>
      {items.length === 0 && <div className="panel-empty">Üstteki ★ ile hisse ekle</div>}
      {items.map((sym) => {
        const q = quotes[sym];
        const pct = q && q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;
        const up = pct >= 0;
        return (
          <div
            key={sym}
            className={'row wl-row' + (sym === active ? ' active' : '')}
            onClick={() => onSelect(sym)}
          >
            <span className="row-sym">{sym}</span>
            <Spark data={spark[sym]} />
            <span className="row-num">{q ? fmt(q.c) : '—'}</span>
            <span className={'row-num ' + (up ? 'up' : 'down')}>
              {q ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : ''}
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
  if (!data || data.length < 2) return <svg className="spark" width="46" height="18" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * 44 + 1).toFixed(1)},${(17 - ((v - min) / rng) * 16).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="spark" width="46" height="18">
      <polyline points={pts} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.2" />
    </svg>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
