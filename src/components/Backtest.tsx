import { useEffect, useMemo, useState } from 'react';
import { Candles } from '../data/types';
import { evalPosition, StrategyResult, idxYearsAgo } from '../indicators/backtest';
import { inflationDailyRates, inflationAvgAnnual } from '../data/inflation';
import { fetchBistStatic, fetchScreener } from '../data/bistStatic';
import {
  CustomStrategy,
  Cond,
  INDS,
  OPS,
  hasParam,
  newCond,
  buildCustomPosition,
  candidateStrategies,
} from '../indicators/customStrategy';
import { IndicatorParams } from '../indicators/calc';

interface Props {
  candles: Candles;
  symbol: string;
  universe: string[];
  strats: CustomStrategy[];
  params: IndicatorParams;
  onSave: (s: CustomStrategy[]) => void;
  onApply: (s: CustomStrategy) => void;
  onPickCombo: (sym: string, s: CustomStrategy) => void;
  onClose: () => void;
}

interface Combo {
  sym: string;
  strat: CustomStrategy;
  ann: number; // annualized incl. inflation on cash (the Al-Tut rival)
  pure: number; // annualized, price only
  ret: number;
  trades: number;
  win: number;
  dd: number;
  hold: number; // buy & hold annualized
  daysIn: number;
  daysOut: number;
  avg: number;
}

// One optimizer result: a candidate's train (in-sample) vs test (out-of-sample)
// performance. Ranked by the worst-period excess over Al-Tut (robustness).
interface OptRow {
  strat: CustomStrategy;
  trainAnn: number; // avg annualized (incl. inflation) over the older ~70%
  trainHold: number; // avg Al-Tut annualized over train
  testAnn: number; // avg annualized over the unseen newest ~30%
  testHold: number; // avg Al-Tut annualized over test
  score: number; // min(trainAnn − trainHold, testAnn − testHold) — worst-period edge
  robustPct: number; // % of stocks beating Al-Tut in BOTH periods (universe mode)
  n: number; // stocks counted (traded in both periods)
  trades: number; // avg test-period trades
}

// ── En İyi 20 scan cache (persisted + incremental) ───────────────────────────
// Keep the last scan and only recompute what changed: metrics are cached per
// (symbol × strategy-rules) so unchanged strategies are reused, and downloaded
// candles stay in memory for the session so a re-scan needs no re-download.
type ScanMetrics = Omit<Combo, 'sym' | 'strat'>;
const candlesMem = new Map<string, Candles>();
const metricsMem = new Map<string, Map<string, ScanMetrics | null>>(); // sym → ruleHash → metrics|null(=no trades)
let memHydrated = false;

// Cache key for a strategy — includes the global MACD periods so the En İyi
// cache invalidates when the user changes them (MACD uses the chart periods).
const stratHash = (s: CustomStrategy, gp: IndicatorParams): string =>
  // Include every global param a build can depend on (MACD set + ROC base used
  // by the rocema indicator) so the cache invalidates when the user changes them.
  JSON.stringify({ b: s.buy, s: s.sell, m: [gp.macdFast, gp.macdSlow, gp.macdSig, gp.macdVwma, gp.roc] });
const toMetrics = (r: StrategyResult): ScanMetrics => ({
  ann: r.annRate ?? r.annPct,
  pure: r.annPct,
  ret: r.retRate ?? r.retPct,
  trades: r.trades,
  win: r.winRate,
  dd: r.maxDD,
  hold: r.holdAnn,
  daysIn: r.daysIn ?? 0,
  daysOut: r.daysOut ?? 0,
  avg: r.avgHoldDays ?? 0,
});

const METRICS_KEY = 'bt-scan-metrics-v2';
const ROWS_KEY = 'bt-scan-rows-v2';

