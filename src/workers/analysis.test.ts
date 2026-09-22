import { describe, expect, it } from 'vitest';
import { AnalysisClient } from './analysisClient';
import { createHandler } from './handler';
import { gostergeOlcutleri, olcutIstekleri } from '../core/screen/indikatorOlcut';
import { ILERI_GETIRI_ID } from '../core/screen/zamanMakinesi';
import { createPool, type WorkerLike } from './pool';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { DEFAULT_SCREEN_PARAMS } from '../core/screen/metrics';
import { encodeBundle } from '../core/data/pack';
import { emptyCandles } from '../core/data/types';

/** Deterministik sentetik paket: n sembol × bars bar. */
function buildBundle(n: number, bars: number, seed = 3): ArrayBuffer {
  const symbols = Array.from({ length: n }, (_, i) => `S${String(i).padStart(3, '0')}`);
  const days = Int32Array.from({ length: bars }, (_, i) => 20000 + i);
  const cells = n * bars;
  const columns = {
    open: new Float32Array(cells),
    high: new Float32Array(cells),
    low: new Float32Array(cells),
    close: new Float32Array(cells),
    volume: new Float32Array(cells),
  };
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  for (let sym = 0; sym < n; sym++) {
    let price = 10 + sym * 0.5;
    for (let i = 0; i < bars; i++) {
      price = Math.max(1, price * (1 + rnd() * 0.04 + 0.0005));
      const cell = sym * bars + i;
      columns.open[cell] = price;
      columns.high[cell] = price * 1.01;
      columns.low[cell] = price * 0.99;
      columns.close[cell] = price;
      columns.volume[cell] = 1_000_000 + i;
    }
  }
  return encodeBundle({ symbols, days, columns });
}

/** Gerçek Worker yerine: aynı handler'ı asenkron çalıştıran sahte. */
function fakeWorker(): WorkerLike {
  const handle = createHandler();
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message) {
      const response = handle(message as WorkerRequest);
      queueMicrotask(() => worker.onmessage?.({ data: response }));
    },
    terminate() {},
  };
  return worker;
}

