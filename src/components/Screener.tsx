import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchScreener, fetchBistSpark, fetchBistStatic, isIndexSymbol, ScreenerFile, ScreenerItem } from '../data/bistStatic';
import { Candles } from '../data/types';
import { emaArr, adxArr, rocArr, rollingHighest, rollingLowest, IndicatorParams } from '../indicators/calc';
import { useEscClose } from '../useEscClose';

// ── Live (period-aware) indicator filter ─────────────────────────────────────
// The fast Screener filters a fixed-period snapshot; this computes an indicator
// at ANY period on demand (downloads candles for the snapshot-filtered subset).
// A live filter, param-aware: compare active indicator `a` to a value, or to
// another active indicator `b`. Periods are NOT stored — they always come from
// the chart's current params at evaluation time (see ACTIVE / activeValue).
interface LiveF {
  a: string; // active indicator key (left side)
  op: 'gt' | 'lt';
  b: string | null; // active indicator key (right side); null → compare to `val`
  val: number; // used when b === null
}
const liveCandles = new Map<string, Candles>(); // session cache (avoid re-downloading)

function rsiLast(close: Float64Array, len: number): number {
  const n = close.length;
  if (n <= len) return NaN;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= len; i++) {
    const ch = close[i] - close[i - 1];
    ag += Math.max(ch, 0);
    al += Math.max(-ch, 0);
  }
  ag /= len;
  al /= len;
  for (let i = len + 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    ag = (ag * (len - 1) + Math.max(ch, 0)) / len;
    al = (al * (len - 1) + Math.max(-ch, 0)) / len;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
// Current value of an indicator at a given period. For %R EMA (a two-period
// composite) `p` is the Williams %R lookback and `p2` is the EMA length.
function liveValue(c: Candles, ind: string, p: number, p2?: number): number {
  const n = c.length;
  const last = n - 1;
  const pp = Math.max(1, Math.round(p));
  if (ind === 'rsi') return rsiLast(c.close, Math.max(2, pp));
  if (ind === 'adx') {
    const a = adxArr(c, Math.max(2, pp));
    return a[last];
  }
  if (ind === 'roc') return n > pp && c.close[n - 1 - pp] > 0 ? (c.close[last] / c.close[n - 1 - pp] - 1) * 100 : NaN;
  if (ind === 'emadist') {
    const e = emaArr(c.close, pp);
    return e[last] ? (c.close[last] / e[last] - 1) * 100 : NaN;
  }
  // ADX EMA / Momentum EMA — pp = base lookback; p2 = EMA length (default 120).
  if (ind === 'adxema') return emaArr(adxArr(c, Math.max(2, pp)), Math.max(1, Math.round(p2 ?? 120)))[last];
  if (ind === 'rocema') return emaArr(rocArr(c.close, pp), Math.max(1, Math.round(p2 ?? 120)))[last];
  // wr / wrema — pp = Williams %R lookback; for wrema, p2 = EMA length (default pp).
  const hh = rollingHighest(c.high, pp);
  const ll = rollingLowest(c.low, pp);
  const pr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = hh[i] - ll[i];
    pr[i] = d ? (100 * (c.close[i] - hh[i])) / d + 100 : NaN;
  }
  if (ind === 'wrema') return emaArr(pr, Math.max(1, Math.round(p2 ?? pp)))[last];
  return pr[last];
}

