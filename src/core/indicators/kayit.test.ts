import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import {
  INDIKATORLER,
  INDIKATOR_ILE,
  indikatorAra,
  parametreSinirla,
  varsayilanParametreler,
} from './kayit';
import { DEFAULT_PARAMS, computeIndicators } from './calc';
import { HESAPLAR } from './kayitHesap';

/** Gerçekçi bir seri: yükselen trend + gürültü, sabit tohumla. */
function seri(n: number): Candles {
  const c = emptyCandles(n);
  let t = 100;
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
  for (let i = 0; i < n; i++) {
    t *= 1 + 0.0004 + rnd() * 0.012;
    c.time[i] = 86_400 * (i + 1);
    c.open[i] = t * (1 + rnd() * 0.002);
    c.high[i] = t * 1.01;
    c.low[i] = t * 0.99;
    c.close[i] = t;
    c.volume[i] = 1000 + Math.abs(rnd()) * 5000;
  }
  return c;
}

describe('indikatör kayıt defteri', () => {
  it('her kaydın çıktı sayısı hesabıyla uyuşuyor', () => {
    const c = seri(800);
    for (const t of INDIKATORLER) {
      const p = varsayilanParametreler(t);
      const ciktilar = t.ciktilar(p);
      const degerler = HESAPLAR[t.id](c, p);
      expect(degerler.length, `${t.id}: çıktı sayısı`).toBe(ciktilar.length);
      for (const d of degerler) {
        expect(d.length, `${t.id}: dizi uzunluğu bar sayısına eşit olmalı`).toBe(c.length);
      }
    }
  });

  /**
   * TANIM ile HESAP eşleşmeli.
   *
   * İkisi ayrı dosyada (hesaplar yalnızca worker'da lazım, tanımlar arayüzde
   * de). Ayrım sessiz bir boşluk üretmemeli: hesabı olmayan bir tanım
   * ekranda boş bir çizgi, tanımı olmayan bir hesap ise ölü koddur.
   */
  it('her tanımın bir hesabı, her hesabın bir tanımı var', () => {
    const tanimlar = INDIKATORLER.map((t) => t.id).sort();
    const hesaplar = Object.keys(HESAPLAR).sort();
    expect(hesaplar, 'tanım ve hesap listeleri ayrışmış').toEqual(tanimlar);
  });

  it('kimlikler benzersiz ve haritada', () => {
    const idler = INDIKATORLER.map((t) => t.id);
    expect(new Set(idler).size, 'kimlik çakışması').toBe(idler.length);
    for (const id of idler) expect(INDIKATOR_ILE.get(id)?.id).toBe(id);
  });

  it('kısa veri sayı UYDURMUYOR', () => {
    // 5 barlık seri: hiçbir göstergenin penceresi dolmuyor.
    const c = seri(5);
    for (const t of INDIKATORLER) {
      const p = varsayilanParametreler(t);
      for (const d of HESAPLAR[t.id](c, p)) {
        expect(d.length, `${t.id}`).toBe(5);
      }
    }
  });

  it('parametre sınırlandırması bozuk girdiyi yutuyor', () => {
    const ema = INDIKATOR_ILE.get('ema')!;
    expect(parametreSinirla(ema, { uzunluk: 0 }).uzunluk).toBe(1);
    expect(parametreSinirla(ema, { uzunluk: 99_999 }).uzunluk).toBe(1000);
    expect(parametreSinirla(ema, { uzunluk: Number.NaN }).uzunluk).toBe(50);
    // Ondalıklı parametre yuvarlanmıyor.
    const bb = INDIKATOR_ILE.get('bollinger')!;
    expect(parametreSinirla(bb, { uzunluk: 20, kat: 2.5 }).kat).toBe(2.5);
  });

  it('arama Türkçe karakterden bağımsız', () => {
    expect(indikatorAra('oynaklik').map((t) => t.id)).toContain('atr');
    expect(indikatorAra('OYNAKLIK').map((t) => t.id)).toContain('bollinger');
    expect(indikatorAra('göreli').map((t) => t.id)).toContain('rsi');
    expect(indikatorAra('').length).toBe(INDIKATORLER.length);
    expect(indikatorAra('zzzz')).toEqual([]);
  });

  /**
   * ESKİ DAVRANIŞ KORUNUYOR.
   *
   * Sabit sistemdeki Williams %R ve NizamiCedid MACD, "260 günlük paradigma"
   * parametreleriyle geliyordu. Yeniden yapılandırma kullanıcının ekranda
   * gördüğü ÇİZGİYİ değiştirmemeli; bu yüzden kayıt defterinin çıktısı eski
   * hesapla bar bar karşılaştırılıyor.
   */
  it('%R ve nMACD eski sabit sistemle aynı sayıyı veriyor', () => {
    const c = seri(900);
    const eski = computeIndicators(c, DEFAULT_PARAMS);

    /*
      %R'de SON BİT farkı beklenen ve kayıt defterininki DAHA DOĞRU.

      Eski hesap `100·(kapanış − enYüksek)/aralık + 100`, yenisi sadeleşmiş
      hâli `100·(kapanış − enDüşük)/aralık`. Cebirsel olarak aynı; kayan
      noktada değil — 100 ekleyip çıkarmak anlamlı basamak kaybettiriyor.
      Aynı sınıf fark MACD dalında da var: eski kod `1/hızlı` çarpanını bir
      kez hesaplayıp ÇARPIYOR, kayıt defteri BÖLÜYOR — bölme bir yuvarlama
      daha az. Histogram iki kere geçtiği için farkı biraz daha büyük.

      Ölçüldü (900 bar, en büyük bağıl fark):
        %R 1,1e-15 · MACD/Sinyal/eMACD 2,2e-16 · Histogram 1,1e-13
      Bu yüzden eşitlik değil BAĞIL HATA sınırı sınanıyor; gevşek bir
      yuvarlama toleransı (örn. toBeCloseTo(6)) gerçek bir sapmayı da
      yutardı, bu sınır yutmaz.
    */
    const yakin = (a: number, b: number, ad: string) => {
      // NaN'lar da EŞLEŞMELİ: biri sayı öteki NaN ise bu gerçek bir sapmadır.
      expect(Number.isNaN(a), `${ad}: NaN uyuşmazlığı`).toBe(Number.isNaN(b));
      if (Number.isNaN(a)) return;
      const bagil = Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
      expect(bagil, `${ad}: ${a} ≠ ${b}`).toBeLessThan(1e-12);
    };

    const wr = INDIKATOR_ILE.get('wr')!;
    const [r, emaYavas, emaHizli] = HESAPLAR.wr(c, varsayilanParametreler(wr));
    for (let i = 0; i < c.length; i++) {
      yakin(r[i], eski.percentR[i], `%R[${i}]`);
      yakin(emaYavas[i], eski.emawil[i], `EMA yavaş[${i}]`);
      yakin(emaHizli[i], eski.emawil120[i], `EMA hızlı[${i}]`);
    }

    const nm = INDIKATOR_ILE.get('macdNizami')!;
    const [hist, macd, sinyal, emacd] = HESAPLAR.macdNizami(c, varsayilanParametreler(nm));
    for (let i = 0; i < c.length; i++) {
      yakin(macd[i], eski.macdN[i], `MACD[${i}]`);
      yakin(sinyal[i], eski.signalN[i], `Sinyal[${i}]`);
      yakin(emacd[i], eski.eMacDN[i], `eMACD[${i}]`);
      yakin(hist[i], eski.histN[i], `Histogram[${i}]`);
    }
  });
});
