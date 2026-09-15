/**
 * Ağaç haritası (treemap) yerleşimi — alan AĞIRLIĞA orantılı.
 *
 * Neden gerekli: ısı haritası düzgün bir ızgaraydı ve her sembole EŞİT kutu
 * veriyordu. "Piyasada bugün ne oluyor?" başlığı altında günde 50 milyon TL
 * dönen bir sembol ile 50 milyar TL dönen bir sembol aynı büyüklükte
 * görünüyordu; yani resim, paranın nerede olduğunu SÖYLEMİYORDU. Renk zaten
 * yönü taşıyor — alan da büyüklüğü taşıyınca harita gerçekten bir para akışı
 * haritası oluyor.
 *
 * Yöntem "squarified" (Bruls, Huizing, van Wijk 2000): kutular sırayla
 * yerleştirilirken bir sonraki kutuyu mevcut şeride eklemek EN KÖTÜ en-boy
 * oranını iyileştiriyorsa ekleniyor, kötüleştiriyorsa yeni şerit açılıyor.
 * Naif "dilimle" yerleşimi uzun ince şeritler üretir ve o şeritlerin alanı
 * gözle karşılaştırılamaz — okunabilirlik burada doğruluk kadar önemli.
 */

export interface TreemapRect {
  /** Girdi dizisindeki sıra — çağıran kutuyu kendi verisine bağlayabilsin. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bir şeridin en kötü en-boy oranı (1'e ne kadar yakınsa o kadar iyi). */
function worstRatio(areas: number[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Infinity;
  const thickness = sum / side;
  let worst = 0;
  for (const a of areas) {
    if (a <= 0) continue;
    const len = a / thickness;
    const ratio = Math.max(thickness / len, len / thickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/**
 * `values` ağırlıklarını `width × height` dikdörtgenine yerleştirir.
 *
 * Sonlu olmayan ve pozitif olmayan ağırlıklar ATLANIR: sıfır alanlı bir kutu
 * çizilemez ve "değeri bilinmiyor"u sıfır saymak yanlış olurdu — çağıran
 * hangi indekslerin döndüğüne bakarak eksiği görebilir.
 */
export function squarify(values: ArrayLike<number>, width: number, height: number): TreemapRect[] {
  if (!(width > 0) || !(height > 0)) return [];

  const items: { v: number; i: number }[] = [];
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v > 0) {
      items.push({ v, i });
      total += v;
    }
  }
  if (items.length === 0) return [];
  items.sort((a, b) => b.v - a.v);

  const scale = (width * height) / total;
  const out: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;

  while (i < items.length) {
    // Şerit KISA kenar boyunca açılıyor: uzun kenara açmak ince uzun
    // kutular üretir ve alanları gözle karşılaştırılamaz hale gelir.
    const dikey = w >= h;
    const side = dikey ? h : w;
    if (!(side > 0)) break;

    const row: { v: number; i: number }[] = [];
    let rowSum = 0;
    let best = Infinity;
    while (i < items.length) {
      const alan = items[i].v * scale;
      const denemeSum = rowSum + alan;
      const denemeWorst = worstRatio([...row.map((r) => r.v * scale), alan], denemeSum, side);
      if (row.length === 0 || denemeWorst <= best) {
        row.push(items[i]);
        rowSum = denemeSum;
        best = denemeWorst;
        i++;
      } else {
        break;
      }
    }

    const thickness = rowSum / side;
    let off = 0;
    for (let k = 0; k < row.length; k++) {
      const alan = row[k].v * scale;
      // Son kutu kalan boşluğu kapatıyor: kayan nokta artığı görünür bir
      // boşluk bırakmasın.
      const len = k === row.length - 1 ? side - off : alan / thickness;
      out.push(
        dikey
          ? { index: row[k].i, x, y: y + off, w: thickness, h: len }
          : { index: row[k].i, x: x + off, y, w: len, h: thickness },
      );
      off += len;
    }

    if (dikey) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
  }

  return out;
}
