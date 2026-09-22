import { describe, expect, it } from 'vitest';
import { ANOMALI_VARSAYILAN, anomaliHesapla, type AnomaliAyar } from './anomali';
import type { Bundle } from '../data/pack';

/**
 * Küçük pencerelerle ayar: 40 günlük elle kurulan paket, 60 günlük varsayılan
 * pencereyi dolduramaz. Eşikler (z ≥ 3, tabanlar) VARSAYILAN kalıyor —
 * sınanan şey onlar.
 */
const AYAR: Partial<AnomaliAyar> = {
  pencere: 10,
  enAzGozlem: 5,
  korUzun: 10,
  korKisa: 5,
  enAzSektor: 2,
  // Dört sembolde tek tetik zaten %25: yaygınlık burada KAPALI, ayrı sınanıyor.
  yayginPay: 2,
};

const GUN = 40;

/** Dönüşümlü ±adim getirili seri: sapma sıfır olmasın ama sakin kalsın. */
function seri(
  adim: number,
  taban = 10,
  n = GUN,
  isaret: (i: number) => number = (i) => (i % 2 ? 1 : -1),
): number[] {
  const out: number[] = [taban];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + isaret(i) * adim));
  return out;
}

interface Secenek {
  hacim?: (si: number, di: number) => number;
  acilis?: (si: number, di: number) => number;
}

function paket(kapanis: number[][], secenek: Secenek = {}): Bundle {
  const bars = kapanis[0].length;
  const names = kapanis.map((_, i) => `S${i}`);
  // Varsayılan hacim 10/11 dönüşümlü (sapma > 0); açılış kapanışın ±%0,1'i.
  const hacim = secenek.hacim ?? ((_si, di) => 10 + (di % 2));
  const acilis = secenek.acilis ?? ((si, di) => kapanis[si][di] * (1 + (di % 2 ? 0.001 : -0.001)));
  return {
    names,
    days: Int32Array.from({ length: bars }, (_, i) => 100 + i),
    bars,
    closeAt: (si, di) => kapanis[si][di],
    volumeAt: (si, di) => (Number.isFinite(kapanis[si][di]) ? hacim(si, di) : Number.NaN),
    openAt: (si, di) => (Number.isFinite(kapanis[si][di]) ? acilis(si, di) : Number.NaN),
    seriesOf: () => null,
  };
}

/** Dört sakin sembol, hepsi aynı sektörde. Dört: üçte medyan bir üyeye eşit çıkıyor. */
function sakin(): number[][] {
  return [seri(0.003), seri(0.004, 20), seri(0.005, 30), seri(0.006, 40)];
}
const SEKTOR = { S0: 'A', S1: 'A', S2: 'A', S3: 'A' };

describe('anomaliHesapla — sakin piyasa', () => {
  it('kimse tetiklenmiyor ve her sinyal herkes için ölçülebiliyor', () => {
    const r = anomaliHesapla(paket(sakin()), SEKTOR, AYAR);
    expect(r.denenen).toBe(4);
    expect(r.islemGormeyen).toBe(0);
    expect(r.satirlar).toEqual([]);
    expect(r.olculemeyen).toEqual({ hacim: 0, bosluk: 0, kopma: 0, korelasyon: 0 });
    expect(r.gun).toBe(100 + GUN - 1);
  });

  it('iki bardan az paket: boş sonuç, uydurma yok', () => {
    const r = anomaliHesapla(paket([[10]]), SEKTOR, AYAR);
    expect(r.denenen).toBe(0);
    expect(r.satirlar).toEqual([]);
  });
});

