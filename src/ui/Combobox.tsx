import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAutoId, useClickOutside } from './hooks';

export interface ComboOption {
  value: string;
  label: string;
  /** Sağda gri gösterilen ikincil bilgi (şirket adı, piyasa vb.). */
  meta?: string;
}

export interface ComboboxProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  hideLabel?: boolean;
  maxVisible?: number;
  emptyText?: string;
}

/**
 * WAI-ARIA "combobox with listbox popup" deseni: input odakta kalır, seçenekler
 * aria-activedescendant ile duyurulur. Ok tuşları, Enter, Esc, Home/End çalışır.
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  hideLabel = false,
  maxVisible = 8,
  emptyText = 'Sonuç yok',
}: ComboboxProps) {
  const id = useAutoId('combo');
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useClickOutside(rootRef, () => setOpen(false), open);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    const list = q
      ? options.filter(
          (o) =>
            o.label.toLocaleLowerCase('tr').includes(q) ||
            o.value.toLocaleLowerCase('tr').includes(q),
        )
      : options;
    return list.slice(0, maxVisible);
  }, [options, query, maxVisible]);

  function commit(option: ComboOption | undefined) {
    if (!option) return;
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i + 1) % matches.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(Math.max(0, matches.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const activeId = open && matches[active] ? `${id}-opt-${matches[active].value}` : undefined;
  const selected = options.find((o) => o.value === value);

  return (
    <div className="ui-combobox" ref={rootRef}>
      <label className={hideLabel ? 'visually-hidden' : 'ui-field__label'} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder={placeholder ?? selected?.label ?? ''}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className="ui-combobox__list" id={listId} role="listbox" aria-label={label}>
          {matches.length === 0 ? (
            <li className="ui-combobox__empty" role="presentation">
              {emptyText}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-opt-${o.value}`}
                role="option"
                aria-selected={i === active}
                className={`ui-combobox__opt ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // input odağı kaybolmasın
                  commit(o);
                }}
              >
                <span className="ui-combobox__value">{o.value}</span>
                <span className="ui-combobox__meta">{o.meta ?? o.label}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
