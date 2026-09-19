#!/usr/bin/env node
/**
 * Performans bütçesi kapısı.
 *
 * Bir sayfanın "ilk yük"ü = HTML'in doğrudan referans verdiği modül script'leri,
 * onların statik import ettiği chunk'lar (modulepreload) ve stylesheet'ler.
 * Lazy chunk'lar sayılmaz — zaten talep üzerine iner.
 *
 * Bütçe aşılırsa çıkış kodu 1 → CI kırmızı.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(process.cwd(), 'dist');

/** entry → { js, css } gzip bütçesi (KB). */
const BUDGETS = {
  'next.html': { js: 180, css: 40 },
  // Legacy uygulama: yeni bütçeye tabi değil, ama büyümesin diye tavanı var
  // (bugünkü değerin ~%15 üstü — sessiz şişme CI'da yakalanır).
  'index.html': { js: 160, css: 20 },
};

const gzipKB = (path) => gzipSync(readFileSync(path)).length / 1024;

function assetsFor(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const base = dirname(htmlPath);
  const refs = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(m[1]);
  const js = [];
  const css = [];
  for (const ref of refs) {
    const file = join(base, ref.replace(/^\.?\//, ''));
    if (!existsSync(file)) continue;
    if (file.endsWith('.js')) js.push(file);
    else if (file.endsWith('.css')) css.push(file);
  }
  return { js, css };
}

let failed = false;
const rows = [];

for (const [entry, budget] of Object.entries(BUDGETS)) {
  const htmlPath = join(DIST, entry);
  if (!existsSync(htmlPath)) {
    console.error(`✗ ${entry}: dist içinde yok (önce "npm run build")`);
    failed = true;
    continue;
  }
  const { js, css } = assetsFor(htmlPath);
  const jsKB = js.reduce((s, f) => s + gzipKB(f), 0);
  const cssKB = css.reduce((s, f) => s + gzipKB(f), 0);
  for (const [kind, actual, limit] of [
    ['js', jsKB, budget.js],
    ['css', cssKB, budget.css],
  ]) {
    const ok = actual <= limit;
    if (!ok) failed = true;
    rows.push(
      `${ok ? '✓' : '✗'} ${entry} ${kind.padEnd(3)} ${actual.toFixed(1).padStart(7)} KB / ${String(limit).padStart(3)} KB gzip`,
    );
  }
}

console.log(rows.join('\n'));
if (failed) {
  console.error('\nPerformans bütçesi aşıldı — bkz. docs/plan/next-gen-finans-platformu.md §5.3');
  process.exit(1);
}
console.log('\nPerformans bütçesi tamam.');
