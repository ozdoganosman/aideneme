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

## Sonuçlar (200 sembol × 3400 barlık sentetik set, 2 tekrarın medyanı)

| Ekran | Normal makine (1×) | Zayıf makine (6×) |
|---|---|---|
| Nabız + ısı haritası | hazır 336 ms · blok **0** | hazır 1,3 sn · en kötü 118 ms |
| Tarayıcı | hazır 403 ms · blok **0** · parametre→sonuç 84 ms | hazır 1,5 sn · en kötü 182 ms · parametre→sonuç 468 ms |
| Sembol Masası | hazır 311 ms · blok **0** · periyot 146 ms | hazır 1,7 sn · en kötü **319 ms** · periyot 486 ms |
| Laboratuvar | hazır 350 ms · blok **0** · doğrulama 370 ms | hazır 1,7 sn · en kötü 195 ms · doğrulama 585 ms |
| Karşılaştır | hazır 415 ms · blok **0** | hazır 1,7 sn · en kötü 185 ms |
| Stratejiler (1600 backtest) | hazır 439 ms · blok **0** · kapsam 62 ms | hazır 1,5 sn · en kötü 118 ms · kapsam 230 ms |
| Model (purged CV) | hazır 926 ms · blok **0** | hazır 1,9 sn · en kötü 108 ms |
| Rapor | hazır 272 ms · blok **0** | hazır 1,4 sn · en kötü 121 ms |
| Sektör akranları | hazır 270 ms · blok **0** · akran yükleme 198 ms | hazır 1,8 sn · en kötü **342 ms** · akran yükleme 787 ms |
| Portföy | hazır 159 ms · blok **0** | hazır 0,9 sn · en kötü 135 ms |

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

| Kalem | Süre |
|---|---|
| `(program)` — betik ayrıştırma/derleme | 1119 ms |
| `lod` yığınının modül değerlendirmesi | 152 ms |
| Sembol Masası bileşen kodu | 142 ms |
| `useBitmapCoordinateSpace` (canvas çizimi) | 48 ms |

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

| | 1× | 6× (zayıf) |
|---|---|---|
| Kaydırma adımı (medyan) | 0,1 ms | 16 ms |
| Kaydırma adımı (p90) | 2,5 ms | 22 ms |
| 40 adımın toplamı | 37 ms | ~425 ms |
| Uzun görev (>50 ms) | 0 | 0 |

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

| | Ana thread bloğu |
|---|---|
| Yakınlaştırma (20 adım) | ~600–820 ms |
| Kaydırma (20 adım) | 0–50 ms |

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

| Süre | Kullanıcının gördüğü (önce) |
|---|---|
| 2 sn | boş |
| 5 sn | araç çubuğu + iskelet, "hesaplanıyor…" |
| 20 sn | hâlâ iskelet, hâlâ "hesaplanıyor…" |

1 MB'lık paket bu hızda ~20 saniye sürüyor ve ekran bu sürenin tamamında
**yanlış** bir şey söylüyordu: "hesaplanıyor". Hesaplanan bir şey yok, veri
iniyor. Kullanıcı ne beklediğini de ne kadar bekleyeceğini de bilmiyor.

İki düzeltme:

1. Paket artık **gövdesi akıtılarak** iniyor (`res.arrayBuffer()` yerine
   okuyucu döngüsü) ve her 64 KB'de ilerleme bildiriliyor. Ekranlarda:
   *"Veri paketi indiriliyor — 259 KB / 979 KB (%26)"*. Toplam boyut
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

## Tekrar üretmek için

```bash
npm run build
npx vite preview --port 4182 &
npm i -D playwright          # depoya eklenmedi, yalnızca ölçüm aracı
npm run perf -- 6 3          # 6× yavaşlatma, 3 tekrar
npm run perf -- 1 3          # yavaşlatmasız referans
```
