# Zayıf makinede akıcılık — ölçüm ve bulgular

**Tarih:** 2026-09-14
**Araç:** `npm run perf -- [yavaşlatma] [tekrar]` (`scripts/measure-perf.mjs`)

---

## Yöntem

"Akıcı mı?" sorusunun ölçülebilir karşılığı ortalama FPS değil, **ana thread
bloklarıdır**: 50 ms'yi aşan tek bir görev, kullanıcının tıklamasının geç
cevaplanması demektir. Araç, Chromium'da CPU'yu yavaşlatıp (6× ≈ düşük güçlü
bir dizüstü) her ekran için şunları ölçer:

- **FCP** — ilk boyama
- **Ekran hazır** — anlamlı içerik görünene kadar
- **Uzun görev sayısı / en kötü blok / toplam blok** (`PerformanceObserver`, `longtask`)
- **Etkileşim gecikmesi** — parametre değişimi → sonuç, periyot değişimi, doğrulama

Tek ölçüm %30'a varan sapma gösterebildiği için varsayılan **3 tekrarın
medyanı** raporlanır.

## GERÇEK VERİ (584 sembol, tam geçmiş) — 15 Eylül 2026

Bu tablo bu tarihe kadar HİÇ ÖLÇÜLMEMİŞTİ ve sebebi araçtaydı: hazır
ölçütlerinin URL'leri `s=X001` yazıyordu, o sembol yalnızca sentetik sette
var. Gerçek veride araç grafiği 120 saniye bekleyip düşüyordu. Yani "zayıf
makinede akışkan" iddiası, asıl önemli veri setinde doğrulanmamıştı. Sembol
artık argüman:

    node scripts/measure-perf.mjs 6 3 THYAO,GARAN,AKBNK

6× yavaşlatma (≈ düşük güçlü dizüstü), 3 tekrarın medyanı:

| Ekran              | Hazır  | En kötü blok | Toplam blok | Etkileşim                             |
| ------------------ | ------ | ------------ | ----------- | ------------------------------------- |
| Nabız              | 2,7 sn | 179 ms       | 791 ms      | —                                     |
| Tarayıcı           | 2,3 sn | 380 ms       | 645 ms      | parametre→sonuç 952 ms                |
| Sembol Masası      | 2,3 sn | 505 ms       | 977 ms      | periyot 527 ms · yakınlaştırma 655 ms |
| Laboratuvar        | 2,4 sn | 353 ms       | 656 ms      | doğrulama 813 ms                      |
| Karşılaştır        | 3,0 sn | 135 ms       | 526 ms      | —                                     |
| Stratejiler        | 2,9 sn | 587 ms       | 885 ms      | kapsam 332 ms                         |
| Model              | 2,0 sn | 120 ms       | 195 ms      | —                                     |
| Rapor              | 1,5 sn | 126 ms       | 187 ms      | —                                     |
| Sektör akranları   | 2,3 sn | 494 ms       | 937 ms      | akran yükleme 1047 ms                 |
| Radar (tüm piyasa) | 2,4 sn | 488 ms       | 932 ms      | açılış 2141 ms                        |
| Portföy            | 1,1 sn | 141 ms       | 226 ms      | —                                     |

Gerçek veri sentetikten yaklaşık 1,5 kat ağır: hazır süreleri 1,3–1,9 sn'den
1,1–3,0 sn'ye, en kötü blok 342 ms'den 587 ms'ye çıkıyor. 6× yavaşlatma bir
EMÜLASYON — normal bir makinede bu sayıların altıda birine karşılık geliyor.

### Yeniden ölçüm (gerçek veri, 541 sembol · 162 MB)

Aracın kendi uyarısı gereği TEK koşuya bakılmadı: üç ayrı çağrı, her biri üç
tekrarın medyanı, yani dokuz sayfa yükü. Üç çağrı birbirine çok yakın çıktı.

