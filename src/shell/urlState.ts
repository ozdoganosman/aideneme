import { useCallback, useEffect, useState } from 'react';

export type UrlState = Record<string, string>;

/**
 * URL ↔ durum. Ürün ilkesi #4: her görünüm paylaşılabilir olmalı.
 * Varsayılan değerler URL'e yazılmaz — link kısa kalır, "temiz" adres
 * her zaman varsayılan görünümü açar.
 */
export function parseQuery(search: string, defaults: UrlState): UrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: UrlState = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = params.get(key);
    if (value !== null && value !== '') out[key] = value;
  }
  return out;
}

export function toQuery(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    const value = state[key];
    if (value != null && value !== '' && value !== defaults[key]) params.set(key, value);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

/** İki durum aynı mı (gereksiz history girdisi açmamak için). */
export function sameState(a: UrlState, b: UrlState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export interface UrlStateApi {
  state: UrlState;
  /** Yeni bir geçmiş girdisi açar (geri tuşu buraya döner). */
  push: (patch: UrlState) => void;
  /** Mevcut girdiyi günceller (filtre sürüklerken geçmişi kirletmemek için). */
  replace: (patch: UrlState) => void;
}

export function useUrlState(defaults: UrlState): UrlStateApi {
  const [state, setState] = useState<UrlState>(() =>
    parseQuery(typeof window === 'undefined' ? '' : window.location.search, defaults),
  );

  // Geri/ileri tuşu → durumu URL'den geri oku.
  useEffect(() => {
    const onPop = () => setState(parseQuery(window.location.search, defaults));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // defaults sabit bir nesne olarak verilir (modül düzeyinde tanımlı).
  }, [defaults]);

  const write = useCallback(
    (patch: UrlState, mode: 'push' | 'replace') => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        if (sameState(prev, next)) return prev;
        const url = `${window.location.pathname}${toQuery(next, defaults)}`;
        if (mode === 'push') window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
        return next;
      });
    },
    [defaults],
  );

  return {
    state,
    push: useCallback((patch: UrlState) => write(patch, 'push'), [write]),
    replace: useCallback((patch: UrlState) => write(patch, 'replace'), [write]),
  };
}
