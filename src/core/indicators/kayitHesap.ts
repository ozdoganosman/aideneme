import type { Candles } from '../data/types';
import { adxArr, emaArr, rocArr, rollingVWMA } from './calc';
import { atrArr, rsiArr } from './rsi';
import { macdArr, supertrendArr, willrArr } from './trend';
import { bantArr, farkArr, obvArr, smaArr, stdevArr, stochKArr, vwapArr, wmaArr } from './temel';
import type { Parametreler } from './kayit';

/**
 * GÖSTERGE HESAPLARI — kayıt defterinden AYRI dosya.
 *
 * Neden ayrı: hesaplar yalnızca worker'da koşuyor ama tanımlar arayüzde de
 * lazım (çip etiketi, ayar kutusu, arama). İkisi aynı dosyadayken sembol
 * masası yığını 11,2 kB'den 30,1 kB'ye çıkmıştı — kabuk, hiç çağırmayacağı
 * gösterge matematiğini (calc, rsi, trend, temel) taşıyordu. Ölçüldü: ekranın
 * hazır olma süresi 1501 → 1731 ms, ana iş parçacığı bloku 421 → 478 ms.
 *
 * `kayitBütünlük` testi her tanımın bir hesabı, her hesabın bir tanımı
 * olduğunu doğruluyor: ayrım sessiz bir boşluk üretmesin.
 */
export const HESAPLAR: Record<string, (c: Candles, p: Parametreler) => Float64Array[]> = {
  ema: (c, p) => [emaArr(c.close, p.uzunluk)],
  sma: (c, p) => [smaArr(c.close, p.uzunluk)],
  wma: (c, p) => [wmaArr(c.close, p.uzunluk)],
  vwap: (c, p) => [vwapArr(c, p.uzunluk)],
  bollinger: (c, p) => {
    const orta = smaArr(c.close, p.uzunluk);
    const sap = stdevArr(c.close, p.uzunluk);
    return [bantArr(orta, sap, p.kat), orta, bantArr(orta, sap, -p.kat)];
  },
  supertrend: (c, p) => [supertrendArr(c, p.uzunluk, p.kat)],
  rsi: (c, p) => [rsiArr(c.close, p.uzunluk)],
  wr: (c, p) => {
    const r = willrArr(c, p.uzunluk);
    return [r, emaArr(r, p.emaYavas), emaArr(r, p.emaHizli)];
  },
  stoch: (c, p) => {
    const k = stochKArr(c, p.uzunluk);
    return [k, smaArr(k, p.d)];
  },
  macd: (c, p) => {
    const m = macdArr(c.close, p.hizli, p.yavas);
    const s = emaArr(m, p.sinyal);
    return [farkArr(m, s), m, s];
  },
  macdNizami: (c, p) => {
    const hizli = emaArr(c.close, p.hizli);
    const m = macdArr(c.close, p.hizli, p.yavas);
    const s = emaArr(m, p.sinyal);
    const e = rollingVWMA(m, c.volume, p.vwma);
    const bol = (a: Float64Array): Float64Array => {
      const out = new Float64Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = hizli[i] !== 0 ? a[i] / hizli[i] : NaN;
      return out;
    };
    const mN = bol(m);
    const sN = bol(s);
    return [farkArr(mN, sN), mN, sN, bol(e)];
  },
  adx: (c, p) => {
    const a = adxArr(c, p.uzunluk);
    return [a, emaArr(a, p.ema)];
  },
  atr: (c, p) => [atrArr(c.high, c.low, c.close, p.uzunluk)],
  roc: (c, p) => {
    const r = rocArr(c.close, p.uzunluk);
    return [r, emaArr(r, p.ema)];
  },
  obv: (c, p) => {
    const o = obvArr(c);
    return [o, emaArr(o, p.ema)];
  },
};