| Ekran              | Hazır   | En kötü blok | Etkileşim                           |
| ------------------ | ------- | ------------ | ----------------------------------- |
| Portföy            | 873 ms  | 84 ms        | —                                   |
| Rapor              | 1119 ms | 87 ms        | —                                   |
| Model              | 1296 ms | 91 ms        | —                                   |
| Sektör akranları   | 1519 ms | 308 ms       | akran yükleme 720 ms                |
| Sembol Masası      | 1524 ms | 317 ms       | yakınlaştırma 51 ms · kaydırma 0 ms |
| Radar (tüm piyasa) | 1559 ms | 337 ms       | açılış 1650 ms                      |
| Laboratuvar        | 1605 ms | 242 ms       | doğrulama 581 ms                    |
| Tarayıcı           | 1652 ms | 232 ms       | parametre→sonuç 598 ms              |
| Nabız              | 1977 ms | 124 ms       | —                                   |
| Stratejiler        | 2054 ms | 425 ms       | kapsam 199 ms                       |
| Karşılaştır        | 2069 ms | 103 ms       | —                                   |

Zayıf makinede ekranlar **0,9–2,1 saniyede** açılıyor; en kötü tek takılma
**425 ms** (Stratejiler, 1600 backtest).

FARK KODA YAZILMIYOR. Bütün sayılar üstteki tablodan düşük, ama iki ölçüm
FARKLI KAPTA koştu; aradaki farkın ne kadarı koddan ne kadarı makineden,
bu veriyle ayrılamaz. Kayda geçen şey ŞU ANKİ durum, bir kazanç iddiası
değil. Karşılaştırma yapılacaksa iki sürüm de aynı kapta ölçülmeli.

Ayrıca: `radar_açılış_ms=1650` bir DONMA değil. Aynı ekranın ana thread blok
toplamı 574 ms; kalan süre worker hesabı ve veri okuma, yani arayüz o sırada
yanıt veriyor. Grafik yakınlaştırma ve kaydırma blokları 0–58 ms.

### En kötü blok profille ayrıştırıldı: 425 → 208 ms

Tablodaki en kötü tek takılma Stratejiler'deydi (425 ms). Dokunmadan önce CPU
profili alındı (6× kısma, adları koruyan derleme) ve tek bir tepe çıktı:

    236 ms  %5,8  logFactorial @ Strategies.js

Listedeki ikinci sıranın neredeyse iki katı. Sebep `signTest`teydi: kuyruk
döngüsünün İÇİNDEN `logFactorial` çağrılıyor, biri (`logFactorial(trials)`)
döngü değişmezi olduğu hâlde her yinelemede baştan hesaplanıyor, üstelik
`logFactorial` kendisi O(n) döngü. Toplam O(deneme²).

Ön toplam tablosuyla O(deneme)'ye indi. Tablo aynı toplamı AYNI SIRAYLA
biriktiriyor, yani değerler bit düzeyinde özdeş — bu bir yaklaşım değişikliği
değil, aynı hesabın bir kez yapılması. `rank.referans.test.ts` eski uygulamayı
referans tutup 300 deneme boyutu × 7 başarı değerinde `Object.is` ile
karşılaştırıyor.

ÖLÇÜM (aynı kap, aynı oturum, aynı küçültülmüş derleme, üçer koşu):

|              | önce                  | sonra                     |
| ------------ | --------------------- | ------------------------- |
| en kötü blok | 425 / 446 / 418 ms    | **211 / 204 / 208 ms**    |
| hazır        | 2054 / 2435 / 2002 ms | **1825 / 1812 / 1825 ms** |

Aralıklar örtüşmüyor; bu sefer karşılaştırma meşru, çünkü iki ölçüm aynı kapta
dakikalar arayla alındı. Stratejiler artık en kötü ekran değil.

### Ölçüldü ve BİLEREK dokunulmadı: `trDate` 87 ms

Düzeltmeden sonra profilde ikinci sıraya Türkçe tarih biçimlendirmesi çıktı
(87 ms). İlk bakışta "her çağrıda `Intl.DateTimeFormat` kuruluyor, önbelleğe
al" denecek bir kalıp. Ölçülünce öyle çıkmadı:

    ilk çağrı        82,8 ms
    sonraki 20 çağrı  0,45 ms/çağrı

Yani bu tekrarlayan bir israf değil, Türkçe yerel verisinin BİR KEREYE MAHSUS
kurulum bedeli; biçimlendiriciyi saklamak onu ortadan kaldırmaz, yalnızca
başka bir ana taşır. Üstelik `marketFreshness` tek kez çağrılıyor. Dokunulmadı.

