import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useChartColors, type ChartColors } from './useThemeColors';

/**
 * Renk nesnesinin KİMLİĞİ sabit kalmalı.
 *
 * Bu değer grafik efektlerinin bağımlılığı. Kanca kuruluşta koşulsuz olarak
 * `setColors(read())` çağırıyordu: değerler aynı olsa bile YENİ bir nesne
 * dönüyor, React bunu değişiklik sayıyor ve tüketen her efekt bir kez daha
 * koşuyordu.
 *
 * Ölçüldü (6× yavaşlatılmış işlemci, gerçek BIST verisi, Nabız ekranı): ısı
 * haritası tek yüklemede DÖRT kez çiziliyordu — 582 kutu, toplam 206 ms. Biri
 * bu yüzdendi, biri de ResizeObserver'ın `observe` anındaki ilk çağrısıydı.
 * İkisi düzeltilince çizim 1 kez / 106 ms; ekranın hazır olma süresi
 * 2139 → 1940 ms, ana iş parçacığı bloku 506 → 425 ms.
 */
function Sonda({ kutu }: { kutu: { renkler: ChartColors[] } }) {
  kutu.renkler.push(useChartColors());
  return null;
}

describe('useChartColors', () => {
  it('değerler değişmediyse AYNI nesneyi döndürür', () => {
    const kutu = { renkler: [] as ChartColors[] };
    const { rerender } = render(<Sonda kutu={kutu} />);
    rerender(<Sonda kutu={kutu} />);

    expect(kutu.renkler.length).toBeGreaterThan(1);
    const ilk = kutu.renkler[0];
    for (const r of kutu.renkler) {
      expect(r, 'renk nesnesi kimliği değişti — tüketen efektler boşuna koşar').toBe(ilk);
    }
  });

  // Sabitlik SESSİZLİK anlamına gelmemeli: gerçek tema değişimi geçmeli.
  it('tema değişince yeni nesne döndürür', async () => {
    const kutu = { renkler: [] as ChartColors[] };
    render(<Sonda kutu={kutu} />);
    const once = kutu.renkler[kutu.renkler.length - 1];

    // Gerçek tema anahtarı: kökteki data-theme. Kanca bunu gözlüyor.
    await act(async () => {
      document.documentElement.style.setProperty('--up', '#123456');
      document.documentElement.setAttribute('data-theme', 'dark');
      await Promise.resolve();
    });

    try {
      await waitFor(() => {
        const sonra = kutu.renkler[kutu.renkler.length - 1];
        expect(sonra.up).toBe('#123456');
        expect(sonra).not.toBe(once);
      });
    } finally {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.style.removeProperty('--up');
    }
  });
});
