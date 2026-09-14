import { describe, expect, it } from 'vitest';
import { DEFAULT_SCREEN_PARAMS, type Rule } from './metrics';
import {
  decodeScreen,
  encodeScreen,
  exportScreens,
  importScreens,
  type SavedScreen,
  type ShareState,
} from './share';

const KNOWN = new Set(['rsi', 'chg21', 'adx', 'pe']);

function state(over: Partial<ShareState> = {}): ShareState {
  return {
    rules: [
      { metric: 'rsi', op: 'between', a: 40, b: 70 },
      { metric: 'chg21', op: 'gt', a: 0 },
    ],
    params: DEFAULT_SCREEN_PARAMS,
    sectors: ['Bankacılık', 'Enerji'],
    sort: { metric: 'chg21', dir: 'desc' },
    ...over,
  };
}

describe('tarama bağlantısı', () => {
  it('gidiş-dönüşte durum aynen korunur', () => {
    const encoded = encodeScreen(state());
    const { state: back, dropped } = decodeScreen(encoded, KNOWN);
    expect(dropped).toEqual([]);
    expect(back).toEqual(state());
  });

  it('kodlama kısa ve okunabilir kalır', () => {
    const encoded = encodeScreen(state());
    expect(encoded).toBe('1|rsi~b~40~70!chg21~g~0|14.14.20.50.14.20.250|Bankacılık,Enerji|chg21~d');
    expect(encoded.length).toBeLessThan(120);
  });

  it('bilinmeyen metriği sessizce düşürmez', () => {
    const { state: back, dropped } = decodeScreen('1|zzz~g~5!rsi~g~30||', KNOWN);
    expect(back!.rules).toEqual<Rule[]>([{ metric: 'rsi', op: 'gt', a: 30 }]);
    expect(dropped).toEqual(['bilinmeyen metrik: zzz']);
  });

  it('bilinmeyen koşulu ve okunamayan değeri ayrı ayrı bildirir', () => {
    const { dropped } = decodeScreen('1|rsi~x~5!adx~g~abc!rsi~b~10~yy||', KNOWN);
    expect(dropped).toEqual([
      'bilinmeyen koşul: x',
      'okunamayan değer: adx',
      'okunamayan üst sınır: rsi',
    ]);
  });

  it('eski/bilinmeyen sürümü çözmeye çalışmaz', () => {
    const { state: back, dropped } = decodeScreen('9|rsi~g~30||', KNOWN);
    expect(back).toBeNull();
    expect(dropped[0]).toMatch(/sürüm 9/);
  });

  it('bozuk parametre varsayılana düşer ve bildirilir', () => {
    const { state: back, dropped } = decodeScreen('1||abc.14.20.50.14.20.250||', KNOWN);
    expect(back!.params.rsiLength).toBe(DEFAULT_SCREEN_PARAMS.rsiLength);
    expect(dropped).toEqual(['okunamayan parametre: rsiLength']);
  });

  it('eksik parametre alanları varsayılanı korur', () => {
    const { state: back, dropped } = decodeScreen('1||21||', KNOWN);
    expect(back!.params.rsiLength).toBe(21);
    expect(back!.params.highLookback).toBe(DEFAULT_SCREEN_PARAMS.highLookback);
    expect(dropped).toEqual([]);
  });

  it('ayırıcı içeren sektör adı kodlamaya girmez (ad bölünmesin)', () => {
    const encoded = encodeScreen(state({ sectors: ['Gıda, İçecek', 'Enerji'] }));
    const { state: back } = decodeScreen(encoded, KNOWN);
    expect(back!.sectors).toEqual(['Enerji']);
  });

  it('boş kurallar ve boş sektörler geçerli bir durumdur', () => {
    const empty = state({ rules: [], sectors: [] });
    const { state: back, dropped } = decodeScreen(encodeScreen(empty), KNOWN);
    expect(dropped).toEqual([]);
    expect(back).toEqual(empty);
  });

  it('yarım parametre nesnesi bağlantı üretimini çökertmez', () => {
    // Eski bir kayıttan gelebilecek durum: alanların yalnızca bir kısmı var.
    const partial = { rsiLength: 21, adxLength: 14 } as ShareState['params'];
    const encoded = encodeScreen(state({ params: partial }));
    const { state: back } = decodeScreen(encoded, KNOWN);
    expect(back!.params.rsiLength).toBe(21);
    expect(back!.params.highLookback).toBe(DEFAULT_SCREEN_PARAMS.highLookback);
  });

  it('boş metin durum üretmez', () => {
    expect(decodeScreen('', KNOWN).state).toBeNull();
  });

  it('bilinmeyen sıralama metriği varsayılana döner ve bildirilir', () => {
    const { state: back, dropped } = decodeScreen('1|||,|zzz~a', KNOWN);
    expect(back!.sort).toEqual({ metric: 'chg21', dir: 'desc' });
    expect(dropped).toContain('bilinmeyen sıralama metriği: zzz');
  });
});

