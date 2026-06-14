import { useState } from 'react';

// Collapsible panel state persisted in localStorage so a folded sidebar section
// stays folded across reloads. Returns [collapsed, toggle].
export function usePanelCollapse(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem(key, n ? '1' : '0');
      } catch {
        /* ignore */
      }
      return n;
    });
  return [collapsed, toggle];
}
