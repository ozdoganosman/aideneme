import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox } from './Combobox';

const OPTIONS = [
  { value: 'THYAO', label: 'Türk Hava Yolları' },
  { value: 'GARAN', label: 'Garanti BBVA' },
  { value: 'ASELS', label: 'Aselsan' },
];

function Harness() {
  const [value, setValue] = useState('THYAO');
  return (
    <>
      <Combobox label="Sembol" value={value} onChange={setValue} options={OPTIONS} />
      <output>{value}</output>
    </>
  );
}

describe('Combobox', () => {
  it('ARIA combobox sözleşmesini kurar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Sembol' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('yazarken filtreler, ok+Enter ile seçer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Sembol' });

    await user.click(input);
    await user.keyboard('gar');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('GARAN');

    await user.keyboard('{Enter}');
    expect(screen.getByText('GARAN', { selector: 'output' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('aktif seçeneği aria-activedescendant ile duyurur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Sembol' });
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toContain('GARAN');
  });

  it('kapalıyken seçili değeri gösterir (soluk placeholder değil)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Sembol' }) as HTMLInputElement;
    expect(input.value).toBe('THYAO');

    await user.click(input);
    expect(input.value).toBe(''); // odakta sorgu kutusu boşalır
    await user.keyboard('asel{Enter}');
    expect(input.value).toBe('ASELS');
  });

  it('Esc listeyi kapatır', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'Sembol' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
