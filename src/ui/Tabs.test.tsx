import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

const ITEMS = [
  { id: 'a', label: 'Genel' },
  { id: 'b', label: 'Risk' },
  { id: 'c', label: 'Maliyet' },
];

function Harness() {
  const [value, setValue] = useState('a');
  return <Tabs items={ITEMS} value={value} onChange={setValue} label="Bölümler" />;
}

describe('Tabs', () => {
  it('roving tabindex: yalnızca seçili sekme Tab sırasında', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ok tuşlarıyla gezinir ve başa sarar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Risk' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Maliyet' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Genel' })).toHaveAttribute('aria-selected', 'true');
  });
});
