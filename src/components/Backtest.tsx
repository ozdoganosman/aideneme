import { useEffect, useMemo, useState } from 'react';
import { Candles } from '../data/types';
import { evalPosition, dailyFromMonthly, TCMB_ANNUAL_PCT } from '../indicators/backtest';
import { fetchBistStatic, fetchScreener } from '../data/bistStatic';
import {
  CustomStrategy,
  Cond,
  INDS,
  OPS,
  hasParam,
  newCond,
  buildCustomPosition,
} from '../indicators/customStrategy';

interface Props {
  candles: Candles;
  symbol: string;
  universe: string[];
  strats: CustomStrategy[];
  onSave: (s: CustomStrategy[]) => void;
  onApply: (s: CustomStrategy) => void;
  onPickCombo: (sym: string, s: CustomStrategy) => void;
  onClose: () => void;
}

interface Combo {
  sym: string;
  strat: CustomStrategy;
  ann: number; // annualized incl. cash interest (the Al-Tut rival)
  ret: number;
  trades: number;
  win: number;
  dd: number;
  hold: number; // buy & hold annualized
  daysIn: number;
  daysOut: number;
  avg: number;
}

const blankDraft = (): CustomStrategy => ({ id: '', name: '', buy: [newCond()], sell: [] });

// Researched best rules from the two indicators (Williams Paşa + NizamiCedid).
const mkCond = (ind: string, op: Cond['op'], tgt: 'val' | 'ind', val: number, ind2 = 'emacd', p = 0, p2 = 0): Cond => ({
  ind,
  p,
  op,
  tgt,
  val,
  ind2,
  p2,
});
const SUGGESTED: { name: string; buy: Cond[]; sell: Cond[] }[] = [
  { name: 'Cedid Trend (MACD>0)', buy: [mkCond('macd', 'gt', 'val', 0)], sell: [mkCond('macd', 'lt', 'val', 0)] },
  { name: 'Cedid eMACD', buy: [mkCond('macd', 'gt', 'ind', 0, 'emacd')], sell: [mkCond('macd', 'lt', 'ind', 0, 'emacd')] },
  {
    name: 'Paşa Dönüş (%R≷EMA)',
    buy: [mkCond('wr', 'gt', 'ind', 0, 'wrema', 260, 260)],
    sell: [mkCond('wr', 'lt', 'ind', 0, 'wrema', 260, 260)],
  },
  {
    name: 'Paşa+Cedid (%R>50 & MACD>0)',
    buy: [mkCond('wr', 'gt', 'val', 50, 'emacd', 260), mkCond('macd', 'gt', 'val', 0)],
    sell: [mkCond('wr', 'lt', 'val', 50, 'emacd', 260)],
  },
];

