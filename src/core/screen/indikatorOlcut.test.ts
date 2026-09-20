import { describe, expect, it } from 'vitest';
import {
  gostergeAnahtari,
  gostergeOlcutId,
  gostergeOlcutleri,
  gostergeOlcutuMu,
  olcutIstekleri,
  olcutTanimi,
} from './indikatorOlcut';
import { gostergeDegerleri } from './indikatorOlcutHesap';
import { DEFAULT_SCREEN_PARAMS, passes, type Rule } from './metrics';
import { emptyCandles, type Candles } from '../data/types';
import { INDIKATORLER, INDIKATOR_ILE, varsayilanParametreler } from '../indicators/kayit';
import { smaArr } from '../indicators/temel';

function seri(n: number, bicim: (i: number) => number = (i) => 100 + i): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    const v = bicim(i);
    c.time[i] = 86_400 * (i + 1);
    c.open[i] = v;
    c.high[i] = v * 1.01;
    c.low[i] = v * 0.99;
    c.close[i] = v;
    c.volume[i] = 1000;
  }
  return c;
}

describe('gösterge ölçütleri', () => {
  it('parametre kimliğin İÇİNDE — EMA 50 ile EMA 200 ayrı ölçüt', () => {
    // Kimlik yalnızca `ema` olsaydı kullanıcı ikisini aynı anda süzemez,
    // üstelik birini süzerken ötekinin sayısını görürdü.
    const a = gostergeAnahtari('ema', { uzunluk: 50 });
    const b = gostergeAnahtari('ema', { uzunluk: 200 });
    expect(a).not.toBe(b);
    expect(gostergeOlcutuMu(a)).toBe(true);
    expect(gostergeOlcutuMu('last')).toBe(false);
  });

  it('kimlik parametre SIRASINDAN bağımsız — nesne sırası kimliği değiştirmiyor', () => {
    // Tercihler JSON'dan geri okunurken anahtar sırası korunmayabilir;
    // kimlik değişirse kullanıcının kurduğu filtre sessizce başka bir
    // ölçüte bağlanırdı.
    const x = gostergeAnahtari('bollinger', { uzunluk: 20, kat: 2 });
    const y = gostergeAnahtari('bollinger', { kat: 2, uzunluk: 20 });
    expect(x).toBe(y);
  });

  it('aynı gösterge aynı parametreyle iki kez açıksa TEK ölçüt üretiyor', () => {
    const olcutler = gostergeOlcutleri([
      { id: 'ema', parametreler: { uzunluk: 50 } },
      { id: 'ema', parametreler: { uzunluk: 50 } },
      { id: 'ema', parametreler: { uzunluk: 200 } },
    ]);
    expect(olcutler.map((m) => m.id)).toEqual([
      gostergeOlcutId('ema', { uzunluk: 50 }, 'ema'),
      gostergeOlcutId('ema', { uzunluk: 200 }, 'ema'),
    ]);
    expect(olcutIstekleri(olcutler)).toHaveLength(2);
  });

  it('çok çıktılı gösterge her dalı ayrı ölçüt yapıyor, hesap TEK', () => {
    const olcutler = gostergeOlcutleri([{ id: 'stoch', parametreler: { uzunluk: 14, d: 3 } }]);
    expect(olcutler.map((m) => m.etiket)).toEqual(['%K 14', '%D 3']);
    expect(olcutIstekleri(olcutler)).toHaveLength(1);
  });

  it('bilinmeyen gösterge kimliği atlanıyor, çökmüyor', () => {
    expect(gostergeOlcutleri([{ id: 'boyle-bir-sey-yok', parametreler: {} }])).toEqual([]);
  });

  it('parametreler sınırların dışındaysa kırpılıp kimliğe öyle giriyor', () => {
    // Kırpılmamış olsaydı kimlik "uzunluk=999999" derken hesap başka bir
    // pencereyi ölçerdi; etiket de yalan söylerdi.
    const olcutler = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 99_999 } }]);
    const t = INDIKATOR_ILE.get('ema')!;
    const max = t.parametreler[0].max;
    expect(olcutler[0].etiket).toBe(`EMA ${max}`);
    expect(olcutler[0].id).toBe(gostergeOlcutId('ema', { uzunluk: max }, 'ema'));
  });

  it('kayıttaki her çıktının ölçeği var — kıyas dışında kalan gösterge yok', () => {
    for (const t of INDIKATORLER) {
      for (const c of t.ciktilar(varsayilanParametreler(t))) {
        expect(c.olcek, `${t.id}.${c.ad} ölçeksiz`).toBeTruthy();
      }
    }
  });

  it('sağlaması gösterge adını ve parametrelerini yazıyor', () => {
    const [m] = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 50 } }]);
    expect(olcutTanimi(m).formula(DEFAULT_SCREEN_PARAMS)).toContain('uzunluk=50');
  });
});

