# Yeni Nesil Finans Analiz Platformu — Plan

**Tarih:** 2026-09-13 (durum notu: 2026-09-14)
**Durum:** **Uygulandı** — Faz 0–6 tamamlandı, üstüne dört iş parçası eklendi.
Faz durumları ve sapmalar: [`faz-0-1-durum.md`](./faz-0-1-durum.md) …
[`faz-7-durum.md`](./faz-7-durum.md), [`performans.md`](./performans.md).
Aşağıdaki metin **plandır**; gerçekleşenle farkları §7'nin sonundaki tabloda.
**Referans sistem:** [`ozdoganosman/borsa`](https://github.com/ozdoganosman/borsa) (BIST Borsa Analiz)
**Uygulanacak yer:** bu repo (`ozdoganosman/aideneme`) — mevcut yüksek performanslı grafik çekirdeği üzerine

---

## 0. Özet

`borsa` projesi işlevsel olarak zengin: 603 BIST sembolü, günlük OHLCV, finansal tablolar,
indikatörler, tarama, backtest, ML ensemble ve kripto sayfası. Ancak üç yapısal sorunu var:

1. **UI/UX ad-hoc büyümüş.** 53 bileşen dosyası, 24 ayrı CSS dosyası / 6.178 satır, tasarım
   sistemi yok; 46 prop'lu `Toolbar` + ayrı 468 satırlık `MobileToolbar` (aynı işin iki kopyası);
   URL state yok (hiçbir görünüm paylaşılamıyor/geri tuşu çalışmıyor); sanallaştırılmış tablo yok;
   erişilebilirlik dokunuşları semboliktir (53 dosyada toplam 52 `aria-*`/`role`).
2. **Veri katmanı pahalı.** `public/data` **227 MB**; sembol başına ~370 KB verbose JSON
   (`{"date":"2012-02-20","open":2.42,...}` — anahtarlar her barda tekrar ediyor).
   Tek bir sembolü açmak için 370 KB indiriliyor; tarama sonuçları (`scan.json`, `backtest.json`)
   CI'da önceden pişirilip donduruluyor, kullanıcı parametre değiştiremiyor.
3. **Analiz "gösterge üretiyor, kanıt üretmiyor."** Backtest var ama işlem maliyeti/slipaj,
   walk-forward disiplini, çoklu-test düzeltmesi, look-ahead koruması ve portföy düzeyi risk
   metrikleri yok. ML tarafında 80+ özellik ve Optuna var; ama purged CV, kalibrasyon ve
   dağıtım-kayması izlemesi olmadan doğruluk rakamları güvenilir değil.

Bu plan, aynı işlevsel kapsamı **tasarım sistemi + kanıta dayalı analiz motoru + kolonsal veri
hattı** üzerine yeniden kurar. Bu repodaki mevcut avantaj korunur: `src/chart/lod.ts` (viewport
decimation + LOD) sayesinde milyonlarca bar akıcı pan/zoom yapıyor — `borsa`'daki ECharts
tabanlı grafik bunu yapamaz.

**Tek cümlelik hedef:** *"Bir hisseyi 5 saniyede anlayan, bir stratejiyi 5 dakikada dürüstçe
sınayan ve her sayının nereden geldiğini gösterebilen bir analiz masası."*

---

## 1. Referans sistemin envanteri (ne devralınıyor)

| Alan | `borsa`'da mevcut | Karar |
|---|---|---|
| Veri | 603 BIST sembolü, 2012→ günlük OHLCV; finansal tablolar (75 MB); `borsapy` + `isyatirimhisse` | **Devral** (kaynaklar iyi), formatı değiştir |
| Grafik | ECharts + `chartBuilder.ts`, `useDragPan` | **Değiştir** → bu repodaki `lod.ts` + Lightweight Charts |
| İndikatörler | `utils/indicators.ts` (530 satır) + Williams %R, Nizam-i Cedid, MATLRNS | **Devral**, test altına al |
| Tarama | `multiSymbolScan.ts`, önceden pişmiş `scan.json` | **Yeniden kur** → istemci tarafı, Worker'da, canlı parametre |
| Backtest | `BacktestView` + `deriveBacktestData` | **Yeniden kur** → olay güdümlü, maliyetli |
| Optimizasyon | `signalOptimizer.ts` (841 satır), `optimizerMetrics.ts` | **Devral**, üstüne doğrulama katmanı ekle |
| ML | `backend/ml/*` 3 katmanlı ensemble, ~80 özellik, Optuna | **Faz 5'e ertele**, dürüst CV ile yeniden çerçevele |
| Temel analiz | F/K, PD/DD, ROE, bilanço/nakit akış grafikleri | **Devral**, TTM + kalite skoru ekle |
| i18n | `react-i18next`, tr/en | **Devral** (baştan iki dilli) |
| Backend | FastAPI (`backend/`) — ML ve WS için, Pages'te çalışmıyor | **Opsiyonel modül** (bkz. §4.4) |

---

## 2. Ürün ilkeleri (her tasarım kararının hakemi)

1. **Önce cevap, sonra grafik.** Her ekran bir soruya cevap verir ("bu hisse pahalı mı?",
   "bu strateji tesadüf mü?"), gösterge duvarı kurmaz.
2. **Her sayı tıklanabilir.** Bir metrik gösteriliyorsa, formülü + girdi penceresi + veri
   tarihi tek tıkla açılır ("provenance popover"). Kara kutu yok.
3. **Kanıt olmadan iddia yok.** Backtest sonucu, doğrulama rozetleri (maliyet dahil mi?
   out-of-sample mi? kaç parametre denendi?) olmadan gösterilmez.
4. **Durum paylaşılabilir.** Her görünüm URL'e serileşir; link atılabilir, geri tuşu çalışır.
5. **Hız bir özelliktir.** İlk anlamlı boya < 1.5 sn, sembol değişimi < 150 ms, tarama
   (603 sembol × 3.500 bar) < 1 sn.
6. **Klavye birinci sınıf.** `Cmd/Ctrl+K` komut paleti; tüm akışlar fare olmadan yapılabilir.
7. **Dürüstlük.** Gecikmeli veri "canlı" gibi gösterilmez; yatırım tavsiyesi değildir uyarısı
   üründe görünür ama rahatsız etmeyen bir yerde durur.

---

## 3. Bilgi mimarisi — 7 ekran

```
┌─ Nabız (Home)      → piyasa özeti, ısı haritası, öne çıkanlar, takip listesi kartları
├─ Sembol Masası     → grafik + özet + indikatörler + temel + sinyal geçmişi (tek sayfa)
├─ Tarayıcı          → kural tabanlı filtre, canlı parametre, kayıtlı taramalar, alarm kur
├─ Karşılaştır       → 2-8 sembol: normalize getiri, korelasyon, drawdown, faktör kırılımı
├─ Strateji Laboratuvarı → kural editörü → backtest → doğrulama → rapor
├─ Portföy           → pozisyonlar, reel (enflasyon düzeltmeli) getiri, risk, senaryo
└─ Rapor             → bir sembol/strateji için paylaşılabilir tek sayfa özet (PDF/PNG)
```

Navigasyon: sol tarafta ince ikon rayı (7 öğe), üstte bağlama duyarlı tek satır araç çubuğu.
`borsa`'daki "her şey toolbar'da" yaklaşımı (46 prop) yerine: **araç çubuğu yalnızca aktif
ekranın 5 birincil eylemini gösterir**, gerisi komut paletinde ve panel içlerinde.

---

## 4. Mimari

### 4.1 Katmanlar

```
apps/web (React 18 + TS + Vite)
│
├─ ui/            tasarım sistemi (token + primitives + pattern'ler)
├─ views/         7 ekran, her biri lazy chunk
├─ state/         URL-senkron store (nuqs benzeri ince katman) + TanStack Query
│
├─ core/          SAF TypeScript, DOM yok, %100 test edilebilir
│   ├─ data/      Candles (kolonsal typed array), takvim, düzeltmeler, resample
│   ├─ indicators/ vektörize indikatörler (altın-değer testleriyle)
│   ├─ stats/     getiri/risk/korelasyon/rejim
│   ├─ strategy/  kural DSL → pozisyon serisi
│   ├─ backtest/  olay güdümlü motor + maliyet modeli
│   └─ validate/  walk-forward, permütasyon, deflated Sharpe
│
├─ workers/       tarama / backtest / optimizasyon Worker havuzu (Comlink)
└─ data-client/   manifest + shard indirici, IndexedDB önbelleği
```

**Kural:** `core/` içinde `window`, `fetch`, React yok. Böylece tüm analiz hem Worker'da hem
Node'da (CI testleri) hem de ileride sunucuda aynı kodla çalışır.

### 4.2 Veri formatı (en büyük tek kazanç)

Bugün: `THYAO.json` = 374 KB, 3.500 bar, tekrar eden anahtarlar, string tarih.

Hedef: **kolonsal ikili format** (`.bin`), tek `manifest.json` ile:

```
public/data/
  manifest.json            # sembol → {offset, len, firstDay, lastDay, hash}
  daily/THYAO.bin          # [int32 epochDay][float32 O,H,L,C][float32 V]  → ~84 KB
  bundle/latest-250.bin    # TÜM semboller × son 250 bar → tek istek (~50 MB → ~12 MB gzip)
  fundamentals/THYAO.bin
```

- Sembol başına **~4,5× küçülme** (374 KB → 84 KB), gzip sonrası daha da iyi.
- `latest-250` paketi sayesinde **tarama ve ısı haritası tek istekte** çalışır; bugün
  `scan.json` CI'da pişirildiği için parametre değiştirilemiyor — bu kısıt kalkar.
- Parse maliyeti sıfıra yakın: `new Float32Array(buffer, offset, len)`. JSON.parse yok.
- IndexedDB'de `hash` ile önbellek; manifest değişmedikçe ağa çıkılmaz.
- Fiyatlar `float32` (BIST fiyat hassasiyeti için yeterli; kuruş ölçekli `int32` alternatifi
  §9'da tartışıldı).

### 4.3 Hesaplama

- Tüm ağır iş (tarama, backtest, optimizasyon, korelasyon matrisi) **Worker havuzunda**;
  ana iş parçacığı yalnızca çizer. Bugün `borsa`'da tarama ana thread'de → UI donuyor.
- Veri Worker'a **transferable** olarak gider (kopyalama yok).
- Artımlı hesap: indikatör sonuçları `(sembol, param-hash)` ile memoize edilir.
- Hedef bütçe: 603 sembol × 3.500 bar × 6 indikatör taraması **< 1 sn** (4 Worker).

### 4.4 Backend — opsiyonel, ürünü bloklamaz

Varsayılan dağıtım **tamamen statik** (GitHub Pages) kalır; ürünün %90'ı backend istemez.
`borsa`'daki FastAPI yalnızca ML ve WS için gerekliydi ve Pages'te hiç çalışmıyor
(ölü kod riski). Plan:

- **Faz 1-4:** backend yok. Veri CI'da üretilir, istemci hesaplar.
- **Faz 5 (ML):** eğitim **CI'da offline** çalışır, çıktı = model kartı + tahmin serisi
  (`.bin`). İstemci yalnızca okur. Canlı eğitim isteniyorsa ayrı bir servis olarak eklenir,
  ürün onsuz da tamdır.

---

## 5. UI/UX planı

### 5.1 Tasarım sistemi (Faz 1'in ilk işi)

`borsa`'da 24 CSS dosyası, 6.178 satır, bileşen başına elle yazılmış renk/boşluk. Yerine:

**Token katmanı** (`ui/tokens.css`) — semantik, iki tema, tek kaynak:
- Renk: `--surface-{0..3}`, `--text-{primary,secondary,muted}`, `--border-{subtle,strong}`,
  `--accent`, `--up`/`--down` (renk körlüğü için ayrıca şekil/işaret kodlaması),
  `--warn`, `--danger`, `--info`.
- Ölçek: 4 px tabanlı boşluk (`--sp-1..8`), tipografi ölçeği (12/13/14/16/20/28),
  **tabular-nums** tüm sayısal alanlarda (fiyat sütunları zıplamasın).
- Yükseklik/gölge/radius: 3 seviye, fazlası yok.
- Tema: `:root` = açık, `[data-theme=dark]` + `prefers-color-scheme` fallback.
  Grafik renkleri de aynı token'lardan okunur (bugün `chartTheme.ts` ayrı yerde duruyor).

**Primitive'ler** (~18 bileşen, hepsi erişilebilir, hepsi Storybook'ta):
`Button, IconButton, Toggle, Select, Combobox, NumberField, RangeField, Tabs, Dialog,
Sheet, Popover, Tooltip, Toast, Table(virtual), Badge, Stat, Skeleton, EmptyState`.

**Pattern'ler:** `ChartPanel`, `MetricCard` (+provenance popover), `RuleEditorRow`,
`ValidationBadges`, `SplitPane`, `CommandPalette`.

### 5.2 Etkileşim kuralları

- **Tek responsive bileşen ağacı.** Ayrı `MobileToolbar` yok; container query + `Sheet`
  primitive'i ile aynı bileşen telefonda alt sayfa olur. (Bugün 468 satırlık ikinci bir
  toolbar bakım borcu üretiyor.)
