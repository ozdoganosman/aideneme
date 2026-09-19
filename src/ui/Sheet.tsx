import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { useAutoId, useEscape, useFocusTrap } from './hooks';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'bottom' | 'right';
  children: ReactNode;
}

/**
 * Kenar paneli. Dar ekranda aynı içerik alttan açılır — ayrı bir "mobil bileşen"
 * yazmaya gerek kalmaz (referans projedeki 468 satırlık ikinci araç çubuğunun
 * varlık sebebi buydu).
 */
export function Sheet({ open, onClose, title, side = 'right', children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useAutoId('sheet');
  useFocusTrap(panelRef, open);
  useEscape(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-overlay ui-overlay--sheet"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`ui-sheet ui-sheet--${side}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="ui-sheet__head">
          <span className="ui-sheet__grip" aria-hidden="true" />
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="ui-dialog__close" aria-label="Kapat" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="ui-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