### Kaydırma ölçümü SESSİZCE yapılmamış hâldeydi

Sentetik sette "40 adım 61 ms" yazıyordu; gerçek veride aynı ölçüm 670 ms
verdi. On kat fark koddan gelmiyordu — ölçümün kendisinden geliyordu.

Adım 120 px sabitti. Sentetik sette tablonun kaydırılabilir mesafesi yalnızca
~1.040 px, yani dokuzuncu adımda dibe varılıyor ve kalan 31 adım hiçbir şey
yapmıyordu. Araç bunu güzel bir sayı olarak raporluyordu: yapılmamış bir
ölçümün sayısı.

Adım artık içeriğe göre (`mesafe / 40`) ve KAT EDİLEN MESAFE de raporlanıyor
— sıfıra yakınsa sayı yorumlanmamalı. Aynı ölçüm düzeltildikten sonra
sentetik sette 79 ms / 1.040 px, yani tablonun tamamı kat ediliyor.

Sanal tablo doğru çalışıyor: gerçek veride DOM'da 24 satır ve 15 sütun var,
toplam yükseklik 5.745 px. Kaydırma maliyeti satır sayısından değil, her
adımda görünen pencerenin yeniden çizilmesinden geliyor.

## Sonuçlar (200 sembol × 3400 barlık sentetik set, 2 tekrarın medyanı)

| Ekran                       | Normal makine (1×)                                | Zayıf makine (6×)                                        |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Nabız + ısı haritası        | hazır 336 ms · blok **0**                         | hazır 1,3 sn · en kötü 118 ms                            |
| Tarayıcı                    | hazır 403 ms · blok **0** · parametre→sonuç 84 ms | hazır 1,5 sn · en kötü 182 ms · parametre→sonuç 468 ms   |
| Sembol Masası               | hazır 311 ms · blok **0** · periyot 146 ms        | hazır 1,7 sn · en kötü **319 ms** · periyot 486 ms       |
| Laboratuvar                 | hazır 350 ms · blok **0** · doğrulama 370 ms      | hazır 1,7 sn · en kötü 195 ms · doğrulama 585 ms         |
| Karşılaştır                 | hazır 415 ms · blok **0**                         | hazır 1,7 sn · en kötü 185 ms                            |
| Stratejiler (1600 backtest) | hazır 439 ms · blok **0** · kapsam 62 ms          | hazır 1,5 sn · en kötü 118 ms · kapsam 230 ms            |
| Model (purged CV)           | hazır 926 ms · blok **0**                         | hazır 1,9 sn · en kötü 108 ms                            |
| Rapor                       | hazır 272 ms · blok **0**                         | hazır 1,4 sn · en kötü 121 ms                            |
| Sektör akranları            | hazır 270 ms · blok **0** · akran yükleme 198 ms  | hazır 1,8 sn · en kötü **342 ms** · akran yükleme 787 ms |
| Portföy                     | hazır 159 ms · blok **0**                         | hazır 0,9 sn · en kötü 135 ms                            |

**Normal makinede hiçbir ekranda 50 ms'yi aşan tek bir görev yok** — sonradan
eklenen altı ekranda da değişmedi. Zayıf makinede en kötü iki blok (319 ms ve
342 ms) aynı yerden geliyor: grafik kütüphanesinin İLK kurulumu (aşağıda).
Model ve Stratejiler en ağır hesabı yaptıkları hâlde en düşük blokları
üretiyorlar, çünkü iş worker'da.

Modelin 926 ms'lik "hazır" süresi eğitimin kendisidir; o sırada arayüz
donmuyor, iskelet gösteriliyor.

### Sektör akranları: ölçüm tahmini düzeltti

Tabloda bu ekranın 6× kısmada 342 ms'lik bir bloğu görünüyordu ve ilk tahmin
"paketi Candles'a çevirmek pahalı" oldu. Panel yalnızca aynı sektördeki
sembolleri çevirecek biçimde daraltıldı (200 yerine 10–25) — doğru bir
iyileştirme, ama süre 787 → 753 ms'de kaldı; demek ki darboğaz orası değildi.

