import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Metnin solunda duran ikon/emoji; anlam taşımaz, dekoratiftir. */
  icon?: ReactNode;
  /** Bekleyen işlem: tıklama kilitlenir, ekran okuyucuya "meşgul" der. */
  busy?: boolean;
  full?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  full = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--${variant} ui-btn--${size} ${full ? 'ui-btn--full' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Zorunlu: ikonun tek başına anlamı yok, erişilebilir ad buradan gelir. */
  label: string;
  size?: Size;
  variant?: Variant;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  active = false,
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--icon ui-btn--${variant} ui-btn--${size} ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={rest['aria-pressed'] ?? (active || undefined)}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