describe('anomaliHesapla — sinyaller', () => {
  it('hacim patlaması: kendi geçmişinin 3σ üstü tetikliyor, komşuları değil', () => {
    const r = anomaliHesapla(
      paket(sakin(), { hacim: (si, di) => (si === 0 && di === GUN - 1 ? 1000 : 10 + (di % 2)) }),
      SEKTOR,
      AYAR,
    );
    expect(r.satirlar.map((s) => s.symbol)).toEqual(['S0']);
    expect(r.satirlar[0].tetikler).toEqual(['hacim']);
    expect(r.satirlar[0].hacimZ).toBeGreaterThan(ANOMALI_VARSAYILAN.zEsik);
    expect(r.tetiklenen.hacim).toBe(1);
  });

  it('hacim yalnızca YÜKSEK tarafta tetikler: hacim kuruması listeyi doldurmaz', () => {
    const r = anomaliHesapla(
      paket(sakin(), { hacim: (si, di) => (si === 0 && di === GUN - 1 ? 0.01 : 10 + (di % 2)) }),
      SEKTOR,
      AYAR,
    );
    expect(r.satirlar.find((s) => s.symbol === 'S0')?.tetikler ?? []).not.toContain('hacim');
    expect(r.olculemeyen.hacim).toBe(0); // ölçüldü ama tetiklemedi
  });

  it('açılış boşluğu: %5 boşluk kendi ±%0,3 geçmişine göre olağandışı', () => {
    const k = sakin();
    const r = anomaliHesapla(
      paket(k, {
        acilis: (si, di) => (si === 0 && di === GUN - 1 ? k[0][di - 1] * 1.05 : k[si][di]),
      }),
      SEKTOR,
      AYAR,
    );
    const s0 = r.satirlar.find((s) => s.symbol === 'S0')!;
    expect(s0.tetikler).toContain('bosluk');
    expect(s0.bosluk).toBeCloseTo(5, 6);
    expect(Math.abs(s0.boslukZ)).toBeGreaterThan(3);
  });

  it('boşluk tabanı: z büyük ama boşluk küçükse tetiklemez', () => {
    const k = sakin();
    const r = anomaliHesapla(
      paket(k, {
        acilis: (si, di) => (si === 0 && di === GUN - 1 ? k[0][di - 1] * 1.05 : k[si][di]),
      }),
      SEKTOR,
      { ...AYAR, boslukTaban: 10 },
    );
    expect(r.satirlar.find((s) => s.symbol === 'S0')?.tetikler ?? []).not.toContain('bosluk');
  });

  it('sektörden kopma: sektör +%0,5 giderken tek başına +%8', () => {
    const k = sakin();
    k[0][GUN - 1] = k[0][GUN - 2] * 1.08;
    const r = anomaliHesapla(
      paket(k, {
        // Boşluk yok: açılış önceki kapanışta. Kopmayı yalıtıyoruz.
        acilis: (si, di) => (si === 0 && di === GUN - 1 ? k[0][di - 1] : k[si][di]),
      }),
      SEKTOR,
      AYAR,
    );
    const s0 = r.satirlar.find((s) => s.symbol === 'S0')!;
    expect(s0.tetikler).toContain('kopma');
    expect(s0.tetikler).not.toContain('bosluk');
    expect(s0.kopma).toBeGreaterThan(7);
    expect(s0.sektor).toBe('A');
  });

  it('sektör dosyası yoksa kopma ve korelasyon ÖLÇÜLEMEZ — sıradan sayılmaz', () => {
    const k = sakin();
    k[0][GUN - 1] = k[0][GUN - 2] * 1.08;
    const r = anomaliHesapla(paket(k), null, AYAR);
    expect(r.olculemeyen.kopma).toBe(4);
    expect(r.olculemeyen.korelasyon).toBe(4);
    for (const s of r.satirlar) {
      expect(s.tetikler).not.toContain('kopma');
      expect(s.sektor).toBeNull();
    }
  });

  it('sektör çok küçükse medyan yok → kopma ölçülemez', () => {
    const r = anomaliHesapla(paket(sakin()), { S0: 'A', S1: 'B', S2: 'C', S3: 'D' }, AYAR);
    expect(r.olculemeyen.kopma).toBe(4);
  });

  it('korelasyon kırılması: 35 gün sürüyle, son 5 gün tersine', () => {
    const k = sakin();
    // S0 son 5 gün ters işaretli getiri: uzun pencerede korelasyon 1, kısada −1.
    k[0] = seri(0.005, 10, GUN, (i) => (i >= GUN - 5 ? -1 : 1) * (i % 2 ? 1 : -1));
    const r = anomaliHesapla(paket(k), SEKTOR, AYAR);
    const s0 = r.satirlar.find((s) => s.symbol === 'S0')!;
    expect(s0.tetikler).toContain('korelasyon');
    expect(s0.korUzun).toBeGreaterThan(0.9);
    expect(s0.korKisa).toBeLessThan(-0.9);
    // Küçük bir ters hareket; kopma tabanının (2 puan) altında.
    expect(s0.tetikler).not.toContain('kopma');
  });
});

