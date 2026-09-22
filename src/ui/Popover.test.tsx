import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './Popover';
import { Button } from './Button';

/**
 * Popover paneli GÖVDEYE portal ile taşınıyor (kaydırılabilir bir ata onu
 * kırpmasın diye). Portalın bedeli var ve bedeli burada korunuyor: panel artık
 * tetikleyicinin DOM alt ağacında değil, yani "dışarı tıklandı mı" ve "odak
 * nereye gidiyor" sorularının cevapları kendiliğinden doğru değil.
 */
describe('Popover', () => {
  function Ornek({ menu = false }: { menu?: boolean }) {
    return (
      <div>
        <Popover
          title="Hazır filtreler"
          trigger={(p) => (
            <Button size="sm" {...p}>
              Hazır
            </Button>
          )}
        >
          {menu ? (
            (kapat) => (
              <button type="button" onClick={kapat}>
                Seç
              </button>
            )
          ) : (
            <button type="button">İçerideki düğme</button>
          )}
        </Popover>
        <button type="button">Dışarıdaki düğme</button>
      </div>
    );
  }

  it('panel gövdeye taşınıyor ama tetikleyiciye bağlı kalıyor', async () => {
    const user = userEvent.setup();
    render(<Ornek />);
    const tetik = screen.getByRole('button', { name: 'Hazır' });
    expect(tetik).toHaveAttribute('aria-expanded', 'false');

    await user.click(tetik);
    const panel = screen.getByRole('dialog', { name: 'Hazır filtreler' });
    // Portal: kök DOM ağacında DEĞİL, gövdenin doğrudan çocuğu.
    expect(panel.parentElement).toBe(document.body);
    // Bağ `aria-controls` ile kuruluyor — ekran okuyucu için tek kalan ip.
    expect(tetik).toHaveAttribute('aria-controls', panel.id);
    expect(tetik).toHaveAttribute('aria-expanded', 'true');
  });

  /*
    REGRESYON KORUMASI. `useClickOutside` kökün alt ağacına bakıyor; panel
    portalla dışarı çıkınca PANELİN KENDİSİ "dışarısı" sayılıyor ve panele
    tıklamak onu kapatıyordu. Bir menüde tek bir seçim bile yapılamaz.
  */
  it('panelin içine tıklamak paneli kapatmıyor', async () => {
    const user = userEvent.setup();
    render(<Ornek />);
    await user.click(screen.getByRole('button', { name: 'Hazır' }));
    await user.click(screen.getByRole('button', { name: 'İçerideki düğme' }));
    expect(screen.queryByRole('dialog', { name: 'Hazır filtreler' })).not.toBeNull();
  });

  it('dışarı tıklamak kapatıyor', async () => {
    const user = userEvent.setup();
    render(<Ornek />);
    await user.click(screen.getByRole('button', { name: 'Hazır' }));
    await user.click(screen.getByRole('button', { name: 'Dışarıdaki düğme' }));
    expect(screen.queryByRole('dialog', { name: 'Hazır filtreler' })).toBeNull();
  });

  /*
    Portal DOM SIRASINI koparıyor: Tab ile tetikleyiciden panele geçilemez,
    panel belgenin en sonundadır. Odak tuzağı bunun karşılığı — açılışta içeri
    girer, Esc kapatınca tetikleyiciye döner. Klavye denetimi bu kuralın
    eksikliğini yakaladı.
  */
  it('odak panele giriyor, Esc kapatıp tetikleyiciye döndürüyor', async () => {
    const user = userEvent.setup();
    render(<Ornek />);
    const tetik = screen.getByRole('button', { name: 'Hazır' });
    await user.click(tetik);
    expect(screen.getByRole('button', { name: 'İçerideki düğme' })).toBe(document.activeElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Hazır filtreler' })).toBeNull();
    expect(document.activeElement).toBe(tetik);
  });

  // Menü tarzı içerik: seçim yapıldığında panel kendini kapatabilmeli.
  it('içerik fonksiyonu kapatma kolunu alıyor', async () => {
    const user = userEvent.setup();
    render(<Ornek menu />);
    await user.click(screen.getByRole('button', { name: 'Hazır' }));
    await user.click(screen.getByRole('button', { name: 'Seç' }));
    expect(screen.queryByRole('dialog', { name: 'Hazır filtreler' })).toBeNull();
  });
});
