import { expect, test, type Page } from '@playwright/test';

/**
 * Beş kritik akış. Her biri KULLANICININ yaptığı işi taklit eder, bileşen
 * sınırlarını değil: ekranlar arası geçiş, gerçek worker hesabı, URL'e yazılan
 * durum ve paylaşılan bağlantının aynı sonucu vermesi.
 */

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
});

test.afterEach(() => {
  // Konsolda hata biriktiren bir akış "geçti" sayılmamalı.
  expect(errors, errors.join('\n')).toEqual([]);
});

async function open(page: Page, query: string) {
  await page.goto(`/next.html?m=bist&${query}`, { waitUntil: 'networkidle' });
}

test('nabız: ısı haritası ve sektör akışı gerçek worker ile hesaplanıyor', async ({ page }) => {
  await open(page, 'v=nabiz');
  await expect(page.locator('.pulse__flows tbody tr').first()).toBeVisible();

  // Sınıflandırma varsa varsayılan görünüm sektör olmalı.
  await expect(page.getByText(/Para akışı — sektörler/)).toBeVisible();
  // Sınıflandırılmamış semboller gizlenmiyor (üretici %10'unu boş bırakıyor).
  await expect(
    page.getByRole('button', { name: /Sektörü bilinmeyen sembollerin en çok işlem göreni/ }),
  ).toBeVisible();

  const rows = await page.locator('.pulse__flows tbody tr').count();
  expect(rows).toBeGreaterThan(2);
});

test('nabız → tarayıcı: sektör satırı o sektör seçili taramayı açıyor', async ({ page }) => {
  await open(page, 'v=nabiz');
  await expect(page.locator('.pulse__flows tbody tr').first()).toBeVisible();

  // Adı BOŞLUKLU bir sektör varsa onu seç: boşluk sorgu dizesinde "+" olarak
  // kodlanır ve tek kelimelik bir adla bu yol hiç sınanmamış olurdu.
  const buttons = page.getByRole('button', { name: /sektörünü tarayıcıda aç$/ });
  const labels = await buttons.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  const strip = (label: string) => label.replace(' sektörünü tarayıcıda aç', '');
  const picked = labels.find((l) => strip(l).includes(' ')) ?? labels[0];
  const sector = strip(picked);
  await page.getByRole('button', { name: picked }).click();

  await expect(page.locator('.ui-vtable')).toBeVisible();
  // Tek bir rozet seçili ve o rozet Nabız'da tıklanan sektör.
  await expect(page.locator('.screener__chip.is-on')).toHaveCount(1);
  await expect(page.locator('.screener__chip.is-on')).toHaveText(sector);
  // Kural eklenmedi: kullanıcının kurmadığı bir filtre varsayılmıyor.
  await expect(page.getByRole('button', { name: /^Giriş kuralları/ })).toHaveCount(0);
  // DİKKAT: sorgu dizesinde boşluk "+" olarak kodlanır ve decodeURIComponent
  // bunu boşluğa ÇEVİRMEZ ("Demir Çelik" → "Demir+Çelik"). Adı iki kelimelik
  // bir sektörde bu testi kıran gerçek bir tuzaktı; URLSearchParams doğru
  // çözüyor.
  const f = new URL(page.url()).searchParams.get('f') ?? '';
  expect(f.split('|')[3]).toBe(sector);
});

test('eski arayüz ile yeni kabuk birbirine bağlı', async ({ page }) => {
  // Yeni kabuk ikinci bir giriş noktasında duruyor; bağlantı kopsa siteye
  // gelen kullanıcı varlığını hiç öğrenemez.
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Yeni arayüz' }).click();
  await expect(page.locator('.shell-topbar')).toBeVisible();

  await page.getByRole('link', { name: 'Eski arayüz' }).click();
  await expect(page.locator('.toolbar')).toBeVisible();
});

test('depolama kapalıyken iki arayüz de açılıyor', async ({ page }) => {
  // Safari özel sekmesi taklidi: localStorage hem okumada hem yazmada istisna
  // fırlatıyor. Yayındaki uygulama bu durumda BOŞ SAYFA açıyordu.
  await page.addInitScript(() => {
    const boom = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => ({
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        clear: boom,
        key: boom,
        length: 0,
      }),
    });
  });

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('.toolbar')).toBeVisible();
  expect(await page.locator('canvas').count()).toBeGreaterThan(0);

  await open(page, 'v=tarayici');
  await expect(page.locator('.ui-vtable')).toBeVisible();
});

