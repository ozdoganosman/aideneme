import { useEffect, useRef } from 'react';
import { trDay } from '../../core/format/date';
import { eksenAraligi } from '../../core/chart/scale';
import { trPct, axisLabel } from '../../ui';
import { useChartColors } from './useThemeColors';

export interface LineSeries {
  label: string;
  color: string;
  /** Unix saniye, artan. */
  time: ArrayLike<number>;
  values: ArrayLike<number>;
  /** Kesikli çizgi (karşılaştırma serileri için). */
  dashed?: boolean;
}

export interface LineChartProps {
  series: LineSeries[];
  /** true → tüm seriler ortak başlangıçta %0'a eşitlenir. */
  normalize?: boolean;
  height?: number;
  /** Y ekseni biçimi: yüzde, ham sayı ya da kısaltılmış (1,2 mlr). */
  unit?: 'pct' | 'raw' | 'compact';
  /**
   * Sıfır çizgisi çiz ve ölçeğe sıfırı DAHİL ET.
   *
   * Negatife geçebilen seriler için (net kâr): sıfır görünmeden "küçüldü"
   * ile "zarara döndü" aynı görünür — ikisi aynı şey değil.
   */
  zeroLine?: boolean;
  ariaLabel?: string;
}

/**
 * Tek canvas çizgi grafiği: normalize getiri, sermaye eğrisi, karşılaştırma.
 *
 * Mum grafiği motoru (lightweight-charts) ayrı ve ağır bir chunk; basit çizgi
 * için onu yüklemek ilk yük bütçesini boşa harcardı. Bu bileşen bağımlılıksız
 * ve ~150 satır.
 */
export function LineChart({
  series,
  normalize = false,
  height = 280,
  unit = 'pct',
  zeroLine = false,
  ariaLabel,
}: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

      const usable = series.filter((s) => s.values.length > 1 && s.time.length === s.values.length);
      if (usable.length === 0) return;

      const start = Math.max(...usable.map((s) => s.time[0]));
      const end = Math.min(...usable.map((s) => s.time[s.time.length - 1]));
      if (!(end > start)) return;

      const padL = 10;
      const padR = 58;
      const padT = 10;
      const padB = 22;
      const plotW = Math.max(1, width - padL - padR);
      const plotH = Math.max(1, height - padT - padB);

      const lines = usable.map((s) => {
        const points: { x: number; y: number }[] = [];
        let base = NaN;
        for (let i = 0; i < s.values.length; i++) {
          const t = s.time[i];
          if (t < start || t > end) continue;
          const v = s.values[i];
          if (!Number.isFinite(v)) continue;
          if (normalize && !Number.isFinite(base)) base = v;
          const y = normalize ? (base > 0 ? (v / base - 1) * 100 : 0) : v;
          points.push({ x: (t - start) / (end - start), y });
        }
        return { label: s.label, color: resolveColor(s.color), dashed: !!s.dashed, points };
      });

      let min = Infinity;
      let max = -Infinity;
      for (const line of lines) {
        for (const p of line.points) {
          if (p.y < min) min = p.y;
          if (p.y > max) max = p.y;
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
      // Ölçek kuralı ÇEKİRDEKTE ve orada sınanıyor: canvas'a `fillText` ile
      // yazılan eksen etiketi DOM'da olmadığı için uçtan uca test göremiyor.
      ({ min, max } = eksenAraligi(min, max, { sifirCizgisi: zeroLine }));

      const toX = (x: number) => padL + x * plotW;
      const toY = (y: number) => padT + (1 - (y - min) / (max - min)) * plotH;
      const fmt = (v: number) => {
        if (unit === 'pct') return trPct(v, 0, true);
        // Ondalık basamak ARALIKTAN geliyor, büyüklükten değil. Sabit tek
        // basamakla 1.900–2.500 b aralığında beş ızgara çizgisinin beşi de
        // "2 b" yazıyordu; aynı şeyi yazan eksen serinin yatay olduğu
        // izlenimini verir. Ayrıca biçim tek kaynağa bağlandı — yerel kopya
        // Türkçe ondalık ayıracını da kullanmıyordu ("2.5 mlr").
        if (unit === 'compact') return axisLabel(v, max - min);
        return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
      };

      ctx.strokeStyle = colors.grid;
      ctx.fillStyle = colors.muted;
      ctx.font = '10px system-ui, sans-serif';
      if (zeroLine && min <= 0 && max >= 0) {
        const y0 = Math.round(toY(0)) + 0.5;
        ctx.save();
        ctx.strokeStyle = colors.muted;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, y0);
        ctx.lineTo(padL + plotW, y0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const value = min + ((max - min) * i) / 4;
        const y = Math.round(toY(value)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(fmt(value), padL + 2, y - 3);
      }

      if (min < 0 && max > 0) {
        ctx.strokeStyle = colors.border;
        ctx.setLineDash([3, 3]);
        const y = Math.round(toY(0)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.dashed ? 1 : 1.5;
        ctx.setLineDash(line.dashed ? [4, 3] : []);
        ctx.beginPath();
        line.points.forEach((p, i) => {
          const x = toX(p.x);
          const y = toY(p.y);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Sağ oluktaki etiketler çakışmasın.
      const labels = lines
        .map((line) => {
          const last = line.points[line.points.length - 1];
          return last ? { label: line.label, color: line.color, y: toY(last.y) } : null;
        })
        .filter((l): l is { label: string; color: string; y: number } => l !== null)
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
      }
      for (const label of labels) {
        ctx.fillStyle = label.color;
        ctx.fillText(label.label, padL + plotW + 6, Math.min(height - 14, label.y) + 3);
      }

      ctx.fillStyle = colors.muted;
      const day = trDay;
      ctx.fillText(day(start), padL, height - 6);
      const endLabel = day(end);
      ctx.fillText(endLabel, padL + plotW - ctx.measureText(endLabel).width, height - 6);
    };

    let sonGenislik = canvas.clientWidth;
    draw();
    // `observe` anında bir kez ateşler: az önce çizdiğimiz genişlikle aynı.
    // Genişlik değişmediyse çizmiyoruz (bkz. HeatMap'teki aynı ölçüm).
    const observer = new ResizeObserver(() => {
      if (canvas.clientWidth === sonGenislik) return;
      sonGenislik = canvas.clientWidth;
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series, normalize, height, unit, zeroLine, colors]);

  return (
    <canvas
      ref={canvasRef}
      className="linechart"
      style={{ width: '100%', height }}
      role="img"
      aria-label={ariaLabel ?? `Çizgi grafiği: ${series.map((s) => s.label).join(', ')}`}
    />
  );
}

/**
 * canvas `strokeStyle` CSS değişkenlerini çözemez ("var(--accent)" geçersiz
 * renktir ve sessizce siyaha düşer). Token'ı gerçek değere çeviriyoruz.
 */
function resolveColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color.trim());
  if (!match) return color;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || '#888';
}