describe('kayıtlı tarama koleksiyonu', () => {
  const saved: SavedScreen[] = [
    {
      name: 'Ucuz ve güçlü',
      rules: [{ metric: 'rsi', op: 'between', a: 40, b: 70 }],
      params: DEFAULT_SCREEN_PARAMS,
      sectors: ['Bankacılık'],
    },
    {
      name: 'Momentum',
      rules: [{ metric: 'chg21', op: 'gt', a: 5 }],
      params: DEFAULT_SCREEN_PARAMS,
    },
  ];

  it('dışa aktarıp geri okuyunca koleksiyon korunur', () => {
    const { screens, dropped } = importScreens(exportScreens(saved), KNOWN);
    expect(dropped).toEqual([]);
    expect(screens).toHaveLength(2);
    expect(screens[0].name).toBe('Ucuz ve güçlü');
    expect(screens[0].rules).toEqual(saved[0].rules);
    expect(screens[0].sectors).toEqual(['Bankacılık']);
    expect(screens[1].sectors).toEqual([]);
  });

  it('JSON olmayan metni reddeder', () => {
    expect(importScreens('merhaba', KNOWN).dropped[0]).toMatch(/JSON olarak okunamadı/);
  });

  it('başka bir JSON dosyasını koleksiyon sanmaz', () => {
    const out = importScreens(JSON.stringify({ hello: 'world' }), KNOWN);
    expect(out.screens).toEqual([]);
    expect(out.dropped[0]).toMatch(/tarama koleksiyonu değil/);
  });

  it('tanınmayan sürümü çözmeye çalışmaz', () => {
    const text = JSON.stringify({ version: 9, kind: 'borsa.screens', screens: [] });
    expect(importScreens(text, KNOWN).dropped[0]).toMatch(/sürümü tanınmadı/);
  });

  it('adı olmayan ve filtresi bozuk kayıtları gerekçesiyle atar', () => {
    const text = JSON.stringify({
      version: 1,
      kind: 'borsa.screens',
      screens: [
        { name: '  ', f: '1|rsi~g~30||' },
        { name: 'Filtresiz', f: 42 },
        { name: 'Sağlam', f: '1|rsi~g~30|||' },
      ],
    });
    const out = importScreens(text, KNOWN);
    expect(out.screens.map((s) => s.name)).toEqual(['Sağlam']);
    expect(out.dropped[0]).toMatch(/1. kayıtta ad yok/);
    expect(out.dropped[1]).toMatch(/"Filtresiz": filtre okunamadı/);
  });

  it('kısmen çözülen kaydı alır ama kaybı bildirir', () => {
    const text = JSON.stringify({
      version: 1,
      kind: 'borsa.screens',
      screens: [{ name: 'Karma', f: '1|zzz~g~5!rsi~g~30|||' }],
    });
    const out = importScreens(text, KNOWN);
    expect(out.screens).toHaveLength(1);
    expect(out.screens[0].rules).toHaveLength(1);
    expect(out.dropped[0]).toMatch(/"Karma": bilinmeyen metrik: zzz/);
  });
});
