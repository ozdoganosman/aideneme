import { describe, expect, it } from 'vitest';
import { trNum, trPct, trAmount, trCompact, axisLabel } from './format';

describe('Türkçe sayı biçimi', () => {
  it('ondalık virgül, binlik nokta', () => {
    expect(trNum(1234.5, 2)).toBe('1.234,50');
    expect(trNum(0.6103, 3)).toBe('0,610');
  });

  it('yüzde işareti sayının ÖNÜNDE, işaret en başta', () => {
    expect(trPct(3.61, 2, true)).toBe('+%3,61');
    expect(trPct(-3.61, 2, true)).toBe('-%3,61');
    // İşaretsiz bağlamda (oran/pay) artı yazılmaz.
    expect(trPct(40, 0)).toBe('%40');
  });

  it('sonsuz ve tanımsız değerler uydurulmaz', () => {
    expect(trNum(NaN)).toBe('—');
    expect(trPct(NaN)).toBe('—');
    expect(trAmount(NaN)).toBe('—');
    expect(trNum(Infinity)).toBe('∞');
    expect(trPct(Infinity)).toBe('∞');
  });

  it('sıfır işaretsiz yazılır', () => {
    expect(trPct(0, 1, true)).toBe('%0,0');
  });
});

describe('trCompact', () => {
  it('milyar, milyon ve bin eşiklerini Türkçe kısaltır', () => {
    expect(trCompact(16_600_000_000)).toBe('16,6 mlr');
    expect(trCompact(2_450_000)).toBe('2,5 mn');
    expect(trCompact(48_300)).toBe('48,3 b');
  });

  it('eşiğin altında kısaltmaz', () => {
    expect(trCompact(999)).toBe('999');
    expect(trCompact(0)).toBe('0');
  });

  it('negatifi de kısaltır', () => {
    // Nabız ekranındaki yerel kopya burada kısaltmayı atlayıp tam sayıya
    // düşüyordu: aynı sütunda iki ayrı biçim görünürdü.
    expect(trCompact(-2_450_000)).toBe('-2,5 mn');
    expect(trCompact(-48_300)).toBe('-48,3 b');
  });

  it('ölçülemeyende sayı uydurmaz', () => {
    expect(trCompact(NaN)).toBe('—');
    expect(trCompact(Infinity)).toBe('∞');
  });

  it('ondalık ayırıcı virgül kalır', () => {
    expect(trCompact(1_234_500_000)).toMatch(/^1,2 mlr$/);
    expect(trCompact(1_234_500_000)).not.toContain('.');
  });
});

describe('axisLabel', () => {
  // Ölçüldü: satış serisi 1.900–2.500 b aralığındayken beş ızgara
  // çizgisinin BEŞİ de "2 b" yazıyordu. Aynı şeyi yazan eksen, serinin
  // yatay olduğu izlenimini verir — yani grafik yanlış bilgi verir.
  it('dar aralıkta etiketleri ayırır', () => {
    const span = 600_000; // 1,9 mn – 2,5 mn
    const etiketler = [1_900_000, 2_050_000, 2_200_000, 2_350_000, 2_500_000].map((v) =>
      axisLabel(v, span),
    );
    expect(new Set(etiketler).size).toBe(etiketler.length);
    expect(etiketler[0]).toBe('1,9 mn');
  });

  it('geniş aralıkta gereksiz basamak eklemez', () => {
    // 0 – 4 mlr: adım 1 mlr, ondalık gerekmiyor.
    expect(axisLabel(3_000_000_000, 4_000_000_000)).toBe('3 mlr');
  });

  it('çok dar aralıkta basamak artar ama üçte durur', () => {
    // Adım 0,01 mlr → iki basamak yeter: 2,00 / 2,01 / 2,02 ayrışıyor.
    expect(axisLabel(2_001_000_000, 40_000_000)).toBe('2,00 mlr');
    // Üst sınır: aralık bu kadar darken (2 milyarda 4 bin) hiçbir makul
    // basamak sayısı etiketleri ayıramaz — dokuz basamak gerekirdi. Sınır
    // kabul ediliyor, gizlenmiyor: finansal tabloda bu oran gerçekleşmiyor.
    expect(axisLabel(2_000_000_000, 4_000)).toBe('2,000 mlr');
  });

  it('birim büyüklükten, basamak aralıktan gelir', () => {
    // Aynı aralık, farklı büyüklük → farklı birim.
    expect(axisLabel(2_500, 600)).toBe('2,5 b');
    expect(axisLabel(2_500_000, 600)).toContain('mn');
  });

  it('sonlu olmayan değer için tire', () => {
    expect(axisLabel(NaN, 100)).toBe('—');
  });
});
