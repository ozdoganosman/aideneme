import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, IconButton, Skeleton, ToastProvider, Tooltip } from '../ui';
import { Icon, type IconName } from '../ui/icons';
import { CommandPalette } from './CommandPalette';
import { ErrorBoundary } from './ErrorBoundary';
import { buildCommands } from './commands';
import { DEFAULT_SCREEN, SCREENS, screenById } from './nav';
import { Placeholder } from './screens/Placeholder';
import { THEME_LABEL, applyTheme, nextTheme, readTheme, type ThemePreference } from './theme';
import { useUrlState } from './urlState';
import './shell.css';

const Gallery = lazy(() => import('./screens/Gallery'));
const SymbolDesk = lazy(() => import('./screens/SymbolDesk'));
const ScreenerScreen = lazy(() => import('./screens/ScreenerScreen'));
const Compare = lazy(() => import('./screens/Compare'));

/**
 * URL şeması: /?v=<ekran>&s=<sembol>&tf=<periyot>&m=<piyasa>&cmp=<sembol,sembol>
 * Varsayılan değerler yazılmaz — link kısa kalır.
 */
const URL_DEFAULTS = { v: DEFAULT_SCREEN, s: '', tf: 'D', m: 'bist', cmp: '' };

const THEME_ICON: Record<ThemePreference, IconName> = {
  system: 'auto',
  light: 'sun',
  dark: 'moon',
};

export function App() {
  const { state, push } = useUrlState(URL_DEFAULTS);
  const screen = screenById(state.v);
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    document.title = `${screen.label} · Analiz Masası`;
  }, [screen.label]);

  const goTo = useCallback((id: string) => push({ v: id }), [push]);

  const commands = useMemo(
    () =>
      buildCommands({
        goTo,
        setTheme,
        openGallery: () => goTo('kitaplik'),
      }),
    [goTo],
  );

  // Cmd/Ctrl+K → palet. Tek kısayol, her ekranda aynı.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ToastProvider>
      <a className="shell-skip" href="#icerik">
        İçeriğe atla
      </a>

      <div className="shell">
        <nav className="shell-rail" aria-label="Ana gezinme">
          <ul>
            {SCREENS.filter((s) => !s.hidden).map((s) => (
              <li key={s.id}>
                <Tooltip text={s.label}>
                  <button
                    type="button"
                    className={`shell-rail__item ${s.id === screen.id ? 'is-active' : ''}`}
                    aria-current={s.id === screen.id ? 'page' : undefined}
                    aria-label={s.label}
                    onClick={() => goTo(s.id)}
                  >
                    <Icon name={s.icon} size={20} />
                    <span className="shell-rail__label">{s.label}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shell-main">
          <header className="shell-topbar">
            <div className="shell-topbar__title">
              <h1>{screen.label}</h1>
              <p className="shell-muted">{screen.question}</p>
            </div>

            <div className="shell-topbar__actions">
              <Badge
                tone="warn"
                icon={<Icon name="alert" size={12} />}
                title="Veriler gecikmelidir; yatırım tavsiyesi değildir"
              >
                Gecikmeli veri
              </Badge>
              <button
                type="button"
                className="shell-palette__trigger"
                aria-label="Komut paletini aç"
                onClick={() => setPaletteOpen(true)}
              >
                <Icon name="search" size={14} />
                {/* Dar ekranda yalnızca ikon kalır; erişilebilir ad aria-label'dan gelir. */}
                <span className="shell-palette__trigger-text">Komut ara</span>
                <kbd className="shell-palette__trigger-kbd">Ctrl K</kbd>
              </button>
              <IconButton
                label={`${THEME_LABEL[theme]} — değiştir`}
                onClick={() => setTheme((t) => nextTheme(t))}
              >
                <Icon name={THEME_ICON[theme]} />
              </IconButton>
              <IconButton
                label="UI kitaplığı"
                active={screen.id === 'kitaplik'}
                onClick={() => goTo('kitaplik')}
              >
                <Icon name="swatch" />
              </IconButton>
            </div>
          </header>

          <main className="shell-content" id="icerik" tabIndex={-1}>
            <ErrorBoundary key={screen.id}>
              <Suspense fallback={<Skeleton count={6} height="22px" />}>
                {screen.id === 'kitaplik' ? (
                  <Gallery />
                ) : screen.id === 'sembol' ? (
                  <SymbolDesk state={state} push={push} />
                ) : screen.id === 'tarayici' ? (
                  <ScreenerScreen state={state} push={push} />
                ) : screen.id === 'karsilastir' ? (
                  <Compare state={state} push={push} />
                ) : (
                  <Placeholder screen={screen} />
                )}
              </Suspense>
            </ErrorBoundary>
          </main>

          <footer className="shell-foot">
            Bu araç yalnızca bilgilendirme amaçlıdır; yatırım tavsiyesi değildir. Veriler
            gecikmelidir.
          </footer>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
    </ToastProvider>
  );
}
