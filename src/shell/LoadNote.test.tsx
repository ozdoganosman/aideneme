import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadNote } from './LoadNote';

describe('İndirme ilerlemesi', () => {
  it('ilerleme bilinmiyorsa hiçbir şey göstermez', () => {
    const { container } = render(<LoadNote progress={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('toplam boyut bilinmiyorsa sahte çubuk çizmez', () => {
    const { container } = render(<LoadNote progress={{ loaded: 1024, total: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('inen ve toplam boyutu yüzdesiyle yazar', () => {
    render(<LoadNote progress={{ loaded: 259 * 1024, total: 979 * 1024 }} />);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('259 KB');
    expect(note).toHaveTextContent('979 KB');
    expect(note).toHaveTextContent('%26');
  });

  it('bir megabaytın üstünü MB olarak yazar', () => {
    render(<LoadNote progress={{ loaded: 1_572_864, total: 2_097_152 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('1.5 MB / 2.0 MB');
  });
});