// ── Active (param-aware) live indicators ────────────────────────────────────
// These mirror the chart's indicator lines and are ALWAYS computed at the
// chart's CURRENT parameters (no manual period box). The exact same set is used
// for the filter target, the "vs indicator" comparison, and as live columns —
// so filtering and the comparison data are formed identically.
interface ActiveInd {
  key: string; // stable id (also the live column key)
  ind: string; // liveValue() indicator
  base: (p: IndicatorParams) => number; // primary period (chart param)
  ema?: (p: IndicatorParams) => number; // EMA length, for compound indicators
  label: (p: IndicatorParams) => string;
}
const ACTIVE: ActiveInd[] = [
  { key: 'a_wr', ind: 'wr', base: (p) => p.wr, label: (p) => `Williams %R (${p.wr})` },
  { key: 'a_wreA', ind: 'wrema', base: (p) => p.wr, ema: (p) => p.wrEmaA, label: (p) => `%R EMA (${p.wr}/${p.wrEmaA})` },
  { key: 'a_wreB', ind: 'wrema', base: (p) => p.wr, ema: (p) => p.wrEmaB, label: (p) => `%R EMA (${p.wr}/${p.wrEmaB})` },
  { key: 'a_adx', ind: 'adx', base: (p) => p.adx, label: (p) => `ADX (${p.adx})` },
  { key: 'a_adxe', ind: 'adxema', base: (p) => p.adx, ema: (p) => p.adxEma, label: (p) => `ADX EMA (${p.adx}/${p.adxEma})` },
  { key: 'a_roc', ind: 'roc', base: (p) => p.roc, label: (p) => `Momentum (${p.roc})` },
  { key: 'a_roce', ind: 'rocema', base: (p) => p.roc, ema: (p) => p.rocEma, label: (p) => `Momentum EMA (${p.roc}/${p.rocEma})` },
  { key: 'a_emad', ind: 'emadist', base: (p) => p.emaFast, label: (p) => `Fiyat/EMA farkı (${p.emaFast})` },
  { key: 'a_rsi', ind: 'rsi', base: () => 14, label: () => 'RSI (14)' },
];
const ACT = (k: string): ActiveInd | undefined => ACTIVE.find((a) => a.key === k);
const isActiveKey = (k: string): boolean => k.startsWith('a_');
const activeLabel = (k: string, p: IndicatorParams): string => ACT(k)?.label(p) ?? k;
function activeValue(c: Candles, key: string, p: IndicatorParams): number {
  const a = ACT(key);
  return a ? liveValue(c, a.ind, a.base(p), a.ema ? a.ema(p) : undefined) : NaN;
}

interface Props {
  onClose: () => void;
  onSelect: (s: string) => void;
  onAddToWatch: (syms: string[], mode: 'add' | 'new') => void;
  params: IndicatorParams; // chart's active periods → power the live indicators
}

function readScrState(): {
  view?: number;
  filters?: Filter[];
  sort?: { key: Key; dir: 1 | -1 };
  q?: string;
  liveFs?: LiveF[];
  liveSet?: string[];
  liveVals?: Record<string, Record<string, number>>;
  psig?: string;
} {
  try {
    return JSON.parse(localStorage.getItem('borsaScrState') || '{}');
  } catch {
    return {};
  }
}

type Key = keyof ScreenerItem;
type Kind = 'price' | 'pct' | 'num' | 'bool' | 'dec';
interface ColDef {
  key: Key;
  label: string;
  kind: Kind;
}

const COLS: ColDef[] = [
  { key: 'p', label: 'Fiyat', kind: 'price' },
  { key: 'ch', label: 'Günlük %', kind: 'pct' },
  { key: 'rsi', label: 'RSI', kind: 'num' },
  { key: 'wr', label: 'Williams %R', kind: 'num' },
  { key: 'wre', label: '%R EMA (260)', kind: 'num' },
  { key: 'wre2', label: '%R EMA (120)', kind: 'num' },
  { key: 'adx', label: 'ADX (28)', kind: 'num' },
  { key: 'roc', label: 'Momentum %', kind: 'pct' },
  { key: 'mc', label: 'MACD (NC)', kind: 'dec' },
  { key: 'sg', label: 'Signal (NC)', kind: 'dec' },
  { key: 'em', label: 'eMACD (NC)', kind: 'dec' },
  { key: 'dl', label: 'Δ MACD (NC)', kind: 'dec' },
  { key: 'r1m', label: '1A %', kind: 'pct' },
  { key: 'r3m', label: '3A %', kind: 'pct' },
  { key: 'r1y', label: '1Y %', kind: 'pct' },
  { key: 'vol', label: 'Oynaklık %', kind: 'num' },
  { key: 'dd', label: 'Max düşüş %', kind: 'num' },
  { key: 'fh', label: 'Zirveye %', kind: 'pct' },
  { key: 'yr', label: 'Geçmiş (yıl)', kind: 'num' },
  { key: 'av', label: 'Ort. hacim', kind: 'num' },
  { key: 'e50', label: 'EMA50 üstü', kind: 'bool' },
  { key: 'e200', label: 'EMA200 üstü', kind: 'bool' },
  { key: 'gc', label: 'Golden cross', kind: 'bool' },
  { key: 'mu', label: 'MACD yukarı', kind: 'bool' },
  { key: 'st', label: 'Supertrend ↑', kind: 'bool' },
];
const COL = (k: Key): ColDef => COLS.find((c) => c.key === k) as ColDef;