function hydrateScanCache(): void {
  if (memHydrated) return;
  memHydrated = true;
  try {
    const obj = JSON.parse(localStorage.getItem(METRICS_KEY) || '{}') as Record<string, Record<string, ScanMetrics | null>>;
    for (const [sym, cell] of Object.entries(obj)) metricsMem.set(sym, new Map(Object.entries(cell)));
  } catch {
    /* ignore corrupt cache */
  }
}
function persistScanCache(keepHashes: Set<string>, keepSyms: Set<string>): void {
  const obj: Record<string, Record<string, ScanMetrics | null>> = {};
  for (const [sym, cell] of metricsMem) {
    if (!keepSyms.has(sym)) {
      metricsMem.delete(sym); // prune stale symbols from memory too
      continue;
    }
    const o: Record<string, ScanMetrics | null> = {};
    for (const [h, v] of cell) {
      if (keepHashes.has(h)) o[h] = v;
      else cell.delete(h); // prune stale strategies
    }
    if (Object.keys(o).length) obj[sym] = o;
  }
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify(obj));
  } catch {
    /* quota — keep the in-memory cache, skip persisting */
  }
}

interface SavedScan {
  rows: Combo[];
  total: number;
  at: number;
  hashes: string[];
}
function loadSavedScan(): SavedScan | null {
  try {
    const raw = localStorage.getItem(ROWS_KEY);
    return raw ? (JSON.parse(raw) as SavedScan) : null;
  } catch {
    return null;
  }
}
function saveScan(s: SavedScan): void {
  try {
    localStorage.setItem(ROWS_KEY, JSON.stringify(s));
  } catch {
    /* skip */
  }
}
function fmtAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

const blankDraft = (): CustomStrategy => ({ id: '', name: '', buy: [newCond()], sell: [] });
const N_CANDIDATES = candidateStrategies().length; // how many combos the optimizer tries

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

