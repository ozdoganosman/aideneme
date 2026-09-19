import { useEffect, useState } from 'react';
import { Badge } from '../ui';
import { Icon } from '../ui/icons';
import { marketFreshness, type Freshness as FreshnessInfo } from '../core/data/freshness';
import { dataClient } from '../data-client/client';
import { MARKETS, type Market } from '../data-client/markets';

/**
 * Üst çubuktaki veri tazeliği rozeti.
 *
 * Eskiden burada SABİT "Gecikmeli veri" yazıyordu: veri bir gün de bir yıl da
 * eski olsa aynı metin. Ölçüldü — örnek veri setinde en yeni bar 2025-09-28,
 * "bugün" 2026-09-14; dokuz ekranın yedisi bu veriyi hiçbir uyarı olmadan
 * "Piyasada bugün ne oluyor?" başlığı altında gösteriyordu. Bayatlık zaten
 * hesaplanıyordu ama yalnızca sembol bazlı iki ekrana (Sembol Masası, Rapor)
 * ulaşıyordu.
 *
 * Manifest oturumda bir kez iniyor (istemci önbelleklemiyor, tazelik ölçüsü
 * odur), yani bu rozet ek ağ maliyeti getirmiyor.
 */

const TONE = { taze: 'up', gecikmeli: 'warn', bayat: 'down' } as const;

export function FreshnessBadge({ market }: { market: string }) {
  const [info, setInfo] = useState<FreshnessInfo | null>(null);

  useEffect(() => {
    if (!(MARKETS as string[]).includes(market)) return;
    let cancelled = false;
    dataClient
      .manifest(market as Market)
      .then((manifest) => {
        if (cancelled) return;
        const lastDays = Object.values(manifest.symbols).map((entry) => entry.d1);
        setInfo(marketFreshness(lastDays, { today: Math.floor(Date.now() / 86_400_000) }));
      })
      // Manifest inmezse ekranların kendi hata durumları zaten konuşuyor;
      // rozet yasal uyarıyı taşıyan bilinen hâline düşüyor.
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [market]);

  if (!info) {
    return (
      <Badge
        tone="warn"
        icon={<Icon name="alert" size={12} />}
        title="Veriler gecikmelidir; yatırım tavsiyesi değildir."
      >
        Gecikmeli veri
      </Badge>
    );
  }

  return (
    <Badge tone={TONE[info.level]} icon={<Icon name="alert" size={12} />} title={info.detail}>
      {info.label}
    </Badge>
  );
}
