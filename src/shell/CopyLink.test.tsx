import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyLink } from './CopyLink';

function withClipboard(impl: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  });
  return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
}

describe('Bağlantıyı kopyala', () => {
  it('adresi panoya yazar ve geri bildirim verir', async () => {
    const user = userEvent.setup();
    const writeText = withClipboard(async () => {});
    render(<CopyLink />);

    await user.click(screen.getByRole('button', { name: 'Bağlantıyı kopyala' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kopyalandı' })).toBeTruthy());
  });

  it('pano erişilemezse "kopyalandı" DEMEZ', async () => {
    const user = userEvent.setup();
    withClipboard(async () => {
      throw new Error('izin yok');
    });
    render(<CopyLink label="Filtreyi paylaş" />);

    await user.click(screen.getByRole('button', { name: 'Filtreyi paylaş' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kopyalanamadı' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Kopyalandı' })).toBeNull();
  });

  it('etiket özelleştirilebilir', () => {
    withClipboard(async () => {});
    render(<CopyLink label="Stratejiyi paylaş" />);
    expect(screen.getByRole('button', { name: 'Stratejiyi paylaş' })).toBeTruthy();
  });
});
