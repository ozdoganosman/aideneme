import { ChangeEvent, useMemo, useState } from 'react';
import { Quotes } from '../data/bistStatic';

export interface Holding {
  symbol: string;
  qty: number;
  cost: number; // average buy price
}

// A single buy/sell transaction (the ledger is the source of truth).
export interface Txn {
  id: string;
  t: number; // unix seconds
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
}

// A completed round-trip (position opened then fully closed).
export interface ClosedTrade {
  symbol: string;
  qty: number; // total shares sold over the round-trip
  avgBuy: number;
  avgSell: number;
  pnl: number; // realized ₺
  pnlPct: number;
  openT: number;
  closeT: number;
}

// Replay the ledger (average-cost): buys raise the average, sells realize P&L at
// the average and reduce qty; when qty hits zero the round-trip is "closed".
export function deriveLedger(txns: Txn[]): { open: Holding[]; closed: ClosedTrade[]; realized: number } {
  const sorted = [...txns].sort((a, b) => a.t - b.t);
  interface S {
    qty: number;
    cost: number;
    openT: number;
    soldQty: number;
    soldProceeds: number;
    realized: number;
  }
  const st = new Map<string, S>();
  const closed: ClosedTrade[] = [];
  let realized = 0;
  const fresh = (t: number): S => ({ qty: 0, cost: 0, openT: t, soldQty: 0, soldProceeds: 0, realized: 0 });
  for (const tx of sorted) {
    let s = st.get(tx.symbol);
    if (tx.side === 'buy') {
      if (!s || s.qty <= 1e-9) {
        s = fresh(tx.t);
        st.set(tx.symbol, s);
      }
      const nq = s.qty + tx.qty;
      s.cost = nq > 0 ? (s.qty * s.cost + tx.qty * tx.price) / nq : tx.price;
      s.qty = nq;
    } else {
      if (!s || s.qty <= 1e-9) continue; // nothing to sell
      const sq = Math.min(tx.qty, s.qty);
      const pnl = (tx.price - s.cost) * sq;
      s.realized += pnl;
      realized += pnl;
      s.qty -= sq;
      s.soldQty += sq;
      s.soldProceeds += sq * tx.price;
      if (s.qty <= 1e-9) {
        closed.push({
          symbol: tx.symbol,
          qty: s.soldQty,
          avgBuy: s.cost,
          avgSell: s.soldQty > 0 ? s.soldProceeds / s.soldQty : 0,
          pnl: s.realized,
          pnlPct: s.cost > 0 ? (s.realized / (s.cost * s.soldQty)) * 100 : 0,
          openT: s.openT,
          closeT: tx.t,
        });
        st.delete(tx.symbol);
      }
    }
  }
  const open: Holding[] = [];
  for (const [symbol, s] of st) if (s.qty > 1e-9) open.push({ symbol, qty: s.qty, cost: s.cost });
  return { open, closed: closed.reverse(), realized };
}

interface Props {
  txns: Txn[];
  positions: Holding[];
  closed: ClosedTrade[];
  realized: number;
  quotes: Quotes;
  spark: Record<string, number[]>;
  symbols: string[];
  onAddTxn: (t: Txn) => void;
  onRemoveTxn: (id: string) => void;
  onImport: (h: Holding[]) => void;
  onSelect: (s: string) => void;
  onAnalyze: () => void;
}

// Stable per-holding colors — same color ties a card to its donut slice.
const PALETTE = [
  '#3b82f6', '#26a69a', '#f59e0b', '#a855f7', '#ef5350', '#14b8a6',
  '#ec4899', '#f97316', '#84cc16', '#06b6d4', '#eab308', '#8b5cf6',
];

const tid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowSec = () => Math.floor(Date.now() / 1000);

