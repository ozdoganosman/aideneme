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

  const other = await page.context().newPage();
  await other.goto(shared, { waitUntil: 'networkidle' });
  await expect(other.locator('.ui-vtable')).toBeVisible();
  await expect(other.getByLabel('Bankacılık')).toBeChecked();
  await expect(other.locator('.screener__status .ui-badge').first()).toHaveText(count);
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
  await expect(page.locator('.desk__health')).toBeVisible();
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
