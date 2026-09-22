import { describe, expect, it } from 'vitest';
import { anomaliKarnesi, isaretTesti } from './anomaliKarnesi';
import { anomaliGunu, anomaliIzgarasi, type AnomaliAyar } from './anomali';
import type { Bundle } from '../data/pack';

/** Küçük pencereler; eşikler varsayılan. Yaygınlık kapalı (6 sembolde tek olay %17). */
const AYAR: Partial<AnomaliAyar> = {
  pencere: 10,
  enAzGozlem: 5,
  korUzun: 10,
  korKisa: 5,
  enAzSektor: 2,
  yayginPay: 2,
};
const GUN = 60;
const OLAY = 30;

/** ±adim dönüşümlü sakin seri. */
function sakin(adim: number, taban: number): number[] {
  const out = [taban];
  for (let i = 1; i < GUN; i++) out.push(out[i - 1] * (1 + (i % 2 ? adim : -adim)));
  return out;
}

function paket(kapanis: number[][], hacim: (si: number, di: number) => number): Bundle {
  const bars = kapanis[0].length;
  return {
    names: kapanis.map((_, i) => `S${i}`),
    days: Int32Array.from({ length: bars }, (_, i) => 100 + i),
    bars,
    closeAt: (si, di) => kapanis[si][di],
    volumeAt: (si, di) => (Number.isFinite(kapanis[si][di]) ? hacim(si, di) : Number.NaN),
    openAt: (si, di) =>
      Number.isFinite(kapanis[si][di]) ? kapanis[si][di] * (1 + (di % 2 ? 0.001 : -0.001)) : NaN,
    seriesOf: () => null,
  };
}

const NORMAL = (_si: number, di: number) => 10 + (di % 2);

/**
 * S0: OLAY gününde 100× hacim, sonra 5 gün boyunca günde %2 yükseliş.
 * Diğer beş sembol sakin. Beklenen: hacim kovasında tek olay, 5 günlük fazla
 * getirisi ≈ %10,4 − piyasa medyanı (≈ 0).
 */
function senaryo(): Bundle {
  const k = [0, 1, 2, 3, 4, 5].map((i) => sakin(0.003 + i * 0.0005, 10 + i));
  for (let d = OLAY + 1; d < GUN; d++) k[0][d] = k[0][d - 1] * (d <= OLAY + 5 ? 1.02 : 1);
  return paket(k, (si, di) => (si === 0 && di === OLAY ? 1000 : NORMAL(si, di)));
}

describe('işaret testi', () => {
  it('kesin binom, iki yönlü', () => {
    expect(isaretTesti(0, 5)).toBeCloseTo(2 / 32, 10);
    expect(isaretTesti(5, 5)).toBeCloseTo(2 / 32, 10);
    expect(isaretTesti(5, 10)).toBe(1);
    // 20'de 15: P(X≤5) = 21700/1048576 → iki yönlü ×2
    expect(isaretTesti(15, 20)).toBeCloseTo((2 * 21700) / 1048576, 8);
  });

  it('gözlem yoksa NaN — "anlamlı değil" uydurulmuyor', () => {
    expect(Number.isNaN(isaretTesti(0, 0))).toBe(true);
  });
});

