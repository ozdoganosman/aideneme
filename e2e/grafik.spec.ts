import { expect, test } from '@playwright/test';
import { SEMBOL, SEMBOL2 } from './semboller';

/**
 * Grafik ekranının DİKEY düzeni.
 *
 * Kullanıcı isteği: "grafik ekranı çok önemli, grafiği olabildiğince genişlet
 * dikeyde". İki ayrı kusur ölçüldü ve ikisi de buradan korunuyor:
 *
 * 1. Grafik kabı `flex: 1` ile büyüyordu ve kapsayıcının `min-height: 100%`
 *    değeriyle birlikte 1.344 px'e çıkıyordu — görünür alan ise 905 px. Yani
 *    grafiğin alt üçte biri ve altındaki metrik kartları ekranın DIŞINDA
 *    kalıyordu. (Ölçüm: hem bu sürümde hem bir önceki sürümde aynı sayı.)
 * 2. İndikatör panelleri kapalıyken bile paylarını alıyordu: esneme
 *    katsayıları kuruluşta 3/1/1 olarak sabitleniyordu, yani iki panel de
 *    kapalıyken fiyat grafiğin yalnızca %59,8'ini kullanıyordu. Katsayı artık
 *    panelin AÇIK olup olmamasına göre veriliyor ve oran %98,9'a çıkıyor.
 *
 * Birim testi bunu yakalayamaz: jsdom düzen hesaplamaz, yükseklikler 0'dır.
 */
test.describe('Sembol Masası — grafik yüksekliği', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('grafik görünür alana sığıyor ve ondan küçük değil', async ({ page }) => {
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    // 1,5 s: kusur ANINDA görünmüyor. Grafik kütüphanesi kabı gözlemleyip
    // yeniden boyutlanıyor ve şişme bir sonraki düzen turunda oluşuyor —
    // 500 ms ile ölçüldüğünde kusurlu sürüm bile "geçiyordu".
    await page.waitForTimeout(1500);

    const olcum = await page.evaluate(() => {
      const kap = document.querySelector('.desk__chart') as HTMLElement;
      const kaydirma = document.querySelector('.shell-content') as HTMLElement;
      return { grafik: kap.clientHeight, gorunur: kaydirma.clientHeight };
    });

    // Taşmıyor: grafik görünür alandan yüksek olamaz.
    expect(olcum.grafik, 'grafik görünür alanı taşıyor').toBeLessThanOrEqual(olcum.gorunur);
    // Ama ezilmiyor da: alanın yarısından fazlasını alıyor. Sabit bir piksel
    // değeri yerine ORAN: pencere boyu değişince eşik anlamsızlaşmasın.
    expect(olcum.grafik, 'grafik dikeyde eziliyor').toBeGreaterThan(olcum.gorunur * 0.5);
  });

  test('kapalı indikatör paneli yer kaplamıyor', async ({ page }) => {
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    /**
     * Kütüphane panelleri bir tablo satırı olarak çiziyor: ilk satır fiyat
     * paneli, aradakiler indikatör panelleri, sonuncusu zaman ekseni.
     *
     * Ölçüm ORAN üzerinden: mutlak piksel, pencere boyuna ve daha önce
     * düzeltilen yükseklik kusuruna bağlı olduğu için iki sürümde de
     * "geçebiliyordu" — ölçüldü, bu testin ilk hâli kusurlu sürümde de
     * yeşil kalmıştı.
     */
    const fiyatPayi = async () =>
      page.evaluate(() => {
        const satirlar = [...document.querySelectorAll('.chart-host tr')].map(
          (r) => (r as HTMLElement).clientHeight,
        );
        if (satirlar.length < 2) return 0;
        // Son satır zaman ekseni: panel payına girmiyor.
        const paneller = satirlar.slice(0, -1);
        const toplam = paneller.reduce((a, b) => a + b, 0);
        return toplam > 0 ? paneller[0] / toplam : 0;
      });

    const kapali = await fiyatPayi();
    expect(
      kapali,
      'iki panel de kapalıyken fiyat alanı grafiğin tamamına yakın olmalı',
    ).toBeGreaterThan(0.85);

    /*
      Kapalı panel KURULMUYOR da.

      Eskiden paneller ve serileri her zaman yaratılıyor, kapalıyken yalnızca
      esneme katsayısı 0'a çekiliyordu: grafik 15 tuvalle açılıyordu. Ölçüldü
      (6× yavaşlatma, gerçek veri): ilk karenin bloku 409 ms'den 294 ms'ye,
      toplam blok 649 ms'den 418 ms'ye indi. Bu maliyet her SEMBOL
      DEĞİŞİMİNDE ödeniyor, yani sık yol.
    */
    const tuval = async () => page.locator('.chart-host canvas').count();
    expect(await tuval(), 'kapalı panellerin tuvalleri de kurulmamalı').toBeLessThan(9);

    // Anahtarın adı artık PARAMETREYİ de taşıyor (göstergeler kayıt
    // defterinden geliyor ve aynı gösterge birden çok kez eklenebiliyor).
    await page.getByText('%R 260 · 260 · 120', { exact: true }).click();
    await page.waitForTimeout(1500);
    const acik = await fiyatPayi();
    expect(acik, 'panel açılınca fiyat payı düşmeli').toBeLessThan(kapali);
    expect(acik, 'açık panel fiyatı ezmemeli').toBeGreaterThan(0.6);
    // Panel açılınca gerçekten KURULUYOR (tembellik sessiz bir kayıp olmasın).
    expect(await tuval(), 'panel açıldı ama tuvalleri kurulmadı').toBeGreaterThan(9);
  });
});

