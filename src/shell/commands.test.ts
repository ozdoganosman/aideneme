import { describe, expect, it, vi } from 'vitest';
import { buildCommands, filterCommands } from './commands';
import { SCREENS } from './nav';

function makeCommands() {
  return buildCommands({ goTo: vi.fn(), setTheme: vi.fn(), openGallery: vi.fn() });
}

describe('buildCommands', () => {
  it('görünür her ekran için bir gezinme komutu üretir', () => {
    const commands = makeCommands();
    for (const screen of SCREENS.filter((s) => !s.hidden)) {
      expect(commands.some((c) => c.id === `git:${screen.id}`)).toBe(true);
    }
  });

  it('komut kimlikleri benzersiz (palet çakışmaz)', () => {
    const ids = makeCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('komut çalıştırmak bağlamı çağırır', () => {
    const goTo = vi.fn();
    const commands = buildCommands({ goTo, setTheme: vi.fn(), openGallery: vi.fn() });
    commands.find((c) => c.id === 'git:tarayici')!.run();
    expect(goTo).toHaveBeenCalledWith('tarayici');
  });
});

describe('filterCommands', () => {
  const commands = makeCommands();

  it('boş sorgu tüm komutları verir', () => {
    expect(filterCommands(commands, '')).toHaveLength(commands.length);
  });

  it('Türkçe büyük/küçük harf ve aksan farkını yok sayar', () => {
    expect(filterCommands(commands, 'TARAYICI')[0].id).toBe('git:tarayici');
    expect(filterCommands(commands, 'tarayici')[0].id).toBe('git:tarayici');
    expect(filterCommands(commands, 'karsilastir')[0].id).toBe('git:karsilastir');
  });

  it('anahtar kelimeden de bulur', () => {
    const ids = filterCommands(commands, 'dark').map((c) => c.id);
    expect(ids).toContain('tema:dark');
  });

  it('eşleşme yoksa boş döner', () => {
    expect(filterCommands(commands, 'zzzzz')).toHaveLength(0);
  });

  it('başlıkla başlayan eşleşme, sadece anahtar kelimede geçenden önce gelir', () => {
    const result = filterCommands(commands, 'tema');
    expect(result[0].group).toBe('Görünüm');
  });
});
