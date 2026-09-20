import { describe, expect, it } from 'vitest';
import { inspect, weekdaysBetween } from './health';
import { DAY_SECONDS } from './pack';
import { emptyCandles, type Candles } from './types';

/** 1 Ocak 2024 Pazartesi = epoch gün 19723. */
const MON = 19723;

function series(days: number[], closes?: number[], volumes?: number[]): Candles {
  const c = emptyCandles(days.length);
  days.forEach((d, i) => {
    const close = closes?.[i] ?? 100 + i;
    c.time[i] = d * DAY_SECONDS;
    c.open[i] = close;
    c.high[i] = close + 1;
    c.low[i] = close - 1;
    c.close[i] = close;
    c.volume[i] = volumes?.[i] ?? 1000;
  });
  return c;
}

/** Hafta sonlarını atlayarak n işlem günü üret. */
function weekdays(start: number, n: number): number[] {
  const out: number[] = [];
  let d = start;
  while (out.length < n) {
    const dow = (d + 4) % 7;
    if (dow !== 0 && dow !== 6) out.push(d);
    d++;
  }
  return out;
}

describe('weekdaysBetween', () => {
  it('hafta sonlarını saymaz', () => {
    expect(weekdaysBetween(MON, MON + 7)).toBe(5);
    expect(weekdaysBetween(MON + 5, MON + 7)).toBe(0); // Cmt + Paz
  });

  it('boş ve ters aralıkta 0', () => {
    expect(weekdaysBetween(MON, MON)).toBe(0);
    expect(weekdaysBetween(MON + 5, MON)).toBe(0);
  });
});

describe('inspect', () => {
  it('temiz seride sorun bulmaz', () => {
    const days = weekdays(MON, 60);
    const report = inspect(series(days), { today: days[days.length - 1] });
    expect(report.level).toBe('ok');
    expect(report.gaps).toHaveLength(0);
    expect(report.outliers).toHaveLength(0);
    expect(report.findings).toEqual(['Belirgin bir sorun bulunmadı.']);
  });

  it('boş seri hata verir', () => {
    const report = inspect(emptyCandles(0), { today: MON });
    expect(report.level).toBe('error');
    expect(report.bars).toBe(0);
  });

  it('hafta sonu boşluğu boşluk sayılmaz', () => {
    const days = [MON + 4, MON + 7]; // Cuma → Pazartesi
    expect(inspect(series(days), { today: MON + 7 }).gaps).toHaveLength(0);
  });

  it('eksik işlem günü boşluk olarak raporlanır', () => {
    const days = [MON, MON + 3]; // Salı ve Çarşamba yok
    const report = inspect(series(days), { today: MON + 3 });
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].missingWeekdays).toBe(2);
    expect(report.level).toBe('error'); // 30 bardan az
  });

  it('bölünme benzeri sıçramayı oranıyla işaretler', () => {
    const days = weekdays(MON, 40);
    const closes = days.map((_, i) => (i < 20 ? 100 : 50)); // 1/2 bölünme
    const report = inspect(series(days, closes), { today: days[days.length - 1] });
    const split = report.outliers.find((o) => o.splitRatio !== null);
    expect(split?.splitRatio).toBeCloseTo(0.5, 6);
    expect(report.findings.join(' ')).toMatch(/bölünme benzeri/);
    expect(report.level).toBe('warn');
  });

  it('bayat veriyi hafta içi gün sayısıyla bildirir', () => {
    const days = weekdays(MON, 40);
    const last = days[days.length - 1];
    const report = inspect(series(days), { today: last + 14 });
    expect(report.staleWeekdays).toBeGreaterThan(3);
    expect(report.findings.join(' ')).toMatch(/bayat/);
  });

  it('tutarsız OHLC hata seviyesine çeker', () => {
    const days = weekdays(MON, 40);
    const c = series(days);
    c.high[5] = c.low[5] - 1; // yüksek < düşük
    const report = inspect(c, { today: days[days.length - 1] });
    expect(report.invalidBars).toBe(1);
    expect(report.level).toBe('error');
  });

  it('sıfır hacimli barları sayar', () => {
    const days = weekdays(MON, 40);
    const volumes = days.map((_, i) => (i % 10 === 0 ? 0 : 1000));
    const report = inspect(series(days, undefined, volumes), { today: days[days.length - 1] });
    expect(report.zeroVolumeBars).toBe(4);
    expect(report.findings.join(' ')).toMatch(/sıfır hacimli/);
  });
});

describe('bulgu metinleri Türkçe biçimde', () => {
  it('sıfır hacim oranı VİRGÜLLE yazılıyor', () => {
    /*
      Gerçek veride bulundu: ISKUR'un raporunda "40 bar (%1.9) sıfır hacimli"
      yazıyordu — aynı ekranın geri kalanı virgül kullanırken. Örnek veride
      hiç görünmüyordu, çünkü orada sıfır hacimli bar yok. Bu cümle çekirdekte
      hazır kuruluyor ve doğrudan ekrana yazılıyor, yani arayüzün biçim
      düzeltmesi buraya ulaşmıyor.
    */
    const c = emptyCandles(200);
    for (let i = 0; i < 200; i++) {
      c.time[i] = (19_000 + i) * 86_400;
      c.open[i] = 10;
      c.high[i] = 10;
      c.low[i] = 10;
      c.close[i] = 10;
      c.volume[i] = i < 3 ? 0 : 1000; // %1,5
    }
    const metin = inspect(c, { today: 19_200 }).findings.join(' ');
    expect(metin).toContain('%1,5');
    expect(metin).not.toContain('%1.5');
  });
});