/**
 * Finansal kolon grafiğinin YATAY düzeni.
 *
 * Gerçek BIST verisiyle (THYAO, 8 çeyrek) ölçülen kusur — örnek veride
 * görünmüyordu çünkü orada dönem etiketleri kısaydı:
 *
 * 1. `grid-template-columns: repeat(n, 1fr)` aslında `minmax(auto, 1fr)`
 *    demek. "2025/12" gibi uzun bir etiket kendi kolonunu genişletiyordu:
 *    sekiz kolonun ikisi 45,7 px, altısı 38,7 px oluyordu. Yani etiketler
 *    çubuk MERKEZLERİNDEN kayıyordu — grafik yanlış okunuyordu.
 * 2. Etiket satırı 256 px'lik kaba 338 px sığmaya çalışıp panelin dışına,
 *    yanındaki grafiğin üstüne taşıyordu.
 *
 * Birim testi bunu yakalayamaz: ızgara kolon genişliği bir DÜZEN sonucudur,
 * jsdom hesaplamaz.
 */
test.describe('Finansallar — kolon grafiği etiketleri', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('etiketler panele sığıyor ve çubuklarla hizalı', async ({ page }) => {
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page
      .getByRole('tab', { name: /finansal/i })
      .first()
      .click();
    /*
      Bu testin iddiası KOLON GRAFİĞİNİN hizalaması; tablosu olmayan bir
      sembolde çizilecek kolon yok. Gerçek veride ölçüldü: ISKUR'un finansal
      tablosu kaynakta yok ve ekran doğru olanı yapıp boş durum çiziyor.
      Beklemek 30 saniyeyi karşılıksız harcıyordu.

      Sessizce geçmek yerine GEREKÇEYLE atlanıyor: "sınanamadı" ile "sınandı
      ve geçti" aynı şey değil.
    */
    await page.waitForSelector('.barseries, .ui-empty', { timeout: 30_000 });
    test.skip(
      (await page.locator('.barseries').count()) === 0,
      `${SEMBOL}: finansal tablo yok — kolon grafiği çizilmiyor, hizalama sınanamaz`,
    );

    const paneller = await page.evaluate(() =>
      [...document.querySelectorAll('.barseries')].map((fig) => {
        const satir = fig.querySelector('.barseries__labels') as HTMLElement;
        const kap = fig.querySelector('.barseries__kap') as HTMLElement;
        const genislikler = getComputedStyle(satir)
          .gridTemplateColumns.split(' ')
          .map((x) => parseFloat(x))
          .filter((x) => Number.isFinite(x));
        return {
          satirGenislik: satir.clientWidth,
          satirIcerik: satir.scrollWidth,
          figIcerik: (fig as HTMLElement).scrollWidth,
          figGenislik: (fig as HTMLElement).clientWidth,
          kapGenislik: kap.clientWidth,
          genislikler,
          // Kırpılan etiket: kolonuna sığmayan metin `overflow: hidden`
          // yüzünden TAŞMIYOR ama yarısı kesiliyor — "2025/12" yerine
          // "2025/" okunuyor. Düzen ölçümü bunu yakalamaz, bu yakalar.
          kirpilan: [...satir.children]
            .filter((c) => !c.classList.contains('is-hidden'))
            .filter((c) => c.scrollWidth > c.clientWidth + 1)
            .map((c) => (c as HTMLElement).innerText),
        };
      }),
    );

    expect(paneller.length, 'kolon grafiği çizilmemiş').toBeGreaterThan(0);

    for (const p of paneller) {
      // Taşma: satırın içeriği kabından geniş olamaz (1 px yuvarlama payı).
      expect(p.satirIcerik, 'etiket satırı kabını taşıyor').toBeLessThanOrEqual(
        p.satirGenislik + 1,
      );
      expect(p.figIcerik, 'kolon grafiği panelini taşıyor').toBeLessThanOrEqual(p.figGenislik + 1);
      // Hizalama: çubuklar EŞİT aralıklı çiziliyor, kolonlar da eşit olmalı.
      // Alt piksel yuvarlaması için 1 px tolerans.
      const enDar = Math.min(...p.genislikler);
      const enGenis = Math.max(...p.genislikler);
      expect(
        enGenis - enDar,
        'ızgara kolonları eşit değil — etiketler çubuktan kayar',
      ).toBeLessThanOrEqual(1);
      // Etiket satırı grafik kabıyla aynı genişlikte: ikisi aynı ızgara
      // sütununda, kayarlarsa hizalama yine bozulur.
      expect(Math.abs(p.satirGenislik - p.kapGenislik)).toBeLessThanOrEqual(1);
      // Okunabilirlik: görünür etiketlerin hiçbiri kırpılmıyor.
      expect(p.kirpilan, `kırpılan etiket: ${p.kirpilan.join(', ')}`).toEqual([]);
    }
  });
});

