/**
 * Korelasyon matrisi + hiyerarşik kümeleme.
 *
 * Referans projede bu iş "en yüksek Pearson'lu ilk N çift" tablosuydu; çiftler
 * listesi piyasanın YAPISINI göstermez. Burada tam matris hesaplanıp ortalama
 * bağlantılı (average linkage) kümelemeyle yaprak sırası çıkarılıyor: ısı
 * haritası bu sırayla çizildiğinde birlikte hareket eden gruplar köşegende
 * blok blok görünür.
 *
 * Saf: girdi hizalanmış kapanış ızgarası (paket dosyasının verdiği biçim).
 */

export interface AlignedCloses {
  symbols: string[];
  /** Sembol başına bar sayısı (ortak gün ekseni). */
  bars: number;
  /** symbols.length × bars, satır = sembol; veri yoksa NaN. */
  close: ArrayLike<number>;
}

export interface CorrelationResult {
  symbols: string[];
  /** n × n, satır-öncelikli; hesaplanamayan çiftler NaN. */
  matrix: Float64Array;
  /** Her çift için kullanılan ortak gözlem sayısı (n × n). */
  pairs: Int32Array;
}

export interface CorrelationOptions {
  /** Bu kadar ortak getiriden az olan çiftler NaN bırakılır. */
  minPairs?: number;
  /** Son N barı kullan (0 = tümü). */
  lookback?: number;
}

/**
 * Pearson korelasyonu — logaritmik getiriler üzerinde, çift bazında eksikleri
 * atlayarak. Fiyat seviyeleri üzerinden korelasyon iki trendli seriyi her zaman
 * ~1 gösterir; getiri üzerinden hesaplamak birlikte HAREKET etmeyi ölçer.
 */
export function correlationMatrix(
  input: AlignedCloses,
  options: CorrelationOptions = {},
): CorrelationResult {
  const { minPairs = 30, lookback = 0 } = options;
  const n = input.symbols.length;
  const bars = input.bars;
  const from = lookback > 0 ? Math.max(0, bars - lookback) : 0;
  const width = bars - from;

  // Getiri ızgarası: NaN = o bar için getiri yok.
  const returns = new Float64Array(n * Math.max(0, width - 1));
  const retWidth = Math.max(0, width - 1);
  for (let s = 0; s < n; s++) {
    const base = s * bars + from;
    for (let i = 1; i < width; i++) {
      const prev = input.close[base + i - 1];
      const cur = input.close[base + i];
      returns[s * retWidth + i - 1] =
        prev > 0 && cur > 0 && Number.isFinite(prev) && Number.isFinite(cur)
          ? Math.log(cur / prev)
          : NaN;
    }
  }

  const matrix = new Float64Array(n * n).fill(NaN);
  const pairs = new Int32Array(n * n);

  for (let a = 0; a < n; a++) {
    matrix[a * n + a] = 1;
    pairs[a * n + a] = retWidth;
    for (let b = a + 1; b < n; b++) {
      let count = 0;
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      for (let i = 0; i < retWidth; i++) {
        const x = returns[a * retWidth + i];
        const y = returns[b * retWidth + i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        count++;
        sumA += x;
        sumB += y;
        sumAA += x * x;
        sumBB += y * y;
        sumAB += x * y;
      }
      pairs[a * n + b] = count;
      pairs[b * n + a] = count;
      if (count < minPairs) continue;

      const cov = sumAB - (sumA * sumB) / count;
      const varA = sumAA - (sumA * sumA) / count;
      const varB = sumBB - (sumB * sumB) / count;
      const denom = Math.sqrt(varA * varB);
      if (!(denom > 0)) continue;

      const r = Math.max(-1, Math.min(1, cov / denom));
      matrix[a * n + b] = r;
      matrix[b * n + a] = r;
    }
  }

  return { symbols: input.symbols, matrix, pairs };
}

export interface ClusterResult {
  /** Isı haritasının çizim sırası (sembol indeksleri). */
  order: number[];
  /** Her sembolün küme kimliği (eşik uygulanmış). */
  clusterOf: number[];
  /** Küme sayısı. */
  count: number;
}

/**
 * Ortalama bağlantılı hiyerarşik kümeleme; uzaklık d = 1 − korelasyon.
 * NaN korelasyon "bilgi yok" sayılır ve en uzak mesafeyle (2) temsil edilir —
 * veri eksikliği yapay yakınlık üretmesin.
 *
 * Karmaşıklık: her adımda satır-minimumları önbelleklenir; tipik olarak O(n²),
 * en kötü durumda O(n³). 600 sembol için tarayıcıda birkaç yüz ms.
 */
export function clusterSymbols(
  matrix: Float64Array,
  n: number,
  distanceThreshold = 0.6,
): ClusterResult {
  if (n === 0) return { order: [], clusterOf: [], count: 0 };
  if (n === 1) return { order: [0], clusterOf: [0], count: 1 };

  const dist = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = matrix[i];
    dist[i] = Number.isFinite(r) ? 1 - r : 2;
  }

  const size = new Int32Array(n).fill(1);
  const alive = new Uint8Array(n).fill(1);
  /** Her aktif kümenin yaprakları (birleşme sırasını korur). */
  const leaves: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const merges: { a: number; b: number; d: number }[] = [];

  for (let step = 0; step < n - 1; step++) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!alive[j]) continue;
        const d = dist[i * n + j];
        if (d < bestD) {
          bestD = d;
          bestA = i;
          bestB = j;
        }
      }
    }
    if (bestA < 0) break;

    // Lance-Williams (ortalama bağlantı): yeni mesafe, boyutla ağırlıklı ortalama.
    const sa = size[bestA];
    const sb = size[bestB];
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bestA || k === bestB) continue;
      const d = (dist[bestA * n + k] * sa + dist[bestB * n + k] * sb) / (sa + sb);
      dist[bestA * n + k] = d;
      dist[k * n + bestA] = d;
    }
    // Küçük küme sağa yazılır: yaprak sırası okunur kalır.
    leaves[bestA] =
      sa >= sb ? [...leaves[bestA], ...leaves[bestB]] : [...leaves[bestB], ...leaves[bestA]];
    size[bestA] = sa + sb;
    alive[bestB] = 0;
    merges.push({ a: bestA, b: bestB, d: bestD });
  }

  const root = alive.indexOf(1);
  const order = root >= 0 ? leaves[root] : Array.from({ length: n }, (_, i) => i);

  // Eşiği aşan birleşmeler kesilerek küme kimlikleri üretilir.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  for (const m of merges) {
    if (m.d > distanceThreshold) continue;
    const ra = find(m.a);
    const rb = find(m.b);
    if (ra !== rb) parent[rb] = ra;
  }

  const idOf = new Map<number, number>();
  const clusterOf = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const root2 = find(i);
    if (!idOf.has(root2)) idOf.set(root2, idOf.size);
    clusterOf[i] = idOf.get(root2)!;
  }

  return { order, clusterOf, count: idOf.size };
}