describe('handler', () => {
  it('init → screen → correlate akışı', () => {
    const handle = createHandler();
    const buffer = buildBundle(12, 120);

    const init = handle({ id: 1, type: 'init', market: 'bist', buffer });
    expect(init.ok && init.type === 'init' && init.symbols).toHaveLength(12);

    const screen = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 12,
    });
    expect(screen.ok).toBe(true);
    if (screen.ok && screen.type === 'screen') {
      expect(screen.rows).toHaveLength(12);
      expect(Number.isFinite(screen.rows[0].values.rsi)).toBe(true);
    }

    const corr = handle({ id: 3, type: 'correlate', market: 'bist', lookback: 0 });
    expect(corr.ok).toBe(true);
    if (corr.ok && corr.type === 'correlate') {
      expect(corr.matrix).toHaveLength(12 * 12);
      expect(corr.order).toHaveLength(12);
      expect(corr.clusters).toBeGreaterThan(0);
    }
  });

  it('nabız: tüm semboller için değişim + işlem değeri ve özet', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(30, 150) });

    const response = handle({ id: 2, type: 'pulse', market: 'bist' });
    expect(response.ok).toBe(true);
    if (response.ok && response.type === 'pulse') {
      expect(response.rows).toHaveLength(30);
      expect(response.summary.symbols).toBe(30);
      expect(response.summary.advancing + response.summary.declining).toBeLessThanOrEqual(30);
      // Genişlik ve akış yön veren sembollerden türetilir; ikisi de tanımlı olmalı.
      expect(Number.isFinite(response.summary.breadthPct)).toBe(true);
      expect(Number.isFinite(response.summary.flowPct)).toBe(true);
      expect(response.summary.totalValue).toBeGreaterThan(0);
    }
  });

  it('gostergeOlcut: grafikteki göstergeyi tüm sembollerde ölçüyor', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(12, 400) });

    const olcutler = gostergeOlcutleri([{ id: 'ema', parametreler: { uzunluk: 50 } }]);
    const response = handle({
      id: 2,
      type: 'gostergeOlcut',
      market: 'bist',
      istekler: olcutIstekleri(olcutler),
      from: 0,
      to: 12,
    });

    expect(response.ok).toBe(true);
    if (response.ok && response.type === 'gostergeOlcut') {
      expect(response.rows).toHaveLength(12);
      for (const r of response.rows) {
        expect(Number.isFinite(r.values[olcutler[0].id]), `${r.symbol} ölçülemedi`).toBe(true);
      }
    }
  });

  it('gostergeOlcut: penceresi sığmayan sembolde sayı UYDURMUYOR', () => {
    // 40 barlık seride "EMA 200" ölçülemez. Radar bunu NaN olarak almalı ki
    // sembol kurala uymuş sayılmasın ve "ölçülemedi" özetinde görünsün.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(4, 40) });

    const olcutler = gostergeOlcutleri([{ id: 'sma', parametreler: { uzunluk: 200 } }]);
    const response = handle({
      id: 2,
      type: 'gostergeOlcut',
      market: 'bist',
      istekler: olcutIstekleri(olcutler),
      from: 0,
      to: 4,
    });

    if (response.ok && response.type === 'gostergeOlcut') {
      for (const r of response.rows) {
        expect(Number.isNaN(r.values[olcutler[0].id]), `${r.symbol} sayı uydurdu`).toBe(true);
      }
    }
  });

  it('anomali: sektör haritası yokken kopma/korelasyon herkes için ölçülemez', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(6, 300) });
    const r = handle({ id: 2, type: 'anomali', market: 'bist', sektorler: null });
    expect(r.ok).toBe(true);
    if (!r.ok || r.type !== 'anomali') throw new Error('anomali yanıtı bekleniyordu');
    expect(r.denenen).toBe(6);
    expect(r.olculemeyen.kopma).toBe(6);
    expect(r.olculemeyen.korelasyon).toBe(6);
    // Hacim ve boşluk için 300 günlük geçmiş yeterli: ölçülemeyen yok.
    expect(r.olculemeyen.hacim).toBe(0);
    expect(r.olculemeyen.bosluk).toBe(0);
    expect(r.gun).toBe(20000 + 299);
  });

  it('anomali: sektör haritası verilince kopma ölçülüyor', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(6, 300) });
    const sektorler = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`S${String(i).padStart(3, '0')}`, 'X']),
    );
    const r = handle({ id: 2, type: 'anomali', market: 'bist', sektorler });
    if (!r.ok || r.type !== 'anomali') throw new Error('anomali yanıtı bekleniyordu');
    expect(r.olculemeyen.kopma).toBe(0);
    expect(r.olculemeyen.korelasyon).toBe(0);
    for (const s of r.satirlar) expect(s.sektor).toBe('X');
  });

  it('zamanMakinesi: geri=0 bugünkü taramayla aynı satırları veriyor (ileri getiri hariç)', () => {
    // Zaman makinesinin "bugün" ayarı taramadan SAPMAMALI; saparsa iki ekran
    // aynı sembol için farklı sayı gösterir. İleri getiri bugün için
    // tanımsız — "bugünden bugüne" bir getiri yok.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(6, 300) });
    const screen = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 6,
    });
    const zm = handle({
      id: 3,
      type: 'zamanMakinesi',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      geri: 0,
      from: 0,
      to: 6,
    });
    expect(screen.ok && zm.ok).toBe(true);
    if (screen.ok && screen.type === 'screen' && zm.ok && zm.type === 'zamanMakinesi') {
      expect(zm.rows.map((r) => r.symbol)).toEqual(screen.rows.map((r) => r.symbol));
      for (let i = 0; i < zm.rows.length; i++) {
        for (const [k, v] of Object.entries(screen.rows[i].values)) {
          expect(zm.rows[i].values[k], `${zm.rows[i].symbol}.${k}`).toBe(v);
        }
        expect(Number.isNaN(zm.rows[i].values[ILERI_GETIRI_ID])).toBe(true);
      }
    }
  });

  it('zamanMakinesi: geçmiş gün için ölçütler KESİK seriden, ileri getiri gerçek', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(4, 300) });
    const zm = handle({
      id: 2,
      type: 'zamanMakinesi',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      geri: 30,
      from: 0,
      to: 4,
    });
    expect(zm.ok).toBe(true);
    if (zm.ok && zm.type === 'zamanMakinesi') {
      expect(zm.rows.length).toBeGreaterThan(0);
      for (const r of zm.rows) {
        // 30 gün öncesinden bugüne getiri ölçülebilir olmalı.
        expect(Number.isFinite(r.values[ILERI_GETIRI_ID]), `${r.symbol} ileri getiri`).toBe(true);
        // Kesik seride bar sayısı bugünkünden AZ — geleceği görmediğinin kanıtı.
        expect(r.bars).toBeLessThan(300);
      }
    }
  });

  it('zamanMakinesi: eksenin dışına düşen geri en son mümkün güne kırpılıyor, çökmüyor', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(3, 100) });
    const zm = handle({
      id: 2,
      type: 'zamanMakinesi',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      geri: 9999,
      from: 0,
      to: 3,
    });
    expect(zm.ok).toBe(true);
    // En erken güne kırpılınca iki bardan az veri kalır → satır üretilmez; bu doğru.
    if (zm.ok && zm.type === 'zamanMakinesi') expect(zm.rows).toEqual([]);
  });

  it('gostergeOlcut: paket yüklenmeden anlaşılır hata döner', () => {
    const handle = createHandler();
    const response = handle({
      id: 1,
      type: 'gostergeOlcut',
      market: 'bist',
      istekler: [{ anahtar: 'gos:ema:50', id: 'ema', parametreler: { uzunluk: 50 } }],
      from: 0,
      to: 1,
    });
    expect(response.ok).toBe(false);
  });

  it('paket yüklenmeden tarama isteği anlaşılır hata döner', () => {
    const handle = createHandler();
    const response = handle({
      id: 1,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 10,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/paket yüklenmedi/);
  });

  it('aralık paketin dışına taşsa da çökmez', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(5, 80) });
    const response = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 3,
      to: 999,
    });
    expect(response.ok && response.type === 'screen' && response.rows).toHaveLength(2);
  });
});

