# Faz 2 — Uygulama Durumu

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §7 (Faz 2)
**Durum:** Tamamlandı — `npm run verify` yeşil (47 → 95 test)

---

## Plandaki maddeler

| Madde | Durum | Nerede |
|---|---|---|
| `.bin` kolonsal format + manifest + `latest-250` paketi | ✅ | `scripts/pack_data.py`, `src/core/data/pack.ts`, [format](./veri-formati.md) |
| CI'da üretim | ✅ | `deploy.yml` (üretim + `--verify`), `verify.yml` (`--self-test`) |
| İşlem takvimi + veri sağlık paneli | ✅ | `src/core/data/health.ts` + Sembol Masası'ndaki panel |
| Kurumsal aksiyon düzeltmesi | ⚠️ kısmi | bölünme **tespiti** var, düzeltme yok — gerekçe aşağıda |
| Sembol Masası: LOD grafik + indikatör + özet + provenance | ✅ | `src/shell/screens/SymbolDesk.tsx`, `src/shell/chart/PriceChart.tsx` |

## Ölçülen sonuçlar

20 sembollük doğrulama setinde (3.400 günlük bar/sembol):

```
6,1 MB JSON  →  1,6 MB .bin      (3,7×; sembol başına 305 KB → 81 KB)
latest-250 paketi: 0,1 MB        (20 sembol × 250 bar × 5 kolon)
next.html ilk yük: 52,6 KB gzip  (grafik motoru ayrı chunk, talep üzerine)
95 test / 13 dosya — hepsi geçiyor
```

Referans projenin 227 MB'lık `public/data`'sı bu oranla **~60 MB**'a iner —
plandaki ≤ 60 MB hedefiyle uyumlu (gerçek ölçüm CI'daki ilk tam üretimde
görülecek).

## Mimari kararlar

**Saf çözücü / kirli istemci ayrımı.** Bayt düzenini okuyan kod
`src/core/data/pack.ts` içinde saf; ağ, IndexedDB önbelleği ve hash tabanlı
tazelik `src/data-client/` içinde. Format testleri ağ kurgusu istemiyor,
istemci testleri gerçek IndexedDB istemiyor (ikisi de enjekte edilebilir).

**İki dilli sözleşme fixture ile kilitli.** `scripts/pack_data.py --write-fixture`
ile üretilen küçük dosyalar `src/core/data/__fixtures__/` altında duruyor;
TypeScript çözücüsü bunlara karşı test ediliyor. Üretici ile okuyucu tek taraflı
değişirse test kırılır — "iki uçta iki format" sınıfı hatalar imkânsızlaşır.

**Hash hem önbellek anahtarı hem cache-busting.** Manifest'teki hash değişmediyse
ağa çıkılmaz; değiştiyse URL de değişir (`THYAO.bin?h=…`), yani CDN/tarayıcı
önbelleği bayat veri servis edemez. Eski hash'li sürümler yazarken silinir.

**Grafik renkleri token'lardan okunur** (`useChartColors`), JS'te ikinci kez
tanımlanmaz. Tema değişiminde grafik yeniden kurulmaz, `applyOptions` ile
güncellenir — kullanıcının zoom'u korunur.

**Metrikler kendi kanıtını taşır.** `summarize()` her metriği formülü, veri
penceresi ve bar sayısıyla döndürür; kart bunları elle yazmaz, metrikten okur.
Böylece hesap ile açıklama ayrışamaz (ürün ilkesi #2).

## Bilinçli sınırlar

1. **Kurumsal aksiyon düzeltmesi yapılmıyor, tespit ediliyor.** Elimizdeki
   kaynakta (borsapy/yfinance çıktısı) temettü ve bölünme olay listesi yok;
   fiyattan geriye dönük "düzeltme" uydurmak, sessizce yanlış seri üretmek olur.
   Bunun yerine sağlık katmanı bölünme benzeri sıçramaları oranıyla işaretliyor
   ("1/2'ye yakın") ve uzun vadeli getirinin bundan etkilendiğini söylüyor.
   Gerçek düzeltme, olay verisi eklendiğinde (ayrı bir kaynak) yapılacak.
2. **Tatil takvimi yok.** Boşluklar hafta içi gün sayısıyla raporlanıyor ve metin
   bunun resmî tatilleri de kapsadığını açıkça söylüyor — "17 gün eksik" ifadesi
   bir suçlama değil, üst sınır.
3. **`latest-250` paketi uzun periyotlu göstergelere yetmez** (ör. EMA-610).
   Paket piyasa geneli hızlı bakış için; derin analiz sembolün tam geçmişini
   çeker (81 KB, önbellekten anında).
4. **Hacim float32.** ~1e10 mertebesinde birkaç yüz adetlik bağıl hata var;
   formatta ve doğrulama toleransında (1e-6) açıkça yazılı.

## Sıradaki: Faz 3

- Worker havuzu + `latest-250` paketi üzerinden canlı parametreli tarama.
- Korelasyon matrisi + hiyerarşik kümeleme, ısı haritası (Nabız ekranı).
- Karşılaştır ekranı: normalize getiri, drawdown, rejim kırılımı.
- Devralınan ekranların `core/` yoluna taşınması ve geçiş kabuklarının silinmesi.
