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
  await expect(page.getByRole('button', { name: 'Sınıflandırılmamış' })).toBeVisible();

  const rows = await page.locator('.pulse__flows tbody tr').count();
  expect(rows).toBeGreaterThan(2);
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
