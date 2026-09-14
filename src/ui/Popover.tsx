import { useRef, useState, type ReactNode } from 'react';
import { useAutoId, useClickOutside, useEscape } from './hooks';

export interface PopoverProps {
  /** Tetikleyici: render-prop, böylece herhangi bir düğme/kart olabilir. */
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    'aria-controls': string;
    onClick: () => void;
  }) => ReactNode;
  title?: string;
  align?: 'start' | 'end';
  children: ReactNode;
}

/**
 * Bağlamsal katman. Ürün ilkesi #2'nin ("her sayı tıklanabilir") taşıyıcısı:
 * bir metriğin formülü/kaynağı bunun içinde açılır.
 */
export function Popover({ trigger, title, align = 'start', children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useAutoId('popover');

  useClickOutside(rootRef, () => setOpen(false), open);
  useEscape(open, () => setOpen(false));

  return (
    <div className="ui-popover" ref={rootRef}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
        onClick: () => setOpen((v) => !v),
      })}
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={title}
          className={`ui-popover__panel ui-popover__panel--${align}`}
        >
          {title ? <h3 className="ui-popover__title">{title}</h3> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
