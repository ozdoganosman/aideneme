import { useEffect, useState } from 'react';
import { Badge, EmptyState, Skeleton, trCompact, trNum, trPct } from '../../ui';
import {
  ANOMALI_TURLERI,
  ANOMALI_VARSAYILAN,
  type AnomaliSatiri,
  type AnomaliSonucu,
  type AnomaliTuru,
} from '../../core/screen/anomali';
import type { SectorMap } from '../../core/screen/sectors';
import type { Market } from '../../data-client/markets';
import type { AnalysisClient } from '../../workers/analysisClient';
import { trDayIndex } from '../../core/format/date';
import { Prov } from '../Prov';

interface Props {
  market: Market;
  /** Hazır worker istemcisi; yoksa panel bekler. */
  client: AnalysisClient | null;
  /** `undefined` = sektör dosyasına henüz bakılmadı; `null` = yok. */
  sectors: SectorMap | null | undefined;
  onSelect: (symbol: string) => void;
}

/** Listede gösterilen en fazla satır; kalanı sayıyla söyleniyor. */
const EN_FAZLA = 40;

const TUR_ADI: Record<AnomaliTuru, string> = {
  hacim: 'Hacim patlaması',
  bosluk: 'Açılış boşluğu',
  kopma: 'Sektörden kopma',
  korelasyon: 'Korelasyon kırılması',
};

/** Tetiklenen sinyalin sayısal ifadesi — "ne kadar alışılmadık". */
function deger(s: AnomaliSatiri, t: AnomaliTuru): string {
  switch (t) {
    case 'hacim':
      return `${trNum(s.hacimZ, 1)}σ`;
    case 'bosluk':
      return `${trPct(s.bosluk, 1, true)} · ${trNum(Math.abs(s.boslukZ), 1)}σ`;
    case 'kopma':
      return `${trNum(s.kopma, 1)} puan · ${trNum(Math.abs(s.kopmaZ), 1)}σ`;
    case 'korelasyon':
      return `${trNum(s.korUzun, 2)} → ${trNum(s.korKisa, 2)}`;
  }
}

/**
 * Rozet rengi OLGUNUN işareti: boşluk yukarı mı aşağı mı. Bu bir yön tavsiyesi
 * değil; hacim patlamasının yönü yok, korelasyon kırılması uyarı tonunda.
 */
function ton(s: AnomaliSatiri, t: AnomaliTuru): 'accent' | 'up' | 'down' | 'warn' {
  switch (t) {
    case 'hacim':
      return 'accent';
    case 'bosluk':
      return s.bosluk >= 0 ? 'up' : 'down';
    case 'kopma':
      return s.kopma >= 0 ? 'up' : 'down';
    case 'korelasyon':
      return 'warn';
  }
}

/**
 * ANOMALİ RADARI — "bugün olağandışı ne var?"
 *
 * Nabız'ın öteki panelleri piyasanın BÜTÜNÜNÜ anlatıyor (genişlik, akış,
 * sektör). Bu panel tekil hisseye iniyor ama tarayıcının tersinden: kullanıcı
 * koşul yazmıyor, hisse kendi alışkanlığının dışına çıkınca listeye giriyor.
 * Eşikler mutlak değil, sembolün kendi 60 günlük sapmasına göre (çekirdek:
 * core/screen/anomali.ts).
 *
 * OLAĞANDIŞI ≠ FIRSAT: panel bunu yazıyor ve yön vermiyor. Satır, grafiğe
 * götürür; kararı orada kullanıcı verir.
 *
 * Ölçülemeyenler ayrı sayılıyor: "bulunmadı" ile "bakılamadı" farklı. Sektör
 * dosyası yoksa iki sinyal (kopma, korelasyon) hiç ölçülemez ve bu söyleniyor.
 */
