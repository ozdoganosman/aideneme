import { useEffect, useMemo, useState } from 'react';
import { Candles } from '../data/types';
import { fetchBistStatic, Quotes } from '../data/bistStatic';
import { analyzeHolding, HoldingAnalysis } from '../indicators/analysis';
import { evalPosition, StrategyResult } from '../indicators/backtest';
import { CustomStrategy, buildCustomPosition, candidateStrategies } from '../indicators/customStrategy';
import { inflationDailyRates, inflationAvgAnnual } from '../data/inflation';
import { IndicatorParams } from '../indicators/calc';
import { Holding } from './Portfolio';

interface Row {
  sym: string;
  value: number;
  weight: number;
  a: HoldingAnalysis | null;
}

interface Props {
  holdings: Holding[];
  quotes: Quotes;
  strats: CustomStrategy[];
  params: IndicatorParams;
  onClose: () => void;
  onSelect: (s: string) => void;
}

export function PortfolioAnalysis({ holdings, quotes, strats, params, onClose, onSelect }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bench, setBench] = useState<number | null>(null); // XU100 1Y return %
  const [hist, setHist] = useState<Map<string, Candles>>(new Map());
  const [xu, setXu] = useState<Candles | null>(null);

  useEffect(() => {
    let cancel = false;
    const totVal = holdings.reduce((s, h) => s + (quotes[h.symbol]?.c ?? 0) * h.qty, 0);
    Promise.all(
      holdings.map(async (h) => {
        const value = (quotes[h.symbol]?.c ?? 0) * h.qty;
        let a: HoldingAnalysis | null = null;
        let c: Candles | null = null;
        try {
          c = await fetchBistStatic(h.symbol);
          a = analyzeHolding(c);
        } catch {
          a = null;
        }
        return { sym: h.symbol, value, weight: totVal ? (value / totVal) * 100 : 0, a, c };
      }),
    ).then((out) => {
      if (cancel) return;
      const m = new Map<string, Candles>();
      out.forEach((o) => o.c && m.set(o.sym, o.c));
      setHist(m);
      setRows(out.map((o) => ({ sym: o.sym, value: o.value, weight: o.weight, a: o.a })).sort((x, y) => y.weight - x.weight));
    });
    fetchBistStatic('XU100')
      .then((c) => {
        if (!cancel) {
          setXu(c);
          setBench(analyzeHolding(c)?.r1y ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [holdings, quotes]);

  const series = useMemo(() => buildValueSeries(holdings, hist, xu), [holdings, hist, xu]);
  const risk = useMemo(() => (rows ? portfolioRisk(rows, hist, xu) : null), [rows, hist, xu]);

  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Portföy Analizi · Risk & Teknik</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>
        <div className="modal-body">
          {!rows ? (
            <div className="bt-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="spinner" /> Hisseler analiz ediliyor…
            </div>
          ) : rows.length === 0 ? (
            <div className="bt-note">Portföyde pozisyon yok. Önce sembol · adet · maliyet ekle.</div>
          ) : (
            <>
              {renderConcentration(rows)}
              {series && <ValueChartCard pv={series.pv} xv={series.xv} chg={series.chg} xchg={series.xchg} t0={series.t0} t1={series.t1} />}
              {risk && <AdvancedRiskCard risk={risk} />}
              <StrategyBacktestCard rows={rows} hist={hist} strats={strats} params={params} xu={xu} onSelect={pick} />
              {renderRisk(rows, bench, risk)}
              {renderTech(rows, pick)}
              <div className="bt-hint">
                ⚠️ Bu analiz geçmiş fiyatlara dayalı, otomatik ve eğitim amaçlıdır — yatırım tavsiyesi değildir.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderConcentration(rows: Row[]) {
  const ws = rows.map((r) => r.weight);
  const largest = ws.length ? Math.max(...ws) : 0;
  const top3 = ws.slice().sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0);
  const hhi = ws.reduce((s, w) => s + (w / 100) * (w / 100), 0);
  const effN = hhi > 0 ? 1 / hhi : 0;
  let verdict = 'Orta düzeyde dağılım.';
  let cls = '';
  if (largest >= 50) {
    verdict = `Tek hisseye aşırı yoğunlaşmış (${rows[0].sym} %${largest.toFixed(0)}) — yüksek tekil risk.`;
    cls = 'down';
  } else if (largest >= 35) {
    verdict = 'Yoğunlaşmış — bir-iki hisseye fazla bağımlı.';
    cls = 'warn';
  } else if (rows.length >= 6 && largest < 20) {
    verdict = 'İyi dağılmış — risk geniş yayılmış.';
    cls = 'up';
  }
  return (
    <div className="pa-card">
      <div className="pa-card-title">📊 Dağılım & Yoğunlaşma</div>
      <div className="pa-grid">
        <div>
          <span className="lg-muted">Pozisyon</span>
          <b>{rows.length}</b>
        </div>
        <div>
          <span className="lg-muted">En büyük</span>
          <b>
            {rows[0].sym} %{largest.toFixed(0)}
          </b>
        </div>
        <div>
          <span className="lg-muted">İlk 3 ağırlık</span>
          <b>%{top3.toFixed(0)}</b>
        </div>
        <div>
          <span className="lg-muted">Etkin çeşitlilik</span>
          <b>{effN.toFixed(1)} hisse</b>
        </div>
      </div>
      <div className={'pa-verdict ' + cls}>{verdict}</div>
    </div>
  );
}

function renderRisk(rows: Row[], bench: number | null, risk: RiskStats | null) {
  const withA = rows.filter((r) => r.a);
  const pvol = withA.reduce((s, r) => s + (r.weight / 100) * r.a!.volPct, 0);
  const pr1y = withA.reduce((s, r) => s + (r.weight / 100) * r.a!.r1y, 0);
  let plabel = 'Düşük';
  if (pvol >= 80) plabel = 'Çok yüksek';
  else if (pvol >= 50) plabel = 'Yüksek';
  else if (pvol >= 30) plabel = 'Orta';
  const rel = bench != null ? pr1y - bench : null;
  return (
    <div className="pa-card">
      <div className="pa-card-title">⚠️ Risk & XU100'e görece</div>
      <div className="pa-portrisk">
        Portföy oynaklığı (yaklaşık): <b>~%{pvol.toFixed(0)}/yıl</b> · {plabel}{' '}
        <span className="lg-muted">(korelasyon hariç üst sınır)</span>
      </div>
      {bench != null && (
        <div className="pa-portrisk">
          Portföy 1Y:{' '}
          <b className={pr1y >= 0 ? 'up' : 'down'}>
            {pr1y >= 0 ? '+' : ''}
            {pr1y.toFixed(0)}%
          </b>{' '}
          · XU100: <b>{bench >= 0 ? '+' : ''}{bench.toFixed(0)}%</b> · Görece:{' '}
          <b className={(rel ?? 0) >= 0 ? 'up' : 'down'}>
            {(rel ?? 0) >= 0 ? '+' : ''}
            {(rel ?? 0).toFixed(0)}%
          </b>{' '}
          <span className="lg-muted">({(rel ?? 0) >= 0 ? 'endeksi yendi' : 'endeksin altında'})</span>
        </div>
      )}
      <div className="pa-risk-list">
        {rows.map((r) => (
          <div key={r.sym} className="pa-risk-row">
            <span className="pa-risk-sym">{r.sym}</span>
            <span className="lg-muted">%{r.weight.toFixed(0)}</span>
            {r.a ? (
              <>
                <span className={'pa-risk-badge ' + r.a.riskClass}>{r.a.riskLabel}</span>
                <span className="lg-muted">oyn ~%{r.a.volPct.toFixed(0)}</span>
                <span className="down">Düşüş -{r.a.maxDD.toFixed(0)}%</span>
                <span className={r.a.r1y >= 0 ? 'up' : 'down'}>
                  1Y {r.a.r1y >= 0 ? '+' : ''}
                  {r.a.r1y.toFixed(0)}%
                </span>
                {bench != null && (
                  <span className={r.a.r1y - bench >= 0 ? 'up' : 'down'} title="XU100'e görece 1Y">
                    XU {r.a.r1y - bench >= 0 ? '+' : ''}
                    {(r.a.r1y - bench).toFixed(0)}%
                  </span>
                )}
                {risk?.betas.get(r.sym) != null && (
                  <span className="lg-muted" title="XU100'e duyarlılık (beta). >1 endeksten oynak.">
                    β {risk.betas.get(r.sym)!.toFixed(2)}
                  </span>
                )}
              </>
            ) : (
              <span className="lg-muted">veri yok</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderTech(rows: Row[], pick: (s: string) => void) {
  const withA = rows.filter((r) => r.a);
  const up = withA.filter((r) => r.a!.trend.toLowerCase().includes('yukar')).length;
  const ob = withA.filter((r) => r.a!.rsi >= 70).length;
  const os = withA.filter((r) => r.a!.rsi <= 30).length;
  const pos = withA.filter((r) => r.a!.lean === 'Olumlu').length;
  return (
    <div className="pa-card">
      <div className="pa-card-title">🧭 Teknik Analiz (sade)</div>
      {withA.length > 0 && (
        <div className="pa-techroll">
          <span className="up">{up}/{withA.length} yukarı trend</span>
          <span className="up">{pos} olumlu</span>
          {ob > 0 && <span className="warn">{ob} aşırı alım</span>}
          {os > 0 && <span className="down">{os} aşırı satım</span>}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.sym} className="pa-tech" onClick={() => pick(r.sym)} title="Grafikte aç">
          <div className="pa-tech-head">
            <b>{r.sym}</b>
            {r.a && (
              <span className={'pa-lean ' + (r.a.lean === 'Olumlu' ? 'up' : r.a.lean === 'Zayıf' ? 'down' : 'warn')}>
                {r.a.lean}
              </span>
            )}
            {r.a && <span className="lg-muted">{r.a.trend}</span>}
          </div>
          {r.a ? (
            <ul className="pa-bullets">
              {r.a.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : (
            <div className="bt-note">Yeterli geçmiş veri yok.</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Strategy backtest across the whole portfolio ─────────────────────────────
interface BtRow {
  sym: string;
  weight: number;
  ann: number; // strategy annualized (incl. inflation on cash)
  hold: number; // Al-Tut annualized
  trades: number;
  name: string; // which strategy (for "best per holding" mode)
  ok: boolean;
}
function bestForHolding(c: Candles, params: IndicatorParams): { strat: CustomStrategy; r: StrategyResult; pos: Uint8Array } | null {
  const rates = inflationDailyRates(c.time, c.length);
  const split = Math.floor(c.length * 0.7);
  const cache = new Map<string, Float64Array>();
  let bestScore = -Infinity;
  let bestStrat: CustomStrategy | null = null;
  let bestPos: Uint8Array | null = null;
  for (const s of candidateStrategies()) {
    const pos = buildCustomPosition(c, s, cache, params);
    const tr = evalPosition(c, pos, rates, 0, split);
    const te = evalPosition(c, pos, rates, split, c.length - 1);
    if (tr.trades > 0 && te.trades > 0) {
      const score = Math.min((tr.annRate ?? 0) - tr.holdAnn, (te.annRate ?? 0) - te.holdAnn);
      if (score > bestScore) {
        bestScore = score;
        bestStrat = s;
        bestPos = pos;
      }
    }
  }
  if (!bestStrat || !bestPos) return null;
  return { strat: bestStrat, r: evalPosition(c, bestPos, rates), pos: bestPos };
}

// Realistic equity series (price while in position, inflation while in cash).
function equitySeries(c: Candles, pos: Uint8Array, rates: Float64Array): Float64Array {
  const n = c.length;
  const e = new Float64Array(n);
  let v = 1;
  e[0] = 1;
  for (let i = 1; i < n; i++) {
    if (pos[i - 1]) v *= c.close[i] / c.close[i - 1];
    else {
      const cal = Math.min(Math.max((c.time[i] - c.time[i - 1]) / 86400, 0), 31);
      v *= Math.pow(1 + rates[i], cal);
    }
    e[i] = v;
  }
  return e;
}

// Day-by-day combined portfolio value over the common period, rebased to 100:
// strategy (each holding's realistic equity) vs Al-Tut (buy & hold), current weights.
interface Pick {
  weight: number;
  c: Candles;
  pos: Uint8Array;
  rates: Float64Array;
}
function buildCombined(picks: Pick[], xu: Candles | null) {
  if (picks.length === 0) return null;
  const startT = Math.max(...picks.map((p) => p.c.time[0]));
  const set = new Set<number>();
  for (const p of picks) for (let i = 0; i < p.c.length; i++) if (p.c.time[i] >= startT) set.add(p.c.time[i]);
  const axis = [...set].sort((a, b) => a - b);
  if (axis.length < 3) return null;
  const wsum = picks.reduce((s, p) => s + p.weight, 0) || 1;
  const eq = picks.map((p) => equitySeries(p.c, p.pos, p.rates));
  const baseIdx = picks.map((p) => {
    let i = 0;
    while (i < p.c.length && p.c.time[i] < startT) i++;
    return Math.min(i, p.c.length - 1);
  });
  const ptr = picks.map(() => 0);
  const stratF: number[] = [];
  const holdF: number[] = [];
  for (const t of axis) {
    let sV = 0;
    let hV = 0;
    for (let k = 0; k < picks.length; k++) {
      const c = picks[k].c;
      while (ptr[k] < c.length && c.time[ptr[k]] <= t) ptr[k]++;
      const idx = Math.max(baseIdx[k], ptr[k] - 1);
      const w = picks[k].weight / wsum;
      sV += w * (eq[k][idx] / (eq[k][baseIdx[k]] || 1));
      hV += w * (c.close[idx] / (c.close[baseIdx[k]] || 1));
    }
    stratF.push(sV);
    holdF.push(hV);
  }
  let xuF: number[] | null = null;
  if (xu && xu.length) {
    let bi = 0;
    while (bi < xu.length && xu.time[bi] < startT) bi++;
    bi = Math.min(bi, xu.length - 1);
    const base = xu.close[bi] || 1;
    let p = 0;
    xuF = [];
    for (const t of axis) {
      while (p < xu.length && xu.time[p] <= t) p++;
      xuF.push(xu.close[Math.max(bi, p - 1)] / base);
    }
  }
  const years = Math.max((axis[axis.length - 1] - axis[0]) / (365.25 * 86400), 1e-6);
  const ann = (v: number) => (Math.pow(Math.max(v, 1e-9), 1 / years) - 1) * 100;
  const annStrat = ann(stratF[stratF.length - 1]);
  const annHold = ann(holdF[holdF.length - 1]);
  const avgInfl = inflationAvgAnnual(axis, axis.length);
  const real = (a: number) => ((1 + a / 100) / (1 + avgInfl / 100) - 1) * 100;
  // Sharpe over inflation (risk-free = inflation), from daily combined returns.
  const rp: number[] = [];
  let m = 0;
  for (let i = 1; i < stratF.length; i++) {
    const r = stratF[i] / stratF[i - 1] - 1;
    rp.push(r);
    m += r;
  }
  m /= rp.length || 1;
  let v = 0;
  for (const r of rp) v += (r - m) * (r - m);
  const sd = Math.sqrt(rp.length > 1 ? v / (rp.length - 1) : 0);
  const rfDaily = Math.pow(1 + avgInfl / 100, 1 / 252) - 1;
  const sharpe = sd > 0 ? ((m - rfDaily) / sd) * Math.sqrt(252) : 0;
  let peak = -Infinity;
  let dd = 0;
  for (const x of stratF) {
    if (x > peak) peak = x;
    const d = (peak - x) / peak;
    if (d > dd) dd = d;
  }
  const step = Math.max(1, Math.floor(axis.length / 120));
  const samp = (arr: number[]) => {
    const o: number[] = [];
    for (let i = 0; i < arr.length; i += step) o.push(arr[i] * 100);
    o.push(arr[arr.length - 1] * 100);
    return o;
  };
  return {
    strat: samp(stratF),
    hold: samp(holdF),
    xu: xuF ? samp(xuF) : null,
    chg: (stratF[stratF.length - 1] - 1) * 100,
    holdChg: (holdF[holdF.length - 1] - 1) * 100,
    xuChg: xuF ? (xuF[xuF.length - 1] - 1) * 100 : null,
    maxDD: dd * 100,
    sharpe,
    realStrat: real(annStrat),
    realHold: real(annHold),
    avgInfl,
    t0: axis[0],
    t1: axis[axis.length - 1],
  };
}

function StrategyBacktestCard({
  rows,
  hist,
  strats,
  params,
  xu,
  onSelect,
}: {
  rows: Row[];
  hist: Map<string, Candles>;
  strats: CustomStrategy[];
  params: IndicatorParams;
  xu: Candles | null;
  onSelect: (s: string) => void;
}) {
  const [mode, setMode] = useState<'saved' | 'best'>(strats.length ? 'saved' : 'best');
  const [sid, setSid] = useState<string>(strats[0]?.id ?? '');
  const sel = strats.find((s) => s.id === sid) ?? strats[0];

  const res = useMemo(() => {
    const out: BtRow[] = [];
    const picks: Pick[] = [];
    for (const r of rows) {
      const c = hist.get(r.sym);
      if (!c || c.length < 60) continue;
      const rates = inflationDailyRates(c.time, c.length);
      let pos: Uint8Array | null = null;
      let rr: StrategyResult | null = null;
      let name = '';
      if (mode === 'best') {
        const b = bestForHolding(c, params);
        if (b) {
          pos = b.pos;
          rr = b.r;
          name = b.strat.name;
        }
      } else if (sel) {
        pos = buildCustomPosition(c, sel, undefined, params);
        rr = evalPosition(c, pos, rates);
        name = sel.name;
      }
      if (pos && rr) {
        out.push({ sym: r.sym, weight: r.weight, ann: rr.annRate ?? rr.annPct, hold: rr.holdAnn, trades: rr.trades, name, ok: rr.trades > 0 });
        picks.push({ weight: r.weight, c, pos, rates });
      }
    }
    const wsum = out.reduce((s, o) => s + o.weight, 0) || 1;
    const cAnn = out.reduce((s, o) => s + (o.weight / wsum) * o.ann, 0);
    const cHold = out.reduce((s, o) => s + (o.weight / wsum) * o.hold, 0);
    return { out: out.sort((a, b) => b.weight - a.weight), cAnn, cHold, n: out.length, curve: buildCombined(picks, xu) };
  }, [rows, hist, mode, sel, params, xu]);

  const beat = res.cAnn >= res.cHold;
  return (
    <div className="pa-card">
      <div className="pa-card-title">🤖 Strateji ile Portföy Backtest</div>
      <div className="bt-rate">
        <select value={mode === 'best' ? '__best' : sid} onChange={(e) => (e.target.value === '__best' ? setMode('best') : (setMode('saved'), setSid(e.target.value)))}>
          {strats.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="__best">🎯 Her hisseye en iyi (otomatik)</option>
        </select>
        <span className="lg-muted">enf. dahil yıllık · ağırlıklı</span>
      </div>
      {res.n === 0 ? (
        <div className="bt-note">{strats.length === 0 && mode === 'saved' ? 'Önce strateji oluştur ya da "Her hisseye en iyi" seç.' : 'Yeterli geçmişli hisse yok.'}</div>
      ) : (
        <>
          <div className="pa-verdict">
            Portföy (ağırlıklı): strateji <b className={beat ? 'up' : 'down'}>{fmtP(res.cAnn)}</b> · Al-Tut{' '}
            <b className={res.cHold >= 0 ? 'up' : 'down'}>{fmtP(res.cHold)}</b>{' '}
            <span className={beat ? 'rv-win' : 'rv-lose'}>{beat ? '✓ geçti' : 'geçemedi'}</span>
          </div>
          {res.curve && <CombinedCurve cv={res.curve} />}
          <div className="pa-risk-list">
            {res.out.map((o) => (
              <div key={o.sym} className="pa-risk-row pa-bt-row" onClick={() => onSelect(o.sym)} title="Grafikte aç">
                <span className="pa-risk-sym">{o.sym}</span>
                <span className="lg-muted">%{o.weight.toFixed(0)}</span>
                <span className={o.ann >= o.hold ? 'up' : 'down'}>strat {fmtP(o.ann)}</span>
                <span className="lg-muted">Al-Tut {fmtP(o.hold)}</span>
                <span className="lg-muted">{o.trades} işlem</span>
                {mode === 'best' && <span className="pa-bt-name">{o.name}</span>}
              </div>
            ))}
          </div>
          <div className="bt-note">
            Her hisseye strateji ayrı uygulanır (nakitteyken enflasyon kazanır); portföy = mevcut ağırlıklarla ortalama.
            {mode === 'best' && ' "Her hisseye en iyi": geçmiş+test döneminde Al-Tut\'u en tutarlı geçen kombinasyon.'}
          </div>
        </>
      )}
    </div>
  );
}
function fmtP(v: number): string {
  return (v >= 0 ? '+' : '') + Math.round(v) + '%';
}

function CombinedCurve({ cv }: { cv: NonNullable<ReturnType<typeof buildCombined>> }) {
  const all = [...cv.strat, ...cv.hold, ...(cv.xu ?? [])].filter((v) => isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const rng = max - min || 1;
  const W = 560;
  const H = 90;
  const y = (v: number) => (H - 2 - ((v - min) / rng) * (H - 8)).toFixed(1);
  const xx = (i: number, len: number) => ((i / (len - 1)) * (W - 2) + 1).toFixed(1);
  const line = (arr: number[]) => arr.map((v, i) => `${xx(i, arr.length)},${y(v)}`).join(' ');
  const up = cv.chg >= 0;
  const col = up ? '#26a69a' : '#ef5350';
  const fmtD = (t: number) => {
    const d = new Date(t * 1000);
    return `${d.getMonth() + 1}.${d.getFullYear()}`;
  };
  const area = `1,${H} ${line(cv.strat)} ${W - 1},${H}`;
  return (
    <div>
      <div className="pv-desc lg-muted">
        Ortak dönemde gün-gün portföy değeri (mevcut adetler) — strateji vs Al-Tut, başlangıç 100. Dönem:{' '}
        <b>{fmtD(cv.t0)} → {fmtD(cv.t1)}</b>
      </div>
      <svg className="pv-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polygon points={area} fill={up ? 'rgba(38,166,154,0.16)' : 'rgba(239,83,80,0.16)'} />
        {cv.xu && <polyline points={line(cv.xu)} fill="none" stroke="#8ab4f8" strokeWidth="1.2" strokeDasharray="2 3" />}
        <polyline points={line(cv.hold)} fill="none" stroke="#6b7280" strokeWidth="1.2" strokeDasharray="4 3" />
        <polyline points={line(cv.strat)} fill="none" stroke={col} strokeWidth="1.8" />
      </svg>
      <div className="pv-legend">
        <span>
          <i className="pv-dot" style={{ background: col }} /> Strateji <b className={up ? 'up' : 'down'}>{fmtP(cv.chg)}</b>
        </span>
        <span>
          <i className="pv-dot pv-dash" /> Al-Tut <b className={cv.holdChg >= 0 ? 'up' : 'down'}>{fmtP(cv.holdChg)}</b>
        </span>
        {cv.xu != null && cv.xuChg != null && (
          <span>
            <i className="pv-dot" style={{ background: '#8ab4f8' }} /> XU100 <b className={cv.xuChg >= 0 ? 'up' : 'down'}>{fmtP(cv.xuChg)}</b>
          </span>
        )}
        <span className="lg-muted">en sert düşüş -{cv.maxDD.toFixed(0)}%</span>
      </div>
      <div className="pa-portrisk">
        Sharpe (enf. üstü) <b>{cv.sharpe.toFixed(2)}</b> <span className="lg-muted">(1+ iyi)</span> · Reel yıllık: strateji{' '}
        <b className={cv.realStrat >= 0 ? 'up' : 'down'}>{fmtP(cv.realStrat)}</b> · Al-Tut{' '}
        <b className={cv.realHold >= 0 ? 'up' : 'down'}>{fmtP(cv.realHold)}</b>{' '}
        <span className="lg-muted">(enflasyon ~%{cv.avgInfl.toFixed(0)}/yıl arındırıldı)</span>
      </div>
    </div>
  );
}

// ── Advanced portfolio risk (correlation-aware) ──────────────────────────────
interface RiskStats {
  realVol: number; // annualized vol incl. correlation
  naiveVol: number; // weighted sum of individual vols (no diversification)
  divBenefit: number; // naiveVol − realVol
  beta: number | null; // portfolio beta vs XU100
  maxDD: number; // portfolio max drawdown over the window
  annRet: number; // annualized portfolio return over the window
  retOverRisk: number; // annRet / realVol
  avgCorr: number | null;
  topPair: { a: string; b: string; corr: number } | null;
  betas: Map<string, number>;
  n: number;
  years: number;
}

function ffill(c: Candles, axis: number[]): number[] {
  const out = new Array<number>(axis.length).fill(NaN);
  let p = 0;
  let last = NaN;
  for (let i = 0; i < axis.length; i++) {
    while (p < c.length && c.time[p] <= axis[i]) {
      last = c.close[p];
      p++;
    }
    out[i] = last;
  }
  return out;
}
function toReturns(arr: number[]): Float64Array {
  const out = new Float64Array(Math.max(0, arr.length - 1));
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1];
    const b = arr[i];
    out[i - 1] = Number.isFinite(a) && Number.isFinite(b) && a > 0 ? b / a - 1 : 0;
  }
  return out;
}
function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}
function varr(a: ArrayLike<number>): number {
  const m = mean(a);
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
  return a.length > 1 ? v / (a.length - 1) : 0;
}
function std(a: ArrayLike<number>): number {
  return Math.sqrt(varr(a));
}
function covv(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}
function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const sa = std(a);
  const sb = std(b);
  return sa > 0 && sb > 0 ? covv(a, b) / (sa * sb) : NaN;
}

function portfolioRisk(rows: Row[], hist: Map<string, Candles>, xu: Candles | null): RiskStats | null {
  const items = rows.filter((r) => r.weight > 0 && hist.get(r.sym)).map((r) => ({ sym: r.sym, w: r.weight, c: hist.get(r.sym)! }));
  if (items.length === 0) return null;
  const startT = Math.max(...items.map((x) => x.c.time[0]));
  const set = new Set<number>();
  for (const it of items) for (let i = 0; i < it.c.length; i++) if (it.c.time[i] >= startT) set.add(it.c.time[i]);
  const axis = [...set].sort((a, b) => a - b);
  if (axis.length < 30) return null;
  const wsum = items.reduce((s, it) => s + it.w, 0) || 1;
  const w = items.map((it) => it.w / wsum);
  const rets = items.map((it) => toReturns(ffill(it.c, axis)));
  const xret = xu ? toReturns(ffill(xu, axis)) : null;
  const m = axis.length - 1;
  const rp = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let v = 0;
    for (let k = 0; k < items.length; k++) v += w[k] * rets[k][i];
    rp[i] = v;
  }
  const realVol = std(rp) * Math.sqrt(252) * 100;
  const naiveVol = items.reduce((s, _it, k) => s + w[k] * std(rets[k]) * Math.sqrt(252) * 100, 0);
  let beta: number | null = null;
  const betas = new Map<string, number>();
  if (xret) {
    const vm = varr(xret) || 1;
    beta = covv(rp, xret) / vm;
    for (let k = 0; k < items.length; k++) betas.set(items[k].sym, covv(rets[k], xret) / vm);
  }
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (let i = 0; i < m; i++) {
    eq *= 1 + rp[i];
    if (eq > peak) peak = eq;
    const d = (peak - eq) / peak;
    if (d > dd) dd = d;
  }
  const years = Math.max((axis[axis.length - 1] - axis[0]) / (365.25 * 86400), 1e-6);
  const annRet = (Math.pow(Math.max(eq, 1e-9), 1 / years) - 1) * 100;
  let avgCorr: number | null = null;
  let topPair: RiskStats['topPair'] = null;
  if (items.length >= 2) {
    let s = 0;
    let cnt = 0;
    let best = -2;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const cc = corr(rets[i], rets[j]);
        if (!Number.isFinite(cc)) continue;
        s += cc;
        cnt++;
        if (cc > best) {
          best = cc;
          topPair = { a: items[i].sym, b: items[j].sym, corr: cc };
        }
      }
    avgCorr = cnt ? s / cnt : null;
  }
  return { realVol, naiveVol, divBenefit: Math.max(0, naiveVol - realVol), beta, maxDD: dd * 100, annRet, retOverRisk: realVol > 0 ? annRet / realVol : 0, avgCorr, topPair, betas, n: items.length, years };
}

function AdvancedRiskCard({ risk }: { risk: RiskStats }) {
  const betaTxt = risk.beta == null ? '—' : risk.beta.toFixed(2);
  const betaNote = risk.beta == null ? '' : risk.beta > 1.1 ? 'endeksten oynak' : risk.beta < 0.9 ? 'endeksten sakin' : 'endeksle benzer';
  const rr = risk.retOverRisk;
  const rrCls = rr >= 1 ? 'up' : rr >= 0.5 ? 'warn' : 'down';
  return (
    <div className="pa-card">
      <div className="pa-card-title">🧮 Gerçek Risk (çeşitlendirme dahil)</div>
      <div className="pa-grid">
        <div>
          <span className="lg-muted">Gerçek oynaklık</span>
          <b>~%{risk.realVol.toFixed(0)}/yıl</b>
        </div>
        <div>
          <span className="lg-muted">Beta (XU100)</span>
          <b>{betaTxt}</b>
        </div>
        <div>
          <span className="lg-muted">En sert düşüş</span>
          <b className="down">-{risk.maxDD.toFixed(0)}%</b>
        </div>
        <div>
          <span className="lg-muted">Getiri / Risk</span>
          <b className={rrCls}>{rr.toFixed(2)}</b>
        </div>
      </div>
      <div className="pa-verdict">
        🧩 Çeşitlendirme: korelasyonsuz üst sınır <b>~%{risk.naiveVol.toFixed(0)}</b> iken hisseler tam birlikte hareket
        etmediği için gerçek oynaklık <b>~%{risk.realVol.toFixed(0)}</b> — çeşitlendirme riski{' '}
        <b className="up">~%{risk.divBenefit.toFixed(0)} azalttı</b>.
      </div>
      {risk.beta != null && (
        <div className="pa-portrisk">
          Beta <b>{betaTxt}</b> → piyasa %10 oynarsa portföy ~%{(risk.beta * 10).toFixed(0)} oynar <span className="lg-muted">({betaNote})</span>.
        </div>
      )}
      {risk.avgCorr != null && (
        <div className="pa-portrisk">
          Ortalama korelasyon <b>{risk.avgCorr.toFixed(2)}</b>{' '}
          <span className="lg-muted">
            ({risk.avgCorr >= 0.6 ? 'yüksek — birlikte hareket ediyorlar, gizli yoğunlaşma' : risk.avgCorr >= 0.3 ? 'orta' : 'düşük — iyi çeşitlenmiş'})
          </span>
          {risk.topPair && (
            <>
              {' '}· en korele: <b>{risk.topPair.a}–{risk.topPair.b}</b> ({risk.topPair.corr.toFixed(2)})
            </>
          )}
        </div>
      )}
      <div className="bt-note">
        Getiri/Risk = yıllık getiri ÷ oynaklık ({risk.annRet >= 0 ? '+' : ''}
        {risk.annRet.toFixed(0)}% / %{risk.realVol.toFixed(0)}); 1'in üstü iyidir. {risk.years.toFixed(1)} yıllık ortak
        dönem, günlük getirilerden hesaplanır.
      </div>
    </div>
  );
}

// Portfolio total value over time (current quantities held over the common
// period of all holdings), normalized to 100, vs XU100.
function buildValueSeries(holdings: Holding[], hist: Map<string, Candles>, xu: Candles | null) {
  const cs = holdings
    .map((h) => ({ qty: h.qty, c: hist.get(h.symbol) }))
    .filter((x): x is { qty: number; c: Candles } => !!x.c);
  if (cs.length === 0) return null;
  const startT = Math.max(...cs.map((x) => x.c.time[0]));
  const set = new Set<number>();
  for (const { c } of cs) for (let i = 0; i < c.length; i++) if (c.time[i] >= startT) set.add(c.time[i]);
  const axis = [...set].sort((a, b) => a - b);
  if (axis.length < 3) return null;
  const step = Math.max(1, Math.floor(axis.length / 140));
  const sampled: number[] = [];
  for (let i = 0; i < axis.length; i += step) sampled.push(axis[i]);
  sampled.push(axis[axis.length - 1]);

  const ptr = cs.map(() => 0);
  const last = cs.map(() => NaN);
  const pvRaw: number[] = [];
  for (const t of sampled) {
    let val = 0;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k].c;
      while (ptr[k] < c.length && c.time[ptr[k]] <= t) {
        last[k] = c.close[ptr[k]];
        ptr[k]++;
      }
      if (isFinite(last[k])) val += cs[k].qty * last[k];
    }
    pvRaw.push(val);
  }
  const xvRaw: number[] = [];
  if (xu) {
    let p = 0;
    let l = NaN;
    for (const t of sampled) {
      while (p < xu.length && xu.time[p] <= t) {
        l = xu.close[p];
        p++;
      }
      xvRaw.push(l);
    }
  }
  const norm = (arr: number[]) => {
    const base = arr.find((v) => isFinite(v) && v > 0) ?? 1;
    return arr.map((v) => (isFinite(v) && v > 0 ? (v / base) * 100 : NaN));
  };
  const pv = norm(pvRaw);
  const xv = xu ? norm(xvRaw) : [];
  return {
    pv,
    xv,
    chg: pv.length ? pv[pv.length - 1] - 100 : 0,
    xchg: xv.length ? xv[xv.length - 1] - 100 : 0,
    t0: sampled[0],
    t1: sampled[sampled.length - 1],
  };
}

function ValueChartCard({ pv, xv, chg, xchg, t0, t1 }: { pv: number[]; xv: number[]; chg: number; xchg: number; t0: number; t1: number }) {
  const all = [...pv, ...xv].filter((v) => isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const rng = max - min || 1;
  const W = 560;
  const H = 96;
  const y = (v: number) => (H - 2 - ((v - min) / rng) * (H - 8)).toFixed(1);
  const xx = (i: number, len: number) => ((i / (len - 1)) * (W - 2) + 1).toFixed(1);
  const pvLine = pv.map((v, i) => `${xx(i, pv.length)},${y(v)}`).join(' ');
  const area = `1,${H} ${pvLine} ${W - 1},${H}`;
  const xvLine = xv.length ? xv.map((v, i) => `${xx(i, xv.length)},${y(v)}`).join(' ') : '';
  const up = chg >= 0;
  const col = up ? '#26a69a' : '#ef5350';
  const fmtD = (t: number) => {
    const d = new Date(t * 1000);
    return `${d.getMonth() + 1}.${d.getFullYear()}`;
  };
  // Plain-language verdict comparing the portfolio to the index over the period.
  const hasX = xv.length > 0;
  const diff = chg - xchg;
  const verdict = !hasX
    ? `Bu dönemde portföyünün değeri %${Math.abs(chg).toFixed(0)} ${chg >= 0 ? 'arttı' : 'azaldı'}.`
    : diff >= 0
      ? `Portföyün endeksi (XU100) ${Math.abs(diff).toFixed(0)} puan geçti 👏`
      : `Portföyün endeksin (XU100) ${Math.abs(diff).toFixed(0)} puan gerisinde kaldı.`;
  return (
    <div className="pa-card">
      <div className="pa-card-title">📈 Portföy Değeri (zaman)</div>
      <div className="pv-desc lg-muted">
        Bugünkü hisse adetlerini geçmişe uygularsak portföyün toplam değeri nasıl seyrederdi — BIST 100 (XU100) endeksiyle
        kıyas. İkisi de başlangıçta <b>100</b>'e eşitlendi. Dönem: <b>{fmtD(t0)} → {fmtD(t1)}</b> (tüm hisselerin ortak en
        uzun geçmişi).
      </div>
      <svg className="pv-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polygon points={area} fill={up ? 'rgba(38,166,154,0.16)' : 'rgba(239,83,80,0.16)'} />
        {xvLine && <polyline points={xvLine} fill="none" stroke="#6b7280" strokeWidth="1.2" strokeDasharray="4 3" />}
        <polyline points={pvLine} fill="none" stroke={col} strokeWidth="1.8" />
      </svg>
      <div className="pv-legend">
        <span>
          <i className="pv-dot" style={{ background: col }} /> Portföyün (bugünkü adetlerle){' '}
          <b className={up ? 'up' : 'down'}>{(chg >= 0 ? '+' : '') + chg.toFixed(0)}%</b>
        </span>
        {hasX && (
          <span>
            <i className="pv-dot pv-dash" /> XU100 (BIST 100 endeksi){' '}
            <b className={xchg >= 0 ? 'up' : 'down'}>{(xchg >= 0 ? '+' : '') + xchg.toFixed(0)}%</b>
          </span>
        )}
      </div>
      <div className={'pv-verdict ' + (!hasX ? '' : diff >= 0 ? 'up' : 'down')}>{verdict}</div>
    </div>
  );
}
