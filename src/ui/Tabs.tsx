import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useAutoId } from './hooks';

export interface TabItem {
  id: string;
  label: string;
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}

/**
 * WAI-ARIA tab deseni + roving tabindex: sekme şeridine bir kez Tab ile girilir,
 * içinde ok tuşlarıyla gezilir. 7 ekranlık kabukta da, panel içlerinde de aynı.
 */
export function Tabs({ items, value, onChange, label }: TabsProps) {
  const id = useAutoId('tabs');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = items.findIndex((t) => t.id === value);
    if (i < 0) return;
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[items[next].id]?.focus();
  }

  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={selected}
            aria-controls={`${id}-${t.id}-panel`}
            tabIndex={selected ? 0 : -1}
            className={`ui-tabs__tab ${selected ? 'is-active' : ''}`}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
            {t.badge != null ? <span className="ui-tabs__badge">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
