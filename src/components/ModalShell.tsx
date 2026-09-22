import { useRef, type ReactNode } from 'react';
import { useEscape, useFocusTrap } from '../ui/hooks';

/**
 * Devralınan modallar için ortak kabuk.
 *
 * Eski modallar yalnızca fare ile kapanıyordu: arka plana tıklamak kapatıyordu
 * ama Escape işe yaramıyordu, odak sayfanın arkasında kalıyordu ve klavyeyle
 * gezen kullanıcı modalın dışına sekebiliyordu. Üçü de burada çözülüyor:
 *
 *   - Escape kapatır (klavyede arka plan tıklamasının karşılığı)
 *   - odak açılışta modalın içine girer, kapanışta geldiği yere döner
 *   - Tab modalın içinde döner (odak tuzağı)
 *
 * Arka plan `role="presentation"`: tıklamayla kapatma bir KOLAYLIK, tek yol
 * değil — aynı işi Escape ve × düğmesi de yapıyor. Bu yüzden arka planın
 * klavyeyle erişilebilir olması gerekmiyor.
 *
 * Görsel olarak hiçbir şey değişmiyor: sınıf adları eskisiyle aynı.
 */
export function ModalShell({
  onClose,
  className = 'modal',
  label,
  children,
}: {
  onClose: () => void;
  /** Eski modalın kendi sınıfı ("modal wide" gibi) — görünüm korunsun. */
  className?: string;
  /** Ekran okuyucuya modalın adı. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  useEscape(true, onClose);

  // Arka plan dekoratif: tıklamayla kapatma bir KOLAYLIK ve klavye karşılığı
  // zaten var (Escape). Kuralın göremediği tam olarak bu; dekoratif bir katmana
  // sahte bir tuş dinleyicisi eklemek erişilebilirliği artırmaz.
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      // Yalnızca arka planın KENDİSİNE tıklanınca kapat. Eski kod bunun yerine
      // içeride stopPropagation kullanıyordu; o da diyaloğa gereksiz bir tıklama
      // dinleyicisi ekliyordu (ve erişilebilirlik uyarısı üretiyordu).
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
