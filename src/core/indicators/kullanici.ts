import { adxArr, emaArr, rocArr, rollingHighest, rollingLowest, rollingVWMA } from './calc';
import { atrArr, rsiArr } from './rsi';
import { macdArr, supertrendArr, willrArr } from './trend';
import {
  bantArr,
  farkArr,
  obvArr,
  smaArr,
  stdevArr,
  stochKArr,
  tipikFiyat,
  vwapArr,
  wmaArr,
} from './temel';
import type { CikisTanimi, CizimTuru, RenkToken, SayiParametresi } from './kayit';

/**
 * KULLANICI GÖSTERGELERİ — sözleşme ve doğrulama.
 *
 * Kullanıcı isteği: "pinescript yerine javascript (veya sen ne tavsiye
 * edersen dil olarak) ile yeni indikatör yükleme".
 *
 * Dil JavaScript. Gerekçe: çekirdek zaten TypeScript, ayrı bir
 * ayrıştırıcı/yorumlayıcı yazmak gerekmiyor ve kod mevcut worker altyapısında
 * koşuyor. Bedeli, kullanıcı kodunun GERÇEKTEN çalıştırılması; bu yüzden
 * yalıtım ciddiye alınıyor (bkz. gosterge.worker.ts).
 *
 * Bu dosya SAF: yalnızca sözleşmeyi, kullanıcıya verilen kitaplığı ve gelen
 * nesnenin şeklini doğrulamayı tanımlıyor. Çalıştırma ayrı katmanda.
 */

/**
 * Kullanıcı koduna verilen kitaplık.
 *
 * Neden kitaplık: döngü yazmak zorunda kalan kullanıcı hem yavaş hem hatalı
 * kod yazar. Buradakilerin hepsi uygulamanın kendi göstergelerinde de
 * kullanılan, sınanmış fonksiyonlar — yani kullanıcının göstergesi ile
 * barındırılan gösterge AYNI hesabı paylaşıyor.
 */
export const KITAPLIK = {
  ema: emaArr,
  sma: smaArr,
  wma: wmaArr,
  rsi: rsiArr,
  atr: atrArr,
  adx: adxArr,
  roc: rocArr,
  macd: macdArr,
  vwma: rollingVWMA,
  vwap: vwapArr,
  stdev: stdevArr,
  stoch: stochKArr,
  obv: obvArr,
  willr: willrArr,
  supertrend: supertrendArr,
  enYuksek: rollingHighest,
  enDusuk: rollingLowest,
  tipikFiyat,
  fark: farkArr,
  bant: bantArr,
} as const;

export type Kitaplik = typeof KITAPLIK;

/** Doğrulanmış kullanıcı göstergesi üstverisi (fonksiyonlar HARİÇ). */
export interface KullaniciUstverisi {
  ad: string;
  kisa: string;
  panel: 'fiyat' | 'ayri';
  parametreler: SayiParametresi[];
}

export type Dogrulama<T> = { tamam: true; deger: T } | { tamam: false; hata: string };

const TOKENLAR: RenkToken[] = ['accent', 'warn', 'up', 'down', 'muted', 'text'];
const TURLER: CizimTuru[] = ['cizgi', 'sutun'];

function metin(v: unknown, alan: string, enCok = 60): Dogrulama<string> {
  if (typeof v !== 'string' || v.trim() === '')
    return { tamam: false, hata: `${alan}: metin olmalı` };
  if (v.length > enCok) return { tamam: false, hata: `${alan}: en çok ${enCok} karakter` };
  return { tamam: true, deger: v.trim() };
}

/**
 * Gelen nesnenin ÜSTVERİSİNİ doğrula.
 *
 * Kullanıcı kodu her şeyi döndürebilir; doğrulanmadan kabul edilen bir şema
 * arayüzü çökertir (ayar kutusu `parametreler` üzerinde dönüyor). Hata
 * ALANI SÖYLÜYOR — "geçersiz gösterge" demek kullanıcıya hiçbir şey
 * anlatmaz.
 */