- **URL state.** `?v=symbol&s=THYAO&tf=D&ind=wr,macd&from=2020-01-01` — her ekran serileşir.
- **Komut paleti** (`Cmd/Ctrl+K`): sembol ara, ekran değiştir, indikatör aç/kapat, tarama
  çalıştır, tema değiştir. Tüm eylemler tek kayıt defterinden (`commands.ts`) beslenir;
  hem palet hem menüler oradan üretilir.
- **Durum dörtlüsü zorunlu:** her veri gösteren bileşen `loading / empty / error / stale`
  durumlarını tasarlar. Gecikmeli veri için "Veri: 12 Eyl 18:10 · gecikmeli" rozeti.
- **Sanallaştırma:** 600+ satırlık tarama/karşılaştırma tabloları `@tanstack/react-virtual`.
- **Klavye:** `j/k` satır gezinme, `/` arama, `Esc` kapatma (mevcut `useEscClose` genelleşir),
  odak tuzağı tüm diyaloglarda, görünür focus ring.
- **Erişilebilirlik hedefi:** WCAG 2.1 AA — kontrast ≥ 4.5:1, tüm interaktif öğeler
  klavyeyle erişilebilir, grafik için metinsel özet alternatifi (`aria-label` + "veri
  tablosu olarak göster").
- **Hareket:** `prefers-reduced-motion` saygısı; animasyon yalnızca durum değişimini
  açıklamak için (≤ 150 ms).

### 5.3 Performans bütçeleri (CI'da ölçülür, aşılırsa build kırmızı)

| Metrik | Bütçe (normal makine) | Bütçe (zayıf makine, 6× yavaş CPU) |
|---|---|---|
| İlk JS (gzip) | ≤ 180 KB | aynı |
| İlk boya (FCP) | ≤ 300 ms | ≤ 600 ms |
| Ekran hazır | ≤ 600 ms | ≤ 2,5 sn |
| Periyot/sembol değiştirme | ≤ 150 ms | ≤ 700 ms |
| Tarama parametresi → sonuç | ≤ 150 ms | ≤ 500 ms |
| 603 sembol taraması (worker) | ≤ 1 sn | ≤ 3 sn |
| Ana thread bloğu | tek seferde ≤ 50 ms | grafik ilk kurulumu hariç ≤ 250 ms |

Ölçüm aracı: `node scripts/measure-perf.mjs [yavaşlatma] [tekrar]` — CPU'yu
yavaşlatıp her ekranın hazır olma süresini, ilk boyamayı ve **uzun görevleri**
(>50 ms ana thread bloğu) raporlar. "Akıcı mı" sorusunun ölçülebilir karşılığı
ortalama FPS değil, bloklardır.

---

## 6. Analiz planı — "gösterge değil, kanıt"

### L0 — Veri kalitesi (görünmez ama her şeyin temeli)
- **Kurumsal aksiyon düzeltmesi:** bölünme/temettü/bedelsiz için geriye dönük düzeltme;
  "düzeltilmiş / ham" anahtarı UI'da görünür. (Bugün bu ayrım hiç yok — uzun vadeli
  backtest'ler sessizce yanlış.)
- **İşlem takvimi:** BIST tatilleri, yarım günler; eksik bar tespiti ve raporu.
- **Veri sağlık paneli:** sembol başına boşluk sayısı, son güncelleme, aykırı bar (%±20+
  tek gün) işaretleri. Şüpheli veri analize girerse UI uyarır.
- **Reel getiri:** TÜFE serisi ile enflasyon düzeltmeli getiri (bu repoda `data/inflation.ts`
  başlangıcı var) — TL bazlı analizde nominal getiri yanıltıcıdır; USD bazlı görünüm de.

### L1 — İndikatör kütüphanesi
- Vektörize, `Float64Array` girdi/çıktı, NaN-önü ısınma penceresi açıkça işaretli.
- **Altın-değer testleri:** her indikatör için bilinen bir referans seriye karşı birim test
  (bugün `borsa`'da 3 test dosyası var, indikatörlerin çoğu test dışı).
- Kapsam: SMA/EMA/WMA/VWMA, RSI, StochRSI, MACD, Bollinger, ATR, ADX/DMI, SuperTrend,
  Ichimoku, OBV, VWAP, Donchian/Keltner, regresyon kanalları + devralınan özel göstergeler
  (Williams Paşa, Nizam-i Cedid, MATLRNS).

### L2 — İstatistik & rejim
- Getiri dağılımı: çarpıklık/basıklık, kuyruk oranı, en iyi/en kötü N gün etkisi.
- **Korelasyon matrisi + hiyerarşik kümeleme** (603×603, Worker'da; dendrogram sıralı ısı
  haritası). `borsa`'daki "Top Pearson tablosu"nun yerine görsel yapı.
- **Rejim tespiti:** volatilite rejimi (yüksek/düşük), trend/yatay (ADX + Hurst),
  endeks korelasyon rejimi. Her strateji sonucu **rejim kırılımıyla** raporlanır —
  "bu strateji yalnızca düşük vol rejiminde kazanıyor" görünür olur.
- Beta / endekse göre göreli güç / sektör kırılımı.
- Sezonluk: ay/hafta günü etkisi (çoklu test uyarısıyla birlikte).

### L3 — Strateji motoru
- **Kural DSL'i** (JSON-serileşebilir, URL'e sığar):
  `{all: [{cross: ['ema20','ema50']}, {gt: ['rsi14', 55]}, {regime: 'lowvol'}]}`
- Giriş/çıkış/stop/hedef ayrı ayrı tanımlanır; pozisyon boyutu kural olabilir.
- Görsel editör + ham JSON görünümü (ikisi çift yönlü senkron).
- `borsa`'daki `SignalCombinator` (1.037 satır) burada ~200 satıra iner: kombinasyon
  mantığı veri (`DSL`), UI değil.

### L4 — Backtest motoru (olay güdümlü, dürüst)
Bugünkü en büyük analiz boşluğu. Zorunlu olacaklar:
- **Look-ahead koruması:** sinyal `t` barında üretilir, emir `t+1` açılışında dolar.
  Motor bunu tip düzeyinde zorlar (`SignalAt<T>` → `FillAt<T+1>`).
- **Maliyet modeli:** komisyon (BIST için varsayılan bps), spread, slipaj (hacme bağlı),
  BSMV/stopaj opsiyonu. Maliyetsiz sonuç **gösterilmez**, yalnızca karşılaştırma amaçlı
  "maliyetsiz" rozetiyle açılabilir.
- **Likidite tavanı:** günlük hacmin %X'inden fazlası alınamaz (küçük hisselerde sahte
  getirileri engeller).