/**
 * Hisse değişiminde görünüm korunmuyordu.
 *
 * Kullanıcı bildirdi: "tarayıcıdan hisse değiştirdiğimizde grafikte konum ve
 * genişlik korunmuyor". Gerçek BIST verisiyle ölçüldü:
 *   THYAO  yakınlaştır + geçmişe kaydır → 2026-05-26 → 2026-08-05 (45,3 bar)
 *   A1CAP  radardan tıkla               → 2026-03-26 → 2026-09-18 (119 bar)
 * 119 bar, "sığdır" dalının son 120 mumu çerçevelemesi: görünüm tamamen
 * kayboluyordu. Sebep, `fitKey`in sembolü içermemesine RAĞMEN grafiğin
 * gerçekten sökülmesiydi — yükleme ekranı bileşenin yerini alıyor, grafik
 * nesnesi yok ediliyor, korunacak canlı bir görünüm kalmıyordu.
 *
 * Birim testi tek başına yetmiyor: kusur React'in söküp yeniden kurmasında,
 * yani LOD denetleyicisinin DIŞINDA. (Tam sayfa yeniden yükleme kapsam dışı:
 * orada belge de gidiyor, korunacak bir şey kalmıyor.)
 */
test.describe('Sembol Masası — hisse değişiminde görünüm', () => {
  test.use({ viewport: { width: 1500, height: 950 } });

  test('yakınlaştırma ve konum sembol değişince korunuyor', async ({ page }) => {
    const ozet = async () => (await page.locator('.chart-ozet').first().textContent()) ?? '';

    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    // Yakınlaştır ve geçmişe kaydır: hem genişlik hem konum varsayılandan uzak.
    const kutu = (await page.locator('.chart-host').boundingBox())!;
    await page.mouse.move(kutu.x + kutu.width * 0.7, kutu.y + kutu.height / 2);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.mouse.down();
    await page.mouse.move(kutu.x + kutu.width * 0.7 + 400, kutu.y + kutu.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    const once = await ozet();
    expect(once, 'görünen aralık özeti yazılmamış').toMatch(/Görünen aralık:/);

    /**
     * Veriyi YAVAŞLAT.
     *
     * Kusurun kendisi yükleme ekranında: `load.status === 'loading'` iken
     * grafik bileşeni tamamen sökülüyor. Örnek veri anında geldiği için o
     * durum hiç commit edilmiyordu ve test KUSURLU sürümde de yeşil kalıyordu
     * (ölçüldü). Gerçek BIST verisinde yükleme yüzlerce ms sürüyor.
     */
    await page.route('**/data/**', async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // Tarayıcıdan (radar) başka bir hisseye geç — kullanıcının bildirdiği yol.
    await page.getByText('Radar', { exact: true }).first().click();
    await page.waitForSelector('.radar__tablo', { timeout: 60_000 });
    // Kapsam "piyasa": varsayılan daraltılmış kapsamda aranan sembol olmayabilir.
    await page.getByLabel('Kapsam').selectOption('piyasa');
    await page.waitForFunction(
      () => document.querySelectorAll('.radar__tablo tbody tr').length > 5,
      undefined,
      { timeout: 60_000 },
    );
    await page.getByPlaceholder('Sembol ara').fill(SEMBOL2);
    await page.waitForFunction(
      () => document.querySelectorAll('.radar__tablo tbody tr').length === 1,
      undefined,
      { timeout: 30_000 },
    );
    // Satırın ORTASI değil ilk hücresi tıklanabilir.
    await page.locator('.radar__tablo tbody tr').first().locator('td').first().click();
    await page.waitForTimeout(2200);

    expect(new URL(page.url()).searchParams.get('s'), 'sembol değişmemiş').toBe(SEMBOL2);

    /*
      ÖZELLİĞİN GERÇEK SÖZÜ: yakınlaştırma HER ZAMAN korunur, tarihler ise
      yeni sembolde o tarihlerde VERİ VARSA.

      Burada tam metin eşitliği isteniyordu ve iki sembolün geçmişi çakıştığı
      sürece bu tutuyordu. Kısa geçmişli gerçek sembollerle düştü: ISKUR'da
      2024-06 → 2025-10 aralığına bakılıyor, GENKM'in verisi 2026-03'te
      başlıyor. O pencereyi korumak BOMBOŞ bir grafik çizmek olurdu; ürün
      doğru olanı yapıyor ve yakınlaştırmayı (45 bar) koruyup son bara
      yapışıyor — `lod.ts` bunu zaten böyle belgeliyor.

      Yani kusur üründe değil, testin sözü fazla geniş okumasındaydı. Sınanan
      şey artık DEĞİŞMEZ olan: bar sayısı. Tarihler yalnızca yeni sembolün
      verisi o pencereyi kapsıyorsa isteniyor.
    */
    const barSayisi = (metin: string) => metin.match(/·\s*(\d+)\s*bar/)?.[1] ?? '';
    const sonra = await ozet();
    expect(barSayisi(sonra), 'yakınlaştırma düzeyi korunmadı').toBe(barSayisi(once));

    /*
      TARİH İDDİASI KOŞULLU — ama gevşek değil.

      Korunan pencere kaynak sembolün geçmişinden alındı. Hedef sembolün
      geçmişi kaynağınkinden ERKEN başlıyorsa o pencere hedefte de mutlaka
      vardır; orada TAM eşitlik isteniyor (testin asıl koruduğu iddia bu ve
      normal sembollerde — THYAO→GARAN — hep bu dal koşuyor).

      Geç başlıyorsa pencere hedefte olmayabilir; orada tarih eşitliği
      istemek ürüne boş grafik çizdirmek olurdu. O dalda görünümün son bara
      yapıştığı sınanıyor: veri neredeyse kullanıcı oraya götürülüyor.
    */
    const araliklar = await page.evaluate(async () => {
      const m = (await (await fetch('/data/bist/pack/manifest.json')).json()) as {
        symbols: Record<string, { d0: number; d1: number }>;
      };
      return m.symbols;
    });
    const kaynak = araliklar[SEMBOL];
    const hedef = araliklar[SEMBOL2];
    expect(kaynak && hedef, 'manifest kayıtları okunamadı').toBeTruthy();

    if (hedef.d0 <= kaynak.d0) {
      expect(sonra, 'hisse değişince görünüm sıfırlandı').toBe(once);
    } else {
      // Hedefin SON barı görünümün içinde olmalı: gün → "3 Oca 2026" biçimi.
      const sonGun = new Date((hedef.d1 + 1) * 86_400_000).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      expect(sonra, 'görünüm verinin bulunduğu yere götürmedi').toContain(sonGun.replace('.', ''));
    }
  });
});

/**
 * Sekme değişiminde grafik SÖKÜLMÜYOR.
 *
 * Kullanıcı isteği "hem finansallara hem grafiklere kolayca erişip"
 * diyordu. Grafik başka sekmeye geçince yok edilip geri dönüşte yeniden
 * kuruluyordu; zayıf makinede ölçüldü (6× yavaşlatma, gerçek BIST verisi):
 * finansallardan grafiğe dönüş 540 ms ve içinde 233 ms'lik bir donma.
 * Gizlemeyle 334 ms ve 149 ms. Gizliyken uzun görev üretmiyor ve düzende
 * yer kaplamıyor (0×0), yani bedeli yok.
 */
test.describe('Sembol Masası — sekme değişimi', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('finansallara geçince grafik yaşıyor, dönünce görünüm duruyor', async ({ page }) => {
    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    const kutu = (await page.locator('.chart-host').boundingBox())!;
    await page.mouse.move(kutu.x + kutu.width * 0.7, kutu.y + kutu.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(700);
    const once = (await page.locator('.chart-ozet').first().textContent()) ?? '';
    expect(once).toMatch(/Görünen aralık:/);

    await page
      .getByRole('tab', { name: /finansal/i })
      .first()
      .click();
    // Sınanan şey GRAFİĞİN sekme değişiminde yaşaması; finansal içeriğin
    // dolu olması şart değil. Tablosu olmayan sembolde boş durum çiziliyor
    // ve sekme yine değişmiş oluyor — asıl iddia orada da geçerli.
    await page.waitForSelector('.barseries, .ui-empty', { timeout: 30_000 });

    // Grafik DOM'da duruyor ama gizli: ne çizim yapıyor ne yer kaplıyor.
    const kap = page.locator('.desk__grafikalan');
    await expect(kap, 'grafik sekme değişiminde sökülmüş').toHaveCount(1);
    await expect(kap).toBeHidden();
    expect(
      await page.evaluate(() => {
        const d = document.querySelector('.desk__grafikalan') as HTMLElement | null;
        const r = d?.getBoundingClientRect();
        return r ? Math.round(r.width * r.height) : -1;
      }),
      'gizli grafik düzende yer kaplıyor',
    ).toBe(0);

    await page.getByRole('tab', { name: 'Grafik' }).first().click();
    await page.waitForTimeout(1200);
    await expect(kap).toBeVisible();
    expect(
      (await page.locator('.chart-ozet').first().textContent()) ?? '',
      'sekmeden dönünce görünüm sıfırlandı',
    ).toBe(once);
  });
});

/**
 * BAŞKA EKRANA gidip dönünce de görünüm korunmalı.
 *
 * Kullanıcı bildirdi: "başka sayfalara geçip geri gelince de grafik konum ve
 * aralığını korusun". Görünüm sembol masasının içindeki bir ref'te
 * taşınıyordu; masa ekran değişiminde söküldüğü için ref de gidiyordu.
 * Ölçüldü (gerçek BIST verisi): 45 barlık görünüm Nabız, Tarayıcı ve
 * Portföy'den dönüşte 119 bara (sığdırma varsayılanı) düşüyordu — üçünde de.
 */
test.describe('Sembol Masası — ekran değişimi', () => {
  test.use({ viewport: { width: 1500, height: 950 } });

  test('başka ekrana gidip dönünce görünüm duruyor', async ({ page }) => {
    const ozet = async () => (await page.locator('.chart-ozet').first().textContent()) ?? '';

    await page.goto(`/next.html?m=bist&v=sembol&s=${SEMBOL}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chart-host canvas', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    const kutu = (await page.locator('.chart-host').boundingBox())!;
    await page.mouse.move(kutu.x + kutu.width * 0.7, kutu.y + kutu.height / 2);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    // Sağ kenardan da uzaklaş: hem genişlik hem KONUM sınanıyor.
    await page.mouse.down();
    await page.mouse.move(kutu.x + kutu.width * 0.7 + 300, kutu.y + kutu.height / 2, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    const once = await ozet();
    expect(once).toMatch(/Görünen aralık:/);

    // Her ekran ayrı sınanıyor: biri korurken öteki kaybedebilir.
    for (const [ad, hazir] of [
      ['Nabız', '.pulse__flows'],
      ['Tarayıcı', '.ui-vtable'],
      ['Portföy', '.ui-field'],
    ] as const) {
      await page.getByRole('button', { name: ad, exact: true }).first().click();
      await page.waitForSelector(hazir, { timeout: 120_000 });
      await page.getByRole('button', { name: 'Sembol Masası', exact: true }).first().click();
      await page.waitForSelector('.chart-host canvas', { timeout: 120_000 });
      await page.waitForTimeout(1200);
      expect(await ozet(), `${ad} ekranından dönüşte görünüm sıfırlandı`).toBe(once);
    }
  });
});
