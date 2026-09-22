import { useState } from 'react';
import { EmptyState, Skeleton, trNum, trPct } from '../../ui';
import type { AnomaliKarnesi as Karne, KarneKovasi } from '../../core/screen/anomaliKarnesi';
import type { SectorMap } from '../../core/screen/sectors';
import type { Market } from '../../data-client/markets';
import type { AnalysisClient } from '../../workers/analysisClient';
import { trDayIndex } from '../../core/format/date';

interface Props {
  market: Market;
  client: AnalysisClient | null;
  /** `undefined` = sektör dosyasına henüz bakılmadı; `null` = yok. */
  sectors: SectorMap | null | undefined;
}

const KOVA_ADI: Record<KarneKovasi, string> = {
  hacim: 'Hacim patlaması',
  boslukYukari: 'Yukarı açılış boşluğu',
  boslukAsagi: 'Aşağı açılış boşluğu',
  kopmaYukari: 'Sektörden yukarı kopma',
  kopmaAsagi: 'Sektörden aşağı kopma',
  korelasyon: 'Korelasyon kırılması',
};

/** Hüküm için gereken en az olay; altı "az örnek". */
const EN_AZ_OLAY = 30;
const ANLAMLILIK = 0.05;
/**
 * Pratik eşik (yüzde puan): olay medyanı, aynı hisselerin sıradan günlerinden
 * en az bu kadar ayrışmalı. Gerçek veride görüldü: korelasyon kırılması 5
 * günde p = 0,02 ama medyan −0,01 — istatistiken "anlamlı", pratikte sıfır.
 * Öyle bir satırı "bulgu" diye öne çıkarmak yanıltıcıydı.
 */
const PRATIK_ESIK = 0.5;

function pYaz(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p < 0.001 ? '<0,001' : trNum(p, 3);
}

/**
 * ANOMALİNİN KARNESİ — "olağandışı" geçmişte işe yaradı mı?
 *
 * Radar bugünün listesini veriyor ve "olağandışı ≠ fırsat" diyor. Bu bölüm o
 * cümleyi veriyle sınıyor: geçmiş her gün radar o güne kurulmuş, listeye
 * düşenlerin sonraki 5 ve 20 günü piyasa medyanıyla kıyaslanmış (çekirdek:
 * core/screen/anomaliKarnesi.ts).
 *
 * AÇILINCA hesaplanıyor: gerçek veride ~0,6 sn (Node), zayıf makinede birkaç
 * saniye worker işi. Kullanıcının hiç açmayacağı bir tablo için ödenmemeli.
 *
 * Hüküm cümlesi yalnızca en az 30 olay VE p < 0,05 olan kovalar için; geri
 * kalanı tabloda duruyor ama "bir şey buldum" diye öne çıkarılmıyor.
 */
