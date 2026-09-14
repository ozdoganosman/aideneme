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

  let interaction = null;
  if (actions) interaction = await actions(page);

  const long = await page.evaluate(() => window.__long ?? []);
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

/** Aynı senaryoyu RUNS kez ölçüp medyanını döndür. */
async function repeat(name, url, ready, actions) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(name, url, ready, actions));
  const pick = (key) => median(runs.map((r) => r[key]));
  const interactionKeys = runs[0].interaction ? Object.keys(runs[0].interaction) : [];
  return {
    name,
    ready_ms: pick('ready_ms'),
    fcp: pick('fcp'),
    longTasks: pick('longTasks'),
    worstLongTask: pick('worstLongTask'),
    totalBlocking: pick('totalBlocking'),
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
      () => !document.querySelector('.screener__status .ui-badge')?.textContent?.includes('Hesaplanıyor'),
      { timeout: 60000 },
    );
    return { 'parametre→sonuç_ms': Date.now() - t };
  }),
);

results.push(
  await repeat('sembol masası (grafik)', `${BASE}?v=sembol&s=THYAO`, '.desk__health', async (page) => {
    const t = Date.now();
    await page.getByRole('tab', { name: 'Haftalık' }).click();
    await page.waitForTimeout(50);
    await page.waitForFunction(() => !!document.querySelector('.chart-host canvas'), { timeout: 30000 });
    return { 'periyot_değişimi_ms': Date.now() - t };
  }),
);

results.push(
  await repeat('laboratuvar (backtest)', `${BASE}?v=laboratuvar&s=THYAO`, '.lab__stats', async (page) => {
    const t = Date.now();
    await page.getByRole('button', { name: 'Doğrulamayı çalıştır' }).click();
    await page.waitForSelector('.lab__badge', { timeout: 180000 });
    return { 'doğrulama_ms': Date.now() - t };
  }),
);

results.push(await repeat('karşılaştır', `${BASE}?v=karsilastir&cmp=THYAO,GARAN,ASELS`, '.compare__matrix'));

// Fazlardan sonra eklenen ekranlar: en ağır iki iş (1600 backtest ve model
// eğitimi) burada. İkisi de worker'da koşuyor; ölçüm bunu doğruluyor.
results.push(
  await repeat('stratejiler (1600 backtest)', `${BASE}?v=stratejiler`, '.rank__table tbody tr', async (page) => {
    const t = Date.now();
    await page.getByLabel('Kapsam').selectOption('symbol');
    await page.waitForFunction(
      () => document.querySelectorAll('.rank__table tbody tr').length > 0,
      { timeout: 120000 },
    );
    return { 'kapsam_değişimi_ms': Date.now() - t };
  }),
);

results.push(
  await repeat('model (purged CV)', `${BASE}?v=model&s=THYAO`, '.model__verdict'),
);

results.push(await repeat('rapor', `${BASE}?v=rapor&s=THYAO`, '.report__sheet'));

console.log(`\nCPU yavaşlatma: ${THROTTLE}× · ${RUNS} tekrarın medyanı\n`);
for (const r of results) {
  console.log(
    `${r.name.padEnd(34)} hazır ${String(r.ready_ms).padStart(6)} ms · FCP ${String(r.fcp).padStart(5)} ms · ` +
      `uzun görev ${String(r.longTasks).padStart(3)} (en kötü ${String(r.worstLongTask).padStart(4)} ms, toplam blok ${String(r.totalBlocking).padStart(5)} ms)` +
      (r.interaction ? ` · ${Object.entries(r.interaction).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''),
  );
}
await browser.close();
