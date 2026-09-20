import { useState } from 'react';
import { Button, Dialog } from '../../ui';
import type { Candles } from '../../core/data/types';
import { gostergeCalistirUzak } from './gostergeIstemci';
import { ORNEK_KAYNAK, yeniKullaniciId, type KullaniciGostergesi } from './kullaniciGosterge';

interface Props {
  acik: boolean;
  /** Düzenlenen gösterge; yeni yazılıyorsa null. */
  duzenlenen: KullaniciGostergesi | null;
  /** Denemenin koşacağı seri — açık sembolün mumları. */
  mumlar: Candles | null;
  onKapat: () => void;
  onKaydet: (g: KullaniciGostergesi) => void;
}

/**
 * KENDİ GÖSTERGENİ YAZ.
 *
 * Kullanıcı isteği: "pinescript yerine javascript ile yeni indikatör
 * yükleme".
 *
 * Kaydetmeden ÖNCE deneme ZORUNLU: kaydedilen ama çalışmayan bir gösterge,
 * kullanıcının listesinde sessizce duran bozuk bir satır olurdu. Deneme
 * yalıtılmış worker'da koşuyor ve üstveriyi de ORADAN alıyoruz — ad, kısa ad
 * ve parametre şeması kodun kendisinde yazılı, ikinci kez sorulmuyor.
 */
export function GostergeDuzenleyici({ acik, duzenlenen, mumlar, onKapat, onKaydet }: Props) {
  const [kaynak, setKaynak] = useState(duzenlenen?.kaynak ?? ORNEK_KAYNAK);
  const [durum, setDurum] = useState<
    | { tur: 'bos' }
    | { tur: 'deneniyor' }
    | { tur: 'hata'; mesaj: string }
    | { tur: 'tamam'; g: KullaniciGostergesi }
  >({ tur: 'bos' });

  // Kip her açılışta düzenlenen göstergeyle başlamalı; React durumu ilk
  // değerinde takılı kalmasın.
  const [sonAcilis, setSonAcilis] = useState(acik);
  if (acik !== sonAcilis) {
    setSonAcilis(acik);
    if (acik) {
      setKaynak(duzenlenen?.kaynak ?? ORNEK_KAYNAK);
      setDurum({ tur: 'bos' });
    }
  }

  const dene = async () => {
    if (!mumlar || mumlar.length === 0) {
      setDurum({ tur: 'hata', mesaj: 'Denemek için önce bir sembolün verisi yüklenmeli.' });
      return;
    }
    setDurum({ tur: 'deneniyor' });
    const sonuc = await gostergeCalistirUzak(kaynak, mumlar, {});
    if (!sonuc.tamam) {
      setDurum({ tur: 'hata', mesaj: sonuc.hata });
      return;
    }
    const u = sonuc.deger.ustveri;
    setDurum({
      tur: 'tamam',
      g: {
        id: duzenlenen?.id ?? yeniKullaniciId(),
        ad: u.ad,
        kisa: u.kisa,
        panel: u.panel,
        parametreler: u.parametreler,
        kaynak,
      },
    });
  };

  return (
    <Dialog
      open={acik}
      onClose={onKapat}
      title={duzenlenen ? `${duzenlenen.ad} — düzenle` : 'Kendi göstergeni yaz'}
      description="JavaScript. Kod yalıtılmış bir arka plan işçisinde çalışır: ağ, depolama ve sayfa erişimi yoktur."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onKapat}>
            Vazgeç
          </Button>
          <Button variant="secondary" onClick={dene} disabled={durum.tur === 'deneniyor'}>
            {durum.tur === 'deneniyor' ? 'Deneniyor…' : 'Dene'}
          </Button>
          <Button
            onClick={() => {
              if (durum.tur === 'tamam') onKaydet(durum.g);
            }}
            disabled={durum.tur !== 'tamam'}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <div className="ui-field">
        <label className="ui-field__label" htmlFor="gosterge-kaynak">
          Gösterge kodu
        </label>
        <textarea
          id="gosterge-kaynak"
          className="ui-input gosterge__kod"
          spellCheck={false}
          rows={18}
          value={kaynak}
          onChange={(e) => {
            setKaynak(e.target.value);
            // Kod değişti: eski deneme sonucu ARTIK GEÇERSİZ. Kaydet düğmesi
            // kapanıyor, yoksa denenmemiş kod kaydedilebilirdi.
            setDurum({ tur: 'bos' });
          }}
        />
      </div>

      {/*
        Sonuç canlı bölgede: deneme asenkron ve ekran okuyucu kullanıcısı
        düğmeye bastıktan sonra ne olduğunu göremez.
      */}
      <p className="gosterge__durum" role="status">
        {durum.tur === 'bos' ? 'Kaydetmeden önce "Dene" ile çalıştırın.' : null}
        {durum.tur === 'deneniyor' ? 'Deneniyor…' : null}
        {durum.tur === 'hata' ? <span className="gosterge__hata">{durum.mesaj}</span> : null}
        {durum.tur === 'tamam' ? (
          <span className="gosterge__tamam">
            Çalıştı: <b>{durum.g.ad}</b> ({durum.g.kisa}) ·{' '}
            {durum.g.panel === 'fiyat' ? 'fiyat üstünde' : 'ayrı panel'} ·{' '}
            {durum.g.parametreler.length} parametre
          </span>
        ) : null}
      </p>
    </Dialog>
  );
}