- Metrikler: CAGR, Sharpe, **Sortino, Calmar, Ulcer Index**, maks. drawdown + süresi,
  kazanma oranı, profit factor, beklenti, **MAE/MFE dağılımı**, işlem başına maliyet payı,
  exposure %, en kötü 10 işlem.
- Karşılaştırma çubuğu: strateji vs **al-tut** vs **rastgele giriş (aynı exposure)**.

### L5 — Doğrulama katmanı (ürünün ayırt edici özelliği)
Her backtest sonucu, üstünde **5 rozetle** gelir; hiçbiri yeşil değilse sonuç gri gösterilir:

| Rozet | Anlamı |
|---|---|
| **OOS** | Walk-forward: parametreler yalnızca geçmiş pencerede seçildi, sonuç ileri pencerede ölçüldü |
| **Maliyet** | Komisyon + slipaj dahil |
| **Sağlamlık** | Parametre platosu haritası — komşu parametreler de kazanıyor mu? (tek tepe = uydurma) |
| **Tesadüf** | Monte Carlo permütasyon testi p-değeri (bar karıştırma / etiket karıştırma) |
| **Çoklu test** | Kaç kombinasyon denendi → **deflated Sharpe ratio** düzeltmesi |

Ek: bootstrap ile güven aralıkları, işlem sırası permütasyonu ile drawdown dağılımı.
Bu katman `borsa`'daki `signalOptimizer.ts`'in üretebileceği "en iyi parametre"yi
**doğrudan güvenilmez ilan etmeyi** mümkün kılar — asıl değer burada.