export function ustveriDogrula(ham: unknown): Dogrulama<KullaniciUstverisi> {
  if (typeof ham !== 'object' || ham === null) {
    return { tamam: false, hata: 'Gösterge bir nesne döndürmeli' };
  }
  const o = ham as Record<string, unknown>;

  const ad = metin(o.ad, 'ad');
  if (!ad.tamam) return ad;
  const kisa = metin(o.kisa ?? o.ad, 'kisa', 12);
  if (!kisa.tamam) return kisa;

  const panel = o.panel === 'fiyat' || o.panel === undefined ? 'fiyat' : o.panel;
  if (panel !== 'fiyat' && panel !== 'ayri') {
    return { tamam: false, hata: "panel: 'fiyat' ya da 'ayri' olmalı" };
  }

  if (!Array.isArray(o.parametreler)) {
    return { tamam: false, hata: 'parametreler: dizi olmalı (boş olabilir)' };
  }
  if (o.parametreler.length > 8) {
    return { tamam: false, hata: 'parametreler: en çok 8 parametre' };
  }

  const parametreler: SayiParametresi[] = [];
  const adlar = new Set<string>();
  for (const [i, ham2] of o.parametreler.entries()) {
    const p = ham2 as Record<string, unknown>;
    const pad = metin(p?.ad, `parametreler[${i}].ad`, 24);
    if (!pad.tamam) return pad;
    if (adlar.has(pad.deger)) {
      return { tamam: false, hata: `parametreler: "${pad.deger}" iki kez tanımlı` };
    }
    adlar.add(pad.deger);
    const etiket = metin(p?.etiket ?? pad.deger, `parametreler[${i}].etiket`, 40);
    if (!etiket.tamam) return etiket;
    const sayilar = ['varsayilan', 'min', 'max'] as const;
    for (const alan of sayilar) {
      if (p?.[alan] !== undefined && !Number.isFinite(p[alan])) {
        return { tamam: false, hata: `parametreler[${i}].${alan}: sayı olmalı` };
      }
    }
    const min = Number.isFinite(p?.min) ? (p.min as number) : 1;
    const max = Number.isFinite(p?.max) ? (p.max as number) : 1000;
    if (max <= min) return { tamam: false, hata: `parametreler[${i}]: max, min'den büyük olmalı` };
    const varsayilan = Number.isFinite(p?.varsayilan) ? (p.varsayilan as number) : min;
    if (varsayilan < min || varsayilan > max) {
      return {
        tamam: false,
        hata: `parametreler[${i}].varsayilan: ${min}–${max} aralığında olmalı`,
      };
    }
    parametreler.push({
      ad: pad.deger,
      etiket: etiket.deger,
      varsayilan,
      min,
      max,
      ondalik: p?.ondalik === true,
    });
  }

  if (typeof o.hesapla !== 'function') {
    return { tamam: false, hata: 'hesapla: fonksiyon olmalı' };
  }
  if (o.ciktilar !== undefined && typeof o.ciktilar !== 'function') {
    return { tamam: false, hata: 'ciktilar: fonksiyon olmalı (verilmezse tek çizgi varsayılır)' };
  }

  return { tamam: true, deger: { ad: ad.deger, kisa: kisa.deger, panel, parametreler } };
}

/**
 * Hesap SONUCUNU doğrula.
 *
 * Yanlış uzunlukta bir dizi grafikte sessizce kayık çizilir — barlarla
 * hizalanmayan bir çizgi, yanlış bir çizgidir. Bu yüzden uzunluk da
 * sınanıyor, yalnızca tip değil.
 */
export function ciktiDogrula(
  ham: unknown,
  barSayisi: number,
  beklenenSeri: number,
): Dogrulama<Float64Array[]> {
  const dizi = Array.isArray(ham) ? ham : [ham];
  if (dizi.length === 0) return { tamam: false, hata: 'hesapla: en az bir dizi döndürmeli' };
  if (dizi.length !== beklenenSeri) {
    return {
      tamam: false,
      hata: `hesapla: ${beklenenSeri} seri bekleniyordu, ${dizi.length} döndü`,
    };
  }
  const out: Float64Array[] = [];
  for (const [i, s] of dizi.entries()) {
    if (!(s instanceof Float64Array) && !Array.isArray(s)) {
      return { tamam: false, hata: `hesapla: ${i}. çıktı dizi değil` };
    }
    const f = s instanceof Float64Array ? s : Float64Array.from(s as number[]);
    if (f.length !== barSayisi) {
      return {
        tamam: false,
        hata: `hesapla: ${i}. çıktının uzunluğu ${f.length}, bar sayısı ${barSayisi}`,
      };
    }
    out.push(f);
  }
  return { tamam: true, deger: out };
}

