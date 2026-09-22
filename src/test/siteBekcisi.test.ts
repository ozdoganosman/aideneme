import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Canlı site bekçisi (scripts/site-bekcisi.mjs) — GERÇEK betik alt süreçte
 * koşuyor; CI'da da bu yoldan çağrılıyor.
 *
 * Yaşanan: iş akışı yeşilken site 404 veriyordu, çünkü eski bir dalın dağıtımı
 * gh-pages'i eski uygulamayla ezmişti. Bekçinin tek işi "yeşil ama bozuk"
 * durumunu kırmızıya çevirmek.
 */
const BETIK = resolve(__dirname, '../../scripts/site-bekcisi.mjs');

function kos(dizin: string): { kod: number; cikti: string } {
  try {
    const cikti = execFileSync('node', [BETIK, '--dizin', dizin], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });
    return { kod: 0, cikti };
  } catch (e) {
    const h = e as { status: number; stdout: string; stderr: string };
    return { kod: h.status, cikti: `${h.stdout}${h.stderr}` };
  }
}

function yaz(kok: string, yol: string, icerik = 'x') {
  const tam = join(kok, yol);
  mkdirSync(join(tam, '..'), { recursive: true });
  writeFileSync(tam, icerik);
}

/** Sağlam bir yayın ağacı: iki sayfa, varlıkları ve paket. */
function saglamAgac(): string {
  const kok = mkdtempSync(join(tmpdir(), 'bekci-'));
  yaz(kok, '.nojekyll', '');
  yaz(
    kok,
    'index.html',
    '<script type="module" crossorigin src="./assets/index-A.js"></script><link rel="stylesheet" href="./assets/index-A.css">',
  );
  yaz(
    kok,
    'next.html',
    '<script type="module" src="./assets/next-B.js"></script><link rel="modulepreload" href="./assets/hooks-C.js">',
  );
  for (const v of ['index-A.js', 'index-A.css', 'next-B.js', 'hooks-C.js']) yaz(kok, `assets/${v}`);
  yaz(kok, 'data/bist/pack/manifest.json', '{}');
  yaz(kok, 'data/bist/pack/latest-250.bin');
  return kok;
}

describe('site bekçisi — dizin kipi', () => {
  it('sağlam ağaç: çıkış 0', () => {
    const kok = saglamAgac();
    try {
      const r = kos(kok);
      expect(r.kod).toBe(0);
      expect(r.cikti).toContain('site sağlam');
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  });

  it('22 Eylül vakası: next.html yok → çıkış 1 ve adıyla söylüyor', () => {
    const kok = saglamAgac();
    try {
      rmSync(join(kok, 'next.html'));
      const r = kos(kok);
      expect(r.kod).toBe(1);
      expect(r.cikti).toContain('next.html');
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  });

  it('sayfa var ama yüklediği varlık yok → bozuk (beyaz sayfa vakası)', () => {
    const kok = saglamAgac();
    try {
      rmSync(join(kok, 'assets/hooks-C.js'));
      const r = kos(kok);
      expect(r.kod).toBe(1);
      expect(r.cikti).toContain('assets/hooks-C.js (next.html yüklüyor)');
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  });

  it('veri paketi yok → bozuk: uygulama açılır ama boş kalır', () => {
    const kok = saglamAgac();
    try {
      rmSync(join(kok, 'data/bist/pack/latest-250.bin'));
      const r = kos(kok);
      expect(r.kod).toBe(1);
      expect(r.cikti).toContain('latest-250.bin');
    } finally {
      rmSync(kok, { recursive: true, force: true });
    }
  });

  it('argümansız: kullanım hatası (2), sessiz geçmiyor', () => {
    let kod = 0;
    try {
      execFileSync('node', [BETIK], { stdio: 'ignore' });
    } catch (e) {
      kod = (e as { status: number }).status;
    }
    expect(kod).toBe(2);
  });
});
