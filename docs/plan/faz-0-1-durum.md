# Faz 0 + Faz 1 — Uygulama Durumu

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md)
**Durum:** Tamamlandı — `npm run verify` yeşil

---

## Faz 0 — Temel

| Plandaki madde | Durum | Nerede |
|---|---|---|
| `core/` ayrımı (saf TS, DOM'suz) | ✅ | `src/core/{indicators,data}` + ESLint sınır kuralı |
| ESLint + Prettier | ✅ | `eslint.config.js`, `.prettierrc` |
| Vitest + test altyapısı | ✅ | `vite.config.ts` (test bloğu), `src/test/setup.ts` |
| Performans bütçesi ölçümü | ✅ | `scripts/check-budget.mjs`, `npm run budget` |
| CI kalite kapısı | ✅ | `.github/workflows/verify.yml` |
| `npm run verify` yeşil | ✅ | tip → lint → biçim → test → build → bütçe |

**`core/` sınırı nasıl zorlanıyor:** `src/core/**` içinde `window`, `document`,
`localStorage`, `fetch`, `navigator` ve React/grafik kütüphanesi import'ları lint
hatasıdır (`eslint.config.js`). Analiz katmanının Node'da (CI), Worker'da ve
ileride sunucuda aynı kodla çalışabilmesinin önkoşulu bu.

**Geçiş kabukları:** `src/indicators/*` ve `src/data/{types,resample,synthetic,
inflation}` artık tek satırlık yeniden dışa aktarım dosyaları; gerçek kod
`src/core/` altında. Mevcut ekranların import yolları **bilinçli olarak
değiştirilmedi** — açık olan çoklu-market PR'ı (#6) `App.tsx`, `Screener.tsx` ve
`data/bistStatic.ts` dosyalarına dokunuyor; gereksiz çakışma üretmemek için
çağıranlar Faz 2'de (veri katmanı zaten elden geçerken) taşınacak ve kabuklar
silinecek.

## Faz 1 — Tasarım sistemi + kabuk

| Plandaki madde | Durum | Nerede |
|---|---|---|
| Token katmanı (iki tema, tek kaynak) | ✅ | `src/ui/tokens.css`, `src/ui/base.css` |
| 18 primitive | ✅ | `src/ui/*` (aşağıdaki liste) |
| Komut paleti (tek kayıt defteri) | ✅ | `src/shell/commands.ts`, `CommandPalette.tsx` |
| URL state | ✅ | `src/shell/urlState.ts` |
| 7 ekranlık kabuk | ✅ | `src/shell/App.tsx`, `src/shell/nav.ts` |
| Klavye + erişilebilirlik | ✅ | odak tuzağı, roving tabindex, ARIA, atlama bağlantısı |
| Bileşen galerisi | ✅ | `src/shell/screens/Gallery.tsx` (Storybook yerine) |

**Primitive listesi:** `Button`, `IconButton`, `Toggle`, `Select`, `Combobox`,
`NumberField`, `RangeField`, `Tabs`, `Dialog`, `Sheet`, `Popover`, `Tooltip`,
`Toast`, `VirtualTable`, `Badge`, `Stat`, `Skeleton`, `EmptyState` — hepsi
`src/ui/index.ts` üzerinden dışa açık, ham renk/px kullanmıyor.

### Ölçülen sonuçlar

```
✓ next.html  js   52.5 KB / 180 KB gzip     (ilk yük)
✓ next.html  css   4.6 KB /  40 KB gzip
✓ index.html js  136.0 KB / 160 KB gzip     (devralınan uygulama, tavan)
47 test / 8 dosya — hepsi geçiyor
0 lint hatası (devralınan ekranlarda 46 uyarı: Faz 2 borcu)
```

---

## Plandan bilinçli sapmalar

1. **Storybook yerine uygulama içi galeri.** Ayrı bir araç zinciri + ~300 paket
   yerine, primitive'ler gerçek kabuğun içinde gerçek temayla `?v=kitaplik`
   adresinde görülüyor. Aynı işi görüyor, bütçeye yük bindirmiyor (galeri ayrı
   chunk, talep üzerine iniyor).
2. **Yeni kabuk ikinci bir giriş noktasında.** `index.html` = mevcut yayında olan
   uygulama, `next.html` = yeni kabuk. Faz 1 çıktısı tanım gereği boş bir
   iskelet; çalışan ürünü onunla değiştirmek kullanıcıdan özellik geri almak
   olurdu. Faz 2'de Sembol Masası veriyle dolunca `next.html` `index.html`'in
   yerini alacak.
3. **Devralınan ekranlarda erişilebilirlik kuralları uyarı seviyesinde.** Yeni
   kodda hata (sıfır tolerans), eski kodda uyarı — taşınırken tek tek
   kapatılacak bir borç listesi olarak duruyor. Hepsini şimdi düzeltmek Faz 1'i
   ilgisiz bir refactor'a çevirirdi.
4. **Biçim (Prettier) kontrolü şimdilik yeni katmanlarda.** Devralınan dosyaları
   baştan biçimlendirmek, açık PR ile gereksiz çakışma üretirdi; taşınırken
   katılacaklar.

## Yol boyunca düzeltilen gerçek kusurlar

- **Odak tuzağı `offsetParent` ile görünürlük ölçüyordu.** `position: fixed`
  öğelerde tarayıcı da `null` döndürebiliyor; artık gizlemenin anlamsal
  işaretlerine bakılıyor (`src/ui/hooks.ts`).
- **`aria-sort` düğme üzerindeydi** (rol desteklemiyor). Tablo gerçek
  `<thead>`/`<th>` yapısına taşındı; pencereleme `transform` yerine boşluk
  satırlarıyla yapılıyor, böylece yapışkan başlık da çalışıyor.
- **Tıklanabilir tablo satırı** artık ilk sütundaki gerçek düğmeye bağlı —
  `<tr>`'ye sahte rol takmadan klavyeyle de çalışıyor.
- **Devralınan `Backtest.tsx`'te `useCandidate`** adlı sıradan bir fonksiyon,
  React'in hook adlandırma kuralını ihlal ediyordu (`applyCandidate` oldu).

---

## Sıradaki: Faz 2

1. `.bin` kolonsal veri formatı + manifest + `latest-250` paketi (`scripts/`).
2. Kurumsal aksiyon düzeltmesi, işlem takvimi, veri sağlık paneli.
3. Sembol Masası: mevcut LOD grafik çekirdeği yeni kabuğa bağlanır.
4. `src/indicators/*` ve `src/data/*` kabukları silinir, çağıranlar `core/`
   yoluna taşınır; devralınan erişilebilirlik uyarıları o dosyalarda kapatılır.
