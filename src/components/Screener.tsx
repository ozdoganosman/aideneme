import { useEffect, useMemo, useState } from 'react';
import { fetchScreener, ScreenerFile, ScreenerItem } from '../data/bistStatic';

interface Props {
  onClose: () => void;
  onSelect: (s: string) => void;
}

type Key = keyof ScreenerItem;
type Kind = 'price' | 'pct' | 'num' | 'bool';
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
  { label: 'Williams Paşa (%R)', cols: ['p', 'wr', 'rsi', 'e200', 'st'] },
  { label: 'Trend / EMA', cols: ['p', 'e50', 'e200', 'gc', 'st'] },
  { label: 'MACD & momentum', cols: ['p', 'mu', 'ch', 'r3m', 'r1y'] },
  { label: 'Getiri', cols: ['p', 'r1m', 'r3m', 'r1y'] },
  { label: 'Risk', cols: ['p', 'vol', 'dd', 'fh', 'yr'] },
];

interface Filter {
  key: Key;
  op: string;
  val: number;
  mode?: 'val' | 'field'; // compare against a fixed value (default) or another column
  key2?: Key;
}

const PRESETS: { label: string; fs: Filter[] }[] = [
  { label: '📈 Yükseliş trendi', fs: [{ key: 'e200', op: 'is', val: 1 }, { key: 'gc', op: 'is', val: 1 }] },
  { label: '🎯 52H zirveye yakın', fs: [{ key: 'e200', op: 'is', val: 1 }, { key: 'fh', op: 'gte', val: -5 }] },
  { label: '🛡️ Supertrend AL', fs: [{ key: 'st', op: 'is', val: 1 }, { key: 'e200', op: 'is', val: 1 }] },
  { label: '💪 %R > 50', fs: [{ key: 'wr', op: 'gt', val: 50 }, { key: 'e200', op: 'is', val: 1 }] },
  { label: '🟢 RSI < 35', fs: [{ key: 'rsi', op: 'lt', val: 35 }] },
  { label: '🔴 RSI > 70', fs: [{ key: 'rsi', op: 'gt', val: 70 }] },
];

export function Screener({ onClose, onSelect }: Props) {
  const [data, setData] = useState<ScreenerFile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState(0);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'r1y', dir: -1 });
  const [fk, setFk] = useState<Key>('wr');
  const [op, setOp] = useState('gt');
  const [val, setVal] = useState('50');
  const [cmp, setCmp] = useState<'val' | 'field'>('val');
  const [fk2, setFk2] = useState<Key>('r3m');

  useEffect(() => {
    fetchScreener().then(setData).catch(() => setData(null)).finally(() => setLoaded(true));
  }, []);

  const cols = VIEWS[view].cols;
  const kind = COL(fk).kind;

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const out = items.filter((it) => filters.every((f) => passF(it, f)));
    out.sort((a, b) => ((a[sort.key] as number) - (b[sort.key] as number)) * sort.dir);
    return out;
  }, [data, filters, sort]);

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
  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Hisse Tarama{data ? ` · ${data.items.length} hisse` : ''}</b>
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
                  📊 Gösterge / kolonlar
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
                    <select value={cmp} onChange={(e) => setCmp(e.target.value as 'val' | 'field')} title="Sabit değer mi başka bir veri mi?">
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

              <div className="scr-count">
                <b>{rows.length}</b> hisse eşleşti
              </div>

              <div className="scr-tablewrap">
                <table className="scr-table">
                  <thead>
                    <tr>
                      <th className="scr-th-sym">Sembol</th>
                      {cols.map((k) => (
                        <th key={k} onClick={() => toggleSort(k)} title="Sırala">
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
                          <b>{it.s}</b> <span className="lg-muted">{it.n}</span>
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
  const v = it[c.key] as number;
  if (c.kind === 'bool') return v ? <span className="up">✓</span> : <span className="lg-muted">–</span>;
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

function fv(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
