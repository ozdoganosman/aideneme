import { useId, useRef, useState } from 'react';
import { trCompact, trPct } from '../../ui';

interface Props {
  labels: string[];
  values: (number | null)[];
  /**
   * Eksende yazılacak KISA etiketler (örn. "25Ç4"). Verilmezse `labels`
   * kullanılır. İpucu ve ekran okuyucu tablosu HER ZAMAN tam etiketi
   * gösteriyor: kısaltma ekseni okunur kılmak için, bilgiyi eksiltmek için
   * değil.
   */
  kisaLabels?: string[];
  label: string;
  height?: number;
}

/**
 * Dönemsel kolon grafiği (satış, faaliyet kârı, net kâr, özkaynak).
 *
 * Neden ayrı bileşen ve neden SVG: panel başına bir grafik ve dönem sayısı
 * onlarla ölçülüyor — grafik kütüphanesini dört kolon için yüklemek ilk yük
 * bütçesini boşa harcardı (ölçüldü: kütüphanenin ilk kurulumu zayıf makinede
 * ~350 ms).
 *
 * Sıfır çizgisi ve negatif kolonlar: net kâr zarara dönebilir ve "küçüldü"
 * ile "zarara döndü" aynı şey değil. Ölçek sıfırı HER ZAMAN içeriyor; aksi
 * hâlde tamamı negatif bir seri yükseliyormuş gibi görünür.
 *
 * Değeri OLMAYAN dönem çubuk çizmiyor ve boş bırakılıyor: eksik veriyi sıfır
 * saymak, olmayan bir çöküş gösterirdi.
 */
export function BarSeries({ labels, values, kisaLabels, label, height = 150 }: Props) {
  const clipId = useId();
  const kap = useRef<HTMLDivElement>(null);
  const [uzerinde, setUzerinde] = useState<number | null>(null);

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

  /**
   * Bir önceki DOLU döneme göre değişim.
   *
   * Bir önceki dönem eksikse atlanmıyor, `null` dönüyor: iki dönem öncesiyle
   * karşılaştırıp "çeyreklik değişim" demek yanlış olurdu. Taban negatifse de
   * `null`: zarardan kâra geçişte yüzde değişim işaret çevirir ve anlamsızdır.
   */
  const degisim = (i: number): number | null => {
    const simdi = values[i];
    const onceki = i > 0 ? values[i - 1] : null;
    if (!Number.isFinite(simdi as number) || !Number.isFinite(onceki as number)) return null;
    const o = onceki as number;
    if (o <= 0) return null;
    return (((simdi as number) - o) / o) * 100;
  };

  const konum = (e: React.PointerEvent<HTMLDivElement>) => {
    const kutu = kap.current?.getBoundingClientRect();
    if (!kutu || kutu.width === 0) return;
    const i = Math.floor(((e.clientX - kutu.left) / kutu.width) * n);
    setUzerinde(i >= 0 && i < n ? i : null);
  };

  const eksen = kisaLabels && kisaLabels.length === n ? kisaLabels : labels;

  // Kaç dönemde bir etiket yazılacağı. Ölçüldü: panel başına 250–290 piksel
  // ve kısa etiket ~26 piksel — sekizden fazla etiket üst üste biniyor.
  const etiketAdim = Math.max(1, Math.ceil(n / 8));

  const secili = uzerinde !== null && Number.isFinite(values[uzerinde] as number) ? uzerinde : null;
  const seciliDegisim = secili === null ? null : degisim(secili);

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
      {/* İmleç kabı: ipucu SVG'nin İÇİNDE olamaz — `preserveAspectRatio="none"`
          yazıyı da esnetirdi. Dışarıda, mutlak konumlu bir kutu. */}
      <div
        className="barseries__kap"
        ref={kap}
        onPointerMove={konum}
        onPointerLeave={() => setUzerinde(null)}
      >
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
            {secili !== null ? (
              <rect
                className="barseries__vurgu"
                x={secili * w}
                y="0"
                width={w}
                height="100"
                fill="var(--surface-2)"
              />
            ) : null}
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
                />
              );
            })}
          </g>
        </svg>
        {secili !== null ? (
          <div
            className="barseries__ipucu"
            style={{ left: `${(secili + 0.5) * w}%` }}
            aria-hidden="true"
          >
            <b>{labels[secili]}</b>
            <span>{trCompact(values[secili] as number)}</span>
            {/* Yüzde bir ÖNCEKİ döneme göre; hesaplanamıyorsa neden olduğu
                yazıyor, boş bırakmak "değişmedi" gibi okunurdu. */}
            <span className={seciliDegisim === null ? 'desk__muted' : undefined}>
              {seciliDegisim === null ? 'önceki döneme göre —' : trPct(seciliDegisim, 1, true)}
            </span>
          </div>
        ) : null}
      </div>
      {/* Izgara: etiket sayısı kadar eşit kolon. `space-between` ile ilk ve son
          etiket kenarlara yapışıp çubuk MERKEZLERİNDEN kayıyordu.

          SEYRELTME son dönemden geriye doğru: kullanıcı önce en son döneme
          bakıyor, bu yüzden her zaman O yazılı. Baştan saymak (i % 2 === 1)
          ÇİFT sayıda dönemde son çubuğu etiketsiz bırakıyordu — on dönemde
          gizlenenler 1,3,5,7,9 ve dokuzuncu indis sonuncusu. Ayrıca eşik tek
          bir sayıya sabitti; yirmi dönemde de on etiket yazılıyordu. */}
      <figcaption className="barseries__labels" aria-hidden="true" style={{ ['--n' as string]: n }}>
        {labels.map((l, i) => (
          <span key={l} className={(n - 1 - i) % etiketAdim === 0 ? undefined : 'is-hidden'}>
            {eksen[i]}
          </span>
        ))}
      </figcaption>
      {/* Ekran okuyucu için dönem dönem değerler: grafik bir resim, tablo veri.
          Fareyle görünen yüzde burada da var — ipucu klavyeyle açılmıyor. */}
      <table className="visually-hidden barseries__table">
        <caption>{label}</caption>
        <tbody>
          {labels.map((l, i) => {
            const d = degisim(i);
            return (
              <tr key={l}>
                <th scope="row">{l}</th>
                <td>
                  {Number.isFinite(values[i] as number)
                    ? `${trCompact(values[i] as number)}${d === null ? '' : `, önceki döneme göre ${trPct(d, 1, true)}`}`
                    : 'veri yok'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