/**
 * Kayıt defterindeki göstergeler worker'da hesaplanıyor.
 *
 * Sözleşmenin iki yönü de sınanıyor: istenen örnekler sonuçta VAR, tanımı
 * bilinmeyen kimlik tüm isteği düşürmüyor ve sonuçta YOK (arayüz "hesaplandı"
 * ile "hesaplanmadı"yı ayırt edebilsin).
 */
describe('handler — kayıt defteri göstergeleri', () => {
  const mumlar = () => {
    const n = 400;
    const c = emptyCandles(n);
    let t = 100;
    let s = 11;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
    for (let i = 0; i < n; i++) {
      t *= 1 + 0.0005 + rnd() * 0.01;
      c.time[i] = 86_400 * (i + 1);
      c.open[i] = t;
      c.high[i] = t * 1.01;
      c.low[i] = t * 0.99;
      c.close[i] = t;
      c.volume[i] = 1000;
    }
    return c;
  };

  const istek = (indikatorler: WorkerRequest extends never ? never : unknown) => ({
    id: 1,
    type: 'symbol' as const,
    candles: mumlar(),
    tf: 'D' as const,
    overlays: [],
    todayDay: 20_500,
    realReturn: false,
    indikatorler,
  });

  it('istenen örnekleri hesaplıyor', () => {
    const handle = createHandler();
    const r = handle(
      istek([
        { ornekId: 'a', id: 'rsi', parametreler: { uzunluk: 14 } },
        { ornekId: 'b', id: 'bollinger', parametreler: { uzunluk: 20, kat: 2 } },
      ]) as WorkerRequest,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.type !== 'symbol') throw new Error('beklenmeyen yanıt');
    expect(Object.keys(r.indikatorDegerleri ?? {}).sort()).toEqual(['a', 'b']);
    expect(r.indikatorDegerleri!.a).toHaveLength(1);
    expect(r.indikatorDegerleri!.b).toHaveLength(3); // üst / orta / alt
    expect(r.indikatorDegerleri!.a[0].length).toBe(400);
  });

  it('bilinmeyen kimlik isteği düşürmüyor, sonuçta da yok', () => {
    const handle = createHandler();
    const r = handle(
      istek([
        { ornekId: 'a', id: 'yok-boyle-bir-sey', parametreler: {} },
        { ornekId: 'b', id: 'ema', parametreler: { uzunluk: 50 } },
      ]) as WorkerRequest,
    );
    expect(r.ok, 'bilinmeyen kimlik tüm isteği düşürdü').toBe(true);
    if (!r.ok || r.type !== 'symbol') throw new Error('beklenmeyen yanıt');
    expect(Object.keys(r.indikatorDegerleri ?? {})).toEqual(['b']);
  });

  it('bozuk parametre sessizce boş çizgiye dönüşmüyor', () => {
    const handle = createHandler();
    // uzunluk 0: sınırlanmazsa EMA boş/NaN dizi döndürürdü.
    const r = handle(
      istek([{ ornekId: 'a', id: 'ema', parametreler: { uzunluk: 0 } }]) as WorkerRequest,
    );
    if (!r.ok || r.type !== 'symbol') throw new Error('beklenmeyen yanıt');
    const seri = r.indikatorDegerleri!.a[0];
    expect(seri.length).toBe(400);
    expect(Number.isFinite(seri[399]), 'sınırlama uygulanmamış').toBe(true);
  });
});

