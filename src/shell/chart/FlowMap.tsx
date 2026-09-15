import { squarify } from '../../core/chart/treemap';
import { trPct } from '../../ui';

export interface FlowItem {
  key: string;
  /** İşlem değeri — kutunun ALANI bunun oranında. */
  value: number;
  /** İşlem değeriyle ağırlıklı ortalama değişim (%) — kutunun RENGİ. */
  changePct: number;
  /** Tıklanınca gidilecek yer; verilmezse kutu tıklanamaz. */
  onSelect?: () => void;
}

interface Props {
  items: FlowItem[];
  /** Renk doygunluğunun doyduğu değişim (%). Sektör ortalaması hisseden sakin. */
  scale?: number;
  height?: number;
  label: string;
}

/**
 * Sektör/grup para akışı haritası.
 *
 * Tablo doğru ama okunmuyordu: "Ulaştırma · 19 hisse · 3,1 mlr · %18,5 ·
 * -%0,42" satırını on kez okuyup kafada bir bütün kurmak gerekiyordu.
 * Sorunun kendisi ("hangi endüstride para var ve yönü ne?") iki boyutlu:
 * BÜYÜKLÜK ve YÖN. İki boyutlu soru tek boyutlu bir listeyle cevaplanmıyor.
 *
 * Tablo kaldırılmadı — kesin sayılar, "Tara" eylemi ve sıralama orada.
 * Harita onun yerine değil, ÜSTÜNE geliyor: önce şekil, sonra ayrıntı.
 *
 * DOM kullanılıyor (canvas değil): sektör sayısı onlarla ölçülüyor, yüzlerle
 * değil — ısı haritasındaki 600 kutu gerekçesi burada geçerli değil. DOM
 * karşılığında gerçek düğmeler geliyor: klavyeyle gezilebiliyor ve ekran
 * okuyucuya tek tek okunuyor.
 */
export function FlowMap({ items, scale = 2, height = 200, label }: Props) {
  const gecerli = items.filter((i) => Number.isFinite(i.value) && i.value > 0);
  if (gecerli.length === 0) return null;

  // Yüzde uzayında yerleşim: kutular yüzdeyle konumlanınca kapsayıcı
  // genişliğini ÖLÇMEK gerekmiyor, yani yeniden çizim ve ResizeObserver de
  // gerekmiyor. Alan oranları genişlikten bağımsız korunuyor.
  const rects = squarify(
    gecerli.map((i) => i.value),
    100,
    100,
  );

  return (
    <ul className="flowmap" style={{ height }} aria-label={label}>
      {rects.map((r) => {
        const item = gecerli[r.index];
        const yukari = item.changePct >= 0;
        const yogunluk = Math.min(1, Math.abs(item.changePct) / scale);
        const metin = `${item.key}: işlem değeri payı, ağırlıklı değişim ${trPct(item.changePct, 2, true)}`;
        return (
          <li
            key={item.key}
            className="flowmap__cell"
            style={{
              left: `${r.x}%`,
              top: `${r.y}%`,
              width: `${r.w}%`,
              height: `${r.h}%`,
              // Doygunluk değişimle artıyor; taban %12 ki sıfıra yakın bir
              // sektör de görünür kalsın (şeffaf kutu "veri yok" demektir).
              background: yukari
                ? `color-mix(in srgb, var(--up) ${12 + yogunluk * 78}%, var(--surface-0))`
                : `color-mix(in srgb, var(--down) ${12 + yogunluk * 78}%, var(--surface-0))`,
            }}
          >
            <button
              type="button"
              className="flowmap__btn"
              onClick={item.onSelect}
              disabled={!item.onSelect}
              aria-label={metin}
            >
              <span className="flowmap__key">{item.key}</span>
              <span className="flowmap__val">{trPct(item.changePct, 1, true)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
