import type { Page } from '@playwright/test';
import { coz } from './semboller';

/**
 * DENETİM EKRANLARI — TEK liste.
 *
 * Neden tek: bu oturumda BEŞ KEZ aynı kusuru yaptım. Yeni bir yüzey ekledim,
 * denetim listelerinin (kontrast, erişilebilirlik, mobil, biçim, klavye,
 * katman)
 * bir kısmını güncellemeyi unuttum, yüzey denetimsiz kaldı. Sırasıyla sektör
 * paneli, finansal sekmesi, sektör rotasyonu, radar filtre paneli ve radarın
 * "ölçülemedi" notu. Her seferinde kusuru eklerken değil SONRADAN buldum.
 *
 * Ayrı listeler varken "hangisinde eksik" sorusu gözle cevaplanıyordu ve göz
 * beş kez yetmedi. Tek liste bu soruyu ORTADAN KALDIRIYOR: yeni bir ekran
 * eklendiğinde denetimlerin HEPSİNE birden girer — sonradan eklenen `katman`
 * denetimi de on yedi ekranı kendiliğinden kapsadı. Bir denetimden çıkarmak için
 * `haric` alanına GEREKÇE yazmak gerekiyor — yani "unuttum" ile "gerek yok"
 * artık birbirinden ayrı.
 *
 * `kapsam.spec.ts` gerekçelerin boş olmadığını ve çürümediğini sınıyor.
 */
export type DenetimAdi =
  'kontrast' | 'erisilebilirlik' | 'mobil' | 'bicim' | 'klavye' | 'katman' | 'kaydirma';

export const DENETIM_ADLARI: DenetimAdi[] = [
  'kontrast',
  'erisilebilirlik',
  'mobil',
  'bicim',
  'klavye',
  'katman',
  'kaydirma',
];

export type Ekran = {
  /** Kısa, kalıcı kimlik. */
  id: string;
  /**
   * Görünen ad. Varyantlar "Ekran — varyant" biçiminde: erişilebilirlik
   * denetimi h1'i bu addan türetiyor (`ad.split(' — ')[0]`).
   */
  ad: string;
  url: string;
  hazir: string;
  /** Varsayılan KAPALI yüzeyler için açma adımı (radar, sekmeler, planlar). */
  ac?: (page: Page) => Promise<void>;
  /** Bu denetimlerden bilerek hariç — gerekçesiyle. */
  haric?: { denetim: DenetimAdi; neden: string }[];
};

/** Durumun kimliği. */
export function ekranKimligi(e: Ekran): string {
  return e.id;
}

