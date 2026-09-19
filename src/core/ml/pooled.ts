import type { Candles } from '../data/types';
import { DEFAULT_BARRIERS, type BarrierOptions } from './labels';
import {
  buildSamples,
  evaluateSamples,
  type ModelResult,
  type Samples,
  type TrainRequest,
} from './model';

/**
 * Kesitsel (havuzlanmış) model — birden çok sembolün örnekleri tek havuzda.
 *
 * Tek sembolde model kartı haklı olarak "tek sembolde, tek dönemde ölçüldü"
 * uyarısı veriyordu: birkaç yüz örnek, tek bir hisseye özgü rejim. Havuz bu
 * uyarının ilk yarısını gerçekten kapatıyor — ama yeni bir tuzak açıyor ve
 * burada ona karşı iki önlem var:
 *
 * 1. **Ortak takvim ekseni.** Örnekler bar indeksine değil GÜNE göre sıralanır;
 *    katmanlar zaman bloklarıdır. Sembollere göre bölmek (ör. yarısı eğitim,
 *    yarısı test) aynı güne ait bilgiyi iki tarafta bırakır: piyasa genelinde
 *    güçlü bir gün, eğitimdeki A hissesinden testteki B hissesine sızar.
 * 2. **Sızıntı temizliği havuz genelinde.** Etiket penceresi test aralığıyla
 *    kesişen HER örnek atılır; hangi sembolden geldiğine bakılmaz.
 *
 * Semboller birbirinden bağımsız olmadığı için havuz, örnek sayısını
 * artırdığı kadar bağımsız bilgi artırmaz; kart bunu ayrıca yazıyor.
 */

export interface PooledInput {
  symbol: string;
  candles: Candles;
}

export interface PooledRequest extends TrainRequest {
  /** Havuza girmesi için sembol başına en az örnek sayısı. */
  minPerSymbol?: number;
}

export interface PooledResult extends ModelResult {
  /** Havuza giren ve elenen semboller (elenenler gizlenmez). */
  used: string[];
  skipped: { symbol: string; reason: string }[];
}

export function trainPooled(inputs: PooledInput[], request: PooledRequest = {}): PooledResult {
  const barriers: BarrierOptions = request.barriers ?? DEFAULT_BARRIERS;
  const minPerSymbol = request.minPerSymbol ?? 30;

  const used: string[] = [];
  const skipped: { symbol: string; reason: string }[] = [];
  const parts: Samples[] = [];

  for (const input of inputs) {
    const samples = buildSamples(input.candles, barriers, input.symbol);
    if (samples.rows.length < minPerSymbol) {
      skipped.push({
        symbol: input.symbol,
        reason: `yalnızca ${samples.rows.length} örnek (en az ${minPerSymbol})`,
      });
      continue;
    }
    used.push(input.symbol);
    parts.push(samples);
  }

  const pooled = mergeByDay(parts);
  // Canlı tahmin havuzda anlamsız: hangi sembol için? İstenirse tek sembol
  // kapsamında sorulur. Bu yüzden latest taşınmıyor.
  pooled.latest = null;

  const result = evaluateSamples(pooled, {
    ...request,
    barriers,
    symbols: used.length,
  });

  return { ...result, used, skipped };
}

/** Parçaları başlangıç gününe göre sıralı tek havuzda birleştirir. */
export function mergeByDay(parts: Samples[]): Samples {
  const order: { part: number; index: number; day: number }[] = [];
  parts.forEach((part, p) => {
    for (let i = 0; i < part.rows.length; i++) {
      order.push({ part: p, index: i, day: part.startDay[i] });
    }
  });
  // Katmanlar zaman bloğu olacağı için sıra ŞART: karışık sıralı bir havuzda
  // "ilk beşte bir" bir zaman aralığına karşılık gelmez.
  order.sort((a, b) => a.day - b.day || a.part - b.part || a.index - b.index);

  const out: Samples = {
    rows: [],
    y: [],
    startDay: [],
    endDay: [],
    ret: [],
    symbol: [],
    latest: null,
  };
  for (const item of order) {
    const part = parts[item.part];
    out.rows.push(part.rows[item.index]);
    out.y.push(part.y[item.index]);
    out.startDay.push(part.startDay[item.index]);
    out.endDay.push(part.endDay[item.index]);
    out.ret.push(part.ret[item.index]);
    out.symbol.push(part.symbol[item.index]);
  }
  return out;
}