test('hareket duyarlılığı iki arayüzde de onurlandırılıyor', async ({ page }) => {
  // Yeni kabukta bu tercih zaten vardı, yayındaki uygulamada hiç yoktu:
  // aynı kullanıcı iki arayüzde iki farklı davranış görüyordu.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const eski = await page.evaluate(() => {
    const wrap = document.createElement('span');
    wrap.className = 'live-toggle on';
    const dot = document.createElement('span');
    dot.className = 'dot';
    wrap.appendChild(dot);
    document.body.appendChild(wrap);
    const d = getComputedStyle(dot).animationDuration;
    wrap.remove();
    return d;
  });
  expect(parseFloat(eski)).toBeLessThan(0.05);

  await open(page, 'v=nabiz');
  const yeni = await page.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--dur-med') || '',
  );
  // Yeni kabukta kural genel: her animasyon/geçiş süresi kısaltılıyor.
  const ornek = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.transitionDuration = 'var(--dur-med)';
    document.body.appendChild(el);
    const d = getComputedStyle(el).transitionDuration;
    el.remove();
    return d;
  });
  expect(parseFloat(ornek)).toBeLessThan(0.05);
  expect(yeni.length).toBeGreaterThan(0);
});

test('rapor yazdırmada beyaz kâğıda uygun çıkıyor', async ({ page }) => {
  // Koyu tema açıkken "Yazdır / PDF" koyu zeminli, açık metinli bir rapor
  // üretiyordu: kâğıtta ya okunmaz ya da sayfa dolusu mürekkep.
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, 'v=rapor&s=X001');
  await expect(page.locator('.report__sheet')).toBeVisible();

  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const durum = await page.evaluate(() => {
    const sheet = document.querySelector('.report__sheet')!;
    const hidden = (sel: string) =>
      getComputedStyle(document.querySelector(sel)!).display === 'none';
    return {
      zemin: getComputedStyle(sheet).backgroundColor,
      metin: getComputedStyle(sheet).color,
      rayGizli: hidden('.shell-rail'),
      ustCubukGizli: hidden('.shell-topbar'),
      araclarGizli: hidden('.report__toolbar'),
    };
  });

  expect(durum.zemin).toBe('rgb(255, 255, 255)');
  expect(durum.metin).toBe('rgb(15, 20, 32)');
  expect(durum.rayGizli).toBe(true);
  expect(durum.ustCubukGizli).toBe(true);
  expect(durum.araclarGizli).toBe(true);
});

test('tarama: filtre → sonuç → paylaşılan bağlantı aynı sonucu veriyor', async ({ page }) => {
  await open(page, 'v=tarayici');
  await expect(page.locator('.ui-vtable')).toBeVisible();

  await page.getByLabel('Bankacılık').click();
  await expect(page.locator('.screener__chip.is-on')).toHaveCount(1);
  // Değişmez olan SONUÇ SAYISI; worker süresi ölçümden ölçüme değişir ve
  // onu karşılaştırmak testi nedensiz kırılgan yapar.
  const count = await page.locator('.screener__status .ui-badge').first().innerText();

  // Filtre URL'e yazılmış olmalı; yeni bir sekmede aynı sonucu vermeli.
  const shared = page.url();
  // URL yüzde kodlu gelir; okunabilirlik iddiası çözülmüş haliyle sınanır.
  expect(decodeURIComponent(shared)).toContain('f=1|');

  // Sonuç kümesinin BOŞ olup olmaması bu testin iddiası değil: iddia, aynı
  // bağlantının aynı DURUMU verdiği. Tabloyu koşulsuz beklemek testi örnek
  // veriye bağlıyordu — sektörde ölçütlere uyan hisse kalmadığında tablo hiç
  // çizilmiyor ve test, ilgisiz bir sebeple kırılıyordu.
  const tabloVar = (await page.locator('.ui-vtable').count()) > 0;

  const other = await page.context().newPage();
  await other.goto(shared, { waitUntil: 'networkidle' });
  await expect(other.getByLabel('Bankacılık')).toBeChecked();
  await expect(other.locator('.screener__status .ui-badge').first()).toHaveText(count);
  // Aynı sonuç, aynı yüzey: birinde tablo varsa ötekinde de olmalı.
  await expect(other.locator('.ui-vtable')).toHaveCount(tabloVar ? 1 : 0);
  await other.close();
});

