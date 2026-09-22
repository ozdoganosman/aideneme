import { useState, type ReactElement, cloneElement } from 'react';
import { useAutoId } from './hooks';

export interface TooltipProps {
  text: string;
  children: ReactElement<{
    'aria-describedby'?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
  }>;
}

/**
 * İpucu. Fare kadar klavye odağıyla da açılır ve aria-describedby ile bağlanır —
 * yoksa ekran okuyucu kullanıcısı bilgiyi hiç görmez.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useAutoId('tip');

  return (
    <span className="ui-tooltip">
      {cloneElement(children, {
        'aria-describedby': open ? id : undefined,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      })}
      {open ? (
        <span role="tooltip" id={id} className="ui-tooltip__bubble">
          {text}
        </span>
      ) : null}
    </span>
  );
}