/** Çıktı tanımlarını doğrula; verilmemişse tek çizgi varsayılır. */
export function cikisDogrula(ham: unknown, kisa: string): Dogrulama<CikisTanimi[]> {
  if (ham === undefined) {
    return { tamam: true, deger: [{ ad: 'deger', etiket: kisa, tur: 'cizgi', token: 'accent' }] };
  }
  if (!Array.isArray(ham) || ham.length === 0) {
    return { tamam: false, hata: 'ciktilar: boş olmayan bir dizi döndürmeli' };
  }
  if (ham.length > 6) return { tamam: false, hata: 'ciktilar: en çok 6 seri' };
  const out: CikisTanimi[] = [];
  for (const [i, ham2] of ham.entries()) {
    const c = ham2 as Record<string, unknown>;
    const ad = metin(c?.ad ?? `seri${i}`, `ciktilar[${i}].ad`, 24);
    if (!ad.tamam) return ad;
    const etiket = metin(c?.etiket ?? ad.deger, `ciktilar[${i}].etiket`, 40);
    if (!etiket.tamam) return etiket;
    const tur = (c?.tur ?? 'cizgi') as CizimTuru;
    if (!TURLER.includes(tur)) {
      return { tamam: false, hata: `ciktilar[${i}].tur: 'cizgi' ya da 'sutun' olmalı` };
    }
    const token = (c?.token ?? 'accent') as RenkToken;
    if (!TOKENLAR.includes(token)) {
      return { tamam: false, hata: `ciktilar[${i}].token: ${TOKENLAR.join(', ')} olmalı` };
    }
    const taban = c?.taban;
    if (taban !== undefined && !Number.isFinite(taban)) {
      return { tamam: false, hata: `ciktilar[${i}].taban: sayı olmalı` };
    }
    out.push({
      ad: ad.deger,
      etiket: etiket.deger,
      tur,
      token,
      taban: taban as number | undefined,
      yonRengi: c?.yonRengi === true,
    });
  }
  return { tamam: true, deger: out };
}

/**
 * Kaynakta YASAKLI kalıp var mı.
 *
 * Yalıtımın ASIL katmanı çalıştırma ortamı (küresel nesneleri sökülmüş,
 * DOM'suz, ağsız bir worker). Bu kontrol İKİNCİ katman: `import()` çağrısı
 * sökülmüş bir küresel nesneye ihtiyaç duymadan ağa çıkabilen tek yapı, ve
 * gösterge kodunun ona ihtiyacı yok — kitaplık zaten veriliyor.
 *
 * Tek başına yeterli DEĞİL ve öyle olduğu iddia edilmiyor: metin araması
 * kaçırılabilir. Bu yüzden ortam da sökülüyor ve paylaşılan kod asla
 * sorulmadan çalıştırılmıyor.
 */
export function kaynakTara(kaynak: string): Dogrulama<string> {
  if (kaynak.length > 20_000)
    return { tamam: false, hata: 'Kaynak çok uzun (en çok 20.000 karakter)' };
  const yasak: [RegExp, string][] = [
    [/\bimport\s*\(/, 'import()'],
    [/\bimport\s+/, 'import'],
    [/\brequire\s*\(/, 'require()'],
  ];
  for (const [kalip, ad] of yasak) {
    if (kalip.test(kaynak)) {
      return {
        tamam: false,
        hata: `Gösterge kodunda "${ad}" kullanılamaz; gereken fonksiyonlar kitaplıkta hazır.`,
      };
    }
  }
  return { tamam: true, deger: kaynak };
}