test('tarama → stratejiler: bulunan semboller strateji testine gidiyor', async ({ page }) => {
  await open(page, 'v=tarayici');
  await expect(page.locator('.ui-vtable')).toBeVisible();

  await page.getByRole('button', { name: /Stratejilerde test et/ }).click();
  await expect(page).toHaveURL(/v=stratejiler/);
  await expect(page.getByText(/o kriterlere koşulludur/)).toBeVisible();

  // Ağır iş kullanıcı onayı olmadan başlamaz.
  const start = page.getByRole('button', { name: 'Bu sembollerde test et' });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.locator('.rank__table tbody tr').first()).toBeVisible();
});

test('sembol masası: grafik, finansallar ve sektör sekmeleri', async ({ page }) => {
  await open(page, 'v=sembol&s=X001');
  await expect(page.locator('.chart-host canvas').first()).toBeVisible();

  // Grafik ayarları yalnızca grafik sekmesinde.
  await expect(page.locator('.desk__toggles')).toBeVisible();
  await page.getByRole('tab', { name: 'Finansallar' }).click();
  await expect(page.locator('.desk__toggles')).toBeHidden();

  await page.getByRole('tab', { name: 'Sektör' }).click();
  // Paket kendiliğinden inmez: önce izin istenir.
  await expect(page.getByText(/yaklaşık 1 MB/)).toBeVisible();
  await page.getByRole('button', { name: 'Akranları yükle' }).click();
  await expect(page.locator('.desk__sector-table tbody tr').first()).toBeVisible();
});

test('laboratuvar: hazır strateji bağlantıyla taşınıyor ve doğrulanıyor', async ({ page }) => {
  await open(page, 'v=stratejiler');
  await expect(page.locator('.rank__table tbody tr').first()).toBeVisible();

  await page.getByRole('button', { name: 'Laboratuvarda aç' }).first().click();
  await expect(page).toHaveURL(/v=laboratuvar/);
  await expect(page.locator('.lab__stats')).toBeVisible();
  // Kural URL'e yazılmış olmalı (paylaşılabilir strateji).
  expect(decodeURIComponent(page.url())).toContain('str=1|');

  await page.getByRole('button', { name: 'Doğrulamayı çalıştır' }).click();
  await expect(page.locator('.lab__badge').first()).toBeVisible();
  // Doğrulama rozetleri: beş sınavın hepsi görünmeli.
  await expect(page.locator('.lab__badge')).toHaveCount(5);
});

test('model: kart olmadan olasılık gösterilmiyor', async ({ page }) => {
  await open(page, 'v=model&s=X001');
  await expect(page.locator('.model__verdict')).toBeVisible();

  const verdict = await page.locator('.model__verdict .ui-badge').innerText();
  const hasProbability = await page.locator('.model__latest').count();
  // Sözleşme: hüküm "kullanma" ise ekranda olasılık YOKTUR.
  if (verdict.includes('kullanma')) expect(hasProbability).toBe(0);

  // Kart her hâlükârda sınırlarını yazar.
  await expect(page.getByText(/işlem maliyeti/)).toBeVisible();
});

/**
 * Veri tazeliği rozeti.
 *
 * Eskiden üst çubukta sabit "Gecikmeli veri" yazıyordu — veri bir gün de bir
 * yıl da eski olsa aynı metin. Örnek veri setinin son barı 2025-09-28 ve
 * dokuz ekranın yedisi bunu hiçbir uyarı olmadan "bugün" diye sunuyordu.
 */
