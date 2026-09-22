import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnomaliRadari } from './AnomaliRadari';
import type { AnomaliSatiri, AnomaliSonucu } from '../../core/screen/anomali';
import type { AnalysisClient } from '../../workers/analysisClient';

function satir(symbol: string, ek: Partial<AnomaliSatiri> = {}): AnomaliSatiri {
  return {
    symbol,
    sektor: 'Bankacılık',
    degisim: 4.5,
    deger: 1_250_000_000,
    hacimZ: 4.2,
    bosluk: Number.NaN,
    boslukZ: Number.NaN,
    kopma: Number.NaN,
    kopmaZ: Number.NaN,
    korUzun: Number.NaN,
    korKisa: Number.NaN,
    tetikler: ['hacim'],
    ...ek,
  };
}

function sonuc(satirlar: AnomaliSatiri[], ek: Partial<AnomaliSonucu> = {}) {
  return {
    gun: 20249,
    denenen: 580,
    islemGormeyen: 4,
    satirlar,
    yaygin: { hacim: false, bosluk: false, kopma: false, korelasyon: false },
    yayginSatir: 0,
    olculemeyen: { hacim: 3, bosluk: 5, kopma: 90, korelasyon: 120 },
    tetiklenen: { hacim: 1, bosluk: 0, kopma: 0, korelasyon: 0 },
    ms: 2,
    ...ek,
  };
}

function istemci(cevap: Promise<unknown>) {
  const anomali = vi.fn().mockReturnValue(cevap);
  return { client: { anomali } as unknown as AnalysisClient, anomali };
}

const SEKTORLER = { of: { GARAN: 'Bankacılık' }, source: 't', generated: 1 };

describe('Anomali radarı paneli', () => {
  it('sektör dosyasına bakılmadan HESAPLAMIYOR — sonra ikinci kez koşmasın', () => {
    const { client, anomali } = istemci(Promise.resolve(sonuc([])));
    render(<AnomaliRadari market="bist" client={client} sectors={undefined} onSelect={() => {}} />);
    expect(anomali).not.toHaveBeenCalled();
    expect(document.querySelector('.anomali')?.getAttribute('data-durum')).toBe('bekliyor');
  });

  it('sektör dosyası yoksa null ile koşuyor ve iki sinyalin ölçülemediğini yazıyor', async () => {
    const { client, anomali } = istemci(Promise.resolve(sonuc([])));
    render(<AnomaliRadari market="bist" client={client} sectors={null} onSelect={() => {}} />);
    await waitFor(() => expect(anomali).toHaveBeenCalledWith('bist', null));
    expect(
      await screen.findByText(/Sektör dosyası yok: kopma ve korelasyon hiçbir sembolde ölçülemedi/),
    ).toBeInTheDocument();
  });

  it('satırlar: sembol, neden rozetleri Türkçe sayıyla; satır grafiğe götürür', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { client, anomali } = istemci(
      Promise.resolve(
        sonuc([
          satir('GARAN', {
            tetikler: ['hacim', 'bosluk'],
            bosluk: 3.25,
            boslukZ: -3.7,
          }),
          satir('THYAO', {
            sektor: null,
            tetikler: ['korelasyon'],
            korUzun: 0.82,
            korKisa: 0.05,
          }),
        ]),
      ),
    );
    render(<AnomaliRadari market="bist" client={client} sectors={SEKTORLER} onSelect={onSelect} />);
    await waitFor(() => expect(anomali).toHaveBeenCalledWith('bist', SEKTORLER.of));
    const tablo = await screen.findByRole('table', { name: 'Olağandışı semboller' });
    expect(tablo).toBeInTheDocument();
    // Rozetler: ad + ölçü. Ondalık VİRGÜL.
    expect(screen.getByText('Hacim patlaması · 4,2σ')).toBeInTheDocument();
    expect(screen.getByText('Açılış boşluğu · +%3,3 · 3,7σ')).toBeInTheDocument();
    expect(screen.getByText('Korelasyon kırılması · 0,82 → 0,05')).toBeInTheDocument();
    // Sektörsüz satır "—".
    expect(screen.getByText('—')).toBeInTheDocument();
    // Kapsam: ölçülemeyenler ve işlem görmeyenler sayıyla.
    expect(
      screen.getByText(/hacim 3 · boşluk 5 · sektörden kopma 90 · korelasyon 120/),
    ).toBeInTheDocument();
    expect(screen.getByText(/bugün işlem görmeyen 4/)).toBeInTheDocument();
    // Uyarı her zaman görünür.
    expect(screen.getByText(/Olağandışı ≠ fırsat/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'THYAO grafiğini aç' }));
    expect(onSelect).toHaveBeenCalledWith('THYAO');
  });

  it('boş sonuç: "yok" diyor, "bakılamadı" ile karıştırmıyor', async () => {
    const { client } = istemci(Promise.resolve(sonuc([])));
    render(<AnomaliRadari market="bist" client={client} sectors={SEKTORLER} onSelect={() => {}} />);
    expect(
      await screen.findByText('Bugün kendi geçmişinin dışına çıkan sembol yok'),
    ).toBeInTheDocument();
    expect(screen.getByText(/580 sembol denendi/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('hata: sessiz boşluk değil, açık hata durumu', async () => {
    const { client } = istemci(Promise.reject(new Error('worker yok')));
    render(<AnomaliRadari market="bist" client={client} sectors={SEKTORLER} onSelect={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Anomali hesabı yapılamadı');
  });

  it('yaygın sinyal: piyasa olayı olarak ayrı söyleniyor, rozeti soluk', async () => {
    const { client } = istemci(
      Promise.resolve(
        sonuc(
          [
            satir('GARAN', {
              tetikler: ['bosluk', 'kopma'],
              bosluk: -9.9,
              boslukZ: -17,
              kopma: 4,
              kopmaZ: 3.5,
            }),
          ],
          {
            yaygin: { hacim: false, bosluk: true, kopma: false, korelasyon: false },
            yayginSatir: 115,
            tetiklenen: { hacim: 0, bosluk: 116, kopma: 1, korelasyon: 0 },
          },
        ),
      ),
    );
    render(<AnomaliRadari market="bist" client={client} sectors={SEKTORLER} onSelect={() => {}} />);
    const not = await screen.findByRole('note');
    expect(not).toHaveTextContent(/açılış boşluğu 116 sembolde \(%20\)/);
    expect(not).toHaveTextContent(/yalnızca bununla tetiklenen 115 sembol listeye alınmadı/);
    // Yaygın sinyalin rozeti soluk (nötr), yaygın olmayan renkli.
    const bosluk = screen.getByText(/^Açılış boşluğu/);
    expect(bosluk.className).toContain('ui-badge--neutral');
    expect(screen.getByText(/^Sektörden kopma/).className).toContain('ui-badge--up');
  });

  it('çok satırda en şiddetli 40 gösteriliyor, kalan sayıyla söyleniyor', async () => {
    const cok = Array.from({ length: 55 }, (_, i) => satir(`S${i}`));
    const { client } = istemci(Promise.resolve(sonuc(cok)));
    render(<AnomaliRadari market="bist" client={client} sectors={SEKTORLER} onSelect={() => {}} />);
    await screen.findByRole('table', { name: 'Olağandışı semboller' });
    expect(screen.getAllByRole('row')).toHaveLength(41); // başlık + 40
    expect(
      screen.getByText(/En şiddetli 40 satır gösteriliyor; 15 satır daha var/),
    ).toBeInTheDocument();
  });
});
