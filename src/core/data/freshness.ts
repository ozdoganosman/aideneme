import { weekdaysBetween } from './health';

/**
 * Piyasa verisinin yaşı — "Gecikmeli veri" rozetinin ölçülmüş hâli.
 *
 * Kabuğun üst çubuğundaki rozet SABİT metindi: veri bir gün de bir yıl da
 * eski olsa aynı şeyi yazıyordu. Ölçüldü: örnek veri setinde en yeni bar
 * 2025-09-28, "bugün" 2026-09-14 — yani dokuz ekranın yedisi neredeyse bir
 * yıllık veriyi "Piyasada bugün ne oluyor?" başlığı altında sunuyordu.
 * Bayatlık `health.ts`'te zaten hesaplanıyordu ama yalnızca SEMBOL bazlı iki
 * ekrana ulaşıyordu; piyasa geneli iddiada bulunan ekranlarda hiç yoktu.
 *
 * Burada takvim/ağ yok: "bugün" çağırandan gelir, fonksiyon saf kalır.
 */

export type FreshnessLevel = 'taze' | 'gecikmeli' | 'bayat';

export interface Freshness {
  /** Piyasadaki EN YENİ bar (epoch gün); veri yoksa null. */
  lastDay: number | null;
  /** Son bardan bugüne hafta içi gün sayısı. */
  ageWeekdays: number;
  level: FreshnessLevel;
  /** Rozetin üstündeki kısa metin. */
  label: string;
  /** Rozetin başlığı (tooltip) — yasal uyarı burada korunuyor. */
  detail: string;
}

export interface FreshnessOptions {
  /** "Bugün" — epoch gün. */
  today: number;
  /** Bu kadar hafta içi güne kadar taze sayılır (borsa kapanışı + üretim gecikmesi). */
  freshWeekdays?: number;
  /** Bunun üstü bayat. */
  staleWeekdays?: number;
}

const DISCLAIMER = 'Veriler gecikmelidir; yatırım tavsiyesi değildir.';

const trDate = (day: number): string =>
  new Date(day * 86_400_000).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Sembollerin son bar günlerinden piyasanın tazeliği.
 *
 * EN YENİ bar alınıyor, ortanca değil: bir sembolün işlem görmemesi piyasanın
 * tamamını bayat yapmaz. Tersi de doğru — en yeni bar eskiyse hiçbir sembolde
 * daha yenisi yoktur, yani bu ölçü iyimser tarafta yanılmaz.
 */
export function marketFreshness(lastDays: readonly number[], options: FreshnessOptions): Freshness {
  const { today, freshWeekdays = 1, staleWeekdays = 3 } = options;

  let lastDay: number | null = null;
  for (const day of lastDays) {
    if (!Number.isFinite(day)) continue;
    if (lastDay === null || day > lastDay) lastDay = day;
  }

  if (lastDay === null) {
    return {
      lastDay: null,
      ageWeekdays: 0,
      level: 'bayat',
      label: 'Veri yok',
      detail: `Piyasa için hiç bar bulunamadı. ${DISCLAIMER}`,
    };
  }

  // [lastDay + 1, today + 1): son barın ERTESİ gününden bugün DAHİL.
  const ageWeekdays = weekdaysBetween(lastDay + 1, today + 1);
  const shown = trDate(lastDay);

  if (ageWeekdays <= freshWeekdays) {
    return {
      lastDay,
      ageWeekdays,
      level: 'taze',
      label: `Veri ${shown}`,
      detail: `Son bar ${shown}. ${DISCLAIMER}`,
    };
  }

  if (ageWeekdays <= staleWeekdays) {
    return {
      lastDay,
      ageWeekdays,
      level: 'gecikmeli',
      label: `Veri ${shown}`,
      detail: `Son bar ${shown} — ${ageWeekdays} hafta içi gün geride. ${DISCLAIMER}`,
    };
  }

  return {
    lastDay,
    ageWeekdays,
    level: 'bayat',
    label: `Veri ${ageWeekdays} iş günü eski`,
    detail:
      `Son bar ${shown} — ${ageWeekdays} hafta içi gün geride. Ekrandaki tüm ` +
      `hesaplar bu tarihe aittir, bugüne değil. ${DISCLAIMER}`,
  };
}
