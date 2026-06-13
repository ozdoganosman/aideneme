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
  onAdd: (h: Holding) => void;
  onRemove: (index: number) => void;
  onSelect: (s: string) => void;
}

export function Portfolio({ holdings, quotes, onAdd, onRemove, onSelect }: Props) {
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');

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
  };

  return (
    <div className="panel">
      <div className="panel-title">Portföy</div>
      <div className="pf-form">
        <input placeholder="Sembol" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} />
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

function fmt(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