describe('anomaliKarnesi', () => {
  it('olayın ileri getirisi piyasa medyanına göre ölçülüyor', () => {
    const k = anomaliKarnesi(senaryo(), null, { ufuklar: [5], ayar: AYAR });
    const hacim = k.satirlar.find((s) => s.kova === 'hacim')!;
    expect(hacim.olay).toBe(1);
    const u = hacim.ufuk[5];
    expect(u.n).toBe(1);
    expect(u.gun).toBe(1);
    expect(u.medyanFazla).toBeGreaterThan(9.5);
    expect(u.medyanFazla).toBeLessThan(11);
    expect(u.isabet).toBe(1);
  });

  it('İLERİYE BAKMIYOR: bir günün olayları sonrası silinse de aynı', () => {
    const tam = senaryo();
    const kesik: Bundle = { ...tam, bars: OLAY + 1, days: tam.days.subarray(0, OLAY + 1) };
    const a = anomaliGunu(anomaliIzgarasi(tam, null, AYAR), OLAY, AYAR);
    const b = anomaliGunu(anomaliIzgarasi(kesik, null, AYAR), OLAY, AYAR);
    expect(a.satirlar).toEqual(b.satirlar);
    expect(a.satirlar.map((s) => s.symbol)).toContain('S0');
  });

  it('değerlendirme aralığı: geçmiş penceresinden en kısa ufka kadar', () => {
    const k = anomaliKarnesi(senaryo(), null, { ufuklar: [20, 5], ayar: AYAR });
    expect(k.ufuklar).toEqual([5, 20]);
    expect(k.basGun).toBe(100 + 10);
    expect(k.sonGun).toBe(100 + GUN - 1 - 5);
    expect(k.degerlendirilenGun).toBe(GUN - 1 - 5 - 10 + 1);
    // 20 günlük ufuk olay gününden sonra 29 gün var: ölçülebiliyor.
    const hacim = k.satirlar.find((s) => s.kova === 'hacim')!;
    expect(hacim.ufuk[20].n).toBe(1);
  });

  it('ufuk paketin sonunu aşan olay sayılıyor ama ölçülmüyor', () => {
    // Olay son günden 3 gün önce: 5 günlük ileri getiri yok.
    const k0 = [0, 1, 2, 3, 4, 5].map((i) => sakin(0.003 + i * 0.0005, 10 + i));
    const p = paket(k0, (si, di) => (si === 0 && di === GUN - 3 ? 1000 : NORMAL(si, di)));
    const k = anomaliKarnesi(p, null, { ufuklar: [2, 5], ayar: AYAR });
    const hacim = k.satirlar.find((s) => s.kova === 'hacim')!;
    expect(hacim.olay).toBe(1);
    expect(hacim.ufuk[2].n).toBe(1);
    expect(hacim.ufuk[5].n).toBe(0);
    expect(Number.isNaN(hacim.ufuk[5].medyanFazla)).toBe(true);
  });

  it('yaygın sinyal olay sayılmıyor — panelle aynı kural', () => {
    // Aynı gün BÜTÜN semboller 100× hacim: piyasa olayı.
    const k0 = [0, 1, 2, 3, 4, 5].map((i) => sakin(0.003 + i * 0.0005, 10 + i));
    const p = paket(k0, (_si, di) => (di === OLAY ? 1000 : NORMAL(_si, di)));
    const acik = anomaliKarnesi(p, null, { ufuklar: [5], ayar: { ...AYAR, yayginPay: 0.1 } });
    expect(acik.satirlar.find((s) => s.kova === 'hacim')!.olay).toBe(0);
    const kapali = anomaliKarnesi(p, null, { ufuklar: [5], ayar: AYAR });
    expect(kapali.satirlar.find((s) => s.kova === 'hacim')!.olay).toBe(6);
  });

  it('yön ayrı kovada: yukarı ve aşağı boşluk birbirini götürmüyor', () => {
    const k0 = [0, 1, 2, 3, 4, 5].map((i) => sakin(0.003 + i * 0.0005, 10 + i));
    const p: Bundle = {
      ...paket(k0, NORMAL),
      openAt: (si, di) => {
        const onceki = k0[si][di - 1];
        if (di === OLAY && si === 0) return onceki * 1.06;
        if (di === OLAY && si === 1) return onceki * 0.94;
        return k0[si][di] * (1 + (di % 2 ? 0.001 : -0.001));
      },
    };
    const k = anomaliKarnesi(p, null, { ufuklar: [5], ayar: AYAR });
    expect(k.satirlar.find((s) => s.kova === 'boslukYukari')!.olay).toBe(1);
    expect(k.satirlar.find((s) => s.kova === 'boslukAsagi')!.olay).toBe(1);
  });

  it('kontrol sütunu: aynı hissenin sıradan günleri, olay gününden ayrı', () => {
    const k = anomaliKarnesi(senaryo(), null, { ufuklar: [5], ayar: AYAR });
    const u = k.satirlar.find((s) => s.kova === 'hacim')!.ufuk[5];
    expect(Number.isFinite(u.kontrolFazla)).toBe(true);
    // S0'nın sıradan günlerinin medyanı olay gününün %10'undan çok küçük.
    expect(u.kontrolFazla).toBeLessThan(u.medyanFazla - 5);
  });

  it('olay olmayan kova: sayılar NaN, p NaN — "belirgin değil" diye uydurulmuyor', () => {
    const k = anomaliKarnesi(senaryo(), null, { ufuklar: [5], ayar: AYAR });
    const kor = k.satirlar.find((s) => s.kova === 'korelasyon')!;
    expect(kor.olay).toBe(0);
    expect(kor.ufuk[5].n).toBe(0);
    expect(Number.isNaN(kor.ufuk[5].medyanFazla)).toBe(true);
    expect(Number.isNaN(kor.ufuk[5].p)).toBe(true);
  });
});