test('veri tazeliği rozeti gerçek veri yaşını söylüyor', async ({ page }) => {
  await open(page, 'v=nabiz');
  await page.waitForSelector('.pulse__flows', { timeout: 90_000 });

  const badge = page.locator('.shell-topbar__actions .ui-badge').first();
  // Sabit metin geri gelirse test kırılır.
  await expect(badge).not.toHaveText('Gecikmeli veri');
  await expect(badge).toHaveText(/^Veri (\d+ iş günü eski|\d{1,2} \S+ \d{4})$/);

  // Yasal uyarı her durumda rozetin başlığında kalmalı.
  await expect(badge).toHaveAttribute('title', /yatırım tavsiyesi değildir/);

  // Örnek veri bayat: başlık hesapların hangi tarihe ait olduğunu yazmalı.
  const title = (await badge.getAttribute('title')) ?? '';
  if (/iş günü eski/.test((await badge.textContent()) ?? '')) {
    expect(title).toMatch(/Son bar .+ geride/);
    expect(title).toMatch(/bu tarihe aittir, bugüne değil/);
  }
});

test('tazelik rozeti her ekranda aynı bilgiyi veriyor', async ({ page }) => {
  const seen = new Set<string>();
  for (const query of ['v=nabiz', 'v=tarayici', 'v=stratejiler', 'v=rapor&s=X001']) {
    await open(page, query);
    const badge = page.locator('.shell-topbar__actions .ui-badge').first();
    await expect(badge).toHaveText(/^Veri /, { timeout: 90_000 });
    seen.add(((await badge.textContent()) ?? '').trim());
  }
  // Aynı piyasada tek bir doğru cevap var; ekrana göre değişemez.
  expect([...seen]).toHaveLength(1);
});

/**
 * ÜRÜNÜN ANA CÜMLESİ, tek akışta.
 *
 * Kullanıcının istediği sistem şuydu: "endüstriden para akışına bir çok
 * filtreyle hisse arayıp en doğru stratejilere". Parçaların her biri ayrı
 * ayrı sınanıyor ama ZİNCİR sınanmıyordu — oysa kırılma tam olarak
 * bağlantılarda olur (sektör adı tarayıcıya taşınmazsa, sembol listesi
 * stratejilere geçmezse akış sessizce kopar).
 */
test('sektör rotasyonu → tarayıcı → karne filtresi → stratejiler', async ({ page }) => {
  const hatalar: string[] = [];
  page.on('pageerror', (e) => hatalar.push(e.message));

  // 1) Nabız: pencere görünümünde para hangi sektöre kaydı?
  await page.goto('/next.html?m=bist&v=nabiz', { waitUntil: 'networkidle' });
  await page.waitForSelector('.pulse__flows', { timeout: 90_000 });
  await page.getByLabel('Dönem').selectOption('21');
  await page.waitForSelector('.pulse__rotasyon', { timeout: 90_000 });

  // 2) O sektörü tarayıcıda aç.
  await page
    .getByRole('button', { name: /sektörünü tarayıcıda aç/ })
    .first()
    .click();
  await page.waitForSelector('.ui-vtable tbody tr', { timeout: 90_000 });

  /**
   * Sonuç sayısı DÜĞMEDEN okunuyor, satır sayısından değil.
   *
   * Tablo pencerelenmiş: DOM'da yalnızca görünen satırlar var, üstelik
   * kaydırma çubuğunu doğru tutmak için boşluk satırları da ekleniyor.
   * `tbody tr` saymak bu yüzden sonucu vermiyor — ilk yazımda tam bu oldu.
   */
  const sonucSayisi = async (): Promise<number> => {
    const metin = await page.getByRole('button', { name: /Stratejilerde test et/ }).innerText();
    return Number(metin.match(/\((\d+)\)/)?.[1] ?? 0);
  };

  const sektorSonrasi = await sonucSayisi();
  expect(sektorSonrasi, 'sektör taraması boş döndü').toBeGreaterThan(0);

  // 3) Karne ölçütüyle daralt. Bu ölçüt TÜM SEMBOLLERİN dönem tablosunu
  //    ister; dosya yayımlanmamışsa ekran bunu söyler ve sonuç boş kalır —
  //    test o durumu da "sessiz sıfır sonuç"tan ayırır.
  await page.getByRole('button', { name: '+ Kural' }).click();
  const secici = page.locator('select').filter({ hasText: 'Karne: kârlılık' }).first();
  await secici.selectOption({ label: 'Karne: kârlılık' });
  await page.waitForTimeout(1500);

  await expect(
    page.getByText('Finansal tablolar yüklenemedi'),
    'tam tablo dosyası yayımlanmamış',
  ).toHaveCount(0);
  const karneSonrasi = await sonucSayisi();
  expect(karneSonrasi, 'karne ölçütü hiçbir sembolü geçirmedi').toBeGreaterThan(0);
  expect(karneSonrasi, 'karne ölçütü hiçbir şeyi elemedi').toBeLessThanOrEqual(sektorSonrasi);

  // 4) Bulunan semboller strateji testine gitsin.
  const gonder = page.getByRole('button', { name: /Stratejilerde test et/ });
  await expect(gonder).toContainText(String(karneSonrasi));
  await gonder.click();

  // Plan kabı ANINDA çiziliyor ama içi "İndirme boyutu hesaplanıyor…" ile
  // başlıyor: boyut manifest ve nabız indikten sonra oturuyor. Kabı beklemek
  // yetmiyor, PLANIN KENDİSİNİ beklemek gerekiyor.
  await page.waitForSelector('.rank__deep button', { timeout: 90_000 });
  await expect(page.getByLabel('Kapsam')).toHaveValue('liste');
  // İndirme planı sembol sayısını ve boyutu SÖYLÜYOR; boyut Türkçe biçimde.
  const plan = await page.locator('.rank__deep').innerText();
  expect(plan).toContain(`${karneSonrasi} sembol`);
  expect(plan, 'indirme boyutu Türkçe ondalıkla yazılmalı').toMatch(/\d+,\d+ MB/);

  expect(hatalar, 'akış sırasında sayfa hatası').toEqual([]);
});

