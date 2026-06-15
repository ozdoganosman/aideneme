import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchScreener, ScreenerItem, isIndexSymbol } from '../data/bistStatic';
import { useEscClose } from '../useEscClose';

interface Props {
  onClose: () => void;
  onSelect: (s: string) => void;
}

// Colour metrics: tile colour = this return, clamped to ±clamp for contrast.
const METRICS: { key: keyof ScreenerItem; label: string; clamp: number }[] = [
  { key: 'ch', label: 'Günlük %', clamp: 6 },
  { key: 'r1m', label: '1 Ay %', clamp: 20 },
  { key: 'r3m', label: '3 Ay %', clamp: 40 },
  { key: 'r1y', label: '1 Yıl %', clamp: 90 },
];

const NEU = [43, 47, 58]; // neutral (~#2b2f3a)
const UP = [38, 166, 154]; // green (#26a69a)
const DN = [239, 83, 80]; // red (#ef5350)
const h2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (a: number[], b: number[], t: number) => `#${h2(a[0] + (b[0] - a[0]) * t)}${h2(a[1] + (b[1] - a[1]) * t)}${h2(a[2] + (b[2] - a[2]) * t)}`;
function heatColor(v: number, clamp: number): string {
  if (!isFinite(v)) return '#2b2f3a';
  const t = Math.max(-1, Math.min(1, v / clamp));
  return t >= 0 ? mix(NEU, UP, t) : mix(NEU, DN, -t);
}