// A filter target is either a snapshot column (instant) or an active indicator
// key (live, param-aware). Active targets are always numeric.
const targetKind = (k: string): Kind => (isActiveKey(k) ? 'num' : COL(k as Key).kind);

const VIEWS: { label: string; cols: Key[] }[] = [
  { label: 'Genel', cols: ['p', 'ch', 'rsi', 'r1y', 'vol', 'e200'] },
  { label: 'Williams Paşa (%R)', cols: ['p', 'wr', 'wre', 'rsi', 'e200', 'st'] },
  { label: 'NizamiCedid (MACD)', cols: ['p', 'mc', 'sg', 'em', 'dl'] },
  { label: 'ADX / Momentum', cols: ['p', 'adx', 'roc'] },
  { label: 'Trend / EMA', cols: ['p', 'e50', 'e200', 'gc', 'st'] },
  { label: 'MACD & momentum', cols: ['p', 'mu', 'ch', 'r3m', 'r1y'] },
  { label: 'Getiri', cols: ['p', 'r1m', 'r3m', 'r1y'] },
  { label: 'Risk', cols: ['p', 'vol', 'dd', 'fh', 'yr'] },
];

interface Filter {
  key: Key;
  op: string;
  val: number;
  mode?: 'val' | 'field';
  key2?: Key;
}

const PRESETS: { label: string; fs: Filter[] }[] = [
  { label: '📈 Yükseliş trendi', fs: [{ key: 'e200', op: 'is', val: 1 }, { key: 'gc', op: 'is', val: 1 }] },
  { label: '🎯 52H zirveye yakın', fs: [{ key: 'e200', op: 'is', val: 1 }, { key: 'fh', op: 'gte', val: -5 }] },
  { label: '🛡️ Supertrend AL', fs: [{ key: 'st', op: 'is', val: 1 }, { key: 'e200', op: 'is', val: 1 }] },
  { label: '💪 %R > 50', fs: [{ key: 'wr', op: 'gt', val: 50 }, { key: 'e200', op: 'is', val: 1 }] },
  { label: '🧭 ADX > 25 (güçlü trend)', fs: [{ key: 'adx', op: 'gt', val: 25 }] },
  { label: '🚀 Momentum > 0 + Trend', fs: [{ key: 'roc', op: 'gt', val: 0 }, { key: 'e200', op: 'is', val: 1 }] },
  { label: '🟢 RSI < 35', fs: [{ key: 'rsi', op: 'lt', val: 35 }] },
  { label: '🔴 RSI > 70', fs: [{ key: 'rsi', op: 'gt', val: 70 }] },
];

const PAL = ['#3b82f6', '#26a69a', '#f59e0b', '#a855f7', '#ef5350', '#14b8a6', '#ec4899', '#f97316', '#06b6d4', '#84cc16'];

