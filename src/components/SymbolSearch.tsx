import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  symbols: string[];
  onChange: (s: string) => void;
  onSubmit: (s: string) => void;
}

// Symbol input with a typeahead dropdown: prefix matches first, then substring.
export function SymbolSearch({ value, symbols, onChange, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = open && value ? rank(symbols, value.toUpperCase()) : [];

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const choose = (s: string) => {
    onChange(s);
    setOpen(false);
    onSubmit(s);
  };

  return (
    <div className="search" ref={wrapRef}>
      {/* ARIA birleşik kutu (APG): odak girişte kalır, etkin seçenek
          aria-activedescendant ile bildirilir. Seçeneklerin kendisi odak ALMAZ —
          desen budur; ok tuşları girişte çalışır. */}
      <input
        value={value}
        placeholder="Sembol ara… (örn. BTC)"
        spellCheck={false}
        role="combobox"
        aria-label="Sembol ara"
        aria-expanded={open && matches.length > 0}
        aria-controls="sym-search-list"
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches.length > 0 ? `sym-search-opt-${active}` : undefined
        }
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          setOpen(true);
          // Select the current symbol so the first keystroke replaces it — start a
          // new search instantly instead of deleting the old text by hand. rAF
          // defers past the click's mouseup so the selection actually sticks.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setActive((a) => Math.min(a + 1, matches.length - 1));
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setActive((a) => Math.max(a - 1, 0));
            e.preventDefault();
          } else if (e.key === 'Enter') {
            choose(matches[active] ?? value);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {matches.length > 0 && (
        <div className="search-dropdown" id="sym-search-list" role="listbox" aria-label="Eşleşen semboller">
          {matches.map((m, i) => (
            // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG birleşik kutu deseni: seçenekler odak almaz, aria-activedescendant kullanılır
            <div
              key={m}
              id={`sym-search-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={'search-item' + (i === active ? ' active' : '')}
              // onMouseDown fires before the input blurs, so the pick registers.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(m);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function rank(symbols: string[], q: string): string[] {
  const pre: string[] = [];
  const sub: string[] = [];
  for (const s of symbols) {
    if (s.startsWith(q)) {
      if (pre.length < 12) pre.push(s);
    } else if (s.includes(q)) {
      if (sub.length < 12) sub.push(s);
    }
    if (pre.length >= 12) break;
  }
  return [...pre, ...sub].slice(0, 12);
}