interface Tile {
  item: ScreenerItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Squarified treemap (Bruls, Huizing & van Wijk). Items must be sorted by area
// descending. Rows are laid along the current shortest edge to keep tiles close
// to square (readable), unlike naive slice-and-dice which makes thin slivers.
function squarify(data: { item: ScreenerItem; area: number }[], W: number, H: number): Tile[] {
  const out: Tile[] = [];
  let cx = 0;
  let cy = 0;
  let cw = W;
  let ch = H;
  let row: { item: ScreenerItem; area: number }[] = [];

  const worst = (r: { area: number }[], side: number): number => {
    let sum = 0;
    let mx = 0;
    let mn = Infinity;
    for (const it of r) {
      sum += it.area;
      if (it.area > mx) mx = it.area;
      if (it.area < mn) mn = it.area;
    }
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };

  const layout = (r: { item: ScreenerItem; area: number }[]) => {
    const sum = r.reduce((s, it) => s + it.area, 0);
    if (sum <= 0) return;
    if (cw >= ch) {
      const colW = sum / ch;
      let yy = cy;
      for (const it of r) {
        const th = it.area / colW;
        out.push({ item: it.item, x: cx, y: yy, w: colW, h: th });
        yy += th;
      }
      cx += colW;
      cw -= colW;
    } else {
      const rowH = sum / cw;
      let xx = cx;
      for (const it of r) {
        const tw = it.area / rowH;
        out.push({ item: it.item, x: xx, y: cy, w: tw, h: rowH });
        xx += tw;
      }
      cy += rowH;
      ch -= rowH;
    }
  };

  for (const node of data) {
    const side = Math.min(cw, ch);
    if (side <= 0) break;
    if (row.length === 0) {
      row.push(node);
      continue;
    }
    if (worst([...row, node], side) <= worst(row, side)) {
      row.push(node);
    } else {
      layout(row);
      row = [node];
    }
  }
  if (row.length) layout(row);
  return out;
}

export function HeatMap({ onClose, onSelect }: Props) {
  useEscClose(onClose);
  const [items, setItems] = useState<ScreenerItem[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [metric, setMetric] = useState(0);
  const [hover, setHover] = useState<{ it: ScreenerItem; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    fetchScreener()
      .then((d) => {
        if (alive) setItems(d?.items ?? []);
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [loaded]);

  const m = METRICS[metric];
  const tiles = useMemo(() => {
    if (!items || size.w < 2 || size.h < 2) return [];
    // Size weight = trading value (price × avg volume) → liquid names dominate.
    // Indices (XU100, XBANK, …) are not stocks and dwarf everything, so drop them.
    const data = items
      .filter((it) => !isIndexSymbol(it.s))
      .map((it) => ({ item: it, area: (it.p > 0 ? it.p : 0) * (it.av > 0 ? it.av : 0) }))
      .filter((d) => d.area > 0)
      .sort((a, b) => b.area - a.area);
    if (!data.length) return [];
    const total = data.reduce((s, d) => s + d.area, 0);
    const scale = (size.w * size.h) / total;
    return squarify(data.map((d) => ({ item: d.item, area: d.area * scale })), size.w, size.h);
  }, [items, size.w, size.h]);

  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide hm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>🗺️ Piyasa Isı Haritası{items ? ` · ${tiles.length} hisse` : ''}</b>
          <button className="row-x" onClick={onClose} title="Kapat" aria-label="Kapat">
            ×
          </button>
        </div>
        <div className="modal-body hm-body">
          {!loaded ? (
            <div className="bt-note">Yükleniyor…</div>
          ) : !items || !items.length ? (
            <div className="bt-note">Tarama verisi henüz hazır değil (CI bir sonraki dağıtımda üretecek).</div>
          ) : (
            <>
              <div className="hm-controls">
                <label className="scr-pick">
                  🎨 Renk
                  <select value={metric} onChange={(e) => setMetric(Number(e.target.value))}>
                    {METRICS.map((mm, i) => (
                      <option key={mm.key} value={i}>
                        {mm.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="hm-legend" title={`Renk: ${m.label} · ±${m.clamp}% arası`}>
                  <span className="lg-muted">−{m.clamp}%</span>
                  <span className="hm-legend-bar" style={{ background: `linear-gradient(90deg, ${mix(NEU, DN, 1)}, ${mix(NEU, DN, 0.3)}, #2b2f3a, ${mix(NEU, UP, 0.3)}, ${mix(NEU, UP, 1)})` }} />
                  <span className="lg-muted">+{m.clamp}%</span>
                </div>
                <span className="lg-muted hm-hint">Boyut = işlem hacmi (fiyat × ort. hacim) · tıkla → grafikte aç</span>
              </div>

              <div className="hm-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
                <svg width={size.w} height={size.h} className="hm-svg">
                  {tiles.map((t) => {
                    const v = Number(t.item[m.key]);
                    const showSym = t.w >= 34 && t.h >= 18;
                    const showVal = t.w >= 44 && t.h >= 34;
                    return (
                      <g
                        key={t.item.s}
                        onClick={() => pick(t.item.s)}
                        onMouseEnter={(e) => setHover({ it: t.item, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover({ it: t.item, x: e.clientX, y: e.clientY })}
                        style={{ cursor: 'pointer' }}
                      >
                        <rect x={t.x} y={t.y} width={Math.max(0, t.w - 1)} height={Math.max(0, t.h - 1)} fill={heatColor(v, m.clamp)} />
                        {showSym && (
                          <text x={t.x + t.w / 2} y={t.y + t.h / 2 + (showVal ? -3 : 3)} className="hm-sym" textAnchor="middle">
                            {t.item.s}
                          </text>
                        )}
                        {showVal && (
                          <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 12} className="hm-val" textAnchor="middle">
                            {isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—'}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {hover && (
                  <div className="hm-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
                    <b>{hover.it.s}</b> <span className="lg-muted">{hover.it.n}</span>
                    <div>
                      {hover.it.p.toLocaleString('en-US', { maximumFractionDigits: 2 })} ₺{' '}
                      <span className={hover.it.ch >= 0 ? 'up' : 'down'}>
                        ({hover.it.ch >= 0 ? '+' : ''}
                        {hover.it.ch.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="lg-muted">
                      1A {fpct(hover.it.r1m)} · 3A {fpct(hover.it.r3m)} · 1Y {fpct(hover.it.r1y)}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fpct(v: number | undefined): string {
  return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + Math.round(v) + '%';
}
