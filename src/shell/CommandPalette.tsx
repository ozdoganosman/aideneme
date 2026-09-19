import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useFocusTrap } from '../ui/hooks';
import { filterCommands, type Command } from './commands';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/** Cmd/Ctrl+K paleti: her eylem fare olmadan iki tuşta erişilebilir olmalı. */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(panelRef, open);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // autoFocus prop'u yerine açık odak: palet her açılışta arama kutusuna gider.
    inputRef.current?.focus();
  }, [open]);

  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const activeCmd = matches[active];
    if (!activeCmd) return;
    // Grup başlıkları listeye ayrı <li> olarak giriyor; indeksle değil kimlikle bul.
    listRef.current?.querySelector(`#palette-${CSS.escape(activeCmd.id)}`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active, matches]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i + 1) % matches.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = matches[active];
      if (cmd) {
        cmd.run();
        onClose();
      }
    }
  }

  let lastGroup = '';

  return createPortal(
    <div
      className="ui-overlay shell-palette__overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="shell-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Komut paleti"
      >
        <input
          className="shell-palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={matches[active] ? `palette-${matches[active].id}` : undefined}
          aria-label="Komut ara"
          placeholder="Komut ara… (örn. tarayıcı, koyu tema)"
          value={query}
          ref={inputRef}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="shell-palette__list" id="palette-list" role="listbox" ref={listRef}>
          {matches.length === 0 ? (
            <li className="shell-palette__empty">Eşleşen komut yok</li>
          ) : (
            matches.map((cmd, i) => {
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              return (
                <Fragment key={cmd.id}>
                  {showGroup ? (
                    <li className="shell-palette__grouphead" role="presentation">
                      {cmd.group}
                    </li>
                  ) : null}
                  <li
                    id={`palette-${cmd.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={`shell-palette__item ${i === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      cmd.run();
                      onClose();
                    }}
                  >
                    <span className="shell-palette__title">{cmd.title}</span>
                    {cmd.hint ? <kbd className="shell-palette__hint">{cmd.hint}</kbd> : null}
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
        <footer className="shell-palette__foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> gez · <kbd>Enter</kbd> çalıştır · <kbd>Esc</kbd> kapat
        </footer>
      </div>
    </div>,
    document.body,
  );
}
