#!/usr/bin/env node
/**
 * CANLI SİTE BEKÇİSİ — yayın gerçekten açılıyor mu?
 *
 * Neden var: 22 Eyl 2026 akşamı site sessizce 404 verdi. Deponun varsayılan
 * dalı eski bir daldı; GitHub zamanlanmış iş akışlarını yalnızca varsayılan
 * daldan çalıştırdığı için o dalın eski `deploy`'u eski uygulamayı derleyip
 * gh-pages'i baştan yazdı: `next.html` ve önizleme silindi. İş akışı YEŞİLDİ.
 * "Dağıtım başarılı" ile "site açılıyor" aynı iddia değil; bu betik ikincisini
 * sınıyor.
 *
 * İki kip:
 *   --dizin <yol>  Yayımlanacak (ya da klonlanmış gh-pages) ağacı denetler:
 *                  zorunlu dosyalar var mı, HTML'in yüklediği her varlık
 *                  ağaçta var mı.
 *   --url <kök>    Canlı siteyi denetler: aynı dosyalar HTTP 200 dönüyor mu.
 *                  Pages yayını dağıtımdan 1–2 dk sonra oturuyor; `--bekle N`
 *                  saniye boyunca 15 sn arayla yeniden dener.
 *
 * Çıkış kodu 0 = sağlam, 1 = bozuk (sebepler Türkçe yazılır), 2 = kullanım.
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Yayında MUTLAKA olması gerekenler. Biri yoksa site kullanıcı için bozuk. */
export const ZORUNLU = [
  'index.html',
  'next.html',
  '.nojekyll',
  'data/bist/pack/manifest.json',
  'data/bist/pack/latest-250.bin',
];

/** HTML'in doğrudan yüklediği yerel varlıklar (script, stil, modulepreload). */
export function varliklar(html) {
  const out = new Set();
  const re = /(?:src|href)="\.?\/?(assets\/[^"?#]+)"/g;
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  return [...out];
}

/** Dizin kipi: eksik yolların listesi (boşsa sağlam). */
export function dizinEksikleri(dizin) {
  const eksik = [];
  for (const yol of ZORUNLU) if (!existsSync(join(dizin, yol))) eksik.push(yol);
  for (const sayfa of ['index.html', 'next.html']) {
    const p = join(dizin, sayfa);
    if (!existsSync(p)) continue;
    for (const v of varliklar(readFileSync(p, 'utf8'))) {
      if (!existsSync(join(dizin, v))) eksik.push(`${v} (${sayfa} yüklüyor)`);
    }
  }
  return eksik;
}

async function durum(url) {
  try {
    // Önbellek kırıcı: Pages'in CDN'i 404'ü de bir süre önbellekte tutuyor;
    // yeni yayın oturmuşken eski 404'ü görüp yanlış alarm vermeyelim.
    const r = await fetch(`${url}?bekci=${Date.now()}`, { redirect: 'follow', cache: 'no-store' });
    return { kod: r.status, metin: r.ok ? await r.text() : '' };
  } catch (e) {
    return { kod: 0, metin: '', hata: e instanceof Error ? e.message : String(e) };
  }
}

/** URL kipi: bir tur denetim, eksik/bozuk olanların listesi. */
export async function urlEksikleri(kok) {
  const taban = kok.endsWith('/') ? kok : `${kok}/`;
  const eksik = [];
  const sayfalar = {};
  for (const yol of ZORUNLU) {
    if (yol === '.nojekyll') continue; // Pages bunu sunmuyor; dizin kipi sınıyor.
    const d = await durum(taban + yol);
    if (d.kod !== 200) eksik.push(`${yol} → ${d.kod || d.hata}`);
    else if (yol.endsWith('.html')) sayfalar[yol] = d.metin;
  }
  for (const [sayfa, html] of Object.entries(sayfalar)) {
    for (const v of varliklar(html)) {
      const d = await durum(taban + v);
      if (d.kod !== 200) eksik.push(`${v} (${sayfa} yüklüyor) → ${d.kod || d.hata}`);
    }
  }
  return eksik;
}

function ozetYaz(satirlar) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, satirlar.join('\n') + '\n');
}

function arg(ad) {
  const i = process.argv.indexOf(ad);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dizin = arg('--dizin');
  const url = arg('--url');
  const bekle = Number(arg('--bekle') ?? 0);
  if (!dizin && !url) {
    console.error('kullanım: site-bekcisi.mjs --dizin <yol> | --url <kök> [--bekle sn]');
    process.exit(2);
  }

  let eksik;
  if (dizin) {
    eksik = dizinEksikleri(dizin);
  } else {
    const son = Date.now() + bekle * 1000;
    for (;;) {
      eksik = await urlEksikleri(url);
      if (eksik.length === 0 || Date.now() >= son) break;
      console.log(`henüz oturmadı (${eksik.length} eksik), 15 sn sonra yeniden…`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  const hedef = dizin ?? url;
  if (eksik.length === 0) {
    console.log(`✓ site sağlam: ${hedef}`);
    ozetYaz([`### ✓ Site sağlam`, '', hedef]);
    return;
  }
  console.error(`✗ site BOZUK: ${hedef}`);
  for (const e of eksik) console.error(`  - ${e}`);
  ozetYaz([`### ✗ Site bozuk`, '', hedef, '', ...eksik.map((e) => `- ${e}`)]);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