export function Portfolio({ txns, positions, closed, realized, quotes, spark, symbols, onAddTxn, onRemoveTxn, onImport, onSelect, onAnalyze }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [sym, setSym] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [acOpen, setAcOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [showClosed, setShowClosed] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const matches = acOpen && sym ? rank(symbols, sym.toUpperCase()) : [];
  const posMap = useMemo(() => new Map(positions.map((h) => [h.symbol, h])), [positions]);

  const rows = positions.map((h, i) => {
    const q = quotes[h.symbol];
    const pr = q ? q.c : 0;
    const pc = q ? q.pc : pr;
    const val = pr * h.qty;
    const cst = h.cost * h.qty;
    const pnl = val - cst;
    return {
      h,
      i,
      color: PALETTE[i % PALETTE.length],
      price: pr,
      val,
      pnl,
      pnlPct: cst ? (pnl / cst) * 100 : 0,
      dayPL: (pr - pc) * h.qty,
      dayPct: pc ? ((pr - pc) / pc) * 100 : 0,
    };
  });
  rows.sort((a, b) => b.val - a.val); // heaviest position first (color already fixed per symbol)
  const totVal = rows.reduce((s, r) => s + r.val, 0);
  const totCost = positions.reduce((s, h) => s + h.cost * h.qty, 0);
  const totPnl = totVal - totCost;
  const totPct = totCost ? (totPnl / totCost) * 100 : 0;
  const totDay = rows.reduce((s, r) => s + r.dayPL, 0);
  const totDayBase = totVal - totDay;
  const totDayPct = totDayBase ? (totDay / totDayBase) * 100 : 0;

  const exportCsv = () => {
    const lines = ['symbol,side,qty,price,date', ...txns.map((t) => `${t.symbol},${t.side},${t.qty},${t.price},${new Date(t.t * 1000).toISOString().slice(0, 10)}`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'islemler.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const out: Holding[] = [];
      for (const line of String(reader.result || '').split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split(/[,;\t]/);
        if (parts.length < 3) continue;
        const s = parts[0].trim().toUpperCase();
        if (!s || s === 'SYMBOL' || s === 'SEMBOL') continue;
        // Accept legacy "symbol,qty,cost" too (qty at [1], price at [2] when no side).
        const hasSide = parts[1] === 'buy' || parts[1] === 'sell' || parts[1] === 'al' || parts[1] === 'sat';
        const q = parseNum(parts[hasSide ? 2 : 1]);
        const c = parseNum(parts[hasSide ? 3 : 2]);
        if (s && q > 0 && c > 0) out.push({ symbol: s, qty: q, cost: c });
      }
      if (out.length) onImport(out);
    };
    reader.readAsText(file);
  };

  const add = () => {
    const s = sym.toUpperCase().trim();
    const q = parseNum(qty);
    const c = parseNum(price);
    if (!s || !(q > 0) || !(c > 0)) return;
    if (side === 'sell') {
      const held = posMap.get(s)?.qty ?? 0;
      if (held <= 0) return; // can't sell what you don't hold
      onAddTxn({ id: tid(), t: nowSec(), symbol: s, side: 'sell', qty: Math.min(q, held), price: c });
    } else {
      onAddTxn({ id: tid(), t: nowSec(), symbol: s, side: 'buy', qty: q, price: c });
    }
    setSym('');
    setQty('');
    setPrice('');
    setAcOpen(false);
  };
  const sellFrom = (h: Holding) => {
    setSide('sell');
    setSym(h.symbol);
    setQty(String(h.qty));
    setPrice(quotes[h.symbol]?.c ? String(quotes[h.symbol].c) : '');
  };

  return (
    <>
      <div className="pf-side">
        <button className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>AL</button>
        <button className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>SAT</button>
      </div>
      <div className="pf-form">
        <div className="ac">
          <input
            placeholder="Sembol"
            value={sym}
            spellCheck={false}
            onChange={(e) => {
              setSym(e.target.value.toUpperCase());
              setAcOpen(true);
              setActive(0);
            }}
            onFocus={() => setAcOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                setActive((a) => Math.min(a + 1, matches.length - 1));
                e.preventDefault();
              } else if (e.key === 'ArrowUp') {
                setActive((a) => Math.max(a - 1, 0));
                e.preventDefault();
              } else if (e.key === 'Enter') {
                if (acOpen && matches[active]) {
                  setSym(matches[active]);
                  setAcOpen(false);
                  e.preventDefault();
                } else {
                  add();
                }
              } else if (e.key === 'Escape') {
                setAcOpen(false);
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
                    setAcOpen(false);
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
        <input placeholder="Adet" value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input placeholder="Fiyat" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className={'pf-addbtn ' + side} onClick={add} title={side === 'buy' ? 'Alış ekle' : 'Satış ekle'}>
          {side === 'buy' ? '+' : '−'}
        </button>
      </div>

      {positions.length === 0 && txns.length === 0 && <div className="panel-empty">İşlem ekle (AL/SAT · sembol · adet · fiyat)</div>}

      {positions.length > 0 && totVal > 0 && <Donut rows={rows} total={totVal} totDay={totDay} totDayPct={totDayPct} />}

      {positions.length > 0 && (
        <button className="pf-analyze" onClick={onAnalyze} title="Risk, dağılım ve sade teknik analiz">
          📊 Risk & Teknik Analiz
        </button>
      )}

      <div className="pf-io">
        <button onClick={exportCsv} disabled={!txns.length} title="İşlemleri CSV olarak indir">⬇ Dışa (CSV)</button>
        <label className="pf-io-imp" title="CSV'den yükle (mevcut işlemlerin yerine alış olarak geçer)">
          ⬆ İçe (CSV)
          <input type="file" accept=".csv,text/csv" onChange={importCsv} hidden />
        </label>
      </div>

      {rows.map((r) => {
        const weight = totVal ? (r.val / totVal) * 100 : 0;
        return (
          <div key={r.h.symbol} className="pf-card" onClick={() => onSelect(r.h.symbol)} title="Grafikte aç">
            <div className="pf-card-top">
              <span className="pf-dot" style={{ background: r.color }} />
              <b>{r.h.symbol}</b>
              <span className="pf-weight">%{weight.toFixed(0)}</span>
              <span className="pf-val">{money(r.val)}</span>
              <button className="pf-sell" title="Sat (parçalı olabilir)" onClick={(e) => { e.stopPropagation(); sellFrom(r.h); }}>Sat</button>
            </div>
            <div className="pf-card-mid">
              <span>
                {fmtQty(r.h.qty)} × {money(r.h.cost)} · son {money(r.price)}{' '}
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

      {positions.length > 0 && (
        <div className="pf-summary">
          <div className="pf-summary-row">
            <span className="lg-muted">Toplam değer</span>
            <b>{money(totVal)}</b>
          </div>
          <div className="pf-summary-row">
            <span className="lg-muted">Açık K/Z</span>
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
          {(realized !== 0 || closed.length > 0) && (
            <div className="pf-summary-row">
              <span className="lg-muted">Gerçekleşen K/Z</span>
              <b className={realized >= 0 ? 'up' : 'down'}>
                {realized >= 0 ? '+' : ''}
                {money(realized)}
              </b>
            </div>
          )}
        </div>
      )}

      {/* Closed positions */}
      {closed.length > 0 && (
        <div className="pf-section">
          <button className="pf-sechead" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? '▾' : '▸'} Kapalı pozisyonlar ({closed.length}) ·{' '}
            <span className={realized >= 0 ? 'up' : 'down'}>{realized >= 0 ? '+' : ''}{money(realized)}</span>
          </button>
          {showClosed &&
            closed.map((c, i) => (
              <div key={i} className="pf-closed" onClick={() => onSelect(c.symbol)} title="Grafikte aç">
                <div className="pf-closed-top">
                  <b>{c.symbol}</b>
                  <span className={'pf-cz ' + (c.pnl >= 0 ? 'up' : 'down')}>
                    {c.pnl >= 0 ? '+' : ''}
                    {money(c.pnl)} ({c.pnlPct >= 0 ? '+' : ''}
                    {c.pnlPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="pf-closed-sub lg-muted">
                  {fmtQty(c.qty)} adet · al {money(c.avgBuy)} → sat {money(c.avgSell)} · {fmtDate(c.openT)}–{fmtDate(c.closeT)}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Transaction log */}
      {txns.length > 0 && (
        <div className="pf-section">
          <button className="pf-sechead" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '▾' : '▸'} İşlem geçmişi ({txns.length})
          </button>
          {showLog &&
            [...txns]
              .sort((a, b) => b.t - a.t)
              .map((t) => (
                <div key={t.id} className="pf-txn">
                  <span className={'pf-txn-side ' + t.side}>{t.side === 'buy' ? 'AL' : 'SAT'}</span>
                  <b>{t.symbol}</b>
                  <span className="lg-muted">{fmtQty(t.qty)} × {money(t.price)}</span>
                  <span className="pf-txn-date lg-muted">{fmtDate(t.t)}</span>
                  <button className="row-x" title="İşlemi sil" onClick={() => onRemoveTxn(t.id)}>×</button>
                </div>
              ))}
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
        <text className="pf-donut-day" x={cx} y={cy + 13} textAnchor="middle" fill={totDay >= 0 ? '#26a69a' : '#ef5350'}>
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
    <div className="pf-pnlbar" title={`Açık K/Z %${pct.toFixed(1)}`}>
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
  return '₺' + v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
}
function fmtQty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
function fmtDate(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
}