export function Backtest({ candles, symbol, universe, strats, params, onSave, onApply, onPickCombo, onClose }: Props) {
  const [tab, setTab] = useState<'mine' | 'top'>('mine');
  const [draft, setDraft] = useState<CustomStrategy>(blankDraft);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Restore the last saved scan so reopening the modal shows it instantly.
  const [scan, setScan] = useState<{ rows: Combo[]; done: number; total: number; running: boolean } | null>(() => {
    hydrateScanCache();
    const sv = loadSavedScan();
    return sv ? { rows: sv.rows, done: 0, total: sv.total, running: false } : null;
  });
  const [scanMeta, setScanMeta] = useState<{ at: number; hashes: string[] } | null>(() => {
    const sv = loadSavedScan();
    return sv ? { at: sv.at, hashes: sv.hashes } : null;
  });

  // Cash leg earns year-specific inflation (TÜFE) while the strategy is flat.
  const inflRates = useMemo(() => inflationDailyRates(candles.time, candles.length), [candles]);
  const avgInfl = useMemo(() => inflationAvgAnnual(candles.time, candles.length), [candles]);

  // Years of history + window start indices (for the 5y / 10y comparisons).
  const spanYears = candles.length > 1 ? (candles.time[candles.length - 1] - candles.time[0]) / (365.25 * 86400) : 0;
  const idx5 = useMemo(() => idxYearsAgo(candles.time, candles.length, 5), [candles]);
  const idx10 = useMemo(() => idxYearsAgo(candles.time, candles.length, 10), [candles]);
  const win = (pos: Uint8Array, yrs: number, fromIdx: number): StrategyResult | null =>
    spanYears >= yrs * 0.9 ? evalPosition(candles, pos, inflRates, fromIdx) : null;

  // Backtest each saved strategy on the current symbol (+ equity curve + windows).
  const results = useMemo(
    () =>
      strats
        .map((s) => {
          const pos = buildCustomPosition(candles, s, undefined, params);
          return {
            s,
            r: evalPosition(candles, pos, inflRates),
            eq: equitySpark(candles.close, pos, candles.time, inflRates),
            pos,
            w5: win(pos, 5, idx5),
            w10: win(pos, 10, idx10),
          };
        })
        .sort((a, b) => (b.r.annRate ?? b.r.annPct) - (a.r.annRate ?? a.r.annPct)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strats, candles, inflRates, idx5, idx10, params],
  );
  const maxAnn = Math.max(...results.map((x) => Math.abs(x.r.annRate ?? x.r.annPct)), 1);
  const topMax = scan ? Math.max(...scan.rows.map((t) => Math.abs(t.ann)), 1) : 1;
  // Is the saved scan stale vs the current strategy set (changed/added/removed)?
  const curHashes = useMemo(() => strats.map((s) => stratHash(s, params)), [strats, params]);
  const stale =
    !!scanMeta &&
    (curHashes.length !== scanMeta.hashes.length || curHashes.some((h) => !scanMeta.hashes.includes(h)));

  // Live preview of the strategy being built, on the current symbol.
  const preview = useMemo(() => {
    if (!draft.buy.length) return null;
    try {
      const pos = buildCustomPosition(candles, draft, undefined, params);
      return {
        r: evalPosition(candles, pos, inflRates),
        eq: equitySpark(candles.close, pos, candles.time, inflRates),
        w5: win(pos, 5, idx5),
        w10: win(pos, 10, idx10),
      };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, candles, inflRates, idx5, idx10, params]);

  // ── Optimizer: try a broad grid of candidate strategies ────────────────────
  const [opt, setOpt] = useState<{ mode: 'cur' | 'uni'; running: boolean; done: number; total: number; rows: OptRow[] } | null>(null);

  const optimizeCurrent = () => {
    const cands = candidateStrategies();
    const cache = new Map<string, Float64Array>(); // share indicator series across candidates
    const n = candles.length;
    const split = Math.floor(n * 0.7); // older 70% = train, newest 30% = test (unseen)
    const rows: OptRow[] = [];
    for (const s of cands) {
      const pos = buildCustomPosition(candles, s, cache, params);
      const tr = evalPosition(candles, pos, inflRates, 0, split);
      const te = evalPosition(candles, pos, inflRates, split, n - 1);
      if (tr.trades > 0 && te.trades > 0) {
        const trainAnn = tr.annRate ?? tr.annPct;
        const testAnn = te.annRate ?? te.annPct;
        const score = Math.min(trainAnn - tr.holdAnn, testAnn - te.holdAnn);
        rows.push({ strat: s, trainAnn, trainHold: tr.holdAnn, testAnn, testHold: te.holdAnn, score, robustPct: score >= 0 ? 100 : 0, n: 1, trades: te.trades });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    setOpt({ mode: 'cur', running: false, done: 0, total: 0, rows });
  };

  const optimizeUniverse = async () => {
    const cands = candidateStrategies();
    setOpt({ mode: 'uni', running: true, done: 0, total: 0, rows: [] });
    const syms = await getScanSymbols();
    setOpt({ mode: 'uni', running: true, done: 0, total: syms.length, rows: [] });
    const acc = cands.map((s) => ({ s, trA: 0, trH: 0, teA: 0, teH: 0, robust: 0, sumTr: 0, n: 0 }));
    let done = 0;
    const queue = [...syms];
    const worker = async () => {
      while (queue.length) {
        const sym = queue.shift()!;
        let c = candlesMem.get(sym);
        if (!c) {
          try {
            c = await fetchBistStatic(sym);
            candlesMem.set(sym, c);
          } catch {
            c = undefined;
          }
        }
        if (c && c.length >= 160) {
          const rates = inflationDailyRates(c.time, c.length);
          const cache = new Map<string, Float64Array>();
          const split = Math.floor(c.length * 0.7);
          for (let k = 0; k < cands.length; k++) {
            const pos = buildCustomPosition(c, cands[k], cache, params);
            const tr = evalPosition(c, pos, rates, 0, split);
            const te = evalPosition(c, pos, rates, split, c.length - 1);
            if (tr.trades > 0 && te.trades > 0) {
              const a = acc[k];
              const trainAnn = tr.annRate ?? tr.annPct;
              const testAnn = te.annRate ?? te.annPct;
              a.trA += trainAnn;
              a.trH += tr.holdAnn;
              a.teA += testAnn;
              a.teH += te.holdAnn;
              if (trainAnn >= tr.holdAnn && testAnn >= te.holdAnn) a.robust++;
              a.sumTr += te.trades;
              a.n++;
            }
          }
        }
        done++;
        setOpt((p) => (p ? { ...p, done } : p));
        if (done % 2 === 0) await new Promise((r) => setTimeout(r)); // yield to keep UI responsive
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    // A combo must trade on enough stocks (in both periods) to be trusted.
    const minN = Math.max(10, Math.floor(syms.length * 0.15));
    const mapped = acc
      .filter((a) => a.n > 0)
      .map((a) => {
        const trainAnn = a.trA / a.n;
        const trainHold = a.trH / a.n;
        const testAnn = a.teA / a.n;
        const testHold = a.teH / a.n;
        return { strat: a.s, trainAnn, trainHold, testAnn, testHold, score: Math.min(trainAnn - trainHold, testAnn - testHold), robustPct: (a.robust / a.n) * 100, n: a.n, trades: a.sumTr / a.n };
      });
    const robust = mapped.filter((r) => r.n >= minN);
    const rows: OptRow[] = (robust.length ? robust : mapped).sort((x, y) => y.score - x.score);
    setOpt({ mode: 'uni', running: false, done, total: syms.length, rows });
  };

  // Load an optimizer result into the builder so it can be tuned + saved.
  const useCandidate = (s: CustomStrategy) =>
    setDraft({ id: '', name: s.name, buy: s.buy.map((c) => ({ ...c })), sell: s.sell.map((c) => ({ ...c })) });

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

  // The 300 oldest stocks (longest history) from the screener snapshot.
  const getScanSymbols = async (): Promise<string[]> => {
    try {
      const sc = await fetchScreener();
      if (sc?.items?.length)
        return sc.items
          .slice()
          .sort((a, b) => (b.yr ?? 0) - (a.yr ?? 0))
          .slice(0, 300)
          .map((i) => i.s);
    } catch {
      /* fall back to the bounded universe */
    }
    return universe;
  };

  // Pick the best CURRENT strategy per symbol from the cache, then rank top 20.
  const buildScanRows = (syms: string[], cur: { s: CustomStrategy; h: string }[]): Combo[] => {
    const best = new Map<string, Combo>();
    for (const sym of syms) {
      const cell = metricsMem.get(sym);
      if (!cell) continue;
      for (const { s, h } of cur) {
        const m = cell.get(h);
        if (!m) continue; // null = computed, no trades · undefined = not computed
        const prev = best.get(sym);
        if (!prev || m.ann > prev.ann) best.set(sym, { sym, strat: s, ...m });
      }
    }
    return [...best.values()].sort((a, b) => b.ann - a.ann).slice(0, 20);
  };

  const runScan = async () => {
    if (!strats.length) return;
    const cur = strats.map((s) => ({ s, h: stratHash(s, params) }));
    const curHashSet = new Set(cur.map((x) => x.h));
    setScan((p) => ({ rows: p?.rows ?? [], done: 0, total: 0, running: true }));
    const syms = await getScanSymbols();
    const symSet = new Set(syms);
    setScan((p) => ({ rows: p?.rows ?? [], done: 0, total: syms.length, running: true }));
    let done = 0;
    const queue = [...syms];
    const worker = async () => {
      while (queue.length) {
        const sym = queue.shift()!;
        let cell = metricsMem.get(sym);
        if (!cell) {
          cell = new Map();
          metricsMem.set(sym, cell);
        }
        // Only compute strategies not already cached for this symbol.
        const missing = cur.filter(({ h }) => !cell!.has(h));
        if (missing.length) {
          let c = candlesMem.get(sym);
          if (!c) {
            try {
              c = await fetchBistStatic(sym);
              candlesMem.set(sym, c);
            } catch {
              c = undefined;
            }
          }
          if (c && c.length >= 80) {
            for (const { s, h } of missing) {
              const r = evalPosition(c, buildCustomPosition(c, s, undefined, params));
              cell.set(h, r.trades > 0 ? toMetrics(r) : null);
            }
          } else {
            for (const { h } of missing) cell.set(h, null); // no usable data → don't retry this run
          }
        }
        done++;
        setScan((p) => (p ? { ...p, done } : p));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const rows = buildScanRows(syms, cur);
    persistScanCache(curHashSet, symSet);
    saveScan({ rows, total: syms.length, at: Date.now(), hashes: [...curHashSet] });
    setScanMeta({ at: Date.now(), hashes: [...curHashSet] });
    setScan({ rows, done, total: syms.length, running: false });
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
                <div className="bt-note">
                  Her koşulun yanındaki kutudan periyodu ayarla. MACD/Signal/eMACD periyotları üstteki <b>İndikatörler ▾</b>{' '}
                  menüsünden gelir ({params.macdFast}/{params.macdSlow}/{params.macdSig}/{params.macdVwma}).
                </div>
                {preview &&
                  (() => {
                    const r = preview.r;
                    const ann = r.annRate ?? r.annPct;
                    const beatR = ann >= r.holdAnn;
                    const beatP = r.annPct >= r.holdAnn;
                    return (
                      <div className="sb-preview">
                        <div className="sb-pv-head">
                          <span className="sb-pv-title">📊 {symbol} ön-izleme (yıllık)</span>
                          <span className="sb-pv-vals">
                            <b className={beatR ? 'rv-win' : 'rv-lose'}>
                              enf. {fmtPct(ann)}
                              {beatR ? ' ✓' : ''}
                            </b>
                            <b className={beatP ? 'rv-win' : 'rv-lose'}>
                              saf {fmtPct(r.annPct)}
                              {beatP ? ' ✓' : ''}
                            </b>
                            <b className="rv-base">Al-Tut {fmtPct(r.holdAnn)}</b>
                          </span>
                        </div>
                        <div className="sb-pv-sub lg-muted">
                          toplam {fmtX(r.retRate ?? r.retPct)} · {r.trades} işlem · Kazanma %{r.winRate.toFixed(0)} · Düşüş -
                          {r.maxDD.toFixed(0)}% · işlemde {r.daysIn ?? 0}g / boşta {r.daysOut ?? 0}g
                        </div>
                        <WinLine w5={preview.w5} w10={preview.w10} />
                        <EquitySpark data={preview.eq} />
                      </div>
                    );
                  })()}
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

              <div className="sb-suggest">
                <span className="lg-muted">🎯 Otomatik: {N_CANDIDATES} kombinasyonu dener, en iyiyi bulur:</span>
                <button className="sb-sugbtn" onClick={optimizeCurrent}>⚡ Bu hisse ({symbol})</button>
                <button className="sb-sugbtn" onClick={optimizeUniverse} disabled={opt?.running}>
                  {opt?.running ? `Taranıyor… ${opt.done}/${opt.total}` : '🌍 Tüm hisseler (ortalama)'}
                </button>
              </div>

              {opt && (
                <div className="opt-panel">
                  <div className="opt-head">
                    <b>🎯 En iyi kombinasyonlar</b>
                    <button className="row-x" onClick={() => setOpt(null)} title="Kapat">×</button>
                  </div>
                  <div className="opt-explain lg-muted">
                    {N_CANDIDATES} kombinasyon {opt.mode === 'uni' ? `${opt.total} hissede` : <b>{symbol}</b>} denendi. Veri ikiye
                    bölündü: <b className="opt-tr">Geçmiş %70</b> (öğrenme) + <b className="opt-te">Test %30</b> (görülmemiş son
                    dönem). Yalnızca geçmişte iyi olan çoğu strateji testte çöker; o yüzden sıralama{' '}
                    <b>iki dönemde de Al-Tut'u en çok geçene</b> göre. Yıllık getiriler <b>enflasyon dahil</b>.
                  </div>
                  {opt.running && opt.rows.length === 0 ? (
                    <div className="bt-note">Hesaplanıyor… {opt.done}/{opt.total}</div>
                  ) : opt.rows.length === 0 ? (
                    <div className="bt-note">{opt.running ? `Hesaplanıyor… ${opt.done}/${opt.total}` : 'Sonuç yok.'}</div>
                  ) : (
                    <div className="opt-list">
                      <div className="opt-row opt-hrow">
                        <span className="bt-rank">#</span>
                        <div className="opt-main">
                          <div className="opt-name">Strateji</div>
                          <div className="opt-periods">
                            <span className="opt-per"><span className="opt-per-lbl opt-tr">Geçmiş</span> strat / Al-Tut</span>
                            <span className="opt-per"><span className="opt-per-lbl opt-te">Test</span> strat / Al-Tut</span>
                          </div>
                        </div>
                        <span className="opt-use-sp" />
                      </div>
                      {opt.rows.slice(0, 12).map((o, i) => {
                        const robust = o.score >= 0; // beat Al-Tut in BOTH periods
                        const trBeat = o.trainAnn >= o.trainHold;
                        const teBeat = o.testAnn >= o.testHold;
                        return (
                          <div className={'opt-row' + (robust ? ' opt-robust' : '')} key={o.strat.id}>
                            <span className="bt-rank">{i + 1}</span>
                            <div className="opt-main">
                              <div className="opt-name">
                                {o.strat.name}
                                {robust && <span className="opt-badge" title="Hem geçmiş hem test döneminde Al-Tut'u geçti">✓✓ tutarlı</span>}
                              </div>
                              <div className="opt-periods">
                                <span className="opt-per">
                                  <span className="opt-per-lbl opt-tr">Geçmiş</span>
                                  <b className={trBeat ? 'rv-win' : 'rv-lose'}>{fmtPct(o.trainAnn)}</b>
                                  <span className="lg-muted">/ {fmtPct(o.trainHold)}</span>
                                </span>
                                <span className="opt-per">
                                  <span className="opt-per-lbl opt-te">Test</span>
                                  <b className={teBeat ? 'rv-win' : 'rv-lose'}>{fmtPct(o.testAnn)}</b>
                                  <span className="lg-muted">/ {fmtPct(o.testHold)}</span>
                                </span>
                                <span className="lg-muted">
                                  {opt.mode === 'uni' ? `${o.robustPct.toFixed(0)}% hissede tutarlı · ${o.n} hisse` : `${Math.round(o.trades)} işlem (test)`}
                                </span>
                              </div>
                            </div>
                            <button className="opt-use" onClick={() => useCandidate(o.strat)} title="Kuralı düzenleyiciye yükle">Kullan →</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="bt-note">
                    <span className="rv-win">✓✓ tutarlı</span> = hem geçmişte hem testte Al-Tut'u geçti (güvenilir). "Kullan" → kuralı
                    yukarıdaki düzenleyiciye yükler; ismini verip kaydet.
                  </div>
                </div>
              )}

              <p className="bt-intro">
                <b>{symbol}</b> üzerinde kayıtlı stratejilerin sonuçları (<b>enflasyon dahil yıllık</b> getiriye göre).
                Strateji nakitteyken para boşta durmaz, <b>enflasyon (TÜFE) kadar</b> değer korur → <b>Al-Tut</b>'a rakip.
                Bir satıra tıkla → grafikte AL/SAT işaretlenir.
              </p>

              <div className="bt-rate">
                <span>📈 Nakit boştayken <b>enflasyona (TÜFE) endeksli</b></span>
                <span className="lg-muted">Yıla göre gerçek TÜFE uygulanır · bu dönemde ort. ≈ yıllık %{avgInfl.toFixed(0)}</span>
              </div>

              {results.length === 0 ? (
                <div className="bt-note">Henüz strateji yok. Yukarıdan koşulları seçip kaydet.</div>
              ) : (
                <div className="bt-list">
                  {results.map(({ s, r, eq, pos, w5, w10 }, i) => {
                    const ann = r.annRate ?? r.annPct;
                    const beatR = ann >= r.holdAnn; // enflasyon dahil, Al-Tut'u geçti mi
                    const beatP = r.annPct >= r.holdAnn; // saf strateji Al-Tut'u geçti mi
                    return (
                    <div key={s.id} className="bt-srow">
                      <div className="bt-srow-head">
                        <span className="bt-rank">{i + 1}</span>
                        <span className="bt-srow-name">{s.name}</span>
                        <span className={'bt-srow-val ' + (ann >= 0 ? 'up' : 'down')} title="Yıllık getiri — nakitteyken enflasyon (TÜFE) dahil (Al-Tut'a rakip)">
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
                        💰 enf. dahil{' '}
                        <b className={beatR ? 'rv-win' : 'rv-lose'}>
                          {fmtPct(ann)}
                          {beatR ? ' ✓' : ''}
                        </b>{' '}
                        · saf strateji{' '}
                        <b className={beatP ? 'rv-win' : 'rv-lose'}>
                          {fmtPct(r.annPct)}
                          {beatP ? ' ✓' : ''}
                        </b>{' '}
                        · Al-Tut <b className="rv-base">{fmtPct(r.holdAnn)}</b>
                      </div>
                      <WinLine w5={w5} w10={w10} />
                      <div className="eq-wrap" title="Sermaye eğrisi: 1₺ nasıl büyürdü (renkli: strateji + nakit enflasyon, gri: Al-Tut, kesik: başabaş)">
                        <EquitySpark data={eq} />
                        <div className="eq-leg lg-muted">renkli: Strateji (enflasyon dahil) · gri: Al-Tut · kesik çizgi: başabaş</div>
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
                Kayıtlı stratejilerini <b>en eski 300 BIST hissesinde</b> (en uzun geçmişe sahip) tarar; <b>enflasyon
                dahil yıllık</b> getirisi en yüksek 20 <b>hisse + strateji</b> eşleşmesini listeler. Bir satıra tıkla → o
                hisseyi açar ve stratejiyi işaretler.{' '}
                <span className="lg-muted">
                  (Nakit, yıla göre enflasyona/TÜFE endeksli. Sonuçlar saklanır; tekrar tarayınca yalnızca yeni/değişen
                  stratejiler hesaplanır.)
                </span>
              </p>
              <div className="sb-actions">
                <button className="scr-add" onClick={runScan} disabled={!strats.length || scan?.running}>
                  {scan?.running ? `Taranıyor… ${scan.done}/${scan.total}` : scanMeta ? '↻ Güncelle' : '🔍 Tara'}
                </button>
                {scanMeta && !scan?.running && (
                  <span className="bt-note">
                    Son tarama: {fmtAgo(scanMeta.at)}
                    {stale && <span className="scan-stale"> · ⚠️ stratejiler değişti, güncelle</span>}
                  </span>
                )}
                {!strats.length && <span className="bt-note">Önce "Stratejilerim"den strateji ekle.</span>}
              </div>
              {scan && (scan.rows.length > 0 || !scan.running) && (
                <div className={'bt-list' + (scan.running ? ' bt-list-updating' : '')}>
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
                          <span className={'bt-srow-val ' + (t.ann >= 0 ? 'up' : 'down')} title="Yıllık getiri — nakitteyken enflasyon (TÜFE) dahil (Al-Tut'a rakip)">
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
                          💰 enf. dahil{' '}
                          <b className={t.ann >= t.hold ? 'rv-win' : 'rv-lose'}>
                            {fmtPct(t.ann)}
                            {t.ann >= t.hold ? ' ✓' : ''}
                          </b>{' '}
                          · saf strateji{' '}
                          <b className={t.pure >= t.hold ? 'rv-win' : 'rv-lose'}>
                            {fmtPct(t.pure)}
                            {t.pure >= t.hold ? ' ✓' : ''}
                          </b>{' '}
                          · Al-Tut <b className="rv-base">{fmtPct(t.hold)}</b>
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

// One window segment: strategy (incl. inflation) vs Al-Tut, annualized.
function winSeg(label: string, w: StrategyResult) {
  const ann = w.annRate ?? w.annPct;
  const beat = ann >= w.holdAnn;
  return (
    <span>
      {label}: strat{' '}
      <b className={beat ? 'rv-win' : 'rv-lose'}>
        {fmtPct(ann)}
        {beat ? ' ✓' : ''}
      </b>{' '}
      / Al-Tut <b className="rv-base">{fmtPct(w.holdAnn)}</b>
    </span>
  );
}
// 5-year / 10-year comparison line (skips a window when history is too short).
function WinLine({ w5, w10 }: { w5: StrategyResult | null; w10: StrategyResult | null }) {
  if (!w5 && !w10) return null;
  return (
    <div className="bt-srow-sub bt-win">
      ⏳ {w5 && winSeg('5y', w5)}
      {w5 && w10 && <span className="lg-muted"> · </span>}
      {w10 && winSeg('10y', w10)}
    </div>
  );
}

// Downsampled equity curves: strategy vs Buy & Hold (both start at 1).
interface Eq {
  strat: number[];
  hold: number[];
}
function equitySpark(close: Float64Array, pos: Uint8Array, time: Float64Array, dailyRates?: ArrayLike<number>, points = 90): Eq {
  const n = close.length;
  if (n < 2) return { strat: [], hold: [] };
  const step = Math.max(1, Math.floor(n / points));
  const strat: number[] = [];
  const hold: number[] = [];
  let e = 1;
  const base = close[0];
  for (let i = 1; i < n; i++) {
    if (pos[i - 1]) e *= close[i] / close[i - 1];
    else if (dailyRates) {
      const cal = Math.min(Math.max((time[i] - time[i - 1]) / 86400, 0), 31);
      e *= Math.pow(1 + dailyRates[i], cal); // cash keeps pace with inflation while flat
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