export function Screener({ onClose, onSelect, onAddToWatch, params }: Props) {
  useEscClose(onClose);
  const [data, setData] = useState<ScreenerFile | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<number>(() => readScrState().view ?? 0);
  const [filters, setFilters] = useState<Filter[]>(() => readScrState().filters ?? []);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>(() => readScrState().sort ?? { key: 'r1y', dir: -1 });
  const [msg, setMsg] = useState('');
  const [fk, setFk] = useState<string>('wr'); // snapshot column key OR active indicator key
  const [op, setOp] = useState('gt');
  const [val, setVal] = useState('50');
  const [cmp, setCmp] = useState<'val' | 'field'>('val'); // 'field' = compare to another column/indicator
  const [fk2, setFk2] = useState<Key>('r3m'); // snapshot compare column
  const [bk, setBk] = useState<string>('a_roc'); // active-indicator compare (active target)
  const [q, setQ] = useState<string>(() => readScrState().q ?? '');
  const [saved, setSaved] = useState<{ name: string; view: number; filters: Filter[] }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('borsaScreens') || '[]');
    } catch {
      return [];
    }
  });
  const [saveName, setSaveName] = useState('');
  // Signature of the chart params the live results were computed with. Results
  // are restored only when it still matches → "params değişmediyse kalsın".
  const psig = useMemo(() => JSON.stringify(params), [params]);
  // Live indicator values per symbol (active key → value), filled by "Canlı
  // uygula"; powers both the live filter AND the live columns (same data).
  const [liveVals, setLiveVals] = useState<Record<string, Record<string, number>>>(() => {
    const s = readScrState();
    return s.liveVals && s.psig === JSON.stringify(params) ? s.liveVals : {};
  });
  // Live filters persist always (they reference indicators, not periods); live
  // RESULTS persist only while the params they used are unchanged.
  const [liveFs, setLiveFs] = useState<LiveF[]>(() => {
    const s = readScrState();
    return Array.isArray(s.liveFs) ? s.liveFs : [];
  });
  const [liveSet, setLiveSet] = useState<Set<string> | null>(() => {
    const s = readScrState();
    return Array.isArray(s.liveSet) && s.psig === JSON.stringify(params) ? new Set(s.liveSet) : null;
  });
  const [liveRun, setLiveRun] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    // Drop indices (XU100, XBANK, …) — this is a stock screener, not an index list.
    fetchScreener()
      .then((d) => setData(d ? { ...d, items: d.items.filter((it) => !isIndexSymbol(it.s)) } : null))
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
    fetchBistSpark().then(setSpark).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem('borsaScreens', JSON.stringify(saved));
  }, [saved]);
  // Remember the last screen state (incl. live filters + results) so leaving to
  // view a stock — or closing the screener — doesn't reset it.
  useEffect(() => {
    localStorage.setItem(
      'borsaScrState',
      JSON.stringify({ view, filters, sort, q, liveFs, liveSet: liveSet ? [...liveSet] : null, liveVals, psig }),
    );
  }, [view, filters, sort, q, liveFs, liveSet, liveVals, psig]);
  // Chart params changed → live results are stale: drop them (keep the filters),
  // so the next "Canlı uygula" recomputes with the new parameters.
  const prevPsig = useRef(psig);
  useEffect(() => {
    if (prevPsig.current !== psig) {
      prevPsig.current = psig;
      setLiveSet(null);
      setLiveVals({});
    }
  }, [psig]);

  const addWatch = (mode: 'add' | 'new') => {
    const syms = rows.map((r) => r.s);
    if (!syms.length) return;
    onAddToWatch(syms, mode);
    setMsg(`${syms.length} hisse ${mode === 'new' ? 'yeni listeye eklendi' : 'aktif listeye eklendi'}`);
    window.setTimeout(() => setMsg(''), 2500);
  };

  const isAct = isActiveKey(fk); // active (live, param-aware) indicator vs snapshot column
  const kind = targetKind(fk);
  const liveMode = isAct; // active targets always evaluate live (download + compute)

  // Columns shown = the selected view + any column we're filtering on (so the
  // values you filter by are always visible in the table).
  const filterKeys = useMemo(() => {
    const s = new Set<Key>();
    for (const f of filters) {
      s.add(f.key);
      if (f.key2) s.add(f.key2);
    }
    return s;
  }, [filters]);
  const cols = useMemo(() => {
    const base = VIEWS[view].cols;
    const seen = new Set<Key>(base);
    const extra: Key[] = [];
    filterKeys.forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        extra.push(k);
      }
    });
    return [...base, ...extra];
  }, [view, filterKeys]);
  // Active indicators referenced by live filters → shown as live columns (same
  // values the live filter used). Computed by "Canlı uygula" into liveVals.
  const liveCols = useMemo(() => {
    const s = new Set<string>();
    for (const f of liveFs) {
      s.add(f.a);
      if (f.b) s.add(f.b);
    }
    return [...s];
  }, [liveFs]);

  // Snapshot-filtered + searched + sorted (before any live filter).
  const base = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toUpperCase();
    const out = items.filter(
      (it) =>
        filters.every((f) => passF(it, f)) &&
        (!needle || it.s.includes(needle) || (it.n || '').toUpperCase().includes(needle)),
    );
    // Finite values sort by direction; missing/NaN (optional columns on older
    // snapshots, or young stocks) always sink to the bottom instead of scrambling.
    out.sort((a, b) => {
      const av = a[sort.key] as number;
      const bv = b[sort.key] as number;
      const af = Number.isFinite(av);
      const bf = Number.isFinite(bv);
      if (af && bf) return (av - bv) * sort.dir;
      return af ? -1 : bf ? 1 : 0;
    });
    return out;
  }, [data, filters, sort, q]);
  const rows = useMemo(() => (liveSet ? base.filter((r) => liveSet.has(r.s)) : base), [base, liveSet]);

  const runLive = async () => {
    if (!liveFs.length) {
      setLiveSet(null);
      setLiveVals({});
      return;
    }
    // Every active indicator referenced (both sides) — computed once per symbol
    // at the chart params; the same values feed the filter AND the live columns.
    const usedKeys = [...new Set(liveFs.flatMap((f) => (f.b ? [f.a, f.b] : [f.a])))];
    const syms = base.map((r) => r.s);
    setLiveRun({ done: 0, total: syms.length });
    const pass = new Set<string>();
    const vals: Record<string, Record<string, number>> = {};
    const queue = [...syms];
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const sym = queue.shift()!;
        let c = liveCandles.get(sym);
        if (!c) {
          try {
            c = await fetchBistStatic(sym);
            liveCandles.set(sym, c);
          } catch {
            c = undefined;
          }
        }
        if (c && c.length >= 30) {
          const row: Record<string, number> = {};
          for (const k of usedKeys) row[k] = activeValue(c, k, params);
          vals[sym] = row;
          let ok = true;
          for (const f of liveFs) {
            const v = row[f.a];
            const t = f.b ? row[f.b] : f.val;
            if (!Number.isFinite(v) || !Number.isFinite(t) || (f.op === 'gt' ? !(v > t) : !(v < t))) {
              ok = false;
              break;
            }
          }
          if (ok) pass.add(sym);
        }
        done++;
        setLiveRun((p) => (p ? { ...p, done } : p));
        if (done % 6 === 0) await new Promise((r) => setTimeout(r));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    setLiveSet(pass);
    setLiveVals(vals);
    setLiveRun(null);
  };

  const addFilter = () => {
    // Active (param-aware) target → live filter vs a value OR another active
    // indicator. Periods always come from the chart params (no manual entry).
    if (isAct) {
      const o: 'gt' | 'lt' = op === 'lt' || op === 'lte' ? 'lt' : 'gt';
      const b = cmp === 'field' ? bk : null;
      if (b === fk) return; // indicator vs itself
      let v = 0;
      if (!b) {
        v = parseFloat(val.replace(',', '.'));
        if (!Number.isFinite(v)) return;
      }
      setLiveFs((fs) => [...fs.filter((x) => !(x.a === fk && x.b === b && x.op === o)), { a: fk, op: o, b, val: v }]);
      setLiveSet(null); // needs re-apply
      return;
    }
    // Snapshot path: filter the already-loaded snapshot (instant).
    const sk = fk as Key;
    let f: Filter;
    if (kind === 'bool') {
      f = { key: sk, op: 'is', val: Number(val) || 0 };
    } else if (cmp === 'field') {
      if (fk2 === sk) return;
      f = { key: sk, op, mode: 'field', key2: fk2, val: 0 };
    } else {
      const v = parseFloat(val.replace(',', '.'));
      if (!isFinite(v)) return;
      f = { key: sk, op, mode: 'val', val: v };
    }
    setFilters((fs) => [...fs.filter((x) => !(x.key === f.key && x.op === f.op && x.key2 === f.key2)), f]);
  };
  const toggleSort = (k: Key) =>
    setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: -1 }));
  const saveScreen = () => {
    const nm = saveName.trim();
    if (!nm) return;
    setSaved((s) => [...s.filter((x) => x.name !== nm), { name: nm, view, filters }]);
    setSaveName('');
  };
  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="scr-head-title">
            <b>🔍 Hisse Tarama{data ? ` · ${data.items.length} hisse` : ''}</b>
            {data?.asof && (
              <span className="scr-asof" title="Verinin ait olduğu son işlem günü (snapshot)">📅 veri: {trDate(data.asof)}</span>
            )}
          </span>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>
        <div className="modal-body">
          {!loaded ? (
            <div className="bt-note">Yükleniyor…</div>
          ) : !data || !data.items.length ? (
            <div className="bt-note">Tarama verisi henüz hazır değil (CI bir sonraki dağıtımda üretecek).</div>
          ) : (
            <>
              <div className="scr-build">
                <label className="scr-pick">
                  📊 Kolonlar
                  <select value={view} onChange={(e) => setView(Number(e.target.value))}>
                    {VIEWS.map((v, i) => (
                      <option key={v.label} value={i}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="scr-sep" />
                <span className="lg-muted">Filtre:</span>
                <select
                  value={fk}
                  onChange={(e) => {
                    const k = e.target.value;
                    setFk(k);
                    const bool = targetKind(k) === 'bool';
                    setOp(bool ? 'is' : 'gt');
                    setVal(bool ? '1' : '');
                    setCmp('val');
                    if (isActiveKey(k) && bk === k) setBk(ACTIVE.find((a) => a.key !== k)!.key);
                  }}
                >
                  <optgroup label="Snapshot (hızlı)">
                    {COLS.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="🔬 Aktif göstergeler (grafik · canlı)">
                    {ACTIVE.map((a) => (
                      <option key={a.key} value={a.key}>{a.label(params)}</option>
                    ))}
                  </optgroup>
                </select>
                {kind === 'bool' ? (
                  <select value={val} onChange={(e) => setVal(e.target.value)}>
                    <option value="1">Evet</option>
                    <option value="0">Hayır</option>
                  </select>
                ) : (
                  <>
                    <select
                      value={isAct ? (op === 'lt' || op === 'lte' ? 'lt' : 'gt') : op}
                      onChange={(e) => setOp(e.target.value)}
                    >
                      <option value="gt">&gt; büyük</option>
                      {!isAct && <option value="gte">≥</option>}
                      <option value="lt">&lt; küçük</option>
                      {!isAct && <option value="lte">≤</option>}
                      {!isAct && <option value="eq">= eşit</option>}
                    </select>
                    <select value={cmp} onChange={(e) => setCmp(e.target.value as 'val' | 'field')} title="Sabit değer mi başka bir gösterge/kolon mu?">
                      <option value="val">Değer</option>
                      <option value="field">{isAct ? 'Gösterge' : 'Veri (kolon)'}</option>
                    </select>
                    {cmp === 'val' ? (
                      <input
                        value={val}
                        inputMode="decimal"
                        placeholder="değer"
                        onChange={(e) => setVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                      />
                    ) : isAct ? (
                      <select value={bk} onChange={(e) => setBk(e.target.value)}>
                        {ACTIVE.filter((a) => a.key !== fk).map((a) => (
                          <option key={a.key} value={a.key}>{a.label(params)}</option>
                        ))}
                      </select>
                    ) : (
                      <select value={fk2} onChange={(e) => setFk2(e.target.value as Key)}>
                        {COLS.filter((c) => c.kind !== 'bool').map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                <button className="scr-add" onClick={addFilter}>
                  + Ekle
                </button>
                {liveMode && <span className="scr-livehint" title="Bu filtre canlı çalışır: + Ekle'den sonra aşağıdan 'Canlı uygula'ya bas">🔬 canlı</span>}
              </div>
              {liveFs.length > 0 && (
                <div className="scr-chips">
                  <span className="lg-muted">🔬 Canlı (aktif göstergeler):</span>
                  {liveFs.map((f, i) => (
                    <span key={i} className="scr-fchip scr-fchip-live">
                      {activeLabel(f.a, params)} {f.op === 'gt' ? '>' : '<'} {f.b ? activeLabel(f.b, params) : f.val}
                      <button aria-label="Filtreyi kaldır" title="Filtreyi kaldır" onClick={() => { setLiveFs((fs) => fs.filter((_, idx) => idx !== i)); setLiveSet(null); }}>×</button>
                    </span>
                  ))}
                  <button className="scr-add" onClick={runLive} disabled={!!liveRun} title="Snapshot ile süzülen hisseleri indirip canlı hesaplar">
                    {liveRun ? `Taranıyor… ${liveRun.done}/${liveRun.total}` : liveSet ? '↻ Canlı uygula' : '🔬 Canlı uygula'}
                  </button>
                  <button className="scr-preset scr-clear" onClick={() => { setLiveFs([]); setLiveSet(null); }}>✕ canlı temizle</button>
                  {liveSet && <span className="lg-muted">canlı: {liveSet.size} eşleşti</span>}
                  {!liveSet && <span className="scan-stale">↻ "Canlı uygula"ya bas</span>}
                </div>
              )}

              <div className="scr-presets">
                {PRESETS.map((p) => (
                  <button key={p.label} className="scr-preset" onClick={() => setFilters(p.fs)}>
                    {p.label}
                  </button>
                ))}
                {filters.length > 0 && (
                  <button className="scr-preset scr-clear" onClick={() => setFilters([])}>
                    ✕ Tümünü temizle
                  </button>
                )}
              </div>

              {filters.length > 0 && (
                <div className="scr-chips">
                  {filters.map((f, i) => (
                    <span key={i} className="scr-fchip">
                      {COL(f.key).label} {opLabel(f)}
                      <button aria-label="Filtreyi kaldır" title="Filtreyi kaldır" onClick={() => setFilters((fs) => fs.filter((_, idx) => idx !== i))}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {(saved.length > 0 || filters.length > 0) && (
                <div className="scr-saved">
                  <span className="lg-muted">💾 Taramalarım:</span>
                  {saved.map((sc) => (
                    <span key={sc.name} className="scr-savedchip">
                      <button
                        onClick={() => {
                          setView(sc.view);
                          setFilters(sc.filters);
                        }}
                        title="Bu taramayı yükle"
                      >
                        📁 {sc.name}
                      </button>
                      <button
                        className="scr-savedx"
                        onClick={() => setSaved((s) => s.filter((x) => x.name !== sc.name))}
                        title="Sil"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {filters.length > 0 && (
                    <span className="scr-saveform">
                      <input
                        placeholder="Tarama adı…"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveScreen()}
                      />
                      <button className="scr-savebtn" onClick={saveScreen}>
                        Kaydet
                      </button>
                    </span>
                  )}
                </div>
              )}

              <div className="scr-count">
                <span>
                  <b>{rows.length}</b> hisse eşleşti
                  {msg && <span className="scr-msg">✓ {msg}</span>}
                </span>
                <span className="scr-actions">
                  <button
                    className="scr-act"
                    onClick={() => addWatch('add')}
                    disabled={!rows.length}
                    title="Eşleşen tüm hisseleri aktif izleme listesine ekle"
                  >
                    ★ Aktif listeye ekle
                  </button>
                  <button
                    className="scr-act"
                    onClick={() => addWatch('new')}
                    disabled={!rows.length}
                    title="Eşleşenlerden yeni bir izleme listesi oluştur"
                  >
                    🆕 Yeni liste oluştur
                  </button>
                  <input
                    className="scr-search"
                    placeholder="🔎 Sembol / şirket ara"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </span>
              </div>

              <div className="scr-tablewrap">
                <table className="scr-table">
                  <thead>
                    <tr>
                      <th className="scr-th-sym">Sembol</th>
                      <th className="scr-th-spark">Trend</th>
                      {cols.map((k) => (
                        <th
                          key={k}
                          className={filterKeys.has(k) ? 'scr-th-filtered' : ''}
                          onClick={() => toggleSort(k)}
                          title="Sırala"
                        >
                          {COL(k).label}
                          {sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                        </th>
                      ))}
                      {liveCols.map((k) => (
                        <th key={k} className="scr-th-filtered cb-r" title="Canlı · grafik parametreleriyle">
                          🔬 {activeLabel(k, params)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 250).map((it) => (
                      <tr key={it.s} onClick={() => pick(it.s)} title="Grafikte aç">
                        <td className="scr-td-sym">
                          <span className="scr-ava" style={{ background: avatarColor(it.s) }}>
                            {it.s.slice(0, 2)}
                          </span>
                          <span className="scr-sym-txt">
                            <b>{it.s}</b>
                            <span className="lg-muted">{it.n}</span>
                          </span>
                        </td>
                        <td className="scr-td-spark">
                          <Spark data={spark[it.s]} />
                        </td>
                        {cols.map((k) => (
                          <td key={k}>{cell(it, COL(k))}</td>
                        ))}
                        {liveCols.map((k) => {
                          const v = liveVals[it.s]?.[k];
                          return (
                            <td key={k} className="cb-r">
                              {Number.isFinite(v) ? (v as number).toFixed(1) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="bt-note">Eşleşen hisse yok — filtreleri gevşet.</div>}
                {rows.length > 250 && <div className="bt-note">… ilk 250 gösteriliyor. Filtreyi daralt.</div>}
              </div>
              <div className="bt-hint">
                ⚠️ Anlık gösterge taraması; yatırım tavsiyesi değildir. Başlığa tıkla → sırala, satıra tıkla → grafikte aç. <b>🔬 Aktif göstergeler</b> grafikteki
                parametrelerle <b>canlı</b> hesaplanır (hisseleri indirir) — aynı değerler hem filtre, hem kıyas (gösterge↔gösterge), hem de kolon olarak kullanılır. Kurduktan sonra <b>Canlı uygula</b>'ya bas. Parametreyi grafikten değiştirip yeniden uygula.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// "2026-06-16" → "16.06.2026" (tz-safe; no Date parsing)
function trDate(iso: string): string {
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
}

function passF(it: ScreenerItem, f: Filter): boolean {
  const v = it[f.key] as number;
  const t = f.mode === 'field' && f.key2 != null ? (it[f.key2] as number) : f.val;
  switch (f.op) {
    case 'gt':
      return v > t;
    case 'gte':
      return v >= t;
    case 'lt':
      return v < t;
    case 'lte':
      return v <= t;
    case 'eq':
      return Math.round(v) === Math.round(t);
    case 'is':
      return (v ? 1 : 0) === f.val;
    default:
      return true;
  }
}

function opLabel(f: Filter): string {
  if (f.op === 'is') return f.val ? 'Evet' : 'Hayır';
  const m: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
  const target = f.mode === 'field' && f.key2 != null ? COL(f.key2).label : String(f.val);
  return `${m[f.op]} ${target}`;
}

function cell(it: ScreenerItem, c: ColDef) {
  const v = it[c.key] as number | undefined;
  if (c.kind === 'bool') return v ? <span className="scr-pill up">✓</span> : <span className="scr-pill mut">–</span>;
  if (v == null || !Number.isFinite(v)) return <span className="lg-muted">—</span>;
  if (c.key === 'rsi') return gauge(v, 'rsi');
  if (c.key === 'wr') return gauge(v, 'wr');
  if (c.kind === 'dec') return <span className={v >= 0 ? 'up' : 'down'}>{v.toFixed(3)}</span>;
  if (c.kind === 'price') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c.key === 'av') return fv(v);
  if (c.key === 'yr') return v.toFixed(1);
  if (c.kind === 'pct')
    return (
      <span className={v >= 0 ? 'up' : 'down'}>
        {(v >= 0 ? '+' : '') + (c.key === 'ch' ? v.toFixed(2) : v)}%
      </span>
    );
  return String(Math.round(v));
}

function gauge(v: number, k: 'rsi' | 'wr') {
  const w = Math.max(0, Math.min(100, v));
  const color =
    k === 'rsi'
      ? v >= 70
        ? 'var(--down)'
        : v <= 35
          ? 'var(--up)'
          : '#5b7cfa'
      : v >= 50
        ? 'var(--up)'
        : 'var(--down)';
  return (
    <div className="scr-gauge">
      <div className="scr-gauge-fill" style={{ width: w + '%', background: color }} />
      <span>{Math.round(v)}</span>
    </div>
  );
}

function Spark({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return <svg className="scr-spark" width="64" height="22" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data
    .map((vv, i) => `${((i / (data.length - 1)) * 62 + 1).toFixed(1)},${(21 - ((vv - min) / rng) * 20).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="scr-spark" width="64" height="22">
      <polyline points={pts} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.3" />
    </svg>
  );
}

function avatarColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PAL[h % PAL.length];
}

function fv(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
