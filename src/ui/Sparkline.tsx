import { useId } from 'react';
import { normalizeSpark } from '../core/chart/spark';

interface Props {
  /** Seyreltilmiş seri (core/chart/spark.ts). */
  points: number[] | undefined;
  /** Erişilebilir ad — yalnız başına anlamlı olmalı. */
  label: string;
  width?: number;
  height?: number;
  /**
   * Çizgi rengi. Verilmezse serinin KENDİ yönüne göre seçilir — renk bir
   * süs değil, ikinci bir bilgi kanalı.
   */
  tone?: 'up' | 'down' | 'flat';
}

/**
 * Tablo satırına sığan mini fiyat grafiği.
 *
 * Neden kütüphane değil düz SVG: satır başına bir grafik demek 200 satırda
 * 200 grafik demek. Grafik kütüphanesinin ilk kurulumu zayıf makinede
 * ~350 ms ölçüldü (bkz. performans.md) — bunu satır başına ödemek mümkün
 * değil. Burada çizilen şey tek bir `polyline`: kurulum yok, canvas yok,
 * animasyon yok.
 *
 * Neden `aria-hidden` değil: sparkline bir süs değil, sütunun taşıdığı
 * bilginin kendisi. Ekran okuyucu kullanıcısına da yönü ve aralığı
 * söylenmeli, yoksa o sütun onlar için boş kalır.
 */
export function Sparkline({ points, label, width = 88, height = 24, tone }: Props) {
  const gradientId = useId();
  const norm = normalizeSpark(points ?? []);
  if (norm.length < 2) {
    return (
      <span className="spark spark--empty" role="img" aria-label={`${label}: yeterli veri yok`}>
        —
      </span>
    );
  }

  const first = points![0];
  const last = points![points!.length - 1];
  const yon: 'up' | 'down' | 'flat' =
    tone ?? (last > first ? 'up' : last < first ? 'down' : 'flat');

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = w / (norm.length - 1);
  const coords = norm.map((v, i) => `${pad + i * step},${pad + (1 - v) * h}`);
  const line = coords.join(' ');
  // Dolgu çizginin altını kapatıyor: yönü renkten bağımsız olarak da
  // okunur kılıyor (renk körlüğü, gri baskı).
  const area = `${pad},${height - pad} ${line} ${pad + w},${height - pad}`;

  const degisim = first !== 0 ? ((last / first - 1) * 100).toFixed(1).replace('.', ',') : null;

  return (
    <svg
      className={`spark spark--${yon}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        degisim === null
          ? `${label}: seyreltilmiş fiyat serisi`
          : `${label}: dönem içinde %${degisim} değişim`
      }
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={pad + w} cy={pad + (1 - norm[norm.length - 1]) * h} r="1.8" fill="currentColor" />
    </svg>
  );
}
