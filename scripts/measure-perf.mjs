#!/usr/bin/env node
/**
 * Zayıf makine performans ölçümü.
 *
 * CPU'yu yavaşlatarak (varsayılan 6×, düşük güçlü bir dizüstüne yakın) her
 * ekranın hazır olma süresini, ilk boyamayı ve ANA THREAD BLOKLARINI ölçer.
 * Uzun görev (>50 ms) sayısı ve toplam blok süresi, "akıcı mı" sorusunun
 * ölçülebilir karşılığıdır — ortalama FPS değil.
 *
 * Kullanım:
 *   npm run build && npx vite preview --port 4182 &
 *   npm i -D playwright        # depoya eklenmedi: yalnızca ölçüm aracı
 *   node scripts/measure-perf.mjs [yavaşlatma] [tekrar]
 *
 * Tek ölçüm gürültülüdür (aynı kodda %30 sapma görülebilir); varsayılan 3
 * tekrarın MEDYANI raporlanır.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4182/next.html';
const THROTTLE = Number(process.argv[2] ?? 6); // 1 = yok, 6 ≈ düşük güçlü dizüstü
const RUNS = Number(process.argv[3] ?? 3);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function measure(name, url, ready, actions) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // Uzun görevleri (>50ms ana thread bloğu) topla.
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
    }).observe({ entryTypes: ['longtask'] });
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(ready, { timeout: 120000 });
  const ready_ms = Date.now() - t0;

  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
      transferKB: nav ? Math.round(nav.transferSize / 1024) : null,
    };
  });

  // Uzun görevler AÇILIŞ aşamasına ait olmalı: etkileşim ölçümleri (yakınlaştırma,
  // kaydırma) kendi bloklarını ayrı alanlarda raporluyor. İkisini tek sayıya
  // katsaydık "açılışta kaç blok var" sorusu ölçüme göre değişirdi.
  const long = await page.evaluate(() => [...(window.__long ?? [])]);

  let interaction = null;
  if (actions) interaction = await actions(page);
  await ctx.close();

  return {
    name,
    ready_ms,
    fcp: paint.fcp,
    longTasks: long.length,
    worstLongTask: long.length ? Math.max(...long) : 0,
    totalBlocking: long.reduce((s, d) => s + Math.max(0, d - 50), 0),
    interaction,
  };
}

/**
 * Aynı senaryoyu RUNS kez ölçüp medyanını VE yayılımını döndür.
 *
 * Yayılım neden raporlanıyor: bu araç bir kez çalıştırılıp iki commit
 * karşılaştırıldığında yanıltıyor. Ölçüldü — DEĞİŞMEYEN bir derlemede
 * üç ayrı çalıştırma Nabız için 406 / 190 / 212 ms "en kötü blok" verdi
 * (2,1× fark). Tek sayıya bakan biri buradan rahatlıkla "şu ekran
 * yavaşlamış" sonucunu çıkarır; çıkardım da, yanlıştı. Medyanın yanında
 * min–maks görünürse o yanılgı mümkün olmuyor.
 */
async function repeat(name, url, ready, actions) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(name, url, ready, actions));
  const values = (key) => runs.map((r) => r[key]);
  const pick = (key) => median(values(key));
  const spread = (key) => {
    const v = values(key);
    return { min: Math.min(...v), max: Math.max(...v) };
  };
  const interactionKeys = runs[0].interaction ? Object.keys(runs[0].interaction) : [];
  return {
    name,
    ready_ms: pick('ready_ms'),
    fcp: pick('fcp'),
    longTasks: pick('longTasks'),
    worstLongTask: pick('worstLongTask'),
    totalBlocking: pick('totalBlocking'),
    spread: {
      ready_ms: spread('ready_ms'),
      worstLongTask: spread('worstLongTask'),
      totalBlocking: spread('totalBlocking'),
    },
    interaction: interactionKeys.length
      ? Object.fromEntries(
          interactionKeys.map((k) => [k, median(runs.map((r) => r.interaction[k]))]),
        )
      : null,
  };
}

const results = [];

results.push(await repeat('nabız (200 sembol, ısı haritası)', `${BASE}?v=nabiz`, '.pulse__flows'));

results.push(
  await repeat('tarayıcı', `${BASE}?v=tarayici`, '.ui-vtable', async (page) => {
    const input = page.getByLabel('RSI uzunluk');
    await input.click();
    await input.press('Control+a');
    const t = Date.now();
    await input.type('30');
    await page.waitForFunction(
      () =>
        !document
          .querySelector('.screener__status .ui-badge')
          ?.textContent?.includes('Hesaplanıyor'),
      { timeout: 60000 },
    );
    const paramMs = Date.now() - t;

    // Kaydırma akıcılığı: 40 adım, her adımda düzen okuması zorlanarak
    // kaydırmanın ANA THREAD'de kaç ms tuttuğu ölçülür. Kare süresini
    // ölçmek yanıltıcıydı: çift rAF'ın tabanı zaten iki vsync (≈33 ms).
    const scrollMs = await page.evaluate(async () => {
      const el = document.querySelector('.ui-vtable__scroll');
      if (!el) return 0;
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now();
        el.scrollTop += 120;
        void el.offsetHeight;
        total += performance.now() - t0;
        await new Promise((r) => setTimeout(r, 20));
      }
      return Math.round(total);
    });
    return { 'parametre→sonuç_ms': paramMs, kaydırma_40_adım_ms: scrollMs };
  }),
);

