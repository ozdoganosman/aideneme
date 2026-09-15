import { useEffect, useState } from 'react';

/**
 * Grafik renkleri arayüzle aynı kaynaktan gelsin diye token'ları
 * getComputedStyle ile okur ve tema değişince yeniden okur.
 *
 * Alternatif (renkleri JS'te ikinci kez tanımlamak) referans projede yapılmıştı
 * ve tema ile grafik zamanla ayrıştı.
 */
export interface ChartColors {
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  accent: string;
  warn: string;
  surface: string;
  muted: string;
}

function read(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text-secondary', '#4a5266'),
    grid: v('--border-subtle', '#e2e5eb'),
    border: v('--border-strong', '#c9cdd6'),
    up: v('--up', '#0f8a5f'),
    down: v('--down', '#d13c36'),
    accent: v('--accent', '#2f6df5'),
    warn: v('--warn', '#b06a00'),
    surface: v('--surface-0', '#ffffff'),
    muted: v('--text-muted', '#78808f'),
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read);

  useEffect(() => {
    const update = () => setColors(read());
    update();

    // Açık tema seçimi kökteki data-theme'i değiştirir…
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // …seçim "sistem" ise değişim işletim sisteminden gelir.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);

    return () => {
      observer.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);

  return colors;
}