Süreyi parçalara ayırınca gerçek tablo çıktı: akran yükleme adımı, sayfa
ısınmışken **315 ms sürüyor ve HİÇ uzun görev üretmiyor**; 1 MB'lık paketin
indirilmesi yerelde 13 ms. Ekranın 342 ms'lik bloğu sembol masasınınkiyle aynı
kaynaktan geliyor: grafik kütüphanesinin ilk kurulumu.

Ders: bloğu ölçmeden "pahalı olan şu olmalı" demek, yanlış yeri optimize
ettirir. Daraltma kodda kaldı (daha az iş, daha az çöp) ama performans kazancı
olarak sayılmıyor.

## Yapılan iyileştirmeler (ve etkileri)

1. **Sembol analizi worker'a taşındı.** Periyot dönüşümü, EMA'lar, özet
   metrikler ve veri sağlığı raporu ana thread'de ~150 ms'lik tek parça blok
   oluşturuyordu (CPU profiliyle ölçüldü). Artık worker'da; ana thread yalnızca
   çiziyor.
2. **Grafik kovaları cihaza göre.** LOD çekirdeği sabit 4000 kova besliyordu;
   1366 px'lik bir ekranda bu piksel başına ~3 mum, yani görülemeyecek iş.
   Artık `genişlik × piksel yoğunluğu` ile ölçekleniyor ve çekirdek sayısı
   düşük cihazlarda ayrıca azaltılıyor.
3. **Gizli indikatörler artık hesaplanmıyor.** LOD, kapalı serilerin verisini
   de her karede indirgiyordu. Görünürlük kontrolü eklendi — kapalı gösterge
   artık bedava. (Devralınan uygulama da bundan yararlanıyor: orada 12 seri var.)
4. **Grafik boş zamanda kuruluyor.** `requestIdleCallback` ile metrikler ve veri
   sağlığı paneli önce boyanıyor; kullanıcı sayfayı "donmuş" görmüyor.
5. **Gereksiz paket indirmesi kaldırıldı.** Sembol Masası tek sembolle çalışıyor
   ama worker havuzu için piyasa paketini (~1 MB) de indiriyordu; artık yalnızca
   manifest.

## Kalan tek blok: grafik kütüphanesinin ilk kurulumu

**CPU profiliyle ayrıştırıldı (6× kısma, gezinme anından itibaren):**

| Kalem                                      | Süre    |
| ------------------------------------------ | ------- |
| `(program)` — betik ayrıştırma/derleme     | 1119 ms |
| `lod` yığınının modül değerlendirmesi      | 152 ms  |
| Sembol Masası bileşen kodu                 | 142 ms  |
| `useBitmapCoordinateSpace` (canvas çizimi) | 48 ms   |

Tek uzun blok (372 ms) grafiğin KURULMASI; ayrıştırma ondan önce, ayrı
görevlerde oluyor. İki azaltma denendi ve **ikisi de ölçülebilir kazanç
vermedi**:

1. Modül indirmesini erkene almak (ayrıştırma ağ boşluğuna denk gelsin diye) —
   blok 370 → 372 ms. Ayrıştırma zaten erken yapılıyormuş. Değişiklik geri
   alındı: ölçülmemiş bir kazanç için kod eklemek, sonraki okuyucuyu yanıltır.
2. Paketin tamamını Candles'a çevirmeyi daraltmak (yukarıda) — o blok zaten
   grafikten geliyormuş.

Karar değişmedi: kütüphane değiştirilmiyor. Gerekçe artık tahmin değil ölçüm —
maliyet kurulumun kendisinde ve onu azaltmanın yolu kütüphaneyi değiştirmekten
geçiyor; kazanç (zayıf makinede tek seferlik ~370 ms) riski karşılamıyor.

Zayıf makinede `lightweight-charts` ilk kurulumu ~370 ms CPU istiyor (profil:
sayfanın en pahalı tek işi, 617 ms toplam CPU). Bu **sayfa başına bir kez**
oluyor ve boş zamana ertelendiği için o sırada metrikler, veri sağlığı ve
gezinme zaten boyanmış ve tıklanabilir durumda.

Daha ileri gitmenin yolu kütüphaneyi değiştirmek (kendi mum çizicimizi yazmak)
olurdu; bu, bakım maliyeti ve piyasa-standardı etkileşimlerin (crosshair, fiyat
ölçeği, çoklu pane) kaybı anlamına gelir. Ölçülen fayda bunu şu an haklı
çıkarmıyor — karar yeniden gözden geçirilebilir olsun diye buraya yazıldı.