describe('pool', () => {
  it('işleri boştaki worker’lara dağıtır ve sırayı korur', async () => {
    const pool = createPool(3, fakeWorker);
    const buffer = buildBundle(9, 100);
    await pool.broadcast((id) => ({ id, type: 'init', market: 'bist', buffer: buffer.slice(0) }));

    const responses = await Promise.all(
      [0, 3, 6].map((from) =>
        pool.run((id) => ({
          id,
          type: 'screen',
          market: 'bist',
          params: DEFAULT_SCREEN_PARAMS,
          from,
          to: from + 3,
        })),
      ),
    );
    const rows = responses.flatMap((r: WorkerResponse) =>
      r.ok && r.type === 'screen' ? r.rows : [],
    );
    expect(rows).toHaveLength(9);
    pool.terminate();
  });

  it('havuz doluyken istekler kuyruğa alınır', async () => {
    const pool = createPool(1, fakeWorker);
    const buffer = buildBundle(6, 100);
    await pool.broadcast((id) => ({ id, type: 'init', market: 'bist', buffer: buffer.slice(0) }));

    const results = await Promise.all(
      [0, 2, 4].map((from) =>
        pool.run((id) => ({
          id,
          type: 'screen',
          market: 'bist',
          params: DEFAULT_SCREEN_PARAMS,
          from,
          to: from + 2,
        })),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    pool.terminate();
  });
});

describe('AnalysisClient', () => {
  it('paketi tüm worker’lara yükler ve taramayı böler', async () => {
    const client = new AnalysisClient({ size: 3, spawn: fakeWorker });
    const info = await client.load('bist', buildBundle(60, 120));
    expect(info.symbols).toHaveLength(60);
    expect(client.isLoaded('bist')).toBe(true);

    const { rows } = await client.screen('bist', DEFAULT_SCREEN_PARAMS);
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.symbol)).size).toBe(60); // çakışma/tekrar yok
    client.terminate();
  });

  /**
   * Paket worker'lara KLONLANARAK değil AKTARILARAK gidiyor.
   *
   * Aktarım listesi olmadan `postMessage` tamponu her worker için bir kez
   * daha kopyalar; üç worker'da dilim + klon = paketin ALTI kopyası ana iş
   * parçacığında. Ölçüldü (3 MB, üç worker, 6× yavaşlatma): klonlayarak
   * 116 ms, aktararak 57,7 ms — ana iş parçacığında 58 ms fark.
   *
   * Uçtan uca ölçüm bunu GÖSTERMEZ: örnek paket 978 KB, yani farkın üçte
   * biri ve 1.300 ms'lik radar açılışının gürültüsüne gömülüyor. Bu yüzden
   * sözleşme burada, doğrudan sınanıyor.
   */
  it('paketi klonlamadan aktarıyor', async () => {
    const aktarimlar: (Transferable[] | undefined)[] = [];
    const gozetleyen = (): WorkerLike => {
      const w = fakeWorker();
      const asil = w.postMessage.bind(w);
      w.postMessage = (message, transfer) => {
        if ((message as WorkerRequest).type === 'init') aktarimlar.push(transfer);
        asil(message, transfer);
      };
      return w;
    };

    const client = new AnalysisClient({ size: 3, spawn: gozetleyen });
    const buffer = buildBundle(10, 50);
    await client.load('bist', buffer);

    expect(aktarimlar).toHaveLength(3);
    // Her worker KENDİ dilimini aktarıyor: aynı tamponu iki kez aktarmak
    // ikincisini boş gönderirdi.
    for (const t of aktarimlar) {
      expect(t, 'aktarım listesi verilmemiş — tampon klonlanıyor').toBeDefined();
      expect(t).toHaveLength(1);
    }
    expect(new Set(aktarimlar.map((t) => t?.[0])).size).toBe(3);
    // Gönderenin elindeki tampon BOŞALMAMALI: aktarılan dilim, kaynak değil.
    expect(buffer.byteLength).toBeGreaterThan(0);
    client.terminate();
  });

  it('yüklenmemiş piyasa için açık hata verir', async () => {
    const client = new AnalysisClient({ size: 1, spawn: fakeWorker });
    await expect(client.screen('us', DEFAULT_SCREEN_PARAMS)).rejects.toThrow(/yüklenmedi/);
    client.terminate();
  });

  it('korelasyon sonucu sembol sırası ve küme kimlikleriyle döner', async () => {
    const client = new AnalysisClient({ size: 2, spawn: fakeWorker });
    await client.load('bist', buildBundle(20, 200));
    const result = await client.correlate('bist', { lookback: 150 });
    expect(result.symbols).toHaveLength(20);
    expect(result.order).toHaveLength(20);
    expect(result.clusterOf).toHaveLength(20);
    client.terminate();
  });
});