describe('anomaliHesapla — dürüstlük', () => {
  it('bugün işlem görmeyen sembol DENENMİYOR ve ayrı sayılıyor', () => {
    const k = sakin();
    k[0][GUN - 1] = Number.NaN;
    const r = anomaliHesapla(paket(k), SEKTOR, AYAR);
    expect(r.denenen).toBe(3);
    expect(r.islemGormeyen).toBe(1);
    expect(r.satirlar.map((s) => s.symbol)).not.toContain('S0');
  });

  it('geçmişi yetersiz sembolde büyük hareket bile TETİKLEMEZ, ölçülemedi sayılır', () => {
    const k = sakin();
    // S0 yalnızca son 4 gün işlem görmüş; son gün +%20 ve 100× hacim.
    for (let i = 0; i < GUN - 4; i++) k[0][i] = Number.NaN;
    k[0][GUN - 1] = k[0][GUN - 2] * 1.2;
    const r = anomaliHesapla(
      paket(k, { hacim: (si, di) => (si === 0 && di === GUN - 1 ? 1000 : 10 + (di % 2)) }),
      SEKTOR,
      AYAR,
    );
    expect(r.satirlar.map((s) => s.symbol)).not.toContain('S0');
    expect(r.olculemeyen.hacim).toBe(1);
    expect(r.olculemeyen.bosluk).toBe(1);
    expect(r.olculemeyen.kopma).toBe(1);
    expect(r.olculemeyen.korelasyon).toBe(1);
  });

  it('sıralama: iki sinyal tek sinyalin önünde', () => {
    const k = sakin();
    const r = anomaliHesapla(
      paket(k, {
        hacim: (si, di) => ((si === 0 || si === 1) && di === GUN - 1 ? 1000 : 10 + (di % 2)),
        acilis: (si, di) => (si === 1 && di === GUN - 1 ? k[1][di - 1] * 1.05 : k[si][di]),
      }),
      SEKTOR,
      AYAR,
    );
    expect(r.satirlar.map((s) => s.symbol)).toEqual(['S1', 'S0']);
    expect(r.satirlar[0].tetikler).toEqual(['hacim', 'bosluk']);
  });
});

/*
 * YAYGINLIK — gerçek veride 18 Eyl 2026: 581 sembolün 116'sı açılış
 * boşluğuyla tetiklendi. Piyasanın beşte biri "olağandışı" olamaz; bu bir
 * piyasa olayıdır ve liste öyle demeli.
 */
describe('anomaliHesapla — yaygınlık', () => {
  it('sinyal denenenlerin %50+ında tetiklenince yaygın: tek başına listeye sokmuyor', () => {
    const k = sakin();
    // S0, S1, S2 %5 boşlukla açılıyor; S3'te hacim patlaması.
    const r = anomaliHesapla(
      paket(k, {
        acilis: (si, di) => (si < 3 && di === GUN - 1 ? k[si][di - 1] * 1.05 : k[si][di]),
        hacim: (si, di) => (si === 3 && di === GUN - 1 ? 1000 : 10 + (di % 2)),
      }),
      SEKTOR,
      { ...AYAR, yayginPay: 0.5 },
    );
    expect(r.yaygin.bosluk).toBe(true);
    expect(r.yaygin.hacim).toBe(false);
    expect(r.tetiklenen.bosluk).toBe(3); // olgu sayılmaya devam ediyor
    expect(r.yayginSatir).toBe(3);
    expect(r.satirlar.map((s) => s.symbol)).toEqual(['S3']);
  });

  it('yaygın sinyal + tekil sinyal olan satır listede, rozeti duruyor, şiddete katılmıyor', () => {
    const k = sakin();
    // S0, S1, S2 boşluk; S0 ayrıca hacim; S3 yalnızca hacim ama daha büyük z.
    const r = anomaliHesapla(
      paket(k, {
        acilis: (si, di) => (si < 3 && di === GUN - 1 ? k[si][di - 1] * 1.05 : k[si][di]),
        hacim: (si, di) =>
          di === GUN - 1 ? (si === 0 ? 100 : si === 3 ? 1000 : 10) : 10 + (di % 2),
      }),
      SEKTOR,
      // Boşluk 3/4 = %75 yaygın; hacim 2/4 = %50 değil.
      { ...AYAR, yayginPay: 0.6 },
    );
    expect(r.satirlar.map((s) => s.symbol)).toEqual(['S3', 'S0']);
    const s0 = r.satirlar[1];
    expect(s0.tetikler).toEqual(['hacim', 'bosluk']); // olgu satırda kalıyor
    expect(r.yayginSatir).toBe(2);
  });

  it('kimse denenmediyse hiçbir sinyal yaygın değil', () => {
    const r = anomaliHesapla(paket([[10]]), SEKTOR, AYAR);
    expect(Object.values(r.yaygin).every((v) => v === false)).toBe(true);
  });
});