## Kaydırma akıcılığı — ve yanlış ölçen bir ölçüt

"Akışkan mı" sorusunun ilk açılış dışındaki yarısı hiç ölçülmemişti: 200
satırlık tablo zayıf makinede **kaydırılırken** ne oluyor?

İlk ölçüm alarm verdi: kare başına medyan 35 ms, p90 90 ms. Yani takılma.
Ama ölçütün kendisi yanlıştı — her adımda çift `requestAnimationFrame`
bekleniyordu ve bunun **tabanı zaten iki vsync karesi (≈33 ms)**. Aynı ölçüt
yavaşlatma KAPALIYKEN de 33 ms veriyordu; ölçtüğüm şey iş değil, ekranın
yenilenme hızıydı.

Doğru ölçüt, kaydırmanın ana thread'de kaç ms tuttuğu:

|                         | 1×     | 6× (zayıf) |
| ----------------------- | ------ | ---------- |
| Kaydırma adımı (medyan) | 0,1 ms | 16 ms      |
| Kaydırma adımı (p90)    | 2,5 ms | 22 ms      |
| 40 adımın toplamı       | 37 ms  | ~425 ms    |
| Uzun görev (>50 ms)     | 0      | 0          |

Zayıf makinede bile kaydırma sırasında **tek bir uzun görev yok**; iş 16 ms'lik
kare bütçesine sığıyor. Ölçüm `npm run perf` çıktısına kalıcı olarak eklendi
(`kaydırma_40_adım_ms`), yoksa bir gün sessizce bozulur.

### Denenip geri alınan: satırları `memo`'ya sarmak

Kaydırırken pencere kayıyor ama ekranda kalan satırların verisi değişmiyor;
"satır bileşenini `memo` ile sarsam yalnızca yeni girenler çizilir" diye
düşündüm. A/B ölçümü:

```
memo YOK : 421 / 430 ms  (40 adım toplamı, 6×)
memo VAR : 429 / 420 ms
```

Fark yok. Maliyet React uzlaştırmasında değil, tarayıcı tarafında (kaydırma →
yapışkan başlık → boyama); tablo zaten `table-layout: fixed` olduğu için düzen
hesabı da ucuz. Ölçülebilir kazanç vermeyen karmaşıklık geri alındı.

## Grafik etkileşimi: yakınlaştırma pahalı, kaydırma bedava

LOD seyreltmesi yazıldı ama ETKİLEŞİM sırasında ne kazandırdığı hiç
ölçülmemişti. 3.400 barlık seride, 6× yavaşlatmayla, 20 tekerlek adımı
(uzaklaştırma) ve 20 sürükleme adımı (kaydırma):

|                         | Ana thread bloğu |
| ----------------------- | ---------------- |
| Yakınlaştırma (20 adım) | ~600–820 ms      |
| Kaydırma (20 adım)      | 0–50 ms          |

Kaydırma pratikte bedava; yakınlaştırma adım başına ~20–40 ms tutuyor (1×'te
~4–7 ms). Profil, maliyetin **kütüphanenin canvas boyaması** olduğunu
söylüyor: örneklerin yarısı `(program)` (yerel canvas çağrıları), `lod`
yığınının kendi JS'i yalnızca ~42 ms.

### Denenip geri alınan: kova yoğunluğunu yarıya indirmek

"Ekranın gösteremeyeceği kadar mum çiziyoruz" varsayımıyla kova yoğunluğu
1,2/px → 0,5/px yapıldı ve ölçüldü:

```
yoğunluk 1,2 : 530 / 730 ms blok (iki koşu)
yoğunluk 0,5 : 614 ms blok
```

Gürültünün içinde kaybolan bir fark. Maliyet mum SAYISINDA değil, her karede
yeniden çizilen ızgara/eksen/etiket katmanında; bu yüzden değişiklik geri
alındı ve mevcut cihaz-duyarlı yoğunluk korundu.

