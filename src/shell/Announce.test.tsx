import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Announce } from './Announce';

/**
 * Duyuru bölgesi WCAG 2.2 §4.1.3'ün karşılığı. Üç şeyi koruyor:
 * bölge en baştan DOM'da olmalı, mesaj gecikmeden SONRA yayımlanmalı,
 * ve hızla değişen ara mesajlar yayımlanmamalı.
 */
describe('Announce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('canlı bölge en baştan DOM’da ama boş', () => {
    render(<Announce message="Tarama tamamlandı" />);
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('');
  });

  it('mesajı gecikmeden sonra yayımlar', () => {
    vi.useFakeTimers();
    render(<Announce message="Tarama tamamlandı: 12 sonuç." delay={700} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Tarama tamamlandı: 12 sonuç.');
  });

  it('gecikme dolmadan değişen ara mesajları yayımlamaz', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Announce message="1 sonuç" delay={700} />);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    rerender(<Announce message="2 sonuç" delay={700} />);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // İlk mesajın zamanlayıcısı iptal edildi: hâlâ boş.
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('status')).toHaveTextContent('2 sonuç');
  });

  it('boş mesaj bölgeyi temizler — bir sonraki aynı metin yeniden duyurulabilsin', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Announce message="Hazır: 5 sonuç" delay={100} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Hazır: 5 sonuç');
    rerender(<Announce message="" delay={100} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<Announce message="Hazır: 5 sonuç" delay={100} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Hazır: 5 sonuç');
  });

  it('ekranda görünmez (yalnızca ekran okuyucuya)', () => {
    render(<Announce message="x" />);
    expect(screen.getByRole('status')).toHaveClass('visually-hidden');
  });
});
