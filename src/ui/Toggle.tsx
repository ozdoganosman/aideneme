import { useAutoId } from './hooks';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Etiketi gizle (araç çubuğunda yer darsa) — erişilebilir ad korunur. */
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
}

/** Anahtar (switch). Native checkbox üzerine kurulu: klavye ve form davranışı bedava. */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  description,
  disabled,
}: ToggleProps) {
  const id = useAutoId('toggle');
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className="ui-toggle">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="ui-toggle__input"
        checked={checked}
        disabled={disabled}
        aria-describedby={descId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="ui-toggle__label">
        <span className="ui-toggle__track" aria-hidden="true">
          <span className="ui-toggle__thumb" />
        </span>
        <span className={hideLabel ? 'visually-hidden' : 'ui-toggle__text'}>
          {label}
          {description ? (
            <span id={descId} className="ui-toggle__desc">
              {description}
            </span>
          ) : null}
        </span>
      </label>
    </div>
  );
}
