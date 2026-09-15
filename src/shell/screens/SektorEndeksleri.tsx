import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Select, Skeleton, trPct } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  sektorGetirileri,
  sektorOzeti,
  type SektorGetirisi,
} from '../../core/screen/sectorIndices';
import { dataClient } from '../../data-client/client';
import type { Market } from '../../data-client/markets';
import type { Candles } from '../../core/data/types';

interface Props {
  market: Market;
  /** Sektöre tıklanınca endeksi grafikte açar. */
  onSelect?: (symbol: string) => void;
}

/** Bar sayısı → dönem adı. Nabız ekranıyla AYNI sözlük. */
const DONEMLER: { bars: number; ad: string }[] = [
  { bars: 1, ad: 'Son bar' },
  { bars: 5, ad: '1 hafta' },
  { bars: 21, ad: '1 ay' },
  { bars: 63, ad: '3 ay' },
  { bars: 250, ad: '1 yıl' },
];

/**
 * SEKTÖR ENDEKSLERİ — "endüstriden para akışı" sorusunun cevaplanabilen hâli.
 *
 * Neden burada: sembol→sektör sınıflandırması üretilemiyor (kaynak 401
 * döndürüyor). Ama BIST'in KENDİ alt sektör endeksleri veri setimizde ve tam
 * geçmişleriyle duruyor. Sektörün nasıl gittiğini uydurmadan borsanın resmî
 * endeksinden okuyoruz.
 *
 * GETİRİ, AKIŞ DEĞİL: endeks serilerinde hacim güvenilir değil (ölçüldü —
 * yayındaki veride endekslerin işlem değeri 0). Bu yüzden "şu sektöre şu kadar
 * para girdi" demiyoruz. Başlık da açıklama da bunu söylüyor.
 *
 * Paket AYRI ve küçük (~140 KB): endeksler tarama evreninden çıkarıldığı için
 * ana pakette yoklar, tek tek seri dosyaları ise tam geçmiş taşıdığından aynı
 * iş ~1,8 MB olurdu.
 */
export function SektorEndeksleri({ market, onSelect }: Props) {
  const [seriler, setSeriler] = useState<Map<string, Candles> | null>(null);
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'yok' | 'hata'>('yukleniyor');
  const [bars, setBars] = useState(21);

  useEffect(() => {
    let iptal = false;
    const kontrol = new AbortController();
    setSeriler(null);
    setDurum('yukleniyor');

    dataClient
      .indexBundle(market, kontrol.signal)
      .then((paket) => {
        if (iptal) return;
        if (!paket) {
          setDurum('yok');
          return;
        }
        const m = new Map<string, Candles>();
        for (const ad of paket.names) {
          const c = paket.seriesOf(ad);
          if (c) m.set(ad, c);
        }
        setSeriler(m);
        setDurum('hazir');
      })
      .catch(() => {
        if (!iptal) setDurum('hata');
      });

    return () => {
      iptal = true;
      kontrol.abort();
    };
  }, [market]);

  const liste: SektorGetirisi[] = useMemo(
    () => (seriler ? sektorGetirileri(seriler, bars) : []),
    [seriler, bars],
  );
  const ozet = useMemo(() => sektorOzeti(liste), [liste]);

  // Çubuk uzunluğu için ORTAK ölçek: en büyük mutlak getiri. Artı ve eksiyi
  // ayrı ölçeklemek, küçük bir düşüşü büyük bir yükselişle aynı boyda
  // gösterirdi.
  const enBuyuk = useMemo(
    () => liste.reduce((m, s) => Math.max(m, Math.abs(s.getiri)), 0) || 1,
    [liste],
  );

  const donemAdi = DONEMLER.find((d) => d.bars === bars)?.ad ?? `${bars} bar`;

  return (
    <section className="pulse__panel sektor" aria-label="Sektör endeksleri">
      <header className="pulse__panel-head">
        <h2>Sektör endeksleri — hangi sektör kazandırdı?</h2>
        <span className="desk__muted">
          BIST'in resmî alt sektör endeksleri. Bu <b>getiri</b>, para akışı değil: endeks
          serilerinde işlem hacmi güvenilir olmadığı için "şu sektöre şu kadar para girdi"
          denemiyor. Birbirini dışlayan sektörler; XU100 gibi ana endeksler ve üst kümeler listede
          yok.
        </span>
        <Select
          label="Getiri penceresi"
          value={String(bars)}
          onChange={(v) => setBars(Number(v))}
          options={DONEMLER.map((d) => ({ value: String(d.bars), label: d.ad }))}
        />
      </header>

      {durum === 'yukleniyor' ? <Skeleton count={6} height="18px" /> : null}

      {durum === 'yok' ? (
        <EmptyState
          icon={<Icon name="rank" />}
          title="Sektör endeksi yok"
          description="Bu piyasa için endeks paketi üretilmemiş."
        />
      ) : null}

      {durum === 'hata' ? (
        <EmptyState
          icon={<Icon name="rank" />}
          title="Sektör endeksleri yüklenemedi"
          description="Paket indirilemedi; sayfayı yenilemeyi deneyin."
          tone="error"
        />
      ) : null}

      {durum === 'hazir' && liste.length === 0 ? (
        <EmptyState
          icon={<Icon name="rank" />}
          title={`${donemAdi} için ölçülebilen sektör yok`}
          description="Seçilen pencereyi dolduracak kadar bar yok. Eksik veri sıfır getiri sayılmıyor."
        />
      ) : null}

      {durum === 'hazir' && liste.length > 0 ? (
        <>
          {ozet ? <p className="sektor__ozet">{ozet}</p> : null}
          <table className="sektor__tablo">
            <caption className="visually-hidden">
              {donemAdi} sektör endeksi getirileri, büyükten küçüğe
            </caption>
            <thead>
              <tr>
                <th scope="col">Sektör</th>
                <th scope="col">Endeks</th>
                <th scope="col" className="is-num">
                  {donemAdi}
                </th>
                <th scope="col">
                  <span className="visually-hidden">Getiri çubuğu</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.kod}>
                  <th scope="row">
                    {onSelect ? (
                      <button
                        type="button"
                        className="sektor__ad"
                        onClick={() => onSelect(s.kod)}
                        title={`${s.ad} endeksini (${s.kod}) grafikte aç`}
                      >
                        {s.ad}
                      </button>
                    ) : (
                      s.ad
                    )}
                  </th>
                  <td className="desk__muted">{s.kod}</td>
                  <td className={`is-num ${s.getiri >= 0 ? 'is-up' : 'is-down'}`}>
                    {trPct(s.getiri, 2, true)}
                  </td>
                  <td className="sektor__bar-hucre">
                    {/* Çubuk SIFIRDAN iki yöne: "az kazandı" ile "kaybetti"
                        aynı yöne uzayan iki çubukla ayırt edilemezdi. */}
                    <span className="sektor__bar" aria-hidden="true">
                      <span
                        className={s.getiri >= 0 ? 'is-up' : 'is-down'}
                        style={{ width: `${(Math.abs(s.getiri) / enBuyuk) * 50}%` }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
