import { useEffect, useMemo, useState } from 'react';
import { fetchScreener, fetchBistSpark, fetchBistStatic, ScreenerFile, ScreenerItem } from '../data/bistStatic';
import { Candles } from '../data/types';
import { emaArr, adxArr, bollingerBand, rollingHighest, rollingLowest } from '../indicators/calc';

// ── Live (period-aware) indicator filter ─────────────────────────────────────
// The fast Screener filters a fixed-period snapshot; this computes an indicator
// at ANY period on demand (downloads candles for the snapshot-filtered subset).
interface LiveF {
  ind: string;
  period: number;
  op: 'gt' | 'lt';
  val: number;
}
const LIVE_INDS: { key: string; label: string }[] = [
  { key: 'wr', label: 'Williams %R' },
  { key: 'wrema', label: '%R EMA' },
  { key: 'rsi', label: 'RSI' },
  { key: 'adx', label: 'ADX' },
  { key: 'roc', label: 'Momentum / ROC %' },
  { key: 'emadist', label: 'Fiyat/EMA farkı %' },
  { key: 'bbp', label: 'Bollinger %b' },
  { key: 'dcp', label: 'Donchian konum %' },
];
const liveLabel = (k: string) => LIVE_INDS.find((i) => i.key === k)?.label ?? k;
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
// Current value of an indicator at a given period.
function liveValue(c: Candles, ind: string, p: number): number {
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
  if (ind === 'bbp') {
    const up = bollingerBand(c, Math.max(2, pp), 'up');
    const dn = bollingerBand(c, Math.max(2, pp), 'dn');
    return up[last] > dn[last] ? ((c.close[last] - dn[last]) / (up[last] - dn[last])) * 100 : NaN;
  }
  if (ind === 'dcp') {
    const hh = rollingHighest(c.high, pp);
    const ll = rollingLowest(c.low, pp);
    return hh[last] > ll[last] ? ((c.close[last] - ll[last]) / (hh[last] - ll[last])) * 100 : NaN;
  }
  // wr / wrema
  const hh = rollingHighest(c.high, pp);
  const ll = rollingLowest(c.low, pp);
  const pr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = hh[i] - ll[i];
    pr[i] = d ? (100 * (c.close[i] - hh[i])) / d + 100 : NaN;
  }
  if (ind === 'wrema') return emaArr(pr, pp)[last];
  return pr[last];
}

interface Props {
  onClose: () => void;
  onSelect: (s: string) => void;
  onAddToWatch: (syms: string[], mode: 'add' | 'new') => void;
}

