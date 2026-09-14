export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'ui.theme';

export function readTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Tercihi uygular. 'system' → data-theme kaldırılır ve karar
 * prefers-color-scheme'e bırakılır (token dosyası bunu bekliyor).
 */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* özel sekmede yazılamayabilir — görünüm yine doğru */
  }
}

export function nextTheme(pref: ThemePreference): ThemePreference {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Sistem teması',
  light: 'Açık tema',
  dark: 'Koyu tema',
};
