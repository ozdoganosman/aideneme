export interface EksenAraligi {
  min: number;
  max: number;
}

/**
 * Çizgi grafiğin DİKEY ekseni: veriden ölçek.
 *
 * Saf fonksiyon, çünkü kural canvas'a çizilen bir metinde saklanamaz —
 * `fillText` ile yazılan eksen etiketi DOM'da yok, yani uçtan uca test
 * göremiyor. Kural buraya taşındı ki sınanabilsin.
 *
 * Üç karar:
 *
 * 1. PAYANDA (%8): seri kenara yapışmasın. Payandasız çizimde en yüksek ve
 *    en düşük noktalar çerçeveye değiyor ve tepe noktası kırpılmış görünüyor.
 *
 * 2. SIFIR ÖLÇEĞİN İÇİNDE (`sifirCizgisi`): tamamı negatif bir seri, sıfır
 *    dışarıda kalırsa grafikte YÜKSELİYORMUŞ gibi görünür. Net kâr
 *    grafiğinde "küçüldü" ile "zarara döndü" aynı şey değildir.
 *
 * 3. NEGATİF FİYAT DİYE BİR ŞEY YOK: payanda koşulsuz uygulanınca, en küçüğü
 *    sıfıra yakın bir seride eksen sıfırın ALTINA iniyordu. Gerçek veride
 *    görüldü — THYAO'nun 14 yıllık fiyat grafiğinde alt etiket "-26"
 *    yazıyordu: hiçbir verinin bulunamayacağı bir bölge ve grafik
 *    yüksekliğinin boşa giden bir dilimi. Seri KENDİSİ negatife inmiyorsa
 *    eksen sıfırda kesiliyor; gerçekten negatif değer taşıyan seri (getiri,
 *    net kâr) etkilenmiyor.
 */
export function eksenAraligi(
  min: number,
  max: number,
  options: { sifirCizgisi?: boolean; payanda?: number } = {},
): EksenAraligi {
  const { sifirCizgisi = false, payanda = 0.08 } = options;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

  const gercekMin = min;
  let alt = min;
  let ust = max;

  if (sifirCizgisi) {
    if (alt > 0) alt = 0;
    if (ust < 0) ust = 0;
  }
  // Düz seri: aralık sıfır olursa bölme tanımsız kalır.
  if (ust - alt < 1e-9) {
    alt -= 1;
    ust += 1;
  }

  const p = (ust - alt) * payanda;
  alt -= p;
  ust += p;

  if (gercekMin >= 0 && alt < 0) alt = 0;
  return { min: alt, max: ust };
}
