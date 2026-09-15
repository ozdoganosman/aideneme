import { useState, type ReactNode } from 'react';
import { useAutoId } from './hooks';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, hideLabel = false, children }: FieldShellProps) {
  return (
    <div className={`ui-field ${error ? 'is-invalid' : ''}`}>
      <label className={hideLabel ? 'visually-hidden' : 'ui-field__label'} htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="ui-field__msg ui-field__msg--error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-field__msg" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  /**
   * Etiketi görsel olarak gizler (erişilebilir ad KALIR).
   *
   * Dar panellerde her alanın üstünde büyük harfli bir etiket satırı dikey
   * alanı yiyor ve seçeneğin kendisi zaten ne olduğunu söylüyor. Etiketi
   * silmek ekran okuyucuda adsız bir kutu bırakırdı.
   */
  hideLabel?: boolean;
}

/** Seçim kutusu. Native <select>: mobil klavye/tekerlek davranışı taklit edilemez. */
export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
  hideLabel = false,
}: SelectProps) {
  const id = useAutoId('select');
  return (
    <FieldShell id={id} label={label} hint={hint} hideLabel={hideLabel}>
      <div className="ui-select">
        <select
          id={id}
          className="ui-select__input"
          value={value}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="ui-select__caret" aria-hidden="true">
          ▾
        </span>
      </div>
    </FieldShell>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
  error?: string;
}

/**
 * Sayı alanı.
 *
 * Yazarken kutuyu boşaltabilmek gerekir: değeri doğrudan prop'tan okuyan bir
 * kontrollü input'ta "sil ve yeniden yaz" akışı, silinen değerin anında geri
 * gelmesine ve ardından yazılan rakamın eskisine EKLENMESİNE yol açıyor
 * (14 → "142" → sınıra kırpılıyor). Bu yüzden yazım sırasında yerel bir taslak
 * tutuluyor; sınır kırpması odak çıkışında uygulanıyor.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
  error,
}: NumberFieldProps) {
  const id = useAutoId('num');
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '');

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="ui-input-wrap">
        <input
          id={id}
          type="number"
          className="ui-input num"
          value={shown}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = e.target.valueAsNumber;
            // Boş ya da yarım girdi ("-", "1e") üst katmana gitmez; kutu boş kalır.
            if (Number.isFinite(next)) onChange(next);
          }}
          onBlur={() => {
            setDraft(null);
            // Number('') === 0 olduğu için boş girdi ayrıca elenir; yoksa
            // kutuyu boşaltıp odağı kaybetmek değeri sessizce sıfırlardı.
            const trimmed = shown.trim();
            if (trimmed === '') return; // boş bırakıldıysa eski değer geri gelir
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed)) return;
            const clamped = clamp(parsed);
            if (clamped !== value) onChange(clamped);
          }}
        />
        {suffix ? (
          <span className="ui-input-wrap__suffix" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </div>
    </FieldShell>
  );
}

export interface RangeFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  hint?: string;
}

/** Kaydırıcı: indikatör parametrelerini gezerken anlık değer okunur kalır. */
export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  hint,
}: RangeFieldProps) {
  const id = useAutoId('range');
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div className="ui-range">
        <input
          id={id}
          type="range"
          className="ui-range__input"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-valuetext={format(value)}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
        <output className="ui-range__value num" htmlFor={id}>
          {format(value)}
        </output>
      </div>
    </FieldShell>
  );
}