results.push(
  await repeat(
    'sembol masası (grafik)',
    `${BASE}?v=sembol&s=X001`,
    '.desk__health',
    async (page) => {
      const t = Date.now();
      await page.getByRole('tab', { name: 'Haftalık' }).click();
      await page.waitForTimeout(50);
      await page.waitForFunction(() => !!document.querySelector('.chart-host canvas'), {
        timeout: 30000,
      });
      const tfMs = Date.now() - t;

      // Grafik etkileşimi: 20 tekerlek adımı (uzaklaştırma) ve 20 sürükleme
      // adımı (kaydırma) sırasında ana thread'i kaç ms bloklandığı. Duvar saati
      // değil BLOK süresi ölçülüyor: takılmayı yaratan budur.
      const box = await page.locator('.chart-host').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // DİKKAT: __long dizisi sayfa yükleme ölçümünde de kullanılıyor; burada
      // SIFIRLAMAK o satırın "uzun görev" sayısını siliyordu. Sıfırlamak yerine
      // etkileşim öncesi toplam alınıp fark hesaplanıyor.
      const sumLong = () =>
        page.evaluate(() => Math.round((window.__long ?? []).reduce((s, d) => s + d, 0)));
      const beforeZoom = await sumLong();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(30);
      }
      const afterZoom = await sumLong();
      const zoomBlock = afterZoom - beforeZoom;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx - i * 8, cy);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      const panBlock = (await sumLong()) - afterZoom;
      return {
        periyot_değişimi_ms: tfMs,
        yakınlaştırma_blok_ms: zoomBlock,
        kaydırma_blok_ms: panBlock,
      };
    },
  ),
);

results.push(
  await repeat(
    'laboratuvar (backtest)',
    `${BASE}?v=laboratuvar&s=X001`,
    '.lab__stats',
    async (page) => {
      const t = Date.now();
      await page.getByRole('button', { name: 'Doğrulamayı çalıştır' }).click();
      await page.waitForSelector('.lab__badge', { timeout: 180000 });
      return { doğrulama_ms: Date.now() - t };
    },
  ),
);

results.push(
  await repeat('karşılaştır', `${BASE}?v=karsilastir&cmp=X001,X002,X003`, '.compare__matrix'),
);

// Fazlardan sonra eklenen ekranlar: en ağır iki iş (1600 backtest ve model
// eğitimi) burada. İkisi de worker'da koşuyor; ölçüm bunu doğruluyor.
results.push(
  await repeat(
    'stratejiler (1600 backtest)',
    `${BASE}?v=stratejiler`,
    '.rank__table tbody tr',
    async (page) => {
      const t = Date.now();
      await page.getByLabel('Kapsam').selectOption('symbol');
      await page.waitForFunction(
        () => document.querySelectorAll('.rank__table tbody tr').length > 0,
        { timeout: 120000 },
      );
      return { kapsam_değişimi_ms: Date.now() - t };
    },
  ),
);

results.push(await repeat('model (purged CV)', `${BASE}?v=model&s=X001`, '.model__verdict'));

results.push(await repeat('rapor', `${BASE}?v=rapor&s=X001`, '.report__sheet'));

// Sektör paneli paketi indiriyor (izinli); portföy kur serisini okuyor.
results.push(
  await repeat('sektör akranları', `${BASE}?v=sembol&s=X001`, '.desk__health', async (page) => {
    const t = Date.now();
    await page.getByRole('tab', { name: 'Sektör' }).click();
    await page.getByRole('button', { name: 'Akranları yükle' }).click();
    await page.waitForSelector('.desk__sector-table tbody tr', { timeout: 60000 });
    return { akran_yükleme_ms: Date.now() - t };
  }),
);

results.push(await repeat('portföy', `${BASE}?v=portfoy`, '.pf-form, .screener__panel, .ui-field'));

console.log(
  `\nCPU yavaşlatma: ${THROTTLE}× · ${RUNS} tekrarın medyanı (köşeli parantez: min–maks)\n`,
);
const ratio = (s) => (s.min > 0 ? s.max / s.min : s.max > 0 ? Infinity : 1);
let worstRatio = 1;
for (const r of results) {
  const b = r.spread.totalBlocking;
  worstRatio = Math.max(worstRatio, ratio(r.spread.worstLongTask), ratio(b));
  console.log(
    `${r.name.padEnd(34)} hazır ${String(r.ready_ms).padStart(6)} ms · FCP ${String(r.fcp).padStart(5)} ms · ` +
      `uzun görev ${String(r.longTasks).padStart(3)} (en kötü ${String(r.worstLongTask).padStart(4)} ms ` +
      `[${r.spread.worstLongTask.min}–${r.spread.worstLongTask.max}], toplam blok ${String(r.totalBlocking).padStart(5)} ms ` +
      `[${b.min}–${b.max}])` +
      (r.interaction
        ? ` · ${Object.entries(r.interaction)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`
        : ''),
  );
}

// Aracın kendi sınırını kullanıcıya SÖYLEMESİ gerekiyor: yayılım büyükse
// iki çalıştırmayı karşılaştırmak bir şey kanıtlamaz.
console.log(
  `\nEn geniş yayılım: ${worstRatio.toFixed(1)}×. ` +
    (worstRatio >= 1.5
      ? 'Bu tablodaki tek bir sayıya bakıp iki sürümü KARŞILAŞTIRMAYIN — ' +
        'aynı derlemede bile bu kadar sapıyor. Karşılaştırma için her sürümü ' +
        'birkaç kez çalıştırıp medyanların medyanına bakın.'
      : 'Sapma dar; karşılaştırma için kullanılabilir.'),
);
await browser.close();
