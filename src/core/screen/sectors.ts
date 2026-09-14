import type { GroupFlow, PulseRow } from './pulse';

/**
 * Resmî sektör sınıflandırmasına göre para akışı.
 *
 * Kümeleme (`flowByCluster`) "birlikte hareket edenler" diyor; bu dosya
 * "aynı işi yapanlar" diyor. İkisi farklı sorulardır ve birbirinin yerine
 * geçmez: bir bankanın çimento şirketiyle aynı kümeye düşmesi mümkündür,
 * sektörü değişmez.
 *
 * Sınıflandırma dışarıdan (veri hattından) gelir. Gelmediğinde bu katman
 * boş döner; arayüz kümeleme görünümüne düşer ve nedenini söyler — sektör
 * UYDURULMAZ.
 */

export interface SectorMap {
  /** Sembol → sektör adı. */
  of: Record<string, string>;
  /** Kaynak ve üretim zamanı — ekranda gösterilir. */
  source: string;
  generated: number;
}

export interface SectorFlow extends Omit<GroupFlow, 'cluster'> {
  /** Sektör adı; sınıflandırması olmayanlar için 'Sınıflandırılmamış'. */
  sector: string;
  /** Toplam işlem değeri içindeki payı (%). */
  sharePct: number;
  /** Sektörün en çok işlem gören sembolü. */
  leader: string;
}

export const UNCLASSIFIED = 'Sınıflandırılmamış';

export function flowBySector(rows: PulseRow[], map: SectorMap | null): SectorFlow[] {
  if (!map) return [];

  const groups = new Map<string, PulseRow[]>();
  for (const row of rows) {
    // Sınıflandırması olmayan sembol GİZLENMEZ: ayrı bir grupta toplanır,
    // yoksa toplam işlem değeri sessizce küçülür ve paylar şişer.
    const sector = map.of[row.symbol] ?? UNCLASSIFIED;
    const list = groups.get(sector);
    if (list) list.push(row);
    else groups.set(sector, [row]);
  }

  let total = 0;
  for (const row of rows) total += row.value;

  const out: SectorFlow[] = [];
  for (const [sector, list] of groups) {
    let value = 0;
    let weighted = 0;
    let up = 0;
    let down = 0;
    let advancing = 0;
    let declining = 0;
    for (const row of list) {
      value += row.value;
      weighted += row.value * row.changePct;
      if (row.changePct > 0) {
        up += row.value;
        advancing++;
      } else if (row.changePct < 0) {
        down += row.value;
        declining++;
      }
    }
    out.push({
      sector,
      label: sector,
      leader: list.reduce((a, b) => (b.value > a.value ? b : a)).symbol,
      symbols: list.length,
      value,
      weightedChangePct: value ? weighted / value : NaN,
      flowPct: value ? ((up - down) / value) * 100 : NaN,
      sharePct: total ? (value / total) * 100 : NaN,
      advancing,
      declining,
    });
  }

  // Sınıflandırılmamış grup her zaman en sonda: bir sektör değil, bir eksik.
  return out.sort((a, b) => {
    if (a.sector === UNCLASSIFIED) return 1;
    if (b.sector === UNCLASSIFIED) return -1;
    return b.value - a.value;
  });
}

/** Kaç sembolün sınıflandırması var — kapsama oranı ekranda gösterilir. */
export function sectorCoverage(
  symbols: string[],
  map: SectorMap | null,
): { known: number; total: number; pct: number } {
  const total = symbols.length;
  if (!map || total === 0) return { known: 0, total, pct: 0 };
  let known = 0;
  for (const symbol of symbols) if (map.of[symbol]) known++;
  return { known, total, pct: (known / total) * 100 };
}

export function isSectorMap(value: unknown): value is SectorMap {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SectorMap>;
  return (
    typeof m.source === 'string' &&
    typeof m.generated === 'number' &&
    !!m.of &&
    typeof m.of === 'object'
  );
}
