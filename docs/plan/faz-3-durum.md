# Faz 3 — Uygulama Durumu

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §7 (Faz 3)
**Durum:** Tamamlandı — `npm run verify` yeşil (95 → 148 test)

---

## Plandaki maddeler

| Madde | Durum | Nerede |
|---|---|---|
| Worker havuzu | ✅ | `src/workers/pool.ts`, `analysis.worker.ts`, `analysisClient.ts` |
| Canlı parametreli tarama | ✅ | `src/core/screen/metrics.ts` + `src/shell/screens/ScreenerScreen.tsx` |
| Kayıtlı taramalar | ✅ | Tarayıcı ekranı (localStorage) |
| Alarmlar | ⏭️ ertelendi | gerekçe aşağıda |
| Korelasyon matrisi + hiyerarşik kümeleme | ✅ | `src/core/stats/correlation.ts` |
| Normalize karşılaştırma | ✅ | `src/shell/chart/NormalizedChart.tsx` (canvas, bağımlılıksız) |
| Isı haritası | ✅ | `src/shell/chart/HeatMap.tsx` (canvas) + Nabız ekranı |
| Nabız ekranı (piyasa özeti + para akışı) | ✅ | `src/core/screen/pulse.ts`, `src/shell/screens/Pulse.tsx` |

## Kabul ölçütleri

Plan: *"603 sembol taraması ≤ 1 sn, ana thread bloğu ≤ 50 ms."*

```
603 sembol × 250 bar tarama (tek iş parçacığı)   : testte bütçe 1000 ms, ölçüm ~60 ms
603 sembol korelasyon + kümeleme (tek worker)    : testte bütçe 3000 ms, ölçüm ~500 ms
200 sembol tarama (tarayıcıda, 3 worker)         : worker 40 ms
Ana iş parçacığı                                  : yalnızca filtre + sıralama + çizim
next.html ilk yük                                 : 52,8 KB gzip (bütçe 180 KB)
148 test / 20 dosya
```

Her iki bütçe de kalıcı test olarak duruyor (`src/workers/analysis.test.ts`);
performans bir daha sessizce kaybolamaz.

## Mimari kararlar

**Worker havuzu neden elle yazıldı.** İhtiyaç yüzeyi küçük: istek/yanıt eşleme,
boştaki worker'a dağıtma, hepsine yayınlama. Karşılığında `spawn` enjekte
edilebilir oldu — testler gerçek Worker olmadan aynı kodu çalıştırıyor (jsdom'da
Worker yok). Comlink eklemek bu esnekliği vermeyecekti.

**Paket worker'lara kopyalanır, fetch tekrarlanmaz.** Ana iş parçacığı paketi bir
kez indirir (IndexedDB önbelleğiyle), her worker'a `buffer.slice(0)` ile kendi
kopyası gider. Aktarım (transfer) kullanılsaydı ilk worker'dan sonra tampon
boşalırdı; her worker'ın kendi ağ isteğini yapması ise N kat indirme olurdu.

**Metrikler worker'da, filtre ana iş parçacığında.** Metrik hesabı parametreye
bağlı ve pahalı; filtre/sıralama ucuz. Kural değiştirmek bu yüzden hiç worker'a
gitmiyor — anında. Parametre değiştirmek yeniden hesaplatıyor (~40 ms).

**NaN hiçbir kuralı geçemez.** "Bilinmiyor" ile "uygun" aynı şey değil; ısınma
süresi dolmamış bir RSI, `RSI < 30` filtresinden geçmemeli.

**Korelasyon getiriler üzerinden.** Fiyat seviyeleri üzerinden korelasyon iki
trendli seriyi daima ~1 gösterir. Log getiri kullanmak "birlikte hareket etmeyi"
ölçer; eksik barlar çift bazında atlanır, yetersiz örtüşmede sonuç NaN kalır.

