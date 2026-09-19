/**
 * Purged K-Fold + embargo — finansal veride tek dürüst çapraz doğrulama.
 *
 * Sıradan K-fold burada YALAN söyler: örnekler zaman içinde örtüşür. Eğitim
 * kümesindeki bir örneğin etiketi, test kümesindeki bir barın geleceğinden
 * beslenebilir; model "öğrenmez", sızdırır. İki düzeltme:
 *
 *   purge   — etiket aralığı test aralığıyla KESİŞEN eğitim örnekleri atılır.
 *   embargo — testten hemen sonraki birkaç bar da eğitimden çıkarılır
 *             (seri bağımlılık test sınırının hemen ötesine taşar).
 *
 * Saf fonksiyon; sonuç yalnızca (n, k, embargo, aralıklar) girdisine bağlıdır.
 */

export interface Fold {
  /** Test örneklerinin (etiket dizisindeki) indeksleri. */
  test: number[];
  /** Eğitim örneklerinin indeksleri — purge ve embargo uygulanmış. */
  train: number[];
  /** Sızıntı riski nedeniyle atılan eğitim örneği sayısı. */
  purged: number;
}

export interface PurgedFoldOptions {
  /** Kaç katman. */
  k: number;
  /** Testten sonra karantinaya alınacak bar sayısı. */
  embargoBars: number;
}

/**
 * @param start   her örneğin başladığı bar (giriş barı)
 * @param end     her örneğin kesinleştiği bar (bariyere değme)
 */
export function purgedFolds(
  start: ArrayLike<number>,
  end: ArrayLike<number>,
  options: PurgedFoldOptions,
): Fold[] {
  const n = start.length;
  const k = Math.max(2, Math.floor(options.k));
  const embargo = Math.max(0, Math.floor(options.embargoBars));
  if (n < k) return [];

  const folds: Fold[] = [];
  const size = Math.floor(n / k);

  for (let f = 0; f < k; f++) {
    const from = f * size;
    const to = f === k - 1 ? n : (f + 1) * size;

    const test: number[] = [];
    let testFrom = Infinity;
    let testTo = -Infinity;
    for (let i = from; i < to; i++) {
      test.push(i);
      if (start[i] < testFrom) testFrom = start[i];
      if (end[i] > testTo) testTo = end[i];
    }

    const train: number[] = [];
    let purged = 0;
    for (let i = 0; i < n; i++) {
      if (i >= from && i < to) continue;
      // Kesişim: [start_i, end_i] ile [testFrom, testTo + embargo] çakışıyor mu?
      const overlaps = start[i] <= testTo + embargo && end[i] >= testFrom;
      if (overlaps) {
        purged++;
        continue;
      }
      train.push(i);
    }

    folds.push({ test, train, purged });
  }

  return folds;
}