export function AnomaliRadari({ market, client, sectors, onSelect }: Props) {
  const [sonuc, setSonuc] = useState<(AnomaliSonucu & { ms: number }) | null>(null);
  const [durum, setDurum] = useState<'bekliyor' | 'hazir' | 'hata'>('bekliyor');

  useEffect(() => {
    // Sektör dosyasına bakılmadan hesaplanmıyor: bakılmadan koşturulsa sonra
    // ikinci kez koşturmak gerekirdi (kopma/korelasyon sektör ister).
    if (!client || sectors === undefined) return;
    let iptal = false;
    setDurum('bekliyor');
    client
      .anomali(market, sectors ? sectors.of : null)
      .then((r) => {
        if (iptal) return;
        setSonuc(r);
        setDurum('hazir');
      })
      .catch(() => {
        if (!iptal) setDurum('hata');
      });
    return () => {
      iptal = true;
    };
  }, [client, market, sectors]);

  const a = ANOMALI_VARSAYILAN;
  const satirlar = sonuc?.satirlar ?? [];
  const gorunen = satirlar.slice(0, EN_FAZLA);
  const yayginlar = sonuc ? ANOMALI_TURLERI.filter((t) => sonuc.yaygin[t]) : [];

  return (
    <section className="pulse__panel anomali" aria-label="Anomali radarı" data-durum={durum}>
      <header>
        <h2>Bugün olağandışı ne var?</h2>
        <Prov label="Anomali radarı">
          <p>
            Her sinyal sembolün <strong>kendi</strong> son {a.pencere} gününe göre ölçülüyor; piyasa
            geneli için sabit bir eşik yok. Tetik: {a.zEsik} standart sapma (σ).
          </p>
          <ul>
            <li>
              <strong>Hacim patlaması:</strong> bugünkü işlem değerinin (logaritmik) z-skoru ≥{' '}
              {a.zEsik}. Yalnızca yüksek taraf sayılıyor.
            </li>
            <li>
              <strong>Açılış boşluğu:</strong> açılış ÷ önceki kapanış − 1; kendi boşluk geçmişine
              göre |z| ≥ {a.zEsik} ve boşluk en az %{a.boslukTaban}.
            </li>
            <li>
              <strong>Sektörden kopma:</strong> bugünkü değişim − sektör medyanı; kendi sapma
              geçmişine göre |z| ≥ {a.zEsik} ve fark en az {a.kopmaTaban} puan. Sektör dosyası ve en
              az {a.enAzSektor} işlem görmüş üye gerekir.
            </li>
            <li>
              <strong>Korelasyon kırılması:</strong> sektör medyanıyla korelasyon son {a.korUzun}{' '}
              günde en az {trNum(a.korTaban, 2)} iken son {a.korKisa} günde en az{' '}
              {trNum(a.korDusus, 2)} düşmüş.
            </li>
          </ul>
          <p>
            En az {a.enAzGozlem} gözlemi olmayan sinyal <em>ölçülemedi</em> sayılır; sıradan
            sayılmaz.
          </p>
        </Prov>
        {sonuc ? (
          <span className="desk__muted">
            {trDayIndex(sonuc.gun)} · {sonuc.denenen} sembol denendi
          </span>
        ) : null}
      </header>

      <p className="anomali__not desk__muted">
        Olağandışı ≠ fırsat. Bu bir sıralama değil, dikkat listesi: hacim patlaması alımın da
        satımın da izi olabilir. Satır grafiğe götürür; karar orada verilir.
      </p>

      {durum === 'bekliyor' ? <Skeleton count={3} /> : null}
      {durum === 'hata' ? <EmptyState tone="error" title="Anomali hesabı yapılamadı" /> : null}

      {durum === 'hazir' && sonuc ? (
        <>
          {yayginlar.length > 0 ? (
            <p className="anomali__yaygin" role="note">
              <strong>Bugün piyasa geneline yayılmış:</strong>{' '}
              {yayginlar
                .map(
                  (t) =>
                    `${TUR_ADI[t].toLocaleLowerCase('tr')} ${sonuc.tetiklenen[t]} sembolde (%${trNum(
                      (100 * sonuc.tetiklenen[t]) / sonuc.denenen,
                      0,
                    )})`,
                )
                .join(', ')}
              . Bu kadar yaygın bir sinyal piyasa olayıdır, tekil olağandışılık değil; yalnızca
              bununla tetiklenen {sonuc.yayginSatir} sembol listeye alınmadı.
            </p>
          ) : null}
          {gorunen.length === 0 ? (
            <EmptyState
              title="Bugün kendi geçmişinin dışına çıkan sembol yok"
              description={
                sonuc.yayginSatir > 0
                  ? 'Piyasa geneline yayılmış sinyaller dışında hiçbir sembol kendi dağılımının dışına çıkmadı.'
                  : 'Denenen her sembol kendi 60 günlük dağılımının içinde kaldı.'
              }
            />
          ) : (
            <table className="anomali__tablo" aria-label="Olağandışı semboller">
              <thead>
                <tr>
                  <th scope="col">Sembol</th>
                  <th scope="col">Sektör</th>
                  <th scope="col" className="num">
                    Değişim
                  </th>
                  <th scope="col" className="num">
                    İşlem değeri
                  </th>
                  <th scope="col">Neden olağandışı</th>
                </tr>
              </thead>
              <tbody>
                {gorunen.map((s) => (
                  <tr key={s.symbol}>
                    <td>
                      <button
                        type="button"
                        className="anomali__sembol"
                        onClick={() => onSelect(s.symbol)}
                        aria-label={`${s.symbol} grafiğini aç`}
                      >
                        {s.symbol}
                      </button>
                    </td>
                    <td>{s.sektor ?? '—'}</td>
                    <td className="num">{trPct(s.degisim, 2, true)}</td>
                    <td className="num">{trCompact(s.deger)}</td>
                    <td>
                      <span className="anomali__nedenler">
                        {s.tetikler.map((t) => (
                          <Badge
                            key={t}
                            tone={sonuc.yaygin[t] ? 'neutral' : ton(s, t)}
                            title={
                              sonuc.yaygin[t] ? 'Bugün piyasa geneline yayılmış sinyal' : undefined
                            }
                          >
                            {TUR_ADI[t]} · {deger(s, t)}
                          </Badge>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {satirlar.length > gorunen.length ? (
            <p className="anomali__kapsam desk__muted">
              En şiddetli {gorunen.length} satır gösteriliyor; {satirlar.length - gorunen.length}{' '}
              satır daha var.
            </p>
          ) : null}
          <p className="anomali__kapsam desk__muted">
            Ölçülemeyen — hacim {sonuc.olculemeyen.hacim} · boşluk {sonuc.olculemeyen.bosluk} ·
            sektörden kopma {sonuc.olculemeyen.kopma} · korelasyon {sonuc.olculemeyen.korelasyon}
            {sonuc.islemGormeyen > 0 ? ` · bugün işlem görmeyen ${sonuc.islemGormeyen}` : ''}
            {sectors === null
              ? '. Sektör dosyası yok: kopma ve korelasyon hiçbir sembolde ölçülemedi.'
              : '.'}
          </p>
        </>
      ) : null}
    </section>
  );
}
