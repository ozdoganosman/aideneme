import { SCREENS } from './nav';
import { THEME_LABEL, type ThemePreference } from './theme';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Aramada da eşleşen ek kelimeler (eş anlamlılar, İngilizce karşılıklar). */
  keywords?: string[];
  /** Sağda gösterilen kısayol/ipucu. */
  hint?: string;
  run: () => void;
}

export interface CommandContext {
  goTo: (screenId: string) => void;
  setTheme: (pref: ThemePreference) => void;
  openGallery: () => void;
}

/**
 * TEK komut kayıt defteri. Ray navigasyonu, menüler ve komut paleti hep bunu
 * okur — referans projedeki "aynı eylem üç ayrı yerde elle tanımlı" sorununun
 * (46 prop'lu araç çubuğu + ayrı mobil kopya) yapısal çözümü budur.
 */
export function buildCommands(ctx: CommandContext): Command[] {
  const navCommands: Command[] = SCREENS.filter((s) => !s.hidden).map((s) => ({
    id: `git:${s.id}`,
    title: `Git: ${s.label}`,
    group: 'Gezinme',
    keywords: [s.id, s.question],
    run: () => ctx.goTo(s.id),
  }));

  const themeCommands: Command[] = (['system', 'light', 'dark'] as ThemePreference[]).map(
    (pref) => ({
      id: `tema:${pref}`,
      title: THEME_LABEL[pref],
      group: 'Görünüm',
      keywords: ['tema', 'theme', 'renk', 'dark', 'light'],
      run: () => ctx.setTheme(pref),
    }),
  );

  return [
    ...navCommands,
    ...themeCommands,
    {
      id: 'ui:kitaplik',
      title: 'UI kitaplığını aç',
      group: 'Görünüm',
      keywords: ['tasarım', 'design system', 'bileşen', 'storybook'],
      run: ctx.openGallery,
    },
  ];
}

const normalize = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/[İI]/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Sıralama: başlığı sorguyla başlayanlar önce, sonra başlıkta geçenler, sonra
 * yalnızca anahtar kelimede eşleşenler. Aynı grupta özgün sıra korunur.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = normalize(query.trim());
  if (!q) return commands;

  const scored: { cmd: Command; score: number; index: number }[] = [];
  commands.forEach((cmd, index) => {
    const title = normalize(cmd.title);
    const keywords = (cmd.keywords ?? []).map(normalize).join(' ');
    let score = -1;
    if (title.startsWith(q)) score = 3;
    else if (title.includes(q)) score = 2;
    else if (keywords.includes(q)) score = 1;
    if (score >= 0) scored.push({ cmd, score, index });
  });

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.cmd);
}