Ölçüm kalıcı: `npm run perf` çıktısında `yakınlaştırma_blok_ms` ve
`kaydırma_blok_ms`. Yol boyunca bir ölçüm hatası da düzeltildi — etkileşim
blokları açılışın uzun görev sayacına karışıyordu; artık açılış ölçümü
etkileşimden ÖNCE alınıyor, yoksa "açılışta kaç blok var" sorusunun cevabı
ölçümün kendisine göre değişirdi.

## Yavaş bağlantı: 20 saniyelik sessizlik

Şimdiye kadar hep CPU ölçüldü; AĞ hiç ölçülmemişti. Yavaş 3G (400 kbit/sn,
400 ms gecikme) taklidiyle ilk açılış:

| Süre  | Kullanıcının gördüğü (önce)            |
| ----- | -------------------------------------- |
| 2 sn  | boş                                    |
| 5 sn  | araç çubuğu + iskelet, "hesaplanıyor…" |
| 20 sn | hâlâ iskelet, hâlâ "hesaplanıyor…"     |

1 MB'lık paket bu hızda ~20 saniye sürüyor ve ekran bu sürenin tamamında
**yanlış** bir şey söylüyordu: "hesaplanıyor". Hesaplanan bir şey yok, veri
iniyor. Kullanıcı ne beklediğini de ne kadar bekleyeceğini de bilmiyor.

İki düzeltme:

1. Paket artık **gövdesi akıtılarak** iniyor (`res.arrayBuffer()` yerine
   okuyucu döngüsü) ve her 64 KB'de ilerleme bildiriliyor. Ekranlarda:
   _"Veri paketi indiriliyor — 259 KB / 979 KB (%26)"_. Toplam boyut
   manifest'ten geliyor, tahmin değil. Akış yoksa tek parça okumaya düşüyor:
   ilerleme gösterilmez ama indirme çalışır — **sahte çubuk çizilmiyor.**
2. Nabız'daki "hesaplanıyor…" yazısı, veri beklenirken "veri bekleniyor"
   diyor.

Aynı ölçüm sonrası: 10. saniyede %26, 20. saniyede %79 — kullanıcı ilerlediğini
görüyor.

### İkinci ziyaret: 1 MB her seferinde iniyordu

Ölçüm bir kusur daha gösterdi: **paket her ziyarette yeniden iniyordu.** Veri
istemcisinde hash anahtarlı IndexedDB önbelleği zaten vardı ve tek sembol
serileri onu kullanıyordu — ama kabuk paketi kendi `fetch`'iyle indiriyor,
önbelleğe hiç uğramıyordu. Aynı işin iki yerde yazılmış olması, birinin
eksik kalmasıydı.

İndirme (ve ilerleme bildirimi) veri istemcisine taşındı; kabuk artık
`dataClient.bundleBuffer` çağırıyor. Yavaş 3G ölçümü:

```
1. ziyaret : veri ekranda 23,9 sn
2. ziyaret : veri ekranda  2,8 sn   (paket için ağa çıkılmıyor)
```

Önbellek anahtarı manifest'teki hash; paket değişirse eski sürüm siliniyor,
yani "bayat veriyi gösterme" riski yok. Test bunu kalıcı kıldı: aynı
önbellekle kurulan İKİNCİ istemci ağa hiç çıkmıyor.

## Uzun oturum: bellek sızıyor mu?

Şimdiye kadar hep AÇILIŞ ve tek etkileşim ölçüldü. Zayıf makinede asıl
sorun çoğu zaman ilk saniye değil, yarım saat sonra: sızan bir dinleyici ya
da atılmayan bir grafik, sekmeyi yavaş yavaş boğar.

Ölçüm: CDP `HeapProfiler.collectGarbage` ile zorlanmış çöp toplamadan sonra
`Performance.getMetrics` (yığın, DOM düğümü, JS olay dinleyicisi).

| Senaryo                         | Yığın          | Düğüm     | Dinleyici |
| ------------------------------- | -------------- | --------- | --------- |
| 9 ekran × 14 tur (126 geçiş)    | 5,20 → 6,70 MB | 417 → 417 | 184 → 184 |
| 19 sembol × 8 tur (152 değişim) | 4,24 → 4,38 MB | 242 → 242 | 191 → 191 |

