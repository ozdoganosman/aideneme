import { describe, expect, it } from 'vitest';
import { purgedFolds } from './cv';

/** i. örnek i. barda başlar, `span` bar sonra biter. */
function windows(n: number, span: number) {
  const start = Array.from({ length: n }, (_, i) => i);
  const end = start.map((s) => s + span);
  return { start, end };
}

describe('purged K-fold', () => {
  it('her örnek tam olarak bir kez test olur', () => {
    const { start, end } = windows(100, 0);
    const folds = purgedFolds(start, end, { k: 5, embargoBars: 0 });
    const seen = new Set<number>();
    for (const fold of folds) for (const i of fold.test) seen.add(i);
    expect(seen.size).toBe(100);
    expect(folds).toHaveLength(5);
  });

  it('örnekler örtüşmüyorsa ve embargo yoksa hiçbir şey atılmaz', () => {
    const { start, end } = windows(100, 0);
    const folds = purgedFolds(start, end, { k: 5, embargoBars: 0 });
    for (const fold of folds) {
      expect(fold.purged).toBe(0);
      expect(fold.train.length + fold.test.length).toBe(100);
    }
  });

  it('etiket penceresi test aralığıyla kesişen eğitim örneklerini atar', () => {
    // 10 barlık etiket penceresi: test sınırının iki yanındaki örnekler sızdırır.
    const { start, end } = windows(100, 10);
    const folds = purgedFolds(start, end, { k: 5, embargoBars: 0 });
    const middle = folds[2];
    expect(middle.purged).toBeGreaterThan(0);
    for (const i of middle.train) {
      const testFrom = Math.min(...middle.test.map((t) => start[t]));
      const testTo = Math.max(...middle.test.map((t) => end[t]));
      const overlaps = start[i] <= testTo && end[i] >= testFrom;
      expect(overlaps).toBe(false);
    }
  });

  it('embargo, testten sonraki barları da eğitimden çıkarır', () => {
    const { start, end } = windows(100, 0);
    const none = purgedFolds(start, end, { k: 5, embargoBars: 0 })[2];
    const some = purgedFolds(start, end, { k: 5, embargoBars: 5 })[2];
    expect(some.purged).toBeGreaterThan(none.purged);
    expect(some.train.length).toBeLessThan(none.train.length);
  });

  it('örnek sayısı katman sayısından azsa katman üretmez', () => {
    const { start, end } = windows(3, 0);
    expect(purgedFolds(start, end, { k: 5, embargoBars: 0 })).toEqual([]);
  });
});