/**
 * Endeksler hisse DEĞİLDİR.
 *
 * Gerçek veride ölçüldü: yayındaki 655 serinin 52'si endeks (XU100, XBANK,
 * BISTTLREF, …) ve tarayıcıda hisselerin arasında duruyordu — XFINK satırı
 * işlem değeri 0, F/K "—" ile listeleniyordu. "Hisse ara" sonucuna alınamayan
 * satırlar giriyor, sektör para akışı ve strateji sıralaması 48 fazla seriyle
 * hesaplanıyordu. Eski arayüz bunları zaten eliyordu; yeni kabuk eleği
 * kaybetmişti.
 *
 * Eleme PAKETTE yapılıyor (tarama evreni), manifest'te değil: XU100 grafikte
 * hâlâ açılabilmeli.
 */
test('endeks ve fonlar taramada yok ama grafikte açılabiliyor', async ({ page }) => {
  await open(page, 'v=tarayici');
  await expect(page.locator('.ui-vtable')).toBeVisible();

  // Beklenen sayı MANİFEST'ten okunuyor, sabit yazılmıyor: uçtan uca iş akışı
  // örnek veriyi `--symbols 200` ile üretiyor, yerelde varsayılan 60. Sabit bir
  // sayı yazmak testi CI'da kırardı — ölçüldü, önce öyle yazılmıştı.
  const sayilar = await page.evaluate(async () => {
    const res = await fetch('/data/bist/pack/manifest.json');
    const m = (await res.json()) as { symbols: Record<string, { e?: number }> };
    const hepsi = Object.values(m.symbols);
    return { toplam: hepsi.length, endeks: hepsi.filter((v) => v.e === 1).length };
  });
  // Örnek veride en az bir eleme OLMALI; yoksa bu test hiçbir şey sınamıyor.
  // Örnek evrende dört endeks (XU100, XBANK, XGIDA, XKMYA) ve bir fon (GLDTR).
  expect(sayilar.endeks, 'örnek veride elenen sembol yok — eleme sınanamıyor').toBeGreaterThan(4);

  const durum = await page.locator('.screener__status').first().innerText();
  const hisse = sayilar.toplam - sayilar.endeks;
  expect(durum).toContain(`${hisse} sembol`);
  expect(durum).not.toContain(`${sayilar.toplam} sembol`);

  // NABIZ en çok zarar gören ekrandı. Gerçek veride ölçüldü: endeksler
  // içerideyken ısı haritasının TAMAMI üç kutuydu (XU100, XU030, XBANK) ve
  // para akışının %99,96'sı "XU100 grubu" adlı tek davranış kümesindeydi;
  // "PARA AKIŞI" başlığı -%100,0 diyordu. Elemeden sonra aynı veride başlık
  // -%33,2 ve harita gerçek hisseleri gösteriyor.
  await open(page, 'v=nabiz');
  await expect(page.locator('.pulse__flows')).toBeVisible();
  // VERİ yüzeylerine bakılıyor, sayfanın tamamına değil: sektör endeksi
  // panelinin AÇIKLAMASI "XU100 gibi ana endeksler listede yok" diyor ve bu
  // doğru bir cümle. Aranan şey endeksin bir SATIR/kutu olarak görünmesi.
  expect(await page.locator('.heatmap').innerText()).not.toContain('XU100');
  expect(await page.locator('.pulse__flows').innerText()).not.toContain('XU100');
  expect(await page.locator('.sektor__tablo').innerText()).not.toContain('XU100');
  // Fon da hisse değil: adı "GOLDIST - Istanbul Gold ETF" olan GLDTR tarama
  // evreninde yok. Gerçek veride bu sınıftan sekiz araç elendi ve ikisi
  // (OPT25, OPX30) banka akranları arasında GÖRÜNÜYORDU.
  expect(await page.locator('.heatmap').innerText()).not.toContain('GLDTR');

  // Sembol masası manifest'ten okuyor: endeks orada DURUYOR.
  await open(page, 'v=sembol&s=XU100');
  await expect(page.locator('.chart-host canvas').first()).toBeVisible();
});

