import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { useAutoId, useEscape, useFocusTrap } from './hooks';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Alt aksiyon çubuğu (Kaydet / Vazgeç gibi). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/** Modal diyalog: odak tuzağı + Esc + arka plan kilidi. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useAutoId('dialog');
  useFocusTrap(panelRef, open);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-overlay"
      role="presentation"
      onMouseDown={(e) => {
        // Yalnızca arka plana tıklandığında kapat — panelin içindeki sürükleme
        // ya da metin seçimi diyaloğu kapatmamalı.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`ui-dialog ui-dialog--${size}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
      >
        <header className="ui-dialog__head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="ui-dialog__close" aria-label="Kapat" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        {description ? (
          <p id={`${id}-desc`} className="ui-dialog__desc">
            {description}
          </p>
        ) : null}
        <div className="ui-dialog__body">{children}</div>
        {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
