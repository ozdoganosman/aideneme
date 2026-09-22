import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Select, Skeleton, trNum, trPct } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  ESLESME_ESIGI,
  resmiSektorunHisseleri,
  sektorGetirileri,
  sektorOzeti,
  sektorunHisseleri,
  type SektorEslesmesi,
  type SektorGetirisi,
} from '../../core/screen/sectorIndices';
import type { SectorMap } from '../../core/screen/sectors';
import { sectorsClient } from '../../data-client/sectors';
import { dataClient } from '../../data-client/client';
import type { Market } from '../../data-client/markets';
import type { Candles } from '../../core/data/types';
import type { AnalysisClient } from '../../workers/analysisClient';

interface Props {
  market: Market;
  /** Sektöre tıklanınca endeksi grafikte açar. */
  onSelect?: (symbol: string) => void;
  /** Hazır worker istemcisi — eşleşme hesabı ORADA yapılıyor. */
  client?: AnalysisClient | null;
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
 * Neden burada: sektörün nasıl gittiğini uydurmadan borsanın resmî
 * endeksinden okuyoruz — BIST'in alt sektör endeksleri veri setimizde ve tam
 * geçmişleriyle duruyor.
 *
 * SEKTÖRÜN HİSSELERİ sütunu RESMÎ sınıflandırmadan (`sectors.json`) geliyor.
 * Önce korelasyon vekilinden geliyordu; resmî dosya üretilebilir hâle gelince
 * ölçtüm: vekil 584 hissenin 35'ini (%6), resmî dosya 496'sını (%85) bir
 * sektöre bağlıyor. Aynı ekranın hemen üstündeki akış tablosu zaten resmî
 * dosyayı kullanıyordu; iki farklı üyeliği yan yana göstermek zayıf olanı
 * yetkili gibi okuturdu. Vekil yalnızca resmî dosya YOKKEN devreye giriyor
 * ve arayüz hangisinin konuştuğunu yazıyor.
 *
 * GETİRİ, AKIŞ DEĞİL: endeks serilerinde hacim güvenilir değil (ölçüldü —
 * yayındaki veride endekslerin işlem değeri 0). Bu yüzden "şu sektöre şu kadar
 * para girdi" demiyoruz. Başlık da açıklama da bunu söylüyor.
 *
 * Paket AYRI ve küçük (~140 KB): endeksler tarama evreninden çıkarıldığı için
 * ana pakette yoklar, tek tek seri dosyaları ise tam geçmiş taşıdığından aynı
 * iş ~1,8 MB olurdu.
 */
export function SektorEndeksleri({ market, onSelect, client }: Props) {
  const [seriler, setSeriler] = useState<Map<string, Candles> | null>(null);
  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'yok' | 'hata'>('yukleniyor');
  const [bars, setBars] = useState(21);
  const [eslesmeler, setEslesmeler] = useState<SektorEslesmesi[] | null>(null);
  const [degerlendirilen, setDegerlendirilen] = useState(0);
  /** Resmî sınıflandırma; `undefined` = henüz bakılmadı, `null` = yok. */
  const [resmi, setResmi] = useState<SectorMap | null | undefined>(undefined);

  useEffect(() => {
    let iptal = false;
    setResmi(undefined);
    sectorsClient
      .map(market)
      .then((m) => {
        if (!iptal) setResmi(m);
      })
      .catch(() => {
        if (!iptal) setResmi(null);
      });
    return () => {
      iptal = true;
    };
  }, [market]);

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

  /**
   * EŞLEŞME — hangi hisse hangi sektör endeksiyle birlikte hareket ediyor.
   *
   * Worker'da: gerçek veride 599 hisse × 23 endeks 246 ms sürüyor ve bu ana
   * iş parçacığında zayıf makinede ~1,5 saniyelik donma demek. Panelin
   * GETİRİ tablosu bu hesabı BEKLEMİYOR; eşleşme geldiğinde sütun ekleniyor.
   */
  useEffect(() => {
    // Resmî dosya varken korelasyon hesabı HİÇ YAPILMIYOR. Yalnızca doğruluk
    // değil, maliyet meselesi de: gerçek veride 599 hisse × 23 endeks 246 ms
    // worker işi ve ayrıca endeks paketinin indirilmesi demek. Zayıf makinede
    // kullanılmayacak bir sonuç için ödenecek bedel değil.
    if (!client || resmi === undefined || resmi) return;
    let iptal = false;
    setEslesmeler(null);

    (async () => {
      try {
        const buf = await dataClient.indexBundleBuffer(market);
        if (iptal || !buf) return;
        const { matches, evaluated } = await client.sectorMatch(market, buf);
        if (iptal) return;
        setEslesmeler(matches);
        setDegerlendirilen(evaluated);
      } catch {
        // Eşleşme İSTEĞE BAĞLI bir zenginleştirme: hesaplanamazsa getiri
        // tablosu olduğu gibi kalıyor, hata mesajı gösterilmiyor.
        if (!iptal) setEslesmeler([]);
      }
    })();

    return () => {
      iptal = true;
    };
  }, [market, client, resmi]);

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
          {resmi ? (
            <>
              {' '}
              {/*
                İDDİA KAYNAĞIN, BİZİM DEĞİL. Burada "borsanın kendi bileşen
                listesi, tahmin değil" yazıyordu — oysa cümle dosyanın
                KİMLİĞİNE bakmadan kuruluyordu. Örnek veriyle çalıştırınca
                ortaya çıktı: "Sentetik (yerel) dosyasından: borsanın kendi
                endeks bileşen listesi" diyordu, yani sentetik bir dosyayı
                borsanın resmî listesi diye sunuyordu. Artık yalnızca kaynağın
                adı yazılıyor; ne olduğunu ad söylüyor.
              */}
              <b>Sektörün hisseleri</b> {resmi.source} sınıflandırmasından.
            </>
          ) : eslesmeler && eslesmeler.length > 0 ? (
            <>
              {' '}
              <b>Birlikte hareket edenler</b> resmî sektör üyeliği DEĞİL: günlük getirisi o endeksle
              en çok örtüşen hisseler (korelasyon ≥ {trNum(ESLESME_ESIGI, 2)}). Resmî sınıflandırma
              dosyası bu piyasada yok, bu yüzden vekil ölçü kullanılıyor. Eşiği geçmeyen hisse
              hiçbir sektöre yazılmıyor — zayıf bir benzerliğe sektör etiketi yapıştırmak yanlış
              bilgi olurdu.
            </>
          ) : null}
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
          {/*
            KAPSAMA açıkça yazılıyor. Eşik yüksek olduğu için hisselerin
            küçük bir kısmı eşleşiyor; bunu söylemezsek "Bilişim — hiç hisse
            yok" satırı "BIST'te bilişim hissesi yok" diye okunabilir.
          */}
          {resmi ? (
            <p className="sektor__ozet desk__muted">
              {Object.keys(resmi.of).length} hisse resmî olarak bir sektöre bağlı. Sınıflandırması
              olmayan hisse bir sektöre YAZILMIYOR.
            </p>
          ) : eslesmeler && degerlendirilen > 0 ? (
            <p className="sektor__ozet desk__muted">
              {degerlendirilen} hissenin {eslesmeler.length} tanesi bir sektör endeksiyle eşiği
              geçecek kadar örtüşüyor. Kalanı bir sektöre YAZILMADI — eşleşmedikleri için, o
              sektörde hisse olmadığı için değil.
            </p>
          ) : null}
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
                {resmi ? (
                  <th scope="col">Sektörün hisseleri</th>
                ) : eslesmeler ? (
                  <th scope="col">Birlikte hareket edenler</th>
                ) : null}
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
                  {resmi ? (
                    <td>
                      {(() => {
                        const liste = resmiSektorunHisseleri(resmi.of, s.ad);
                        if (liste.length === 0) return <span className="desk__muted">—</span>;
                        const baslik = liste.slice(0, 12).join(', ');
                        return <span title={baslik}>{liste.length} hisse</span>;
                      })()}
                    </td>
                  ) : eslesmeler ? (
                    <td>
                      {(() => {
                        const h = sektorunHisseleri(eslesmeler, s.kod);
                        if (h.length === 0) return <span className="desk__muted">—</span>;
                        const baslik = h
                          .slice(0, 12)
                          .map((e) => `${e.symbol} (${trNum(e.korelasyon, 2)})`)
                          .join(', ');
                        return <span title={baslik}>{h.length} hisse</span>;
                      })()}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
