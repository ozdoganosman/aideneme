import { expect, test } from '@playwright/test';
import { DENETIM_ADLARI, EKRANLAR, denetimEkranlari } from './ekranlar';

/**
 * DENETİM KAPSAMI.
 *
 * Asıl koruma listenin TEK olmasında: yeni bir ekran eklendiğinde beş
 * denetime birden giriyor, unutmak mümkün değil. Bu dosya o yapının
 * çürümesini engelliyor — gerekçesiz bir hariç tutma, boş bir gerekçe ya da
 * artık geçersiz bir kayıt sessizce kalmasın.
 *
 * Tarayıcı gerekmiyor: listeyi okuyan saf bir sınama.
 */
test.describe('Denetim kapsamı', () => {
  test('her ekranın kimliği benzersiz', () => {
    const idler = EKRANLAR.map((e) => e.id);
    expect(idler).toEqual([...new Set(idler)]);
  });

  test('her hariç tutmanın yazılı bir gerekçesi var', () => {
    for (const e of EKRANLAR) {
      for (const h of e.haric ?? []) {
        expect(DENETIM_ADLARI, `${e.id}: "${h.denetim}" diye bir denetim yok`).toContain(h.denetim);
        // Gerekçe BOŞ OLAMAZ: tek kelimelik bir not, bu alanı onay damgasına
        // çevirirdi. Amaç "unuttum" ile "gerek yok"u ayırt etmek.
        expect(
          h.neden.trim().length,
          `${e.id} → ${h.denetim}: gerekçe yazılmamış ya da çok kısa`,
        ).toBeGreaterThan(40);
      }
    }
  });

  test('aynı denetim iki kez hariç tutulmamış', () => {
    for (const e of EKRANLAR) {
      const d = (e.haric ?? []).map((h) => h.denetim);
      expect(d, `${e.id}: yinelenen hariç kaydı`).toEqual([...new Set(d)]);
    }
  });

  // Hiçbir ekran BEŞ denetimden birden çıkarılamaz: o zaman ekran hiç
  // denetlenmiyor demektir ve listede durması yanıltıcı olur.
  test('hiçbir ekran tüm denetimlerin dışında değil', () => {
    for (const e of EKRANLAR) {
      const kalan = DENETIM_ADLARI.filter((d) => !e.haric?.some((h) => h.denetim === d));
      expect(kalan.length, `${e.id}: hiçbir denetim kapsamıyor`).toBeGreaterThan(0);
    }
  });

  // Her denetim en az bir ekran görmeli — `denetimEkranlari` yanlış bir ada
  // boş liste dönerse denetim sessizce hiçbir şey sınamaz hâle gelir.
  test('her denetim en az bir ekran geziyor', () => {
    for (const d of DENETIM_ADLARI) {
      expect(denetimEkranlari(d).length, `${d}: hiç ekran yok`).toBeGreaterThan(0);
    }
  });
});
