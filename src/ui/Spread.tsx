import { useId } from 'react';

interface Props {
  /** SIRALI (küçükten büyüğe) değerler — al-tut farkı, puan. */
  values: number[];
  label: string;
  width?: number;
  height?: number;
}

/**
 * Sıfır çizgisi etrafında sıralı dağılım.
 *
 * Neden gerekli: strateji tablosunun ana sütunu medyandı ve medyan yayılımı
 * gizliyor. "Medyan -%2,6" iki çok farklı kuralı aynı gösteriyor — biri her
 * sembolde tutarlı olarak biraz kaybeder, öteki yarısında kazanıp yarısında
 * çöker. Bu fark, kuralı kullanıp kullanmama kararının kendisi; tabloda ise
 * hiç görünmüyordu.
 *
 * Neden histogram değil sıralı eğri: histogram kova genişliği seçmeyi
 * gerektirir ve seçim sonucun şeklini değiştirir. Sıralı eğride seçim yok —
 * sıfırın üstünde kalan yatay pay DOĞRUDAN "kaç sembolde yendi" demek.
 *
 * Ölçek uçlara göre değil %5–%95 dilimine göre: tek bir uç sembol (birkaç
 * yüz puan) bütün eğriyi düz bir çizgiye ezerdi. Kırpılan uçlar kenarda
 * görünür kalıyor, sessizce atılmıyor.
 */
export function Spread({ values, label, width = 96, height = 26 }: Props) {
  const clipId = useId();
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) {
    return (
      <span className="spread spread--empty" role="img" aria-label={`${label}: dağılım yok`}>
        —
      </span>
    );
  }

  const at = (q: number) =>
    clean[Math.min(clean.length - 1, Math.max(0, Math.round(q * (clean.length - 1))))];
  const lo = Math.min(at(0.05), 0);
  const hi = Math.max(at(0.95), 0);
  const span = Math.max(hi - lo, 1e-9);

  const pad = 1;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = w / (clean.length - 1);
  const y = (v: number) => pad + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / span) * h;
  const zeroY = y(0);

  const line = clean.map((v, i) => `${pad + i * step},${y(v)}`).join(' ');
  const kazanan = clean.filter((v) => v > 0).length;
  const oran = Math.round((kazanan / clean.length) * 100);

  return (
    <svg
      className="spread"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${clean.length} sembolün %${oran}'inde al-tut'un üstünde`}
      focusable="false"
    >
      <defs>
        {/* Eğrinin sıfırın ÜSTÜNDE kalan kısmı yeşil, altı kırmızı. Tek
            polyline iki renkle boyanıyor: iki ayrı çizgi çizmek kesişim
            noktasında sahte bir boşluk bırakırdı. */}
        <clipPath id={`${clipId}-up`}>
          <rect x="0" y="0" width={width} height={zeroY} />
        </clipPath>
        <clipPath id={`${clipId}-down`}>
          <rect x="0" y={zeroY} width={width} height={height - zeroY} />
        </clipPath>
      </defs>
      <line
        x1="0"
        y1={zeroY}
        x2={width}
        y2={zeroY}
        stroke="var(--border-strong)"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--down)"
        strokeWidth="1.5"
        clipPath={`url(#${clipId}-down)`}
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--up)"
        strokeWidth="1.5"
        clipPath={`url(#${clipId}-up)`}
      />
    </svg>
  );
}