**Kümelemede eksik veri yakınlık üretmez.** Uzaklık `1 − korelasyon`; korelasyon
hesaplanamadıysa uzaklık 2 (mümkün olan en uzak) kabul edilir.

## Yol boyunca düzeltilen gerçek kusurlar

- **Sayı alanında "sil ve yeniden yaz" değeri bozuyordu.** Kontrollü input, boş
  girdide eski değeri anında geri yazıyor, ardından basılan rakam ona EKLENİYORDU
  (14 → "142" → sınıra kırpılıp 100). Alan artık yazım sırasında yerel taslak
  tutuyor, sınır kırpması odak çıkışında uygulanıyor. (`src/ui/Fields.tsx`,
  regresyon testleriyle.)
- **`Number('') === 0` tuzağı:** kutuyu boşaltıp odağı kaybetmek değeri sessizce
  sıfırlıyordu; boş girdi artık ayrıca eleniyor.
- **canvas CSS değişkeni çözemez.** `strokeStyle = 'var(--accent)'` geçersiz renk
  olduğu için tüm çizgiler gri çiziliyordu; token artık `getComputedStyle` ile
  gerçek değere çevriliyor.
- **Sağdaki sembol etiketleri üst üste biniyordu**; artık en az 12 px aralıkla
  itiliyor ve ölçek etiketleri sol tarafa alındı.
- **Ekranlar worker istemcisinin nesne kimliğine bağlıydı.** Kimlik beklenmedik
  biçimde değişirse tarama sonsuz döngüye giriyordu (testte 378 çağrı olarak
  yakalandı). İstemci artık ref üzerinden okunuyor; hook'un "kimlik sabittir"
  sözleşmesi de yazıldı.

## Ertelenenler ve gerekçeleri

1. **Alarmlar.** Anlamlı bir alarm, kullanıcı sekmeyi kapattığında da çalışmalı;
   bu ya bir sunucu ya da service worker + bildirim izni demek. Yarım bir
   "sekme açıkken çalışan alarm" güven veren bir özellik değil, o yüzden kendi
   başına ele alınacak.
2. **Isı haritası.** Piyasa geneli ısı haritasının doğal yeri Nabız ekranı;
   kümeleme sırası (`order`) hazır, ekranla birlikte gelecek.

## Nabız ekranı ve para akışı

"Endeks yükseldi" tek başına az şey söyler: 30 hisse taşıyıp 400 hisse düşüyor
olabilir. Ekran iki ayrı soruyu ayrı ayrı cevaplıyor:

- **Genişlik** — yükselenlerin yön veren semboller içindeki payı (değişmeyenler
  hesaba girmez).
- **Para akışı** — (yükselenlerin işlem değeri − düşenlerin işlem değeri) ÷
  toplam. Sayıca çoğunluk ile paranın yönü zıt olabilir; ölçüm ikincisini
  gösterir.

**Isı haritası** kümeleme sırasıyla çiziliyor: yan yana düşen kutular birlikte
hareket eden hisseler, yani "hangi grup taşıyor / hangi grup satılıyor" tek
bakışta görünüyor. 200 kutu canvas'a tek geçişte çiziliyor (DOM'da 200 düğüm
her tema değişiminde yeniden stillenirdi).

**Gruplara göre para akışı** tablosu, kümeleri en çok işlem gören üyesiyle
etiketliyor. Bu bir sektör listesi DEĞİL — elimizde resmî sınıflandırma yok —
ve arayüz bunu açıkça yazıyor: "birlikte hareket eden hisselerin kümeleri".
Ağırlıklandırma işlem değerine göre; eşit ağırlık büyük ve küçük hisseyi aynı
sayardı.

Ölçüm: 200 sembol nabız hesabı tarayıcıda **13–31 ms** (tek worker).

## Sıradaki

- Faz 4: kural DSL'i, olay güdümlü maliyetli backtest, doğrulama rozetleri.