export function AnomaliKarnesi({ market, client, sectors }: Props) {
  const [karne, setKarne] = useState<(Karne & { ms: number }) | null>(null);
  const [durum, setDurum] = useState<'kapali' | 'yukleniyor' | 'hazir' | 'hata'>('kapali');
  const [istenen, setIstenen] = useState<string | null>(null);

  const anahtar = `${market}:${sectors ? sectors.generated : 'yok'}`;

  const iste = () => {
    if (!client || sectors === undefined || istenen === anahtar) return;
    setIstenen(anahtar);
    setDurum('yukleniyor');
    client
      .anomaliKarne(market, sectors ? sectors.of : null)
      .then((k) => {
        setKarne(k);
        setDurum('hazir');
      })
      .catch(() => setDurum('hata'));
  };

  const ufuklar = karne?.ufuklar ?? [];
  /** Hüküm: yeterli örnek, anlamlı VE pratikte ayrışan (kova × ufuk). */
  const bulgular = karne
    ? karne.satirlar.flatMap((s) =>
        ufuklar
          .map((h) => ({
            s,
            h,
            u: s.ufuk[h],
            fark: s.ufuk[h].medyanFazla - s.ufuk[h].kontrolFazla,
          }))
          .filter(
            ({ u, fark }) => u.n >= EN_AZ_OLAY && u.p < ANLAMLILIK && Math.abs(fark) >= PRATIK_ESIK,
          ),
      )
    : [];
  /** "yukarı açılış boşluğu (20 gün -%1,6)" — kova başına tek parça. */
  const grupla = (yon: 'geri' | 'ileri') => {
    const kovalar = new Map<KarneKovasi, string[]>();
    for (const b of bulgular) {
      if (b.fark < 0 !== (yon === 'geri')) continue;
      const l = kovalar.get(b.s.kova) ?? [];
      l.push(`${b.h} gün ${trPct(b.u.medyanFazla, 1, true)}`);
      kovalar.set(b.s.kova, l);
    }
    return [...kovalar].map(([k, l]) => `${KOVA_ADI[k].toLocaleLowerCase('tr')} (${l.join(', ')})`);
  };
  const geride = grupla('geri');
  const onde = grupla('ileri');

  return (
    <details
      className="anomali__karne"
      data-durum={durum}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) iste();
      }}
    >
      <summary>Bu sinyaller geçmişte ne yaptı? — karne</summary>

      {durum === 'yukleniyor' ? (
        <div aria-live="polite">
          <p className="desk__muted">Geçmiş her gün için radar yeniden kuruluyor…</p>
          <Skeleton count={4} />
        </div>
      ) : null}
      {durum === 'hata' ? <EmptyState tone="error" title="Karne hesaplanamadı" /> : null}

      {durum === 'hazir' && karne ? (
        <>
          <p className="anomali__karne-ozet" aria-live="polite">
            {trDayIndex(karne.basGun)} – {trDayIndex(karne.sonGun)} ({karne.degerlendirilenGun}{' '}
            gün):{' '}
            {bulgular.length === 0
              ? 'hiçbir sinyal, sonrasında piyasadan belirgin biçimde ayrışmadı.'
              : [
                  geride.length
                    ? `sonrasında piyasanın gerisinde kalanlar — ${geride.join('; ')}`
                    : '',
                  onde.length ? `önünde kalanlar — ${onde.join('; ')}` : '',
                ]
                  .filter(Boolean)
                  .join('. ') + '.'}
          </p>

          {/* Dar ekranda kendi içinde kayıyor: klavyeyle de kaydırılabilsin
              (VirtualTable ile aynı kalıp). */}
          <div
            className="anomali__karne-kaydir"
            tabIndex={0}
            role="region"
            aria-label="Karne tablosu"
          >
            <table className="anomali__tablo" aria-label="Anomali sinyallerinin geçmiş karnesi">
              <thead>
                <tr>
                  <th scope="col">Sinyal</th>
                  <th scope="col" className="num">
                    Olay
                  </th>
                  {ufuklar.map((h) => (
                    <th key={h} scope="col" className="num">
                      {h} gün sonra
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {karne.satirlar.map((s) => (
                  <tr key={s.kova}>
                    <th scope="row">{KOVA_ADI[s.kova]}</th>
                    <td className="num">{s.olay}</td>
                    {ufuklar.map((h) => {
                      const u = s.ufuk[h];
                      if (u.n === 0) {
                        return (
                          <td key={h} className="num desk__muted">
                            olay yok
                          </td>
                        );
                      }
                      return (
                        <td key={h} className="num">
                          <span className="anomali__karne-deger">
                            {trPct(u.medyanFazla, 2, true)} · isabet {trPct(u.isabet * 100, 0)}
                          </span>
                          <span className="anomali__karne-alt desk__muted">
                            sıradan günler {trPct(u.kontrolFazla, 2, true)} · p {pYaz(u.p)}
                            {u.n < EN_AZ_OLAY ? ' · az örnek' : ''}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="anomali__karne-notlar desk__muted">
            <li>
              Sayı: olay günü kapanışından {ufuklar.join(' / ')} gün sonrasına getiri, eksi aynı
              günün piyasa medyanı (fazla getiri). “İsabet”: fazla getirisi pozitif olayların payı.
            </li>
            <li>
              “Sıradan günler”: aynı hisselerin olay olmayan günlerdeki medyanı. Olay medyanı buna
              yakınsa sonuç sinyalden değil hissenin kendisinden geliyordur.
            </li>
            <li>
              Özette yalnızca en az {EN_AZ_OLAY} olaylı, p &lt; 0,05 ve sıradan günlerden en az{' '}
              {trNum(PRATIK_ESIK, 1)} puan ayrışan sonuçlar var. p, gün başına ortalamanın işaret
              testi (aynı günün olayları bağımsız değil). Pencereler üst üste bindiği için yine de
              biraz iyimser.
            </li>
            <li>
              Yalnızca bugün işlem gören hisseler var; aradan kotasyondan çıkanlar yok (hayatta
              kalma yanlılığı). Tek dönem: başka bir piyasa rejiminde sonuç farklı olabilir.
            </li>
          </ul>
        </>
      ) : null}
    </details>
  );
}
