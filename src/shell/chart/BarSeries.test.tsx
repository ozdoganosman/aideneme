import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarSeries } from './BarSeries';

/**
 * Kolon grafiğinin sessiz yalan söyleyebileceği üç yer sınanıyor:
 * eksik dönemi sıfır saymak, negatifi pozitif gibi çizmek ve ölçeğe sıfırı
 * almamak (tamamı negatif bir seri yükseliyormuş gibi görünür).
 */
describe('BarSeries', () => {
  function cubuklar(): SVGRectElement[] {
    return Array.from(document.querySelectorAll('rect[fill]'));
  }

  it('eksik dönem için çubuk ÇİZMEZ (sıfır saymaz)', () => {
    render(
      <BarSeries labels={['2024/3', '2024/6', '2024/9']} values={[100, null, 80]} label="Satış" />,
    );
    expect(cubuklar()).toHaveLength(2);
    // Veri yine de kayıp değil: ekran okuyucu tablosunda "veri yok" yazıyor.
    expect(screen.getByRole('row', { name: '2024/6 veri yok' })).toBeInTheDocument();
  });

  it('negatif çubuk ayrı renkte ve sıfır çizgisinin ALTINDA', () => {
    render(<BarSeries labels={['2024/3', '2024/6']} values={[100, -50]} label="Net kâr" />);
    const [pozitif, negatif] = cubuklar();
    expect(pozitif.getAttribute('fill')).toBe('var(--accent)');
    expect(negatif.getAttribute('fill')).toBe('var(--down)');
    // Negatifin üstü, pozitifin altından aşağıda (SVG'de y aşağı doğru artar).
    const alt = Number(pozitif.getAttribute('y')) + Number(pozitif.getAttribute('height'));
    expect(Number(negatif.getAttribute('y'))).toBeGreaterThanOrEqual(alt - 0.01);
  });

  // Ölçek sıfırı içermezse tamamı zarar olan bir seri "yükseliyor" gibi çizilir.
  it('tamamı negatif seride ölçeğin üst ucu sıfır', () => {
    render(<BarSeries labels={['2024/3', '2024/6']} values={[-10, -40]} label="Net kâr" />);
    const olcek = document.querySelector('.barseries__olcek')!;
    expect(olcek.textContent).toBe('0-40');
  });

  it('hiç değer yoksa boş grafik yerine cümle kurar', () => {
    render(<BarSeries labels={['2024/3']} values={[null]} label="Satış" />);
    expect(screen.getByRole('img', { name: 'Satış: veri yok' })).toBeInTheDocument();
  });
});