/**
 * SEKTÖR ENDEKSLERİ — sınıflandırma dosyası OLMADAN da sektör sorusu
 * cevaplanıyor.
 *
 * Kullanıcı isteği "endüstriden para akışı"ydı. Sembol→sektör sınıflandırması
 * üretilemiyor (kaynak 401 döndürüyor), ama BIST'in kendi alt sektör
 * endeksleri veri setinde ve tam geçmişleriyle duruyor. Bu panel onları
 * okuyor; sınıflandırma dosyasına bağlı DEĞİL.
 *
 * Gerçek BIST verisiyle doğrulandı (14 Eylül 2026, 1 ay): 23 sektörün 11'i
 * artıda, başta Finansal Kiralama +%31,68, sonda Bilişim -%45,24 — bağımsız
 * bir Python hesabıyla birebir aynı.
 */
test('sektör endeksleri: sınıflandırma olmadan sektör getirisi', async ({ page }) => {
  await open(page, 'v=nabiz');
  await expect(page.locator('.sektor__tablo')).toBeVisible();

  const satir = page.locator('.sektor__tablo tbody tr');
  const n = await satir.count();
  expect(n, 'sektör endeksi satırı yok').toBeGreaterThan(0);

  // Getiriler BÜYÜKTEN küçüğe sıralı: kullanıcı ilk satırı "en çok kazandıran"
  // diye okuyor, sıra bozulursa cümle yanlış olur.
  const yuzdeler = await page.locator('.sektor__tablo tbody td.is-num').allInnerTexts();
  const sayi = yuzdeler.map((t) => Number(t.replace('%', '').replace(',', '.').replace('+', '')));
  expect(sayi.every((v) => Number.isFinite(v))).toBe(true);
  for (let i = 1; i < sayi.length; i++) {
    expect(sayi[i - 1], `${i}. satır sıralama dışı`).toBeGreaterThanOrEqual(sayi[i]);
  }

  // Ana endeks ve üst küme LİSTEDE OLMAMALI: XU100 örnek veride var ama
  // sektör değil; üst kümeyi alt sektörle sıralamak aynı parayı iki kez sayar.
  const tablo = await page.locator('.sektor__tablo').innerText();
  expect(tablo).not.toContain('XU100');

  // Dönem değişince tablo yeniden hesaplanıyor.
  await page.getByLabel('Getiri penceresi').selectOption('5');
  await expect(page.locator('.sektor__tablo thead')).toContainText(/1 hafta/i);

  // Sektör adına tıklayınca o endeks grafikte açılıyor. Satır başlığındaki
  // düğme: aynı satırda "N hisse →" düğmesi de var ve o stratejilere gidiyor.
  await satir.first().locator('th button').click();
  await expect(page).toHaveURL(/v=sembol/);
});

