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

## Tekrar üretmek için

```bash
npm run build
npx vite preview --port 4182 &
npm i -D playwright          # depoya eklenmedi, yalnızca ölçüm aracı
npm run perf -- 6 3          # 6× yavaşlatma, 3 tekrar
npm run perf -- 1 3          # yavaşlatmasız referans
```
