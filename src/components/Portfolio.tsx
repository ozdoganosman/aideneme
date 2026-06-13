import { useState } from 'react';
import { Quotes } from '../data/bistStatic';

export interface Holding {
  symbol: string;
  qty: number;
  cost: number; // average buy price
}

interface Props {
  holdings: Holding[];
  quotes: Quotes;
  symbols: string[];
  onAdd: (h: Holding) => void;
  onRemove: (index: number) => void;
  onSelect: (s: string) => void;
}

export function Portfolio({ holdings, quotes, symbols, onAdd, onRemove, onSelect }: Props) {
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = open && sym ? rank(symbols, sym.toUpperCase()) : [];

  let totVal = 0;
  let totCost = 0;
  const rows = holdings.map((h) => {
    const price = quotes[h.symbol]?.c ?? 0;
    const val = price * h.qty;
    const cst = h.cost * h.qty;
    totVal += val;
    totCost += cst;
    const pnl = val - cst;
    const pnlPct = cst ? (pnl / cst) * 100 : 0;
    return { h, val, pnl, pnlPct };
  });
  const totPnl = totVal - totCost;
  const totPct = totCost ? (totPnl / totCost) * 100 : 0;

  const add = () => {
    const s = sym.toUpperCase().trim();
    const q = parseFloat(qty);
    const c = parseFloat(cost);
    if (!s || !(q > 0) || !(c > 0)) return;
    onAdd({ symbol: s, qty: q, cost: c });
    setSym('');
    setQty('');
    setCost('');
    setOpen(false);
  };

  return (
    <div className="panel">
      <div className="panel-title">Portföy</div>
      <div className="pf-form">
        <div className="ac">
          <input
            placeholder="Sembol"
            value={sym}
            spellCheck={false}
            onChange={(e) => {
              setSym(e.target.value.toUpperCase());
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                setActive((a) => Math.min(a + 1, matches.length - 1));
                e.preventDefault();
              } else if (e.key === 'ArrowUp') {
                setActive((a) => Math.max(a - 1, 0));
                e.preventDefault();
              } else if (e.key === 'Enter') {
                if (matches[active]) {
                  setSym(matches[active]);
                  setOpen(false);
                  e.preventDefault();
                }
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {matches.length > 0 && (
            <div className="search-dropdown">
              {matches.map((m, i) => (
                <div
                  key={m}
                  className={'search-item' + (i === active ? ' active' : '')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSym(m);
                    setOpen(false);
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
        <input placeholder="Adet" value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />
        <input placeholder="Maliyet" value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} />
        <button onClick={add} title="Ekle">+</button>
      </div>

      {holdings.length === 0 && <div className="panel-empty">Pozisyon ekle</div>}
      {rows.map((r, i) => (
        <div key={i} className="row" onClick={() => onSelect(r.h.symbol)}>
          <span className="row-sym">
            {r.h.symbol}
            <small>{r.h.qty}×{fmt(r.h.cost)}</small>
          </span>
          <span className="row-num">{fmt(r.val)}</span>
          <span className={'row-num ' + (r.pnl >= 0 ? 'up' : 'down')}>
            {(r.pnl >= 0 ? '+' : '') + fmt(r.pnl)}
            <small>{(r.pnlPct >= 0 ? '+' : '') + r.pnlPct.toFixed(1)}%</small>
          </span>
          <button
            className="row-x"
            title="Kaldır"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(i);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {holdings.length > 0 && (
        <div className="pf-total">
          <span>Toplam</span>
          <span>{fmt(totVal)}</span>
          <span className={totPnl >= 0 ? 'up' : 'down'}>
            {(totPnl >= 0 ? '+' : '') + fmt(totPnl)} ({(totPct >= 0 ? '+' : '') + totPct.toFixed(1)}%)
          </span>
        </div>
      )}
    </div>
  );
}

function rank(symbols: string[], q: string): string[] {
  const pre: string[] = [];
  const sub: string[] = [];
  for (const s of symbols) {
    if (s.startsWith(q)) {
      if (pre.length < 8) pre.push(s);
    } else if (s.includes(q)) {
      if (sub.length < 8) sub.push(s);
    }
    if (pre.length >= 8) break;
  }
  return [...pre, ...sub].slice(0, 8);
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