describe('performans bütçesi', () => {
  it('603 sembol × 250 bar taraması tek iş parçacığında 1 sn altında', () => {
    // Kabul ölçütü (plan §7, Faz 3): 603 sembol taraması ≤ 1 sn. Test tek
    // handler ile ölçer — gerçek uygulamada iş worker'lara bölünür, yani bu
    // üst sınırdır.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(603, 250) });

    const started = performance.now();
    const response = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 603,
    });
    const elapsed = performance.now() - started;

    expect(response.ok && response.type === 'screen' && response.rows).toHaveLength(603);
    expect(elapsed).toBeLessThan(1000);
  });

  it('603 sembol korelasyon + hiyerarşik kümeleme 3 sn altında', () => {
    // Tam matris 603² çift × 250 getiri + ortalama bağlantılı kümeleme.
    // Ölçüm ~0,5 sn; bütçe, yavaş makinede de worker'ı kilitlememesi için 3 sn.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(603, 250) });

    const started = performance.now();
    const response = handle({ id: 2, type: 'correlate', market: 'bist', lookback: 0 });
    const elapsed = performance.now() - started;

    expect(response.ok).toBe(true);
    if (response.ok && response.type === 'correlate') {
      expect(response.order).toHaveLength(603);
      expect(response.clusters).toBeGreaterThan(0);
    }
    expect(elapsed).toBeLessThan(3000);
  });
});