export const EKRANLAR: Ekran[] = [
  { id: 'nabiz', ad: 'Nabız', url: 'v=nabiz', hazir: '.pulse__flows' },
  // Sektör endeksi paneli ASENKRON yükleniyor: `.pulse__flows` hazır olduğunda
  // tablosu daha çizilmemiş olabiliyor. Ayrı giriş, çünkü denetimin kör
  // noktası tam olarak buydu — varsayılan durumda GÖRÜNMEYEN yüzeyler.
  {
    id: 'nabiz:sektor-endeks',
    ad: 'Nabız — sektör endeksleri',
    url: 'v=nabiz',
    hazir: '.sektor__tablo',
  },
  {
    id: 'nabiz:rotasyon',
    ad: 'Nabız — sektör rotasyonu',
    url: 'v=nabiz',
    hazir: '.pulse__rotasyon',
    ac: async (page) => {
      await page.getByLabel('Dönem').selectOption('21');
    },
  },
  { id: 'tarayici', ad: 'Tarayıcı', url: 'v=tarayici', hazir: '.ui-vtable' },
  { id: 'sembol', ad: 'Sembol Masası', url: 'v=sembol&s={SEMBOL}', hazir: '.desk__chart' },
  {
    // Radar üç etkileşim getiriyor: sürüklenebilir ayırıcı (ok tuşlarıyla da
    // çalışmalı), filtre ve sütun panelleri. Kapalıyken denetlenmiş sayılmaz.
    id: 'sembol:radar',
    ad: 'Sembol Masası — radar',
    url: 'v=sembol&s={SEMBOL}',
    hazir: '.radar__tablo',
    ac: async (page) => {
      await page.getByText('Radar', { exact: true }).first().click();
      await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
      await page.getByLabel('Kapsam').selectOption('piyasa');
      await page.getByRole('button', { name: /^Filtre paneli/ }).click();
      // Temel veri filtresi UYGULANIYOR: "ölçülemedi" notu yalnızca böyle
      // görünüyor ve denetim görmediği yüzeyi koruyamaz.
      await page.getByRole('button', { name: 'Hazır', exact: true }).click();
      await page.getByRole('button', { name: /Ucuz ve kârlı/ }).click();
      await page.waitForSelector('.radar__olculemedi', { timeout: 30_000 });
    },
  },
  {
    /*
      FİLTRE PANELİ AYRI BİR DURUM. `sembol:radar` girdisi hazır filtreyi
      uyguluyor ve panel seçimde KAPANIYOR — yani orada panelin kendisi
      denetlenmiyor. Sektör süzgeci de bu panelin içinde; ayrı giriş
      olmasaydı yepyeni bir yüzey denetimsiz kalırdı. Bu oturumda tam olarak
      bu kusuru beş kez yaptım.
    */
    id: 'sembol:radar-filtre',
    ad: 'Sembol Masası — radar filtre paneli',
    url: 'v=sembol&s={SEMBOL}',
    hazir: '.radar__sektor',
    ac: async (page) => {
      await page.getByText('Radar', { exact: true }).first().click();
      await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
      await page.getByLabel('Kapsam').selectOption('piyasa');
      await page.getByRole('button', { name: /^Filtre paneli/ }).click();
    },
  },
  {
    /*
      GRAFİK GÖSTERGELERİ + ÖLÇÜT KIYASI. Ayrı giriş, çünkü ikisi de KATLI
      açılan bölümler: `sembol:radar-filtre` panelin kendisini geziyor ama bu
      iki bölüm kapalı duruyor, yani denetimin görmediği iki yepyeni yüzey
      olurdu. Bu dosyanın var olma sebebi tam olarak bu kusur.

      Gösterge de EKLENİYOR: eşik kutuları ve kıyas listeleri ancak ekledikten
      sonra çiziliyor.
    */
    id: 'sembol:radar-gosterge',
    ad: 'Sembol Masası — radar gösterge ve kıyas',
    url: 'v=sembol&s={SEMBOL}',
    hazir: '.radar__kiyas-kur',
    ac: async (page) => {
      await page.getByText('Radar', { exact: true }).first().click();
      await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
      await page.getByLabel('Kapsam').selectOption('piyasa');
      await page.getByRole('button', { name: /^Filtre paneli/ }).click();
      // `details` başlığına tıklamak bölümü açıyor.
      await page.getByText('Grafikteki göstergeler').click();
      await page
        .getByRole('button', { name: /ölçütlerini radardan ekle/ })
        .first()
        .click();
      await page.getByText('Ölçüt kıyası').click();
      await page.waitForSelector('.radar__kiyas-kur', { timeout: 30_000 });
    },
  },
  {
    id: 'sembol:finansallar',
    ad: 'Sembol Masası — finansallar',
    url: 'v=sembol&s={SEMBOL}',
    hazir: '.fin__karne',
    ac: async (page) => {
      await page.getByRole('tab', { name: 'Finansallar' }).click();
    },
  },
  {
    id: 'sembol:sektor',
    ad: 'Sembol Masası — sektör',
    url: 'v=sembol&s={SEMBOL}',
    hazir: '.desk__sector-table',
    ac: async (page) => {
      await page.getByRole('tab', { name: 'Sektör' }).click();
      await page.getByRole('button', { name: 'Akranları yükle' }).click();
    },
  },
  {
    id: 'karsilastir',
    ad: 'Karşılaştır',
    url: 'v=karsilastir&cmp={SEMBOL},{SEMBOL2},{SEMBOL3}',
    hazir: '.compare__matrix',
  },
  { id: 'portfoy', ad: 'Portföy', url: 'v=portfoy', hazir: '.ui-field' },
  { id: 'rapor', ad: 'Rapor', url: 'v=rapor&s={SEMBOL}', hazir: '.report__sheet' },
  {
    // UI kitaplığının tablo sekmesi: fiyat sütunu burada çiziliyor.
    id: 'kitaplik',
    ad: 'Kitaplık — tablo',
    url: 'v=kitaplik',
    hazir: '.ui-vtable',
    ac: async (page) => {
      await page.getByRole('tab', { name: /Tablo/ }).click();
    },
    haric: [
      {
        denetim: 'erisilebilirlik',
        neden:
          'Kitaplık bir ÜRÜN ekranı değil, bileşen vitrini: kendi h1’i ve ' +
          'gezinme sözleşmesi ürün ekranlarınınkinden farklı, denetimin h1 ' +
          'kuralı burada anlamsız kırılır. Bileşenlerin erişilebilirliği ' +
          'kullanıldıkları gerçek ekranlarda denetleniyor.',
      },
    ],
  },
];

/** Bir denetimin gezeceği ekranlar — hariç tutulanlar düşülmüş hâliyle. */
export function denetimEkranlari(denetim: DenetimAdi): Ekran[] {
  return EKRANLAR.filter((e) => !e.haric?.some((h) => h.denetim === denetim)).map((e) => ({
    ...e,
    url: coz(e.url),
  }));
}