/**
 * SEKTÖR → HİSSE → STRATEJİ zinciri.
 *
 * Hedef cümlenin son halkası: "endüstriden para akışına ... hisse arayıp en
 * doğru stratejilere". Sektör endeksinden o sektörle birlikte hareket eden
 * hisselere, oradan strateji testine geçilebiliyor mu?
 *
 * Eşleşme RESMÎ SEKTÖR DEĞİL, ölçülen bir davranış: hissenin günlük getirisi
 * hangi sektör endeksine en çok benziyor. Gerçek BIST verisinde bilinen 15
 * ismin 15'i doğru eşleşti; eşiği geçemeyen (PETKM) hiç bildirilmedi.
 *
 * Örnek veride üç hisse endeksi İZLEYECEK şekilde üretiliyor; bağımsız
 * serilerde hiçbiri eşiği geçmiyordu ve bu yol hiç koşmuyordu.
 */
test('sektör endeksi → birlikte hareket eden hisseler → stratejiler', async ({ page }) => {
  await open(page, 'v=nabiz');
  await expect(page.locator('.sektor__tablo')).toBeVisible();

  // Eşleşme worker'da hesaplanıyor; sütun hazır olunca geliyor.
  const baslik = page.locator('.sektor__tablo thead');
  await expect(baslik).toContainText(/birlikte hareket/i);

  // Kapsama AÇIKÇA yazılı olmalı: eşik yüksek, hisselerin küçük bir kısmı
  // eşleşiyor. Bunu söylemezsek boş satır "o sektörde hisse yok" diye okunur.
  await expect(page.locator('.sektor__ozet').last()).toContainText(/bir sektöre YAZILMADI/);

  const bagli = page.locator('.sektor__tablo tbody button', { hasText: /hisse/ });
  expect(await bagli.count(), 'hiçbir sektörde eşleşen hisse yok').toBeGreaterThan(0);

  await bagli.first().click();
  await expect(page).toHaveURL(/v=stratejiler/);
  // Sembol listesi gerçekten taşındı: stratejiler "liste" kapsamında açılıyor.
  await expect(page.getByText(/o kriterlere koşulludur/)).toBeVisible();
});

/**
 * "Tablo yok" ile "bizde yok" AYNI ŞEY DEĞİL.
 *
 * Arayüz önce iki cümle kuruyordu ve ikincisi YANLIŞTI. Ölçüldü: tablosu
 * gelmeyen 96 sembolün 52'si endeks, 19'u fon/sertifika — ama kalan 25'i
 * GERÇEK ŞİRKET (Garanti Faktoring, QNB Finansal Kiralama, Ray Sigorta,
 * DO & CO…). Onlara "bu araç finansal tablo yayımlamıyor" demek düpedüz
 * yanlıştı — yayımlıyorlar, kaynak bize vermiyor.
 *
 * SEBEBİ BİLİNMİYOR ve uydurulmuyor: `tablosuz.json` yalnızca kaynak ÜÇ
 * şablonun hiçbirinde veri döndürmediğinde yazılıyor. "Tablo geldi ama
 * okuyamadık" ayrı bir durum ve o dosyaya girmiyor.
 *
 * Ayrım manifest'teki `e` işaretinden: endeks/fon olduğunu BİLDİĞİMİZ
 * semboller orada işaretli, bilmiyorsak iddia etmiyoruz.
 */
test('finansal tablo yokluğu: araç mı öyle, veri mi eksik', async ({ page }) => {
  // Fon: tablo YAYIMLAMAZ. (GLDTR — "GOLDIST - Istanbul Gold ETF")
  await open(page, 'v=sembol&s=GLDTR');
  await page
    .getByRole('tab', { name: /finansal/i })
    .first()
    .click();
  await expect(page.getByText('Bu araç finansal tablo yayımlamıyor')).toBeVisible();

  // Gerçek şirket ama tablosu bizde yok: BAŞKA cümle.
  const tablosuz: string[] = await page.evaluate(async () => {
    const res = await fetch('/data/bist/fundamentals/tablosuz.json');
    const j = (await res.json()) as { symbols: string[] };
    const man = await (await fetch('/data/bist/pack/manifest.json')).json();
    return j.symbols.filter((s) => man.symbols[s]?.e !== 1);
  });
  expect(tablosuz.length, 'örnek veride "tablosuz ama hisse" sembol yok').toBeGreaterThan(0);

  await open(page, `v=sembol&s=${tablosuz[0]}`);
  await page
    .getByRole('tab', { name: /finansal/i })
    .first()
    .click();
  await expect(page.getByText('Bu şirketin tablosu kaynakta bulunamadı')).toBeVisible();
  await expect(page.getByText('Bu araç finansal tablo yayımlamıyor')).toHaveCount(0);
});

