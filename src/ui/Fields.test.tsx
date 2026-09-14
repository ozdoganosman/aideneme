import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField } from './Fields';

function Harness({
  onChange,
  min,
  max,
}: {
  onChange?: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(14);
  return (
    <>
      <NumberField
        label="Uzunluk"
        value={value}
        min={min}
        max={max}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <output>{value}</output>
    </>
  );
}

describe('NumberField', () => {
  it('sil-ve-yeniden-yaz akışı yazılan değeri verir (eskisine eklemez)', async () => {
    const user = userEvent.setup();
    render(<Harness min={2} max={100} />);
    const input = screen.getByLabelText('Uzunluk');

    await user.clear(input);
    await user.type(input, '21');

    expect(screen.getByText('21', { selector: 'output' })).toBeInTheDocument();
  });

  it('kutu yazarken boş kalabilir, odak çıkınca eski değere döner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Uzunluk') as HTMLInputElement;

    await user.clear(input);
    expect(input.value).toBe('');
    expect(onChange).not.toHaveBeenCalled(); // boş girdi üst katmana gitmez

    await user.tab();
    expect(input.value).toBe('14');
  });

  it('sınır kırpması odak çıkışında uygulanır', async () => {
    const user = userEvent.setup();
    render(<Harness min={2} max={50} />);
    const input = screen.getByLabelText('Uzunluk');

    await user.clear(input);
    await user.type(input, '999');
    await user.tab();

    expect(screen.getByText('50', { selector: 'output' })).toBeInTheDocument();
  });
});
