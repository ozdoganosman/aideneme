import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('Kabuk', () => {
  it('varsayılan ekranla açılır ve URL temiz kalır', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nabız' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('gezinme URL yazar ve aria-current işaretler', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Tarayıcı' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Tarayıcı' })).toBeInTheDocument();
    expect(window.location.search).toBe('?v=tarayici');
    expect(screen.getByRole('button', { name: 'Tarayıcı' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('geri tuşu önceki ekrana döner (durum URL’de yaşıyor)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Portföy' }));
    expect(window.location.search).toBe('?v=portfoy');

    window.history.back();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Nabız' })).toBeInTheDocument(),
    );
  });

  it('Ctrl+K paleti açar, yazıp Enter ile ekran değiştirir', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Komut ara' });
    await user.type(input, 'karsilastir');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { level: 1, name: 'Karşılaştır' })).toBeInTheDocument();
    expect(window.location.search).toBe('?v=karsilastir');
  });

  it('palet Esc ile kapanır', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Komut paleti' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Komut paleti' })).toBeNull();
  });

  it('tema düğmesi sistem → açık → koyu döngüsünü uygular', async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = () => screen.getByRole('button', { name: /tema/i });

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    await user.click(button());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await user.click(button());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(button());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('içeriğe atla bağlantısı ana bölgeyi hedefler', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: 'İçeriğe atla' })).toHaveAttribute('href', '#icerik');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'icerik');
  });
});