Yığın artışı **duruyor**: ekran turunda 11 → 14. turlar arası toplam
+0,04 MB. Bu bir sızıntı eğrisi değil, ısınma ve önbellek platosu. Düğüm ve
dinleyici sayısı tam olarak sabit — `chart.remove()`, `ResizeObserver`
`disconnect()` ve tema `matchMedia` dinleyicisinin temizliği çalışıyor.

Worker'lardaki paket önbelleği (`bundles` Map'i) piyasa başına bir kopya
tutuyor; üç piyasa olduğu için sınırlı. Bu ortamda yalnızca BIST örnek
verisi bulunduğundan piyasa DEĞİŞİMİ ölçülemedi — bilinen boşluk.

Düzeltilecek bir şey çıkmadı. Ölçüm yine de burada: "sızıntı yok" bir
iddiadır ve ölçülmeden yazılmamalı.

## Ölçüm aracının kendisi yanılttı

Konteyner yeniden başladıktan sonra 6× ölçüm alındı ve Nabız'ın en kötü
bloğu 143 ms yerine **406 ms** çıktı. İlk okuma: son commit'ler (duyuru
bölgesi, tazelik rozeti, işlem değeri sütunu) bir şeyi bozmuş.

Önce makine mi kod mu ayrıldı. 1× ölçüm PR'daki tabloyla uyumluydu (blok 0
korunuyor, hazır süreleri %10–25 fazla) — yani makine biraz yavaş ama iddia
ayakta. Sonra aynı makinede A/B: `6277f42` (değişikliklerden önce) derlenip
ölçüldü.

| Ekran            | Eski en kötü blok | Yeni       | Eski toplam | Yeni        |
| ---------------- | ----------------- | ---------- | ----------- | ----------- |
| **nabız**        | 200 ms            | **406 ms** | 708 ms      | **1194 ms** |
| tarayıcı         | 244               | 225        | 520         | 450         |
| sembol masası    | 420               | 370        | 928         | 697         |
| laboratuvar      | 483               | 355        | 742         | 634         |
| stratejiler      | 170               | 134        | 361         | 185         |
| model            | 170               | 129        | 316         | 223         |
| rapor            | 153               | 125        | 370         | 199         |
| sektör akranları | 412               | 369        | 960         | 669         |
| portföy          | 171               | 143        | 215         | 165         |

On ekranın dokuzu iyileşmiş, biri iki katına çıkmış görünüyordu. Tek bir
ekranın tersine gitmesi ya gerçek bir gerileme ya da gürültüdür; karar
vermeden önce **aynı derleme üç kez** ölçüldü:

```
nabız, en kötü blok :  406 / 190 / 212 ms   (medyan 212)
nabız, toplam blok  : 1194 / 614 / 564 ms   (medyan 614)
eski commit         :  200 ms / 708 ms
```

Gerileme yok. İlk tur aykırıydı (konteyner yeni başlamıştı) ve medyan
alınmasına rağmen tabloya o girmişti. Diğer dokuz ekranın "iyileşmesi" de
aynı gürültünün öteki yüzü — o yöne de anlam yüklenmemeli.

**Asıl kusur araçtaydı.** Belgesinde "aynı kodda %30 sapma görülebilir"
yazıyordu; ölçülen sapma **2,3×**. Üstelik araç tek bir sayı basıyordu, yani
okuyan kişinin sapmayı görme şansı yoktu. Artık her satır medyanın yanında
**min–maks** yayılımını da yazıyor ve tablonun altına aracın kendi sınırı
düşülüyor:

```
nabız … en kötü  187 ms [179–405], toplam blok  535 ms [458–1036]
…
En geniş yayılım: 2.3×. Bu tablodaki tek bir sayıya bakıp iki sürümü
KARŞILAŞTIRMAYIN — aynı derlemede bile bu kadar sapıyor.
```

Ders, bu dosyadaki kare süresi hatasıyla aynı aileden: **ölçüt yanlışsa
ölçüm de yanlıştır.** Bir aracın sessizce tek sayı basması, o sayının
kesin olduğu anlamına gelmiyor.

## Tekrar üretmek için

```bash
npm run build
npx vite preview --port 4182 &
npm i -D playwright          # depoya eklenmedi, yalnızca ölçüm aracı
npm run perf -- 6 3          # 6× yavaşlatma, 3 tekrar
npm run perf -- 1 3          # yavaşlatmasız referans
```
