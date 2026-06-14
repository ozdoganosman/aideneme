import { useEffect, useMemo, useState } from 'react';
import { fetchScreener, ScreenerFile, ScreenerItem } from '../data/bistStatic';

interface Props {
  onClose: () => void;
  onSelect: (s: string) => void;
}

interface Filters {
  rsiMin: string;
  rsiMax: string;
  chMin: string;
  r1yMin: string;
  volMax: string;
  fhMin: string;
  yrMin: string;
  above200: boolean;
  golden: boolean;
  wrStrong: boolean;
  macdUp: boolean;
  superUp: boolean;
}

const EMPTY: Filters = {
  rsiMin: '', rsiMax: '', chMin: '', r1yMin: '', volMax: '', fhMin: '', yrMin: '',
  above200: false, golden: false, wrStrong: false, macdUp: false, superUp: false,
};

const PRESETS: { label: string; f: Partial<Filters> }[] = [
  { label: '📈 Yükseliş trendi', f: { above200: true, golden: true } },
  { label: '🎯 52H zirveye yakın', f: { above200: true, fhMin: '-5' } },
  { label: '🚀 Güçlü momentum', f: { above200: true, macdUp: true, r1yMin: '0' } },
  { label: '🛡️ Supertrend AL', f: { superUp: true, above200: true } },
  { label: '💪 Williams %R güçlü', f: { wrStrong: true, above200: true } },
  { label: '🟢 Aşırı satım (RSI<35)', f: { rsiMax: '35' } },
  { label: '🔴 Aşırı alım (RSI>70)', f: { rsiMin: '70' } },
  { label: '😌 Düşük oynaklık', f: { above200: true, volMax: '35' } },
];

type SortKey = 'r1y' | 'ch' | 'rsiUp' | 'rsiDn' | 'volUp' | 'fh';

