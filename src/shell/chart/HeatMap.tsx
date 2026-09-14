import { useEffect, useRef, useState } from 'react';
import { trPct } from '../../ui';
import { squarify } from '../../core/chart/treemap';
import type { PulseRow } from '../../core/screen/pulse';
import { useChartColors } from './useThemeColors';

export interface HeatMapProps {
  rows: PulseRow[];
  /** Çizim sırası (küme sıralı); verilmezse satır sırası kullanılır. */
  order?: string[];
  /** Renk doygunluğunun doyduğu değişim (%). */
  scale?: number;
  /**
   * 'treemap' — alan işlem değerine orantılı (para nerede?).
   * 'grid'    — eşit kutular, verilen sırada (hangi grup birlikte hareket ediyor?).
   *
   * İki yerleşim iki ayrı soruya cevap veriyor; ağaç haritası kutuları
   * büyüklüğe göre sıraladığı için kümeleme sırasını KORUYAMAZ.
   */
  layout?: 'treemap' | 'grid';
  height?: number;
  onSelect?: (symbol: string) => void;
}

interface Tile {
  row: PulseRow;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Isı haritası — tüm piyasa tek ekranda.
 *
 * Kümeleme sırasıyla çizildiğinde birlikte hareket eden hisseler yan yana
 * düşer, yani "hangi grup taşıyor / hangi grup satılıyor" tek bakışta görünür.
 *
 * Canvas: 600+ kutu DOM'da düğüm başına ~1 KB tutar ve her tema değişiminde
 * yeniden stillenir; burada tek bir çizim yeterli.
 */
export function HeatMap({
  rows,
  order,
  scale = 4,
  height = 320,
  layout = 'treemap',
  onSelect,
}: HeatMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tilesRef = useRef<Tile[]>([]);
  const [hover, setHover] = useState<PulseRow | null>(null);
  const colors = useChartColors();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
      const ordered = (order ?? rows.map((r) => r.symbol))
        .map((s) => bySymbol.get(s))
        .filter((r): r is PulseRow => !!r);
      if (ordered.length === 0) return;

      const tiles: Tile[] = [];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // Alan İŞLEM DEĞERİNE orantılı. Düzgün ızgarada her sembol eşit kutu
      // alıyordu: günde 50 milyon TL dönen bir sembol ile 50 milyar TL dönen
      // bir sembol aynı büyüklükte görünüyor, yani "Piyasada bugün ne
      // oluyor?" başlığı altındaki resim paranın NEREDE olduğunu
      // söylemiyordu. Renk yönü taşıyor; alan büyüklüğü taşıyınca harita
      // gerçekten bir para akışı haritası oluyor.
      //
      // İşlem değeri hiç yoksa (ölçülmemiş veri) eşit ağırlığa düşülüyor —
      // o durumda düzgün ızgara doğru cevaptır, sahte bir büyüklük sıralaması
      // uydurmaktan iyidir.
      const olculen = ordered.filter((r) => Number.isFinite(r.value) && r.value > 0).length;
      const rects =
        layout === 'grid' || olculen === 0
          ? gridRects(ordered.length, width, height)
          : squarify(
              ordered.map((r) => r.value),
              width,
              height,
            );

      for (const rect of rects) {
        const row = ordered[rect.index];
        const { x, y, w, h } = rect;
        tiles.push({ row, x, y, w, h });

        const change = Number.isFinite(row.changePct) ? row.changePct : 0;
        const intensity = Math.min(1, Math.abs(change) / scale);
        const base = change >= 0 ? colors.up : colors.down;
        ctx.fillStyle = mix(colors.surface, base, 0.12 + intensity * 0.8);
        ctx.fillRect(x, y, Math.max(0, w - 1), Math.max(0, h - 1));

        // Etiket kutu okunur büyüklükteyse yazılır: iki satır sığıyorsa sembol +
        // değişim, yalnızca bir satır sığıyorsa sembol. Eşikler ölçüldü: 200
        // sembol 1440 px genişlikte ~45 px kutu veriyor, iki satır tam sığıyor.
        const twoLines = w >= 40 && h >= 30;
        const oneLine = w >= 28 && h >= 14;
        if (oneLine) {
          ctx.fillStyle = intensity > 0.55 ? '#fff' : colors.text;
          ctx.font = `600 ${Math.max(8, Math.min(13, w / 4.5))}px system-ui, sans-serif`;
          ctx.fillText(row.symbol, x + w / 2, y + h / 2 + (twoLines ? -5 : 0), w - 4);
          if (twoLines) {
            ctx.font = `${Math.max(8, Math.min(11, w / 5.5))}px system-ui, sans-serif`;
            ctx.fillText(trPct(change, 1, true), x + w / 2, y + h / 2 + 7, w - 4);
          }
        }
      }

      tilesRef.current = tiles;
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rows, order, scale, height, layout, colors]);

  const tileAt = (event: { clientX: number; clientY: number }): PulseRow | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return (
      tilesRef.current.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)?.row ??
      null
    );
  };

  return (
    <div className="heatmap">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        role="img"
        aria-label={`Isı haritası: ${rows.length} sembol · kutu alanı işlem değeri, rengi son bar değişimi`}
        onMouseMove={(e) => setHover(tileAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const row = tileAt(e);
          if (row && onSelect) onSelect(row.symbol);
        }}
      />
      <p className="heatmap__hint desk__muted">
        {hover ? (
          <>
            <strong>{hover.symbol}</strong> {hover.changePct >= 0 ? '+' : ''}
            {trPct(hover.changePct, 2, true)} · işlem değeri{' '}
            {hover.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
            {hover.newHigh ? ' · yeni zirve' : hover.newLow ? ' · yeni dip' : ''}
          </>
        ) : (
          'Kutu ALANI işlem değeri, rengi son bar değişimi. Üzerine gel, tıkla.'
        )}
      </p>
    </div>
  );
}

/**
 * Eşit kutulu ızgara — kümeleme sırası korunur.
 *
 * İşlem değeri hiç ölçülmemişse de buraya düşülüyor: sahte bir büyüklük
 * sıralaması uydurmaktansa eşit kutu doğru cevaptır.
 */
function gridRects(count: number, width: number, height: number) {
  if (count <= 0 || !(width > 0) || !(height > 0)) return [];
  // Kutular kare kalsın: sütun sayısını alan oranından türet.
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rowsCount = Math.ceil(count / cols);
  const w = width / cols;
  const h = height / rowsCount;
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    w,
    h,
  }));
}

/** İki rengi karıştır (her ikisi de #rgb/#rrggbb ya da rgb() olabilir). */
function mix(from: string, to: string, ratio: number): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return to;
  const f = Math.max(0, Math.min(1, ratio));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

function parse(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const v = hex[1];
    const full =
      v.length === 3
        ? v
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : v;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}
