/**
 * Kayıtlı taramanın "geçen sefere göre ne değişti" hesabı.
 *
 * Bu uygulamanın canlı bir akışı yok: veri, hattın ürettiği durağan bir
 * paket. Dolayısıyla "alarm" dürüst biçimde şu olabilir — kullanıcı taramayı
 * kaydettiğinde sonucu bir anlık görüntü olarak saklarız, uygulamayı bir
 * sonraki açışında YENİ VERİYLE aynı taramayı çalıştırıp farkı gösteririz.
 * Bildirim göndermiyoruz, göndereceğimizi de söylemiyoruz.
 *
 * Farkın anlamlı olması iki şarta bağlı ve ikisi de burada KONTROL EDİLİYOR:
 *
 * 1. Veri değişmiş olmalı. Aynı pakete bakarken çıkan fark piyasadan değil,
 *    bizim bir hatamızdan gelir; o yüzden aynı veride fark ARANMAZ.
 * 2. Kural değişmemiş olmalı. Kullanıcı filtreyi gevşettiyse "yeni giren
 *    sembol" piyasa hareketi değil, kullanıcının kendi değişikliğidir.
 */

export interface ScreenSnapshot {
  /** Kaydın adı — kayıtlı tarama listesindeki anahtar. */
  name: string;
  market: string;
  /** Taramanın paylaşılabilir kodu; kural/parametre/sektör kimliği. */
  code: string;
  /** Anlık görüntünün alındığı veri paketinin kimliği (hash ya da damga). */
  data: string;
  /** Verinin üretim damgası (saniye) — ekranda tarih olarak gösterilir. */
  generated: number;
  /** Eşleşen semboller, alfabetik. */
  symbols: string[];
}

export type DiffStatus =
  /** Elde anlık görüntü yok: karşılaştırılacak bir geçmiş yok. */
  | 'ilk-bakis'
  /** Veri paketi aynı: fark aranmadı. */
  | 'ayni-veri'
  /** Tarama tanımı değişmiş: fark piyasadan değil kullanıcıdan gelirdi. */
  | 'kural-degisti'
  /** Veri yeni, kural aynı: fark gerçek. */
  | 'degisti';

export interface ScreenDiff {
  status: DiffStatus;
  entered: string[];
  exited: string[];
  /** Her iki listede de olan sembol sayısı. */
  stayed: number;
  /** Karşılaştırılan anlık görüntünün üretim damgası (varsa). */
  since: number | null;
}

const EMPTY = { entered: [], exited: [], stayed: 0 };

/**
 * İki liste arasındaki giren/çıkan farkı. Girdi sırası önemsiz; çıktı
 * alfabetik, böylece ekran her açılışta aynı sırayı gösterir.
 */
export function diffScreen(previous: ScreenSnapshot | null, current: ScreenSnapshot): ScreenDiff {
  if (!previous) return { status: 'ilk-bakis', ...EMPTY, since: null };
  const since = previous.generated;
  if (previous.market !== current.market || previous.code !== current.code) {
    return { status: 'kural-degisti', ...EMPTY, since };
  }
  if (previous.data === current.data) {
    return { status: 'ayni-veri', ...EMPTY, since };
  }

  const before = new Set(previous.symbols);
  const after = new Set(current.symbols);
  const entered: string[] = [];
  const exited: string[] = [];
  for (const symbol of after) if (!before.has(symbol)) entered.push(symbol);
  for (const symbol of before) if (!after.has(symbol)) exited.push(symbol);
  const cmp = (a: string, b: string) => a.localeCompare(b, 'tr');

  return {
    status: 'degisti',
    entered: entered.sort(cmp),
    exited: exited.sort(cmp),
    stayed: [...after].filter((s) => before.has(s)).length,
    since,
  };
}

/** localStorage'dan okunan değer gerçekten anlık görüntü mü? */
export function isScreenSnapshot(value: unknown): value is ScreenSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<ScreenSnapshot>;
  return (
    typeof s.name === 'string' &&
    typeof s.market === 'string' &&
    typeof s.code === 'string' &&
    typeof s.data === 'string' &&
    typeof s.generated === 'number' &&
    Array.isArray(s.symbols) &&
    s.symbols.every((x) => typeof x === 'string')
  );
}

/** Anlık görüntü deposu — bozuk kayıtlar sessizce atılır (hepsi değil). */
export function readSnapshots(raw: string | null): Record<string, ScreenSnapshot> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, ScreenSnapshot> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isScreenSnapshot(value)) out[key] = value;
  }
  return out;
}

/** Depo anahtarı: aynı ad farklı piyasalarda farklı taramadır. */
export const snapshotKey = (market: string, name: string): string => `${market}|${name}`;
