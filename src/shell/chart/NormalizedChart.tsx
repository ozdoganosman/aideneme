import { useEffect, useRef } from 'react';
import type { Candles } from '../../core/data/types';
import { useChartColors } from './useThemeColors';

export interface NormalizedSeries {
  symbol: string;
  color: string;
  candles: Candles;
}

export interface NormalizedChartProps {
  series: NormalizedSeries[];
  height?: number;
}

/**
 * Normalize getiri grafiği: tüm seriler ortak başlangıçta 100'e eşitlenir,
 * böylece fiyat seviyeleri değil GÖRECELİ performans karşılaştırılır.
 *
 * Neden kütüphane değil: tek ihtiyacımız N çizgi; canvas'a doğrudan çizmek
 * ilk yük bütçesine bir şey eklemiyor (mum grafiği motoru ayrı chunk'ta kalıyor).
 */
/**
 * canvas `strokeStyle` CSS değişkenlerini çözemez ("var(--accent)" geçersiz
 * renktir ve sessizce siyaha düşer). Token'ı burada gerçek değere çeviriyoruz,
 * böylece çağıran taraf yine token kullanabiliyor.
 */
function resolveColor(color: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(color.trim());
  if (!match) return color;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || '#888';
}

export function NormalizedChart({ series, height = 280 }: NormalizedChartProps) {
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

      const usable = series.filter((s) => s.candles.length > 1);
      if (usable.length === 0) return;

      // Ortak pencere: en geç başlayan serinin başlangıcı.
      const start = Math.max(...usable.map((s) => s.candles.time[0]));
      const end = Math.min(...usable.map((s) => s.candles.time[s.candles.length - 1]));
      if (!(end > start)) return;

      const padL = 10;
      const padR = 56;
      const padT = 10;
      const padB = 22;
      const plotW = Math.max(1, width - padL - padR);
      const plotH = Math.max(1, height - padT - padB);

      // Normalize edilmiş seriler + ölçek.
      const lines = usable.map((s) => {
        const points: { x: number; y: number }[] = [];
        let base = NaN;
        for (let i = 0; i < s.candles.length; i++) {
          const t = s.candles.time[i];
          if (t < start || t > end) continue;
          const v = s.candles.close[i];
          if (!(v > 0)) continue;
          if (!Number.isFinite(base)) base = v;
          points.push({ x: (t - start) / (end - start), y: (v / base - 1) * 100 });
        }
        return { symbol: s.symbol, color: resolveColor(s.color), points };
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
      if (max - min < 1e-9) {
        min -= 1;
        max += 1;
      }
      const pad = (max - min) * 0.08;
      min -= pad;
      max += pad;

      const toX = (x: number) => padL + x * plotW;
      const toY = (y: number) => padT + (1 - (y - min) / (max - min)) * plotH;

      // Izgara + eksen etiketleri (5 çizgi).
      ctx.strokeStyle = colors.grid;
      ctx.fillStyle = colors.muted;
      ctx.font = '10px system-ui, sans-serif';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const value = min + ((max - min) * i) / 4;
        const y = Math.round(toY(value)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        // Ölçek etiketleri SOLDA, çizginin üstünde: sağ oluk sembol
        // etiketlerine ayrıldı, ikisi üst üste binmesin.
        ctx.fillText(`${value >= 0 ? '+' : ''}${value.toFixed(0)}%`, padL + 2, y - 3);
      }

      // Sıfır çizgisi (başlangıç seviyesi) vurgulanır.
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
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        line.points.forEach((p, i) => {
          const x = toX(p.x);
          const y = toY(p.y);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // Sağdaki sembol etiketleri: aynı hizaya düşenler üst üste binmesin.
      const labels = lines
        .map((line) => {
          const last = line.points[line.points.length - 1];
          return last ? { symbol: line.symbol, color: line.color, y: toY(last.y) } : null;
        })
        .filter((l): l is { symbol: string; color: string; y: number } => l !== null)
        .sort((a, b) => a.y - b.y);

      const MIN_GAP = 12;
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].y - labels[i - 1].y < MIN_GAP) labels[i].y = labels[i - 1].y + MIN_GAP;
      }
      for (const label of labels) {
        ctx.fillStyle = label.color;
        ctx.fillText(label.symbol, padL + plotW + 6, Math.min(height - 14, label.y) + 3);
      }

      // Tarih aralığı.
      ctx.fillStyle = colors.muted;
      const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
      ctx.fillText(fmt(start), padL, height - 6);
      const endLabel = fmt(end);
      ctx.fillText(endLabel, padL + plotW - ctx.measureText(endLabel).width, height - 6);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series, height, colors]);

  return (
    <canvas
      ref={canvasRef}
      className="normchart"
      style={{ width: '100%', height }}
      role="img"
      aria-label={`Normalize getiri karşılaştırması: ${series.map((s) => s.symbol).join(', ')}`}
    />
  );
}
