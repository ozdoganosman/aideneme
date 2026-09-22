/**
 * Tablo içi mini grafik (sparkline) için seri seyreltme.
 *
 * Neden tabloda grafik: ürün bir sayı yığınıydı. Tarayıcı 200 sembolü 14
 * sütun sayıyla gösteriyor ve "bu hisse nasıl hareket ediyor" sorusunun
 * cevabı ancak tek tek tıklayarak alınıyordu. Sayı kesindir ama ŞEKİL
 * okunur: yükselen mi, yatay mı, tepeden mi dönmüş — bir bakışta.
 *
 * Neden ortalama değil MIN/MAKS koruyan seyreltme: ortalama alan bir
 * seyreltme fiyat sıçramalarını siler; 40 noktaya indirilen bir seride
 * %20'lik bir çakılma düz bir çizgiye dönüşebilir. Sparkline'ın işi tam
 * olarak o sıçramayı göstermek. Her kovadan hem en düşük hem en yüksek
 * alınıp ZAMAN SIRASINDA yerleştiriliyor — yani şekil korunuyor, sahte
 * bir dalgalanma da uydurulmuyor.
 */

/**
 * `values` dizisini en çok `points` noktaya indirir.
 *
 * Seri zaten kısaysa kopyası döner (uydurma nokta eklenmez). Sonlu olmayan
 * değerler atlanır: NaN bir fiyat değildir ve çizgiyi sıfıra çekmemeli.
 */
export function sparkPoints(values: ArrayLike<number>, points = 40): number[] {
  const clean: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) clean.push(v);
  }
  if (clean.length <= points || points < 2) return clean;

  // Her kova iki nokta üretiyor (min ve maks), o yüzden kova sayısı yarısı.
  const buckets = Math.max(1, Math.floor(points / 2));
  const size = clean.length / buckets;
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = b === buckets - 1 ? clean.length : Math.floor((b + 1) * size);
    let lo = Infinity;
    let hi = -Infinity;
    let loAt = start;
    let hiAt = start;
    for (let i = start; i < end; i++) {
      if (clean[i] < lo) {
        lo = clean[i];
        loAt = i;
      }
      if (clean[i] > hi) {
        hi = clean[i];
        hiAt = i;
      }
    }
    if (lo === Infinity) continue;
    // Zaman sırası korunuyor: hangisi önce geldiyse önce çiziliyor. Sabit
    // bir sıra (önce min) seriye olmayan bir testere deseni uydururdu.
    if (loAt <= hiAt) {
      out.push(lo);
      if (hi !== lo) out.push(hi);
    } else {
      out.push(hi);
      if (hi !== lo) out.push(lo);
    }
  }
  return out;
}

/**
 * Noktaları `0..1` kutusuna oturtur (y ekseni YUKARI artar).
 *
 * Boş seride boş dizi, düz seride ortada bir çizgi döner — düz bir seriyi
 * kutunun dibine ya da tepesine yapıştırmak, olmayan bir yönü varmış gibi
 * gösterirdi.
 */
export function normalizeSpark(points: number[]): number[] {
  if (points.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of points) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  if (span === 0) return points.map(() => 0.5);
  return points.map((v) => (v - lo) / span);
}