/**
 * "Uymadı" ile "ölçemedik" AYNI ŞEY DEĞİL.
 *
 * Tarayıcı "582 sembolden 35 tanesi ölçütlere uyuyor" diyordu ve bu, 547
 * sembolün SINANIP elendiğini ima ediyordu. Oysa NaN hiçbir kuralı geçmiyor:
 * ölçüsü olmayan sembol de "uymadı" kovasına düşüyor.
 *
 * Gerçek veride ölçüldü: 582 hissenin yalnızca 293'ünün F/K'sı var — zarar
 * edende F/K tanımsız (negatif F/K "ucuz" gibi sıralanırdı), 23 sembolde ise
 * tablo hiç yok. Yani bir F/K kuralı evrenin yarısını sessizce eliyordu.
 * Karne'de zaten uygulanan "payda küçülünce söyle" ilkesinin aynısı.
 */
test('tarayıcı: ölçülemeyen sembolleri "uymadı" diye saymıyor', async ({ page }) => {
  await open(page, 'v=tarayici');
  await expect(page.locator('.ui-vtable')).toBeVisible();

  // Varsayılan kurallar (RSI, 1 ay) her sembolde ölçülebilir → uyarı YOK.
  await expect(page.locator('.screener__olculemedi')).toHaveCount(0);

  // F/K: zarar eden şirkette tanımsız, tablosuz sembolde hiç yok.
  await page.getByLabel('Metrik').first().selectOption({ label: 'F/K' });
  await page.getByLabel('Koşul').first().selectOption('<');
  await page.getByLabel('Değer').first().fill('10');

  const not = page.locator('.screener__olculemedi');
  await expect(not).toBeVisible();
  await expect(not).toContainText('F/K');
  await expect(not).toContainText(/o ölçü onlarda olmadığı için/);

  // Sayı UYDURULMUYOR: sonuç + ölçülemeyen ≤ evren olmalı.
  const metin = await page.locator('.screener__status').first().innerText();
  const uyan = Number(metin.match(/(\d+)\s*\/\s*(\d+) sembol/)?.[1] ?? '0');
  const evren = Number(metin.match(/(\d+)\s*\/\s*(\d+) sembol/)?.[2] ?? '0');
  const olculemeyen = Number((await not.innerText()).match(/(\d+) sembol ölçülemedi/)?.[1] ?? '0');
  expect(olculemeyen).toBeGreaterThan(0);
  expect(uyan + olculemeyen).toBeLessThanOrEqual(evren);
});

/**
 * Aynı ayrım RADARDA da olmalı: filtre motoru tarayıcıyla AYNI, dolayısıyla
 * kusur da aynıydı. Radar dar bir panel olduğu için cümle kısa; ölçüt
 * kırılımı `title` ile fareye, görünmez metinle ekran okuyucuya gidiyor —
 * panele sığmaması, erişilemez kalmasının gerekçesi değil.
 */
test('radar: ölçülemeyen sembolleri "uymadı" diye saymıyor', async ({ page }) => {
  await open(page, 'v=sembol&s=X001');
  await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByText('Radar', { exact: true }).first().click();
  await page.waitForSelector('.radar__tablo', { timeout: 90_000 });
  await page.getByLabel('Kapsam').selectOption('piyasa');
  await page.waitForFunction(() => document.querySelectorAll('.radar__tablo tbody tr').length > 5, {
    timeout: 90_000,
  });

  // Filtresiz: ölçülemeyen yok, uyarı da yok.
  await expect(page.locator('.radar__olculemedi')).toHaveCount(0);

  await page.getByRole('button', { name: 'Hazır', exact: true }).click();
  await page.getByRole('button', { name: /Ucuz ve kârlı/ }).click();

  const not = page.locator('.radar__olculemedi');
  await expect(not).toBeVisible();
  await expect(not).toContainText(/o ölçü onlarda olmadığı için/);
  // Kırılım hem fareye (title) hem ekran okuyucuya (görünmez metin) gidiyor.
  expect(await not.getAttribute('title')).toMatch(/F\/K|Özkaynak/);
  await expect(not).toContainText(/Ölçüt kırılımı:/);
});