export function Screener({ onClose, onSelect }: Props) {
  const [data, setData] = useState<ScreenerFile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>('r1y');

  useEffect(() => {
    fetchScreener()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, []);

  const results = useMemo(() => {
    const items = data?.items ?? [];
    const out = items.filter((it) => pass(it, f));
    const cmp: Record<SortKey, (a: ScreenerItem, b: ScreenerItem) => number> = {
      r1y: (a, b) => b.r1y - a.r1y,
      ch: (a, b) => b.ch - a.ch,
      rsiUp: (a, b) => a.rsi - b.rsi,
      rsiDn: (a, b) => b.rsi - a.rsi,
      volUp: (a, b) => a.vol - b.vol,
      fh: (a, b) => b.fh - a.fh,
    };
    return out.sort(cmp[sort]);
  }, [data, f, sort]);

  const set = (k: keyof Filters, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Hisse Tarama{data ? ` · ${data.items.length} hisse` : ''}</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>
        <div className="modal-body">
          {!loaded ? (
            <div className="bt-note">Yükleniyor…</div>
          ) : !data || data.items.length === 0 ? (
            <div className="bt-note">Tarama verisi henüz hazır değil (CI bir sonraki dağıtımda üretecek).</div>
          ) : (
            <>
              <div className="scr-section">🧠 Akıllı filtreler</div>
              <div className="scr-presets">
                {PRESETS.map((p) => (
                  <button key={p.label} className="scr-preset" onClick={() => setF({ ...EMPTY, ...p.f })}>
                    {p.label}
                  </button>
                ))}
                {active && (
                  <button className="scr-preset scr-clear" onClick={() => setF(EMPTY)}>
                    ✕ Temizle
                  </button>
                )}
              </div>

              <div className="scr-section">⚙️ Kendi filtrelerin</div>
              <div className="scr-filters">
                <Num label="RSI ≥" v={f.rsiMin} on={(v) => set('rsiMin', v)} />
                <Num label="RSI ≤" v={f.rsiMax} on={(v) => set('rsiMax', v)} />
                <Num label="Günlük % ≥" v={f.chMin} on={(v) => set('chMin', v)} />
                <Num label="1Y getiri % ≥" v={f.r1yMin} on={(v) => set('r1yMin', v)} />
                <Num label="Oynaklık % ≤" v={f.volMax} on={(v) => set('volMax', v)} />
                <Num label="Zirveye uzaklık % ≥" v={f.fhMin} on={(v) => set('fhMin', v)} title="−5 = zirvenin %5 yakını" />
                <Num label="Min geçmiş (yıl)" v={f.yrMin} on={(v) => set('yrMin', v)} />
              </div>
              <div className="scr-checks">
                <Chk label="200 günlük üstünde" v={f.above200} on={(v) => set('above200', v)} />
                <Chk label="Golden cross (50>200)" v={f.golden} on={(v) => set('golden', v)} />
                <Chk label="Williams %R > 50" v={f.wrStrong} on={(v) => set('wrStrong', v)} />
                <Chk label="MACD yukarı" v={f.macdUp} on={(v) => set('macdUp', v)} />
                <Chk label="Supertrend yukarı" v={f.superUp} on={(v) => set('superUp', v)} />
              </div>

              <div className="scr-resbar">
                <b>{results.length}</b> hisse eşleşti
                <span className="scr-sort">
                  Sırala:
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    <option value="r1y">1Y getiri ↓</option>
                    <option value="ch">Günlük % ↓</option>
                    <option value="fh">Zirveye yakınlık ↓</option>
                    <option value="rsiDn">RSI ↓</option>
                    <option value="rsiUp">RSI ↑</option>
                    <option value="volUp">Oynaklık ↑</option>
                  </select>
                </span>
              </div>

              <div className="scr-list">
                {results.slice(0, 150).map((it) => (
                  <div key={it.s} className="scr-row" onClick={() => pick(it.s)} title="Grafikte aç">
                    <div className="scr-row-l">
                      <div className="scr-row-sym">
                        <b>{it.s}</b> {it.n && <span className="lg-muted">{it.n}</span>}
                      </div>
                      <div className="scr-badges">
                        {it.e200 ? <span className="scr-b up">200↑</span> : <span className="scr-b down">200↓</span>}
                        {it.gc ? <span className="scr-b up">GC</span> : null}
                        {it.st ? <span className="scr-b up">ST↑</span> : null}
                        {it.mu ? <span className="scr-b up">MACD↑</span> : null}
                        <span className={'scr-b ' + (it.rsi >= 70 ? 'down' : it.rsi <= 35 ? 'up' : 'mut')}>RSI {it.rsi}</span>
                      </div>
                    </div>
                    <div className="scr-row-r">
                      <div className="scr-price">{fmt(it.p)}</div>
                      <div className={it.ch >= 0 ? 'up' : 'down'}>
                        {it.ch >= 0 ? '+' : ''}
                        {it.ch.toFixed(2)}%
                      </div>
                      <div className={'scr-r1y ' + (it.r1y >= 0 ? 'up' : 'down')}>
                        1Y {it.r1y >= 0 ? '+' : ''}
                        {it.r1y}%
                      </div>
                    </div>
                  </div>
                ))}
                {results.length > 150 && <div className="bt-note">… ilk 150 gösteriliyor. Filtreyi daralt.</div>}
                {results.length === 0 && <div className="bt-note">Eşleşen hisse yok — filtreleri gevşet.</div>}
              </div>
              <div className="bt-hint">⚠️ Anlık gösterge taraması; yatırım tavsiyesi değildir.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function pass(it: ScreenerItem, f: Filters): boolean {
  const num = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')));
  const rmin = num(f.rsiMin), rmax = num(f.rsiMax), ch = num(f.chMin), r1y = num(f.r1yMin);
  const vmax = num(f.volMax), fh = num(f.fhMin), yr = num(f.yrMin);
  if (rmin != null && it.rsi < rmin) return false;
  if (rmax != null && it.rsi > rmax) return false;
  if (ch != null && it.ch < ch) return false;
  if (r1y != null && it.r1y < r1y) return false;
  if (vmax != null && it.vol > vmax) return false;
  if (fh != null && it.fh < fh) return false;
  if (yr != null && it.yr < yr) return false;
  if (f.above200 && !it.e200) return false;
  if (f.golden && !it.gc) return false;
  if (f.wrStrong && !(it.wr > 50)) return false;
  if (f.macdUp && !it.mu) return false;
  if (f.superUp && !it.st) return false;
  return true;
}

function Num({ label, v, on, title }: { label: string; v: string; on: (v: string) => void; title?: string }) {
  return (
    <label className="scr-num" title={title}>
      <span>{label}</span>
      <input value={v} inputMode="decimal" placeholder="—" onChange={(e) => on(e.target.value)} />
    </label>
  );
}

function Chk({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className={'scr-chk' + (v ? ' on' : '')}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}

function fmt(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
