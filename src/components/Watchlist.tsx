import { Quotes } from '../data/bistStatic';

interface Props {
  items: string[];
  quotes: Quotes;
  active: string;
  onSelect: (s: string) => void;
  onRemove: (s: string) => void;
}

export function Watchlist({ items, quotes, active, onSelect, onRemove }: Props) {
  return (
    <div className="panel">
      <div className="panel-title">İzleme Listesi</div>
      {items.length === 0 && <div className="panel-empty">Üstteki ⭐ ile hisse ekle</div>}
      {items.map((sym) => {
        const q = quotes[sym];
        const pct = q && q.pc ? ((q.c - q.pc) / q.pc) * 100 : 0;
        const up = pct >= 0;
        return (
          <div
            key={sym}
            className={'row' + (sym === active ? ' active' : '')}
            onClick={() => onSelect(sym)}
          >
            <span className="row-sym">{sym}</span>
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

function fmt(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