describe('gösterge ölçüt hesabı', () => {
  it('son barın değerini veriyor', () => {
    const c = seri(300);
    const olcutler = gostergeOlcutleri([{ id: 'sma', parametreler: { uzunluk: 20 } }]);
    const d = gostergeDegerleri(c, olcutIstekleri(olcutler));
    const beklenen = smaArr(c.close, 20)[c.length - 1];
    expect(d[olcutler[0].id]).toBeCloseTo(beklenen, 10);
  });

  it('pencere dolmayan sembolde NaN — sıfır ya da son geçerli değer DEĞİL', () => {
    // 60 barlık bir sembolde "EMA 200" ölçülemez. Sayı uydurmak o sembolü
    // ölçülmüş gibi gösterir, kural da onu geçmiş sayardı.
    const c = seri(60);
    const olcutler = gostergeOlcutleri([{ id: 'sma', parametreler: { uzunluk: 200 } }]);
    const d = gostergeDegerleri(c, olcutIstekleri(olcutler));
    expect(Number.isNaN(d[olcutler[0].id])).toBe(true);
    expect(
      passes({ symbol: 'X', values: d, bars: 60 }, [{ metric: olcutler[0].id, op: 'gt', a: -1e9 }]),
    ).toBe(false);
  });

  it('boş seride çökmüyor', () => {
    const olcutler = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 50 } }]);
    expect(gostergeDegerleri(emptyCandles(0), olcutIstekleri(olcutler))).toEqual({});
  });

  it('gerçek kıyas: yükselen seride fiyat EMA 200 ÜSTÜNDE', () => {
    const c = seri(400);
    const olcutler = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 200 } }]);
    const d = gostergeDegerleri(c, olcutIstekleri(olcutler));
    const row = { symbol: 'YUKARI', values: { ...d, last: c.close[c.length - 1] }, bars: 400 };
    const kural: Rule[] = [{ metric: 'last', op: 'gt', a: 0, karsiMetrik: olcutler[0].id }];
    expect(passes(row, kural)).toBe(true);
    expect(passes(row, [{ metric: 'last', op: 'lt', a: 0, karsiMetrik: olcutler[0].id }])).toBe(
      false,
    );
  });

  it('düşen seride aynı kural TERSİNİ veriyor', () => {
    const c = seri(400, (i) => 500 - i);
    const olcutler = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 200 } }]);
    const d = gostergeDegerleri(c, olcutIstekleri(olcutler));
    const row = { symbol: 'ASAGI', values: { ...d, last: c.close[c.length - 1] }, bars: 400 };
    expect(passes(row, [{ metric: 'last', op: 'gt', a: 0, karsiMetrik: olcutler[0].id }])).toBe(
      false,
    );
  });

  it('kayıttaki HER gösterge hesaplanabiliyor ve etiketi kimliğiyle eşleşiyor', () => {
    const c = seri(900, (i) => 100 + Math.sin(i / 10) * 20 + i * 0.1);
    const olcutler = gostergeOlcutleri(
      INDIKATORLER.map((t) => ({ id: t.id, parametreler: varsayilanParametreler(t) })),
    );
    const d = gostergeDegerleri(c, olcutIstekleri(olcutler));
    for (const m of olcutler) {
      expect(m.id in d, `${m.id} hesaplanmadı`).toBe(true);
    }
  });
});