export function Backtest({ candles, symbol, universe, strats, onSave, onApply, onPickCombo, onClose }: Props) {
  const [tab, setTab] = useState<'mine' | 'top'>('mine');
  const [draft, setDraft] = useState<CustomStrategy>(blankDraft);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scan, setScan] = useState<{ rows: Combo[]; done: number; total: number; running: boolean } | null>(null);
  // Annual cash interest (TCMB) earned while flat — overridable, persisted.
  const [rate, setRate] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('bt-cash-rate') || '');
    return Number.isFinite(v) ? v : TCMB_ANNUAL_PCT;
  });
  useEffect(() => {
    localStorage.setItem('bt-cash-rate', String(rate));
  }, [rate]);
  const dRate = dailyFromMonthly(rate / 12); // annual → aylık → günlük

  // Backtest each saved strategy on the current symbol (+ equity curve).
  const results = useMemo(
    () =>
      strats
        .map((s) => {
          const pos = buildCustomPosition(candles, s);
          return { s, r: evalPosition(candles, pos, dRate), eq: equitySpark(candles.close, pos, candles.time, dRate), pos };
        })
        .sort((a, b) => (b.r.annRate ?? b.r.annPct) - (a.r.annRate ?? a.r.annPct)),
    [strats, candles, dRate],
  );
  const maxAnn = Math.max(...results.map((x) => Math.abs(x.r.annRate ?? x.r.annPct)), 1);
  const topMax = scan ? Math.max(...scan.rows.map((t) => Math.abs(t.ann)), 1) : 1;

  const setBuy = (buy: Cond[]) => setDraft((d) => ({ ...d, buy }));
  const setSell = (sell: Cond[]) => setDraft((d) => ({ ...d, sell }));

  const save = () => {
    const name = draft.name.trim();
    if (!name || draft.buy.length === 0) return;
    const id = draft.id || String(Date.now());
    const next = [...strats.filter((s) => s.id !== id), { ...draft, id, name }];
    onSave(next);
    setDraft(blankDraft());
  };
  const del = (id: string) => onSave(strats.filter((s) => s.id !== id));
  const addSuggested = () => {
    const have = new Set(strats.map((s) => s.name));
    const add = SUGGESTED.filter((s) => !have.has(s.name)).map((s, i) => ({ id: String(Date.now() + i), ...s }));
    if (add.length) onSave([...strats, ...add]);
  };
  const edit = (s: CustomStrategy) =>
    setDraft({ id: s.id, name: s.name, buy: s.buy.map((c) => ({ ...c })), sell: s.sell.map((c) => ({ ...c })) });

  const runScan = async () => {
    if (!strats.length) return;
    setScan({ rows: [], done: 0, total: 0, running: true });
    // Scan the 300 oldest stocks (longest history) from the screener snapshot.
    let syms = universe;
    try {
      const sc = await fetchScreener();
      if (sc?.items?.length) {
        syms = sc.items
          .slice()
          .sort((a, b) => (b.yr ?? 0) - (a.yr ?? 0))
          .slice(0, 300)
          .map((i) => i.s);
      }
    } catch {
      /* fall back to the bounded universe */
    }
    setScan({ rows: [], done: 0, total: syms.length, running: true });
    const best = new Map<string, Combo>();
    const queue = [...syms];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const sym = queue.shift()!;
        try {
          const c = await fetchBistStatic(sym);
          if (c.length >= 80) {
            for (const s of strats) {
              const r = evalPosition(c, buildCustomPosition(c, s), dRate);
              const ann = r.annRate ?? r.annPct;
              if (r.trades > 0) {
                const prev = best.get(sym);
                if (!prev || ann > prev.ann)
                  best.set(sym, {
                    sym,
                    strat: s,
                    ann,
                    ret: r.retRate ?? r.retPct,
                    trades: r.trades,
                    win: r.winRate,
                    dd: r.maxDD,
                    hold: r.holdAnn,
                    daysIn: r.daysIn ?? 0,
                    daysOut: r.daysOut ?? 0,
                    avg: r.avgHoldDays ?? 0,
                  });
              }
            }
          }
        } catch {
          /* skip */
        }
        done++;
        setScan((p) => (p ? { ...p, done } : p));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const rows = [...best.values()].sort((a, b) => b.ann - a.ann).slice(0, 20);
    setScan({ rows, done, total: universe.length, running: false });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Stratejilerim {strats.length > 0 && `· ${strats.length}`}</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>

        <div className="bt-tabs">
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            🛠️ Stratejilerim
          </button>
          <button className={tab === 'top' ? 'active' : ''} onClick={() => setTab('top')}>
            🏅 En İyi 20
          </button>
        </div>

        <div className="modal-body">
          {tab === 'mine' ? (
            <>
              <div className="sb-card">
                <div className="sb-title">{draft.id ? '✏️ Stratejiyi düzenle' : '➕ Yeni strateji'}</div>
                <input
                  className="sb-name"
                  placeholder="Strateji adı (ör. %R Güç Dönüşü)"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
                <CondGroup label="AL koşulları (hepsi sağlanınca girer)" conds={draft.buy} onChange={setBuy} />
                <CondGroup
                  label="SAT koşulları (boşsa: AL koşulu bozulunca çıkar)"
                  conds={draft.sell}
                  onChange={setSell}
                />
                <div className="sb-actions">
                  <button className="scr-add" onClick={save}>
                    {draft.id ? 'Güncelle' : 'Kaydet'}
                  </button>
                  {(draft.id || draft.name) && (
                    <button className="sb-clear" onClick={() => setDraft(blankDraft())}>
                      Temizle
                    </button>
                  )}
                </div>
              </div>

              <div className="sb-suggest">
                <span className="lg-muted">Hazır şablonlar (Williams Paşa + NizamiCedid, en iyiler):</span>
                <button className="sb-sugbtn" onClick={addSuggested}>📋 Önerilenleri ekle</button>
              </div>

              <p className="bt-intro">
                <b>{symbol}</b> üzerinde kayıtlı stratejilerin sonuçları (<b>nakit faizi dahil yıllık</b> getiriye göre).
                Strateji nakitteyken para boşta durmaz, faiz kazanır → <b>Al-Tut</b>'a rakip. Bir satıra tıkla → grafikte
                AL/SAT işaretlenir.
              </p>

              <div className="bt-rate">
                <label>💰 Nakit faizi (TCMB, yıllık %)</label>
                <ValInput value={rate} onChange={setRate} />
                <span className="lg-muted">
                  ≈ aylık %{(rate / 12).toFixed(2)} · günlük %{(dRate * 100).toFixed(3)} — boştaki günlerde işler
                </span>
              </div>

              {results.length === 0 ? (
                <div className="bt-note">Henüz strateji yok. Yukarıdan koşulları seçip kaydet.</div>
              ) : (
                <div className="bt-list">
                  {results.map(({ s, r, eq, pos }, i) => {
                    const ann = r.annRate ?? r.annPct;
                    const beat = ann >= r.holdAnn;
                    return (
                    <div key={s.id} className="bt-srow">
                      <div className="bt-srow-head">
                        <span className="bt-rank">{i + 1}</span>
                        <span className="bt-srow-name">{s.name}</span>
                        <span className={'bt-srow-val ' + (ann >= 0 ? 'up' : 'down')} title="Yıllık getiri — nakitteyken TCMB faizi dahil (Al-Tut'a rakip)">
                          {fmtPct(ann)}
                          <span className="bt-tag">yıl ✦</span>
                        </span>
                      </div>
                      <div className="bt-barwrap">
                        <div className={'bt-bar ' + (ann >= 0 ? 'pos' : 'neg')} style={{ width: barW(ann, maxAnn) }} />
                      </div>
                      <div className="bt-srow-sub">
                        toplam {fmtX(r.retRate ?? r.retPct)} · {r.trades} işlem · Kazanma %{r.winRate.toFixed(0)} · Düşüş -
                        {r.maxDD.toFixed(0)}%
                      </div>
                      <div className="bt-srow-sub bt-days">
                        ⏱️ ort {Math.round(r.avgHoldDays ?? 0)} gün/işlem · işlemde {r.daysIn ?? 0} gün · boşta {r.daysOut ?? 0} gün
                      </div>
                      <div className="bt-srow-sub bt-rival">
                        💰 faiz dahil <b className={ann >= 0 ? 'up' : 'down'}>{fmtPct(ann)}</b> · saf strateji{' '}
                        {fmtPct(r.annPct)} · Al-Tut <b className={r.holdAnn >= 0 ? 'up' : 'down'}>{fmtPct(r.holdAnn)}</b>{' '}
                        <span className={beat ? 'rv-win' : 'rv-lose'}>{beat ? '✓ geçti' : 'geçemedi'}</span>
                      </div>
                      <div className="eq-wrap" title="Sermaye eğrisi: 1₺ nasıl büyürdü (renkli: strateji + nakit faizi, gri: Al-Tut, kesik: başabaş)">
                        <EquitySpark data={eq} />
                        <div className="eq-leg lg-muted">renkli: Strateji (faiz dahil) · gri: Al-Tut · kesik çizgi: başabaş</div>
                      </div>
                      <div className="bt-srow-explain">{describe(s)}</div>
                      <div className="sb-rowbtns">
                        <button onClick={() => onApply(s)}>📈 Grafikte göster</button>
                        <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}>📅 Aylık</button>
                        <button onClick={() => edit(s)}>Düzenle</button>
                        <button className="sb-del" onClick={() => del(s.id)}>Sil</button>
                      </div>
                      {expanded === s.id && <Heatmap data={monthlyReturns(candles.close, candles.time, pos)} />}
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="bt-intro">
                Kayıtlı stratejilerini <b>en eski 300 BIST hissesinde</b> (en uzun geçmişe sahip) tarar; <b>nakit faizi
                dahil yıllık</b> getirisi en yüksek 20 <b>hisse + strateji</b> eşleşmesini listeler. Bir satıra tıkla → o
                hisseyi açar ve stratejiyi işaretler.{' '}
                <span className="lg-muted">(Nakit faizi yıllık %{rate.toFixed(0)}. 300 hisse indirildiği için biraz sürebilir.)</span>
              </p>
              <div className="sb-actions">
                <button className="scr-add" onClick={runScan} disabled={!strats.length || scan?.running}>
                  {scan?.running ? `Taranıyor… ${scan.done}/${scan.total}` : '🔍 Tara'}
                </button>
                {!strats.length && <span className="bt-note">Önce "Stratejilerim"den strateji ekle.</span>}
              </div>
              {scan && !scan.running && (
                <div className="bt-list">
                  {scan.rows.length === 0 ? (
                    <div className="bt-note">Eşleşen sonuç yok.</div>
                  ) : (
                    scan.rows.map((t, i) => (
                      <div
                        key={t.sym + t.strat.id}
                        className="bt-srow clickable"
                        onClick={() => onPickCombo(t.sym, t.strat)}
                        title="Hisseyi aç + grafikte göster"
                      >
                        <div className="bt-srow-head">
                          <span className="bt-rank">{i + 1}</span>
                          <span className="bt-srow-name">
                            <b>{t.sym}</b> · {t.strat.name}
                          </span>
                          <span className={'bt-srow-val ' + (t.ann >= 0 ? 'up' : 'down')} title="Yıllık getiri — nakit faizi dahil (Al-Tut'a rakip)">
                            {fmtPct(t.ann)}
                            <span className="bt-tag">yıl ✦</span>
                          </span>
                        </div>
                        <div className="bt-barwrap">
                          <div className={'bt-bar ' + (t.ann >= 0 ? 'pos' : 'neg')} style={{ width: barW(t.ann, topMax) }} />
                        </div>
                        <div className="bt-srow-sub">
                          toplam {fmtX(t.ret)} · {t.trades} işlem · Kazanma %{t.win.toFixed(0)} · Düşüş -{t.dd.toFixed(0)}%
                        </div>
                        <div className="bt-srow-sub bt-days">
                          ⏱️ ort {Math.round(t.avg)} gün/işlem · işlemde {t.daysIn} gün · boşta {t.daysOut} gün
                        </div>
                        <div className="bt-srow-sub bt-rival">
                          💰 faiz dahil <b className={t.ann >= 0 ? 'up' : 'down'}>{fmtPct(t.ann)}</b> · Al-Tut{' '}
                          <b className={t.hold >= 0 ? 'up' : 'down'}>{fmtPct(t.hold)}</b>{' '}
                          <span className={t.ann >= t.hold ? 'rv-win' : 'rv-lose'}>{t.ann >= t.hold ? '✓ geçti' : 'geçemedi'}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className="bt-hint">⚠️ Geçmişe dönük; yatırım tavsiyesi değildir.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CondGroup({ label, conds, onChange }: { label: string; conds: Cond[]; onChange: (c: Cond[]) => void }) {
  const set = (i: number, c: Cond) => onChange(conds.map((x, idx) => (idx === i ? c : x)));
  return (
    <div className="sb-group">
      <div className="sb-grouplabel">{label}</div>
      {conds.map((c, i) => (
        <CondRow key={i} c={c} onChange={(nc) => set(i, nc)} onRemove={() => onChange(conds.filter((_, idx) => idx !== i))} />
      ))}
      <button className="sb-addcond" onClick={() => onChange([...conds, newCond()])}>
        + koşul ekle
      </button>
    </div>
  );
}

// Decimal-friendly value input: keeps the raw text so "0.", "0.00", "0.0083"
// can be typed (a controlled number would strip the trailing dot/zeros).
function ValInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => {
    if (parseFloat(txt.replace(',', '.')) !== value) setTxt(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="cond-v"
      value={txt}
      inputMode="decimal"
      placeholder="değer"
      onChange={(e) => {
        const raw = e.target.value;
        setTxt(raw);
        const v = parseFloat(raw.replace(',', '.'));
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

function CondRow({ c, onChange, onRemove }: { c: Cond; onChange: (c: Cond) => void; onRemove: () => void }) {
  return (
    <div className="cond">
      <select value={c.ind} onChange={(e) => onChange({ ...c, ind: e.target.value })}>
        {INDS.map((i) => (
          <option key={i.key} value={i.key}>
            {i.label}
          </option>
        ))}
      </select>
      {hasParam(c.ind) && (
        <input className="cond-p" value={c.p} inputMode="numeric" onChange={(e) => onChange({ ...c, p: +e.target.value || 0 })} />
      )}
      <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Cond['op'] })}>
        {OPS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <select value={c.tgt} onChange={(e) => onChange({ ...c, tgt: e.target.value as 'val' | 'ind' })}>
        <option value="val">Değer</option>
        <option value="ind">Gösterge</option>
      </select>
      {c.tgt === 'val' ? (
        <ValInput value={c.val} onChange={(v) => onChange({ ...c, val: v })} />
      ) : (
        <>
          <select value={c.ind2} onChange={(e) => onChange({ ...c, ind2: e.target.value })}>
            {INDS.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </select>
          {hasParam(c.ind2) && (
            <input className="cond-p" value={c.p2} inputMode="numeric" onChange={(e) => onChange({ ...c, p2: +e.target.value || 0 })} />
          )}
        </>
      )}
      <button className="cond-x" onClick={onRemove} title="Koşulu kaldır">×</button>
    </div>
  );
}

// Plain-language one-liner of a strategy's rules.
function describe(s: CustomStrategy): string {
  const part = (c: Cond) => {
    const left = ind(c.ind, c.p);
    const opl = c.op === 'gt' ? '>' : c.op === 'lt' ? '<' : c.op === 'cu' ? '↗ keser' : '↘ keser';
    const right = c.tgt === 'val' ? String(c.val) : ind(c.ind2, c.p2);
    return `${left} ${opl} ${right}`;
  };
  const buy = s.buy.map(part).join(' ve ');
  const sell = s.sell.length ? s.sell.map(part).join(' ve ') : 'AL koşulu bozulunca';
  return `AL: ${buy}  →  SAT: ${sell}`;
}
function ind(key: string, p: number): string {
  const lbl = INDS.find((i) => i.key === key)?.label ?? key;
  return hasParam(key) ? `${lbl}(${p})` : lbl;
}

function fmtX(r: number): string {
  if (!isFinite(r)) return '—';
  if (r >= 1000) {
    const m = 1 + r / 100;
    return (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + 'x';
  }
  return (r >= 0 ? '+' : '') + Math.round(r) + '%';
}
function fmtPct(r: number): string {
  if (!isFinite(r)) return '—';
  return (r >= 0 ? '+' : '') + (Math.abs(r) < 10 ? r.toFixed(1) : Math.round(r).toString()) + '%';
}
function barW(v: number, max: number): string {
  return Math.max(3, Math.min(100, (Math.abs(v) / max) * 100)) + '%';
}

// Downsampled equity curves: strategy vs Buy & Hold (both start at 1).
interface Eq {
  strat: number[];
  hold: number[];
}
function equitySpark(close: Float64Array, pos: Uint8Array, time: Float64Array, dailyRate = 0, points = 90): Eq {
  const n = close.length;
  if (n < 2) return { strat: [], hold: [] };
  const step = Math.max(1, Math.floor(n / points));
  const strat: number[] = [];
  const hold: number[] = [];
  let e = 1;
  const base = close[0];
  for (let i = 1; i < n; i++) {
    if (pos[i - 1]) e *= close[i] / close[i - 1];
    else if (dailyRate) {
      const cal = Math.min(Math.max((time[i] - time[i - 1]) / 86400, 0), 31);
      e *= Math.pow(1 + dailyRate, cal); // cash earns interest while flat
    }
    if (i % step === 0) {
      strat.push(e);
      hold.push(close[i] / base);
    }
  }
  strat.push(e);
  hold.push(close[n - 1] / base);
  return { strat, hold };
}

function EquitySpark({ data }: { data: Eq }) {
  const { strat, hold } = data;
  if (strat.length < 2) return null;
  const all = [...strat, ...hold, 1];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const rng = max - min || 1;
  const W = 300;
  const H = 40;
  const y = (v: number) => (H - 1 - ((v - min) / rng) * (H - 2)).toFixed(1);
  const line = (arr: number[]) => arr.map((v, i) => `${((i / (arr.length - 1)) * (W - 2) + 1).toFixed(1)},${y(v)}`).join(' ');
  const up = strat[strat.length - 1] >= 1;
  return (
    <svg className="eq-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" y1={y(1)} x2={W} y2={y(1)} stroke="#3a4150" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={line(hold)} fill="none" stroke="#6b7280" strokeWidth="1.2" />
      <polyline points={line(strat)} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.7" />
    </svg>
  );
}

// Monthly returns of the strategy equity → year × month grid for a heatmap.
interface MonthRow {
  y: number;
  m: (number | null)[];
}
function monthlyReturns(close: Float64Array, time: Float64Array, pos: Uint8Array): MonthRow[] {
  const n = close.length;
  if (n < 2) return [];
  const eq = new Float64Array(n);
  let e = 1;
  eq[0] = 1;
  for (let i = 1; i < n; i++) {
    if (pos[i - 1]) e *= close[i] / close[i - 1];
    eq[i] = e;
  }
  const map = new Map<string, { first: number; last: number }>();
  for (let i = 0; i < n; i++) {
    const d = new Date(time[i] * 1000);
    const k = d.getFullYear() + '-' + d.getMonth();
    let g = map.get(k);
    if (!g) {
      g = { first: eq[i], last: eq[i] };
      map.set(k, g);
    }
    g.last = eq[i];
  }
  const years = [...new Set([...map.keys()].map((k) => +k.split('-')[0]))].sort((a, b) => a - b);
  return years.map((yr) => {
    const m: (number | null)[] = Array(12).fill(null);
    for (let mo = 0; mo < 12; mo++) {
      const g = map.get(yr + '-' + mo);
      if (g && g.first > 0) m[mo] = (g.last / g.first - 1) * 100;
    }
    return { y: yr, m };
  });
}

const MONTHS = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A'];
function Heatmap({ data }: { data: MonthRow[] }) {
  if (!data.length) return null;
  const color = (v: number | null) => {
    if (v == null) return 'transparent';
    const a = Math.min(1, Math.abs(v) / 20) * 0.85 + 0.1;
    return v >= 0 ? `rgba(38,166,154,${a})` : `rgba(239,83,80,${a})`;
  };
  return (
    <div className="hm-wrap">
      <table className="hm">
        <thead>
          <tr>
            <th />
            {MONTHS.map((m, i) => (
              <th key={i}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.y}>
              <td className="hm-y">{row.y}</td>
              {row.m.map((v, i) => (
                <td key={i} style={{ background: color(v) }} title={v == null ? '' : `${row.y} · ${(v >= 0 ? '+' : '') + v.toFixed(1)}%`}>
                  {v == null ? '' : Math.round(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bt-note">Aylık getiri (yeşil + / kırmızı −). Strateji o ay pozisyondaysa kâr/zarar.</div>
    </div>
  );
}
