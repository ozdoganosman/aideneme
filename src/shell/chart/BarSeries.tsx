import { useId } from 'react';
import { trCompact } from '../../ui';

interface Props {
  labels: string[];
  values: (number | null)[];
  label: string;
  height?: number;
}

/**
 * Çeyreklik kolon grafiği (satış, faaliyet kârı, net kâr).
 *
 * Neden ayrı bileşen ve neden SVG: satır başına değil panel başına bir grafik
 * ve dönem sayısı onlarla ölçülüyor — grafik kütüphanesini üç kolon için
 * yüklemek ilk yük bütçesini boşa harcardı (ölçüldü: kütüphanenin ilk
 * kurulumu zayıf makinede ~350 ms).
 *
 * Sıfır çizgisi ve negatif kolonlar: net kâr zarara dönebilir ve "küçüldü"
 * ile "zarara döndü" aynı şey değil. Ölçek sıfırı HER ZAMAN içeriyor; aksi
 * hâlde tamamı negatif bir seri yükseliyormuş gibi görünür.
 *
 * Değeri OLMAYAN dönem çubuk çizmiyor ve boş bırakılıyor: eksik veriyi sıfır
 * saymak, olmayan bir çöküş gösterirdi.
 */
export function BarSeries({ labels, values, label, height = 150 }: Props) {
  const clipId = useId();
  const sonlu = values.filter((v): v is number => Number.isFinite(v as number));
  if (sonlu.length === 0) {
    return (
      <p className="barseries__empty desk__muted" role="img" aria-label={`${label}: veri yok`}>
        Veri yok
      </p>
    );
  }

  const lo = Math.min(0, ...sonlu);
  const hi = Math.max(0, ...sonlu);
  const span = hi - lo || 1;

  const n = values.length;
  const w = 100 / n;
  const pad = w * 0.18;

  // DİKEY PAYANDA: ölçüldü — tamamı negatif bir seride sıfır çizgisi tam üst
  // kenara oturuyor ve çizginin yarısı kırpılıyordu; çubukların ucu da kenara
  // yapışıyordu. Çizim alanı üstten ve alttan %4 içeri alındı.
  const PAYANDA = 4;
  const yer = (v: number) => PAYANDA + ((hi - v) / span) * (100 - PAYANDA * 2);
  const y0 = yer(0);

  return (
    <figure className="barseries">
      {/*
        ÖLÇEK: kolon grafiği tek başına yalnızca "biri ötekinden büyük" diyor;
        büyüklüğü söylemiyordu. İki uç değer yanda yazıyor — her çubuğun
        üstüne sayı yazmak yirmi dönemde okunmaz bir yığın olurdu.
      */}
      <span className="barseries__olcek" aria-hidden="true">
        <span>{trCompact(hi)}</span>
        <span>{trCompact(lo)}</span>
      </span>
      <svg
        className="barseries__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={`${label}: ${labels.length} dönem, ${trCompact(sonlu[sonlu.length - 1])} son değer`}
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width="100" height="100" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <line x1="0" y1={y0} x2="100" y2={y0} stroke="var(--border-strong)" strokeWidth="0.4" />
          {values.map((v, i) => {
            if (!Number.isFinite(v as number)) return null;
            const val = v as number;
            const yv = yer(val);
            const top = Math.min(y0, yv);
            const h = Math.abs(y0 - yv);
            return (
              <rect
                key={labels[i]}
                x={i * w + pad}
                y={top}
                width={w - pad * 2}
                height={Math.max(h, 0.4)}
                fill={val >= 0 ? 'var(--accent)' : 'var(--down)'}
              >
                {/* Fare üzerindeyken tam değer: ölçek iki uçtan okunur, çubuk
                    başına kesin sayı burada. */}
                <title>{`${labels[i]}: ${trCompact(val)}`}</title>
              </rect>
            );
          })}
        </g>
      </svg>
      {/* Etiketler SVG dışında: `preserveAspectRatio="none"` yazıyı da
          esnetirdi. Dönem sayısı arttığında ara etiketler gizleniyor. */}
      {/* Izgara: etiket sayısı kadar eşit kolon. `space-between` ile ilk ve son
          etiket kenarlara yapışıp çubuk MERKEZLERİNDEN kayıyordu. */}
      <figcaption className="barseries__labels" aria-hidden="true" style={{ ['--n' as string]: n }}>
        {labels.map((l, i) => (
          <span key={l} className={n > 8 && i % 2 === 1 ? 'is-hidden' : undefined}>
            {l}
          </span>
        ))}
      </figcaption>
      {/* Ekran okuyucu için dönem dönem değerler: grafik bir resim, tablo veri. */}
      <table className="visually-hidden barseries__table">
        <caption>{label}</caption>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <th scope="row">{l}</th>
              <td>
                {Number.isFinite(values[i] as number) ? trCompact(values[i] as number) : 'veri yok'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
