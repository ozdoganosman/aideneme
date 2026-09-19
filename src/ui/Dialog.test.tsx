import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';
import { Button } from './Button';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Aç</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ayarlar"
        footer={<Button onClick={() => setOpen(false)}>Kapat düğmesi</Button>}
      >
        <input aria-label="Ad" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('modal semantiğiyle açılır ve odağı içeri alır', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Aç' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Ayarlar');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab döngüsü diyaloğun dışına çıkmaz', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Aç' }));

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('Esc kapatır ve odak açan düğmeye döner', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Aç' });
    await user.click(opener);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
