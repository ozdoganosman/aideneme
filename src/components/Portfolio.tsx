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
  spark: Record<string, number[]>;
  symbols: string[];
  onAdd: (h: Holding) => void;
  onRemove: (index: number) => void;
  onSelect: (s: string) => void;
  onAnalyze: () => void;
}

// Stable per-holding colors — same color ties a card to its donut slice.
const PALETTE = [
  '#3b82f6', '#26a69a', '#f59e0b', '#a855f7', '#ef5350', '#14b8a6',
  '#ec4899', '#f97316', '#84cc16', '#06b6d4', '#eab308', '#8b5cf6',
];

export function Portfolio({ holdings, quotes, spark, symbols, onAdd, onRemove, onSelect, onAnalyze }: Props) {
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = open && sym ? rank(symbols, sym.toUpperCase()) : [];

  const rows = holdings.map((h, i) => {
    const q = quotes[h.symbol];
    const price = q ? q.c : 0;
    const pc = q ? q.pc : price;
    const val = price * h.qty;
    const cst = h.cost * h.qty;
    const pnl = val - cst;
    return {
      h,
      i,
      color: PALETTE[i % PALETTE.length],
      price,
      val,
      pnl,
      pnlPct: cst ? (pnl / cst) * 100 : 0,
      dayPL: (price - pc) * h.qty,
      dayPct: pc ? ((price - pc) / pc) * 100 : 0,
    };
  });
  const totVal = rows.reduce((s, r) => s + r.val, 0);
  const totCost = holdings.reduce((s, h) => s + h.cost * h.qty, 0);
  const totPnl = totVal - totCost;
  const totPct = totCost ? (totPnl / totCost) * 100 : 0;
  const totDay = rows.reduce((s, r) => s + r.dayPL, 0);
  const totDayBase = totVal - totDay;
  const totDayPct = totDayBase ? (totDay / totDayBase) * 100 : 0;

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
    <>
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

      {holdings.length > 0 && totVal > 0 && (
        <Donut rows={rows} total={totVal} totDay={totDay} totDayPct={totDayPct} />
      )}

      {holdings.length > 0 && (
        <button className="pf-analyze" onClick={onAnalyze} title="Risk, dağılım ve sade teknik analiz">
          📊 Risk & Teknik Analiz
        </button>
      )}

      {rows.map((r) => {
        const weight = totVal ? (r.val / totVal) * 100 : 0;
        return (
          <div key={r.i} className="pf-card" onClick={() => onSelect(r.h.symbol)} title="Grafikte aç">
            <div className="pf-card-top">
              <span className="pf-dot" style={{ background: r.color }} />
              <b>{r.h.symbol}</b>
              <span className="pf-weight">%{weight.toFixed(0)}</span>
              <span className="pf-val">{money(r.val)}</span>
              <button
                className="row-x"
                title="Kaldır"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(r.i);
                }}
              >
                ×
              </button>
            </div>
            <div className="pf-card-mid">
              <span>
                {r.h.qty} × {money(r.h.cost)} · son {money(r.price)}{' '}
                <span className={r.dayPct >= 0 ? 'up' : 'down'}>
                  ({r.dayPct >= 0 ? '+' : ''}
                  {r.dayPct.toFixed(2)}%)
                </span>
              </span>
              <Spark data={spark[r.h.symbol]} />
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
              <div className="pf-weightfill" style={{ width: weight + '%', background: r.color }} />
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
          <PnlBar pct={totPct} />
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
    </>
  );
}

// Allocation donut (composition by current value) with total + today in the hole.
function Donut({
  rows,
  total,
  totDay,
  totDayPct,
}: {
  rows: { color: string; val: number; h: Holding }[];
  total: number;
  totDay: number;
  totDayPct: number;
}) {
  const size = 138;
  const sw = 18;
  const r = (size - sw) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="pf-donutwrap">
      <svg width={size} height={size} className="pf-donut">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1d27" strokeWidth={sw} />
        {rows.map((s, i) => {
          const frac = total > 0 ? s.val / total : 0;
          const dash = frac * C;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={sw}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-acc * C}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{`${s.h.symbol} · %${(frac * 100).toFixed(1)}`}</title>
            </circle>
          );
          acc += frac;
          return el;
        })}
        <text className="pf-donut-val" x={cx} y={cy - 2} textAnchor="middle">{money(total)}</text>
        <text
          className="pf-donut-day"
          x={cx}
          y={cy + 13}
          textAnchor="middle"
          fill={totDay >= 0 ? '#26a69a' : '#ef5350'}
        >
          bugün {totDayPct >= 0 ? '+' : ''}{totDayPct.toFixed(2)}%
        </text>
      </svg>
    </div>
  );
}

// Diverging total-P&L bar: green right of center for profit, red left for loss.
function PnlBar({ pct }: { pct: number }) {
  const half = Math.min(50, Math.abs(pct) / 2);
  const pos = pct >= 0;
  return (
    <div className="pf-pnlbar" title={`Toplam K/Z %${pct.toFixed(1)}`}>
      <div className={'pf-pnlbar-fill ' + (pos ? 'pos' : 'neg')} style={{ left: pos ? '50%' : 50 - half + '%', width: half + '%' }} />
      <div className="pf-pnlbar-center" />
    </div>
  );
}

function Spark({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return <svg className="spark" width="46" height="16" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * 44 + 1).toFixed(1)},${(15 - ((v - min) / rng) * 14).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="spark" width="46" height="16">
      <polyline points={pts} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.2" />
    </svg>
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
