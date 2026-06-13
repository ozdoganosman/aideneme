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

  const rows = holdings.map((h) => {
    const q = quotes[h.symbol];
    const price = q ? q.c : 0;
    const pc = q ? q.pc : price;
    const val = price * h.qty;
    const cost = h.cost * h.qty;
    const pnl = val - cost;
    return {
      h,
      price,
      val,
      pnl,
      pnlPct: cost ? (pnl / cost) * 100 : 0,
      dayPL: (price - pc) * h.qty,
      dayPct: pc ? ((price - pc) / pc) * 100 : 0,
    };
  });
  const totVal = rows.reduce((s, r) => s + r.val, 0);
  const totCost = holdings.reduce((s, h) => s + h.cost * h.qty, 0);
  const totPnl = totVal - totCost;
  const totPct = totCost ? (totPnl / totCost) * 100 : 0;
  const totDay = rows.reduce((s, r) => s + r.dayPL, 0);
  const totDayPct = totVal - totDay ? (totDay / (totVal - totDay)) * 100 : 0;

  const add = () => {
    const s = sym.toUpperCase().trim();
    const q = parseNum(qty);
    const c = parseNum(cost);
    if (!s || !(q > 0) || !(c > 0)) return;
    onAdd({ symbol: s, qty: q, cost: c });
    setSym('');
    setQty('');
    setCost('');
    setOpen(false);
  };

  return (
    <div className="panel">
      <div className="panel-title">Portföy {holdings.length > 0 && `· ${holdings.length}`}</div>

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
                if (open && matches[active]) {
                  setSym(matches[active]);
                  setOpen(false);
                  e.preventDefault();
                } else {
                  add();
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
        <input placeholder="Adet" value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input placeholder="Maliyet" value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} title="Ekle">+</button>
      </div>

      {holdings.length === 0 && <div className="panel-empty">Pozisyon ekle (sembol · adet · maliyet)</div>}

      {rows.map((r, i) => {
        const weight = totVal ? (r.val / totVal) * 100 : 0;
        return (
          <div key={i} className="pf-card" onClick={() => onSelect(r.h.symbol)} title="Grafikte aç">
            <div className="pf-card-top">
              <b>{r.h.symbol}</b>
              <span className="pf-weight">%{weight.toFixed(0)}</span>
              <span className="pf-val">{money(r.val)}</span>
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
            <div className="pf-card-mid">
              {r.h.qty} × {money(r.h.cost)} · son {money(r.price)}{' '}
              <span className={r.dayPct >= 0 ? 'up' : 'down'}>
                ({r.dayPct >= 0 ? '+' : ''}
                {r.dayPct.toFixed(2)}%)
              </span>
            </div>
            <div className="pf-card-pnl">
              <span className={r.pnl >= 0 ? 'up' : 'down'}>
                K/Z {r.pnl >= 0 ? '+' : ''}
                {money(r.pnl)} ({r.pnlPct >= 0 ? '+' : ''}
                {r.pnlPct.toFixed(1)}%)
              </span>
              <span className="lg-muted">
                {' · '}bugün{' '}
                <span className={r.dayPL >= 0 ? 'up' : 'down'}>
                  {r.dayPL >= 0 ? '+' : ''}
                  {money(r.dayPL)}
                </span>
              </span>
            </div>
            <div className="pf-weightbar">
              <div className="pf-weightfill" style={{ width: weight + '%' }} />
            </div>
          </div>
        );
      })}

      {holdings.length > 0 && (
        <div className="pf-summary">
          <div className="pf-summary-row">
            <span className="lg-muted">Toplam değer</span>
            <b>{money(totVal)}</b>
          </div>
          <div className="pf-summary-row">
            <span className="lg-muted">Toplam K/Z</span>
            <b className={totPnl >= 0 ? 'up' : 'down'}>
              {totPnl >= 0 ? '+' : ''}
              {money(totPnl)} ({totPct >= 0 ? '+' : ''}
              {totPct.toFixed(1)}%)
            </b>
          </div>
          <div className="pf-summary-row">
            <span className="lg-muted">Bugün</span>
            <b className={totDay >= 0 ? 'up' : 'down'}>
              {totDay >= 0 ? '+' : ''}
              {money(totDay)} ({totDayPct >= 0 ? '+' : ''}
              {totDayPct.toFixed(2)}%)
            </b>
          </div>
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

function parseNum(s: string): number {
  let t = s.trim().replace(/\s/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  return parseFloat(t);
}

function money(v: number): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
}