function readScrState(): { view?: number; filters?: Filter[]; sort?: { key: Key; dir: 1 | -1 }; q?: string } {
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
  { key: 'dcp', label: 'Donchian konum %', kind: 'num' },
  { key: 'bbp', label: 'Bollinger %b', kind: 'num' },
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

const VIEWS: { label: string; cols: Key[] }[] = [
  { label: 'Genel', cols: ['p', 'ch', 'rsi', 'r1y', 'vol', 'e200'] },
  { label: 'Williams Paşa (%R)', cols: ['p', 'wr', 'wre', 'rsi', 'e200', 'st'] },
  { label: 'NizamiCedid (MACD)', cols: ['p', 'mc', 'sg', 'em', 'dl'] },
  { label: 'ADX / Momentum', cols: ['p', 'adx', 'roc', 'dcp', 'bbp'] },
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

export function Screener({ onClose, onSelect, onAddToWatch }: Props) {
  const [data, setData] = useState<ScreenerFile | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<number>(() => readScrState().view ?? 0);
  const [filters, setFilters] = useState<Filter[]>(() => readScrState().filters ?? []);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>(() => readScrState().sort ?? { key: 'r1y', dir: -1 });
  const [msg, setMsg] = useState('');
  const [fk, setFk] = useState<Key>('wr');
  const [op, setOp] = useState('gt');
  const [val, setVal] = useState('50');
  const [cmp, setCmp] = useState<'val' | 'field'>('val');
  const [fk2, setFk2] = useState<Key>('r3m');
  const [q, setQ] = useState<string>(() => readScrState().q ?? '');
  const [saved, setSaved] = useState<{ name: string; view: number; filters: Filter[] }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('borsaScreens') || '[]');
    } catch {
      return [];
    }
  });
  const [saveName, setSaveName] = useState('');
  // Live (period-aware) filters
  const [liveFs, setLiveFs] = useState<LiveF[]>([]);
  const [lind, setLind] = useState('wr');
  const [lp, setLp] = useState('260');
  const [lop, setLop] = useState<'gt' | 'lt'>('gt');
  const [lval, setLval] = useState('50');
  const [liveSet, setLiveSet] = useState<Set<string> | null>(null);
  const [liveRun, setLiveRun] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    fetchScreener().then(setData).catch(() => setData(null)).finally(() => setLoaded(true));
    fetchBistSpark().then(setSpark).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem('borsaScreens', JSON.stringify(saved));
  }, [saved]);
  // Remember the last screen state so leaving to view a stock doesn't reset it.
  useEffect(() => {
    localStorage.setItem('borsaScrState', JSON.stringify({ view, filters, sort, q }));
  }, [view, filters, sort, q]);

  const addWatch = (mode: 'add' | 'new') => {
    const syms = rows.map((r) => r.s);
    if (!syms.length) return;
    onAddToWatch(syms, mode);
    setMsg(`${syms.length} hisse ${mode === 'new' ? 'yeni listeye eklendi' : 'aktif listeye eklendi'}`);
    window.setTimeout(() => setMsg(''), 2500);
  };

  const kind = COL(fk).kind;

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

  const addLive = () => {
    const period = Math.max(1, Math.round(Number(lp)));
    const v = parseFloat(lval.replace(',', '.'));
    if (!Number.isFinite(period) || !Number.isFinite(v)) return;
    setLiveFs((fs) => [...fs, { ind: lind, period, op: lop, val: v }]);
    setLiveSet(null); // needs re-apply
  };
  const runLive = async () => {
    if (!liveFs.length) {
      setLiveSet(null);
      return;
    }
    const syms = base.map((r) => r.s);
    setLiveRun({ done: 0, total: syms.length });
    const pass = new Set<string>();
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
          let ok = true;
          for (const f of liveFs) {
            const v = liveValue(c, f.ind, f.period);
            if (!Number.isFinite(v) || (f.op === 'gt' ? !(v > f.val) : !(v < f.val))) {
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
    setLiveRun(null);
  };

  const addFilter = () => {
    let f: Filter;
    if (kind === 'bool') {
      f = { key: fk, op: 'is', val: Number(val) || 0 };
    } else if (cmp === 'field') {
      if (fk2 === fk) return;
      f = { key: fk, op, mode: 'field', key2: fk2, val: 0 };
    } else {
      const v = parseFloat(val.replace(',', '.'));
      if (!isFinite(v)) return;
      f = { key: fk, op, mode: 'val', val: v };
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
          <b>🔍 Hisse Tarama{data ? ` · ${data.items.length} hisse` : ''}</b>
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
                    const k = e.target.value as Key;
                    setFk(k);
                    setOp(COL(k).kind === 'bool' ? 'is' : 'gt');
                    setVal(COL(k).kind === 'bool' ? '1' : '');
                  }}
                >
                  {COLS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {kind === 'bool' ? (
                  <select value={val} onChange={(e) => setVal(e.target.value)}>
                    <option value="1">Evet</option>
                    <option value="0">Hayır</option>
                  </select>
                ) : (
                  <>
                    <select value={op} onChange={(e) => setOp(e.target.value)}>
                      <option value="gt">&gt; büyük</option>
                      <option value="gte">≥</option>
                      <option value="lt">&lt; küçük</option>
                      <option value="lte">≤</option>
                      <option value="eq">= eşit</option>
                    </select>
                    <select value={cmp} onChange={(e) => setCmp(e.target.value as 'val' | 'field')} title="Sabit değer mi başka bir kolon mu?">
                      <option value="val">Değer</option>
                      <option value="field">Veri (kolon)</option>
                    </select>
                    {cmp === 'val' ? (
                      <input
                        value={val}
                        inputMode="decimal"
                        placeholder="değer"
                        onChange={(e) => setVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                      />
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
              </div>

              <div className="scr-build scr-live">
                <span className="lg-muted" title="İstediğin periyotla anlık hesaplar (snapshot ile sınırlanan hisseleri indirir)">🔬 Canlı (periyotlu):</span>
                <select value={lind} onChange={(e) => setLind(e.target.value)}>
                  {LIVE_INDS.map((i) => (
                    <option key={i.key} value={i.key}>{i.label}</option>
                  ))}
                </select>
                <input className="scr-lp" value={lp} inputMode="numeric" placeholder="periyot" onChange={(e) => setLp(e.target.value)} title="Periyot (gün)" />
                <select value={lop} onChange={(e) => setLop(e.target.value as 'gt' | 'lt')}>
                  <option value="gt">&gt; büyük</option>
                  <option value="lt">&lt; küçük</option>
                </select>
                <input value={lval} inputMode="decimal" placeholder="değer" onChange={(e) => setLval(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLive()} />
                <button className="scr-add" onClick={addLive}>+ Ekle</button>
                {liveFs.length > 0 && (
                  <button className="scr-add" onClick={runLive} disabled={!!liveRun} title="Snapshot ile süzülen hisseleri indirip canlı hesaplar">
                    {liveRun ? `Taranıyor… ${liveRun.done}/${liveRun.total}` : liveSet ? '↻ Canlı uygula' : '🔬 Canlı uygula'}
                  </button>
                )}
              </div>
              {liveFs.length > 0 && (
                <div className="scr-chips">
                  {liveFs.map((f, i) => (
                    <span key={i} className="scr-fchip scr-fchip-live">
                      {liveLabel(f.ind)}({f.period}) {f.op === 'gt' ? '>' : '<'} {f.val}
                      <button onClick={() => { setLiveFs((fs) => fs.filter((_, idx) => idx !== i)); setLiveSet(null); }}>×</button>
                    </span>
                  ))}
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
                      <button onClick={() => setFilters((fs) => fs.filter((_, idx) => idx !== i))}>×</button>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="bt-note">Eşleşen hisse yok — filtreleri gevşet.</div>}
                {rows.length > 250 && <div className="bt-note">… ilk 250 gösteriliyor. Filtreyi daralt.</div>}
              </div>
              <div className="bt-hint">
                ⚠️ Anlık gösterge taraması; yatırım tavsiyesi değildir. Başlığa tıkla → sırala, satıra tıkla → grafikte aç.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
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
