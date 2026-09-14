import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tanımsız CSS değişkeni SESSİZCE hiçbir şey boyamaz.
 *
 * Ölçüldü: yeni kabukta 16 kullanım tanımsızdı — yedi panelin ARKA PLANI,
 * yedisinin KENARLIĞI ve iki öğenin zemini hiç boyanmıyordu. "Kart" olması
 * gereken bloklar sayfada boşta duruyordu. Tarayıcı hata vermez, test
 * kırılmaz, yalnızca ekran yanlış görünür.
 *
 * Tarama PAKET FARKINDA olmak zorunda: bütün CSS dosyalarını tek havuz sayan
 * ilk denemem bu on altı kusurun hiçbirini görmedi, çünkü `--border` ve
 * `--surface` ESKİ uygulamanın `index.css`'inde tanımlı — yeni kabuk ise onu
 * hiç yüklemiyor. Aynı ada sahip olmak, aynı sayfada olmak demek değil.
 */

const KOK = join(process.cwd(), 'src');

/** Giriş noktası → o sayfanın YÜKLEDİĞİ stil dosyaları ve kod kökleri. */
const PAKETLER = [
  {
    ad: 'next.html (yeni kabuk)',
    css: ['ui/tokens.css', 'ui/base.css', 'ui/ui.css', 'shell/shell.css'],
    kod: ['ui', 'shell'],
    // Taramanın gerçekten çalıştığını kanıtlayan tanık. Sayı eşiği yerine
    // bilinen bir token: eşik, paket küçüldüğünde anlamsız yere kırılıyor.
    tanik: '--surface-0',
  },
  {
    ad: 'index.html (yayındaki uygulama)',
    css: ['index.css'],
    kod: ['components'],
    tanik: '--up',
  },
];

function dosyalar(dir: string, uzanti: RegExp, out: string[] = []): string[] {
  for (const ad of readdirSync(dir)) {
    const yol = join(dir, ad);
    if (statSync(yol).isDirectory()) dosyalar(yol, uzanti, out);
    else if (uzanti.test(ad)) out.push(yol);
  }
  return out;
}

function tanimlar(cssYollari: string[]): Set<string> {
  const out = new Set<string>();
  for (const göreli of cssYollari) {
    const metin = readFileSync(join(KOK, göreli), 'utf8');
    for (const m of metin.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) out.add(m[1]);
  }
  return out;
}

/** `var(` sonrası dengeli parantezle kapanan içerik ve bittiği konum. */
function icerik(metin: string, acilis: number): { govde: string; son: number } | null {
  let derinlik = 0;
  for (let i = acilis; i < metin.length; i++) {
    if (metin[i] === '(') derinlik++;
    else if (metin[i] === ')') {
      derinlik--;
      if (derinlik === 0) return { govde: metin.slice(acilis + 1, i), son: i };
    }
  }
  return null;
}

/** İlk ÜST DÜZEY virgülde ayır — iç içe var() bölünmesin. */
function ilkVirgul(govde: string): number {
  let derinlik = 0;
  for (let i = 0; i < govde.length; i++) {
    if (govde[i] === '(') derinlik++;
    else if (govde[i] === ')') derinlik--;
    else if (govde[i] === ',' && derinlik === 0) return i;
  }
  return -1;
}

/**
 * Bir `var(...)` ifadesi bir şey boyar mı?
 *
 * Yedek zinciri sonuna kadar çözülüyor. `var(--a, var(--b))` ikisi de
 * tanımsızsa boyamaz; `var(--btn, #1f2937)` ise DÜZ bir yedeğe düştüğü için
 * boyar. İlk denememde yedekli kullanımların tamamını atlıyordum — ikisi
 * de tanımsız olan gerçek bir zincir bu yüzden kaçmıştı; sonra yalnızca ad
 * arayınca da düz yedek yanlış alarm vermişti.
 */
export function cozulur(govde: string, tanimli: ReadonlySet<string>): boolean {
  const virgul = ilkVirgul(govde);
  const ad = (virgul === -1 ? govde : govde.slice(0, virgul)).trim();
  if (tanimli.has(ad)) return true;
  if (virgul === -1) return false;

  const yedek = govde.slice(virgul + 1).trim();
  if (!yedek) return false;
  if (!yedek.startsWith('var(')) return true; // düz değer: boyar
  const ic = icerik(yedek, 3);
  return ic ? cozulur(ic.govde, tanimli) : false;
}

/**
 * Metindeki boyamayan `var(...)` ifadeleri.
 *
 * Yalnızca ÜST DÜZEY ifadeler: iç içe `var()` zaten dıştakinin yedek zinciri
 * olarak çözülüyor, ayrıca raporlamak aynı kusuru iki kez saymak olurdu.
 */
export function bozukVarlar(metin: string, tanimli: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let i = metin.indexOf('var(');
  while (i !== -1) {
    const ic = icerik(metin, i + 3);
    if (!ic) {
      i = metin.indexOf('var(', i + 1);
      continue;
    }
    if (!cozulur(ic.govde, tanimli)) out.push(`var(${ic.govde})`);
    i = metin.indexOf('var(', ic.son + 1);
  }
  return out;
}

describe('CSS token sözleşmesi', () => {
  for (const paket of PAKETLER) {
    describe(paket.ad, () => {
      const tanimli = tanimlar(paket.css);

      it('tarama çalışıyor (tanık token bulundu)', () => {
        // Sayı eşiği yerine bilinen bir token: tarama bozulursa test
        // sessizce "geçer" hâle gelmesin, ama paket küçülünce de kırılmasın.
        expect(tanimli.has(paket.tanik)).toBe(true);
      });

      it('kullanılan her token bu pakette bir şey boyuyor', () => {
        const kaynaklar = [
          ...paket.css.map((c) => join(KOK, c)),
          ...paket.kod.flatMap((k) => dosyalar(join(KOK, k), /\.tsx$/)),
        ];
        const eksik: string[] = [];
        for (const dosya of kaynaklar) {
          for (const bozuk of bozukVarlar(readFileSync(dosya, 'utf8'), tanimli)) {
            eksik.push(`${dosya.replace(KOK, 'src')}: ${bozuk}`);
          }
        }
        expect(eksik).toEqual([]);
      });
    });
  }
});

describe('cozulur — yedek zinciri', () => {
  const tanimli = new Set(['--var']);

  it('tanımlı ad boyar', () => {
    expect(cozulur('--var', tanimli)).toBe(true);
  });

  it('tanımsız ad, yedeksiz: boyamaz', () => {
    expect(cozulur('--yok', tanimli)).toBe(false);
  });

  // Asıl kaçan kusur buydu: iki adım da tanımsız.
  it('tanımsız zincir (var içinde var) boyamaz', () => {
    expect(cozulur('--yok, var(--dahayok)', tanimli)).toBe(false);
  });

  it('zincirin sonundaki tanımlı ad boyar', () => {
    expect(cozulur('--yok, var(--var)', tanimli)).toBe(true);
  });

  // Ve bu yanlış alarm veriyordu: düz yedek boyar.
  it('düz yedek değeri boyar', () => {
    expect(cozulur('--yok, #1f2937', tanimli)).toBe(true);
  });

  it('iç içe var() üst düzey virgülü şaşırtmaz', () => {
    expect(bozukVarlar('color: var(--yok, var(--var));', tanimli)).toEqual([]);
    expect(bozukVarlar('color: var(--yok, var(--hicyok));', tanimli)).toEqual([
      'var(--yok, var(--hicyok))',
    ]);
  });
});
