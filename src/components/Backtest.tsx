import { useMemo, useState } from 'react';
import { Candles } from '../data/types';
import { evalPosition } from '../indicators/backtest';
import { fetchBistStatic } from '../data/bistStatic';
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
  ann: number;
  ret: number;
  trades: number;
  win: number;
  dd: number;
}

const blankDraft = (): CustomStrategy => ({ id: '', name: '', buy: [newCond()], sell: [] });

export function Backtest({ candles, symbol, universe, strats, onSave, onApply, onPickCombo, onClose }: Props) {
  const [tab, setTab] = useState<'mine' | 'top'>('mine');
  const [draft, setDraft] = useState<CustomStrategy>(blankDraft);
  const [scan, setScan] = useState<{ rows: Combo[]; done: number; total: number; running: boolean } | null>(null);

  // Backtest each saved strategy on the current symbol.
  const results = useMemo(
    () =>
      strats
        .map((s) => ({ s, r: evalPosition(candles, buildCustomPosition(candles, s)) }))
        .sort((a, b) => b.r.annPct - a.r.annPct),
    [strats, candles],
  );

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
  const edit = (s: CustomStrategy) =>
    setDraft({ id: s.id, name: s.name, buy: s.buy.map((c) => ({ ...c })), sell: s.sell.map((c) => ({ ...c })) });

  const runScan = async () => {
    if (!strats.length || !universe.length) return;
    setScan({ rows: [], done: 0, total: universe.length, running: true });
    const best = new Map<string, Combo>();
    const queue = [...universe];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const sym = queue.shift()!;
        try {
          const c = await fetchBistStatic(sym);
          if (c.length >= 80) {
            for (const s of strats) {
              const r = evalPosition(c, buildCustomPosition(c, s));
              if (r.trades > 0) {
                const prev = best.get(sym);
                if (!prev || r.annPct > prev.ann)
                  best.set(sym, { sym, strat: s, ann: r.annPct, ret: r.retPct, trades: r.trades, win: r.winRate, dd: r.maxDD });
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

              <p className="bt-intro">
                <b>{symbol}</b> üzerinde kayıtlı stratejilerin sonuçları (<b>yıllık</b> getiriye göre). Bir satıra tıkla →
                grafikte AL/SAT işaretlenir.
              </p>

              {results.length === 0 ? (
                <div className="bt-note">Henüz strateji yok. Yukarıdan koşulları seçip kaydet.</div>
              ) : (
                <div className="bt-list">
                  {results.map(({ s, r }, i) => (
                    <div key={s.id} className="bt-srow">
                      <div className="bt-srow-head">
                        <span className="bt-rank">{i + 1}</span>
                        <span className="bt-srow-name">{s.name}</span>
                        <span className={'bt-srow-val ' + (r.annPct >= 0 ? 'up' : 'down')}>
                          {fmtPct(r.annPct)}
                          <span className="bt-tag">yıl</span>
                        </span>
                      </div>
                      <div className="bt-srow-sub">
                        toplam {fmtX(r.retPct)} · {r.trades} işlem · Kazanma %{r.winRate.toFixed(0)} · Düşüş -
                        {r.maxDD.toFixed(0)}%
                      </div>
                      <div className="bt-srow-explain">{describe(s)}</div>
                      <div className="sb-rowbtns">
                        <button onClick={() => onApply(s)}>📈 Grafikte göster</button>
                        <button onClick={() => edit(s)}>Düzenle</button>
                        <button className="sb-del" onClick={() => del(s.id)}>Sil</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="bt-intro">
                Kayıtlı stratejilerini ~{universe.length} hissede (izleme listen + portföyün + likit BIST hisseleri)
                tarar; <b>yıllık</b> getirisi en yüksek 20 <b>hisse + strateji</b> eşleşmesini listeler. Bir satıra tıkla
                → o hisseyi açar ve stratejiyi işaretler.
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
                          <span className={'bt-srow-val ' + (t.ann >= 0 ? 'up' : 'down')}>
                            {fmtPct(t.ann)}
                            <span className="bt-tag">yıl</span>
                          </span>
                        </div>
                        <div className="bt-srow-sub">
                          toplam {fmtX(t.ret)} · {t.trades} işlem · Kazanma %{t.win.toFixed(0)} · Düşüş -{t.dd.toFixed(0)}%
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
        <input className="cond-v" value={c.val} inputMode="decimal" onChange={(e) => onChange({ ...c, val: parseFloat(e.target.value.replace(',', '.')) || 0 })} />
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