### L6 — Portföy & risk
- Pozisyon boyutlama: sabit kesir, ATR-bazlı risk parite, Kelly (kesirli), vol hedefleme.
- Portföy kısıtları: maks. pozisyon, korelasyon limiti (aynı kümeden N'den fazla pozisyon yok),
  sektör tavanı, drawdown freni.
- Risk raporu: VaR/CVaR (tarihsel + parametrik), stres senaryoları (2018 TL şoku, 2020 Mart,
  2023 deprem haftası gibi tanımlı tarihsel pencereler), faktör maruziyeti.
- **Reel (enflasyon düzeltmeli) ve USD bazlı** performans — TL yatırımcısı için nominal
  getiri tek başına anlamsız.
- İşlem günlüğü: gerçekleşen işlemler vs stratejinin dediği (uygulama farkı / "slippage of
  discipline").

### L7 — ML (Faz 5, dürüst çerçeve)
`borsa`'daki 3 katmanlı ensemble devralınır ama şu eklerle:
- **Triple-barrier etiketleme** + örnek ağırlıkları (eşzamanlılık düzeltmesi).
- **Purged K-fold + embargo** (sızıntıyı engeller; bugünkü basit train/test split sızdırır).
- **Kalibrasyon** (isotonic/Platt) — "%72 olasılık" gerçekten %72 mi?
- **Açıklanabilirlik:** SHAP ile özellik katkısı, her tahminin yanında ilk 5 sürücü.
- **Model kartı:** eğitim penceresi, özellik sayısı, CV skoru, canlı skor, kayma (drift)
  göstergesi. Model kartı olmadan tahmin UI'da gösterilmez.
- Baseline zorunlu: model, **al-tut ve basit momentum kuralını** yenemiyorsa öyle yazar.

### L8 — Temel analiz
- TTM (son 12 ay) hesapları, çeyreklik büyüme, DuPont ROE ayrıştırması.
- Çarpanlar + **sektör medyanına göre yüzdelik dilim** (tek başına F/K anlamsız).
- Kalite skoru: Piotroski F-Score, Altman Z (BIST uyarlamalı uyarısıyla), tahakkuk oranı.
- Temel + teknik birleşik tarama ("F/K < sektör medyanı VE 50 günlük momentum ilk %20'de").
- Finansal tablolarda **yeniden ifade (restatement) tarihi** gösterimi — geçmişe dönük
  tarama yaparken o gün bilinmeyen veriyi kullanmamak için (point-in-time disiplini).

---

## 7. Yol haritası

Her faz **kendi başına kullanılabilir bir ürün** bırakır; hiçbir faz "yarım sistem" değildir.

### Faz 0 — Temel (1 hafta)
- Monorepo düzeni (`core/` ayrımı), ESLint + Prettier + Vitest + CI.
- Performans bütçesi ölçümü CI'da (bundle-size + Lighthouse).
- **Çıktı:** boş ama disiplinli iskelet. **Kabul:** `npm run verify` (tip + lint + test + bütçe) yeşil.

### Faz 1 — Tasarım sistemi + kabuk (1.5 hafta)
- Token'lar, 18 primitive, Storybook, tema, komut paleti, URL state, 7 ekranlık boş kabuk.
- **Kabul:** tüm primitive'ler klavyeyle kullanılabilir; kontrast testi otomatik geçiyor;
  her ekran URL'den geri yüklenebiliyor.

### Faz 2 — Veri hattı + Sembol Masası (2 hafta)
- `.bin` kolonsal format + manifest + `latest-250` paketi; CI'da üretim (`scripts/`).
- Kurumsal aksiyon düzeltmesi, takvim, veri sağlık paneli.
- Sembol Masası: LOD grafik + indikatörler + özet kartları + provenance popover.
- **Kabul:** THYAO ilk açılış ≤ 600 ms; veri boyutu ≤ 60 MB (bugün 227 MB); sembol
  değişimi ≤ 150 ms.

### Faz 3 — Tarayıcı + Karşılaştır (1.5 hafta)
- Worker havuzu, canlı parametreli tarama, kayıtlı taramalar, alarmlar.
- Korelasyon matrisi + kümeleme, normalize karşılaştırma, ısı haritası.
- **Kabul:** 603 sembol taraması ≤ 1 sn, ana thread bloğu ≤ 50 ms.

### Faz 4 — Strateji Laboratuvarı (2.5 hafta) ← *değerin merkezi*
- Kural DSL + editör, olay güdümlü backtest, maliyet modeli, metrik seti.
- Doğrulama katmanı (5 rozet), parametre platosu haritası, rapor çıktısı.
- **Kabul:** bilinen bir stratejinin sonuçları referans bir motorla ±%1 içinde eşleşiyor;
  look-ahead içeren bir test kasıtlı yazıldığında motor derleme/çalışma zamanında reddediyor.

### Faz 5 — Portföy + Temel analiz (2 hafta)
- Portföy, risk raporu, reel/USD getiri, senaryo; temel tablolar + birleşik tarama.
- **Kabul:** portföy getirisi elle hesaplanan referansla tutuyor; point-in-time tarama
  geçmiş veriyi sızdırmıyor (test).

### Faz 6 — ML + Rapor (2 hafta, opsiyonel)
- CI'da offline eğitim, model kartı, kalibrasyon, SHAP; paylaşılabilir rapor sayfası.
- **Kabul:** model kartı olmadan tahmin render edilmiyor; baseline karşılaştırması görünür.

**Toplam:** ~12 hafta tam kapsam; ilk kullanılabilir sürüm (Faz 0-2) ~4.5 hafta.

### Gerçekleşen (2026-09-14)

Yedi fazın hepsi uygulandı. Plandan sapmalar ve fazlardan sonra eklenenler:

| Faz | Durum | Plandan fark |
|---|---|---|
| 0 — Temel | ✅ | Lighthouse yerine kendi bütçe betiğimiz (gzip eşiği, CI'da kapı) |
| 1 — Tasarım sistemi + kabuk | ✅ | Storybook yerine uygulama içi canlı galeri (ayrı derleme yok) |
| 2 — Veri hattı | ✅ | Plandaki hedef 3×; ölçülen **3,7×** (bar başına 24 bayt) |
| 3 — Tarayıcı + Karşılaştır | ✅ | Bütçe 1000 ms, ölçüm ~60 ms |
| 4 — Laboratuvar | ✅ | Beş doğrulama rozeti planlandığı gibi |
| 5 — Portföy + temel analiz | ✅ | USD bazlı getiri ertelendi (kur serisi veri hattında yok) |
| 6 — ML + Rapor | ✅ | SHAP yerine katsayı + katmanlar arası **kararlılık** (model lineer olduğu için katsayı zaten yorumlanabilir); PNG yerine yazdırma/PDF |

**Fazlardan sonra eklenenler** (planda yoktu, kullanıcı isteğinden doğdu):

1. **Stratejiler ekranı** — piyasa geneli sıralama, üç kapsam, Holm düzeltmesi.
2. **Sektör bazlı para akışı** — davranış kümelerinin yanına resmî sınıflandırma.
3. **Paylaşılabilirlik** — tarama filtreleri ve laboratuvar kuralı URL'de.
4. **Erişilebilirlik borcunun kapatılması** — devralınan ekranlarda 46 uyarı → 0.

**Kalan boşluklar** (kapanmadı, gizlenmedi):

- `scripts/build_sectors.py`'nin kaynağı geliştirme ortamından erişilemediği için
  canlı yanıt formatı doğrulanamadı; ayrıştırıcı çevrimdışı test altında, CI adımı
  `continue-on-error` ve dosya yazılmazsa arayüz davranış kümelerine düşüyor.
- Kesitsel (çoklu sembol) model: kart "tek sembolde, tek dönemde ölçüldü" diyor.

---

## 8. Kalite kapıları

- **Test piramidi:** `core/` %90+ satır kapsamı (saf fonksiyonlar, hızlı), UI için
  etkileşim testleri (Testing Library), 5 kritik akış için Playwright (Chromium zaten kurulu).
- **Altın-değer testleri:** indikatör ve backtest sonuçları sabitlenmiş referans dosyalarla
  karşılaştırılır; sessiz regresyon imkânsız.
- **Özellik testleri (fast-check):** "resample(D→W) bar sayısını asla artırmaz",
  "maliyet eklemek getiriyi asla artırmaz" gibi değişmezler.
- **Veri sözleşmesi testi:** CI'da üretilen `.bin` manifest şemasına uyuyor mu, NaN var mı.
- **Görsel regresyon:** Storybook + snapshot (tema başına).
- **CI:** tip → lint → test → bütçe → veri doğrulama → deploy. Herhangi biri kırmızıysa yayın yok.

---

## 9. Teknik kararlar ve alternatifleri

| Karar | Seçim | Neden / alternatif |
|---|---|---|
| Grafik | Lightweight Charts + mevcut LOD çekirdeği | ECharts (borsa) 100k+ barda takılıyor; LOD çekirdeği zaten burada ve milyonlarca barı kaldırıyor |
| Fiyat tipi | `float32` | `int32` kuruş daha kesin ama tüm hesap zincirini karmaşıklaştırır; float32 BIST hassasiyeti için yeterli, hacim için `float32` (büyük değerler) |
| Veri dağıtımı | Statik `.bin` + Pages | Backend maliyet ve bakım getirir; %90 senaryo istemcide çözülüyor |
| State | URL + TanStack Query + küçük store | Redux gereksiz; context-prop-drilling (borsa'daki 46 prop) tekrarlanmayacak |
| Stil | CSS değişkenleri + CSS Modules | Tailwind de olur; token disiplini esas, sözdizimi değil |
| Worker | Comlink + havuz | Elle `postMessage` protokolü hata üretiyor |
| ML | CI'da offline eğitim | Canlı FastAPI, statik dağıtımla uyumsuz; ürünü bloklamamalı |
| i18n | `react-i18next`, tr varsayılan | Baştan iki dilli; sonradan eklemek 3 kat pahalı |

---

## 10. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Veri kaynağı (`borsapy`/`isyatirimhisse`) kırılması | Yüksek | Adaptör arkasına al, CI'da şema testi, son iyi veriyi koru + UI'da "bayat veri" rozeti |
| 227 MB → yeni format göçü | Orta | Faz 2'de iki formatı paralel üret, doğrulama scripti ile bar-bar karşılaştır |
| Doğrulama katmanı kullanıcıyı yavaşlatır | Orta | Hızlı mod (tek geçiş) + "tam doğrulama" düğmesi; rozetler asenkron dolar |
| Kapsam şişmesi (ML'e erken dalmak) | Yüksek | ML Faz 6'da; öncesinde hiçbir ML kodu ana dala girmez |
| Yasal (yatırım tavsiyesi algısı) | Yüksek | Her rapor/ekranda görünür feragatname, "tahmin" değil "geçmiş performans" dili, SPK uyarısı korunur |

---

## 11. Başarı ölçütleri

- Bir sembolü açıp "bu hisse ne durumda" sorusuna cevap alma süresi: **< 5 sn**.
- Bir strateji kurup doğrulanmış sonuç alma süresi: **< 5 dk**.
- Veri boyutu: **227 MB → ≤ 60 MB**; ilk açılış JS: **≤ 180 KB**.
- `core/` test kapsamı **≥ %90**; indikatörlerin **%100'ü** altın-değer testli.
- Her yayınlanan metriğin provenance popover'ı var (kapsam: **%100**).
- Erişilebilirlik: axe ihlali **0**, tam klavye ile tüm akışlar tamamlanabiliyor.

---

## 12. Sonraki adım

Onaylanırsa **Faz 0 + Faz 1** tek PR'da başlar: repo düzeni, `core/` ayrımı, tasarım sistemi
token'ları ve ilk 8 primitive + komut paleti + URL state. Mevcut `src/chart/lod.ts`,
`src/indicators/*` ve `scripts/*.py` bu yapıya taşınır, yeniden yazılmaz.

> **Feragatname:** Bu belge bir yazılım planıdır; hiçbir bölümü yatırım tavsiyesi değildir.
