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

## Sonuçlar (200 sembol × 250 barlık veri seti)

| Ekran | Normal makine (1×) | Zayıf makine (6×) |
|---|---|---|
| Nabız + ısı haritası | hazır 326 ms · blok **0** | hazır 1,6 sn · en kötü blok 131 ms |
| Tarayıcı | hazır 302 ms · blok **0** · parametre→sonuç 66 ms | hazır 1,7 sn · en kötü 237 ms · parametre→sonuç 341 ms |
| Sembol Masası | hazır 314 ms · blok **0** · periyot 138 ms | hazır 2,0 sn · en kötü 369 ms · periyot 483 ms |
| Laboratuvar | hazır 320 ms · blok **0** · doğrulama 358 ms | hazır 1,7 sn · en kötü 233 ms · doğrulama 631 ms |
| Karşılaştır | hazır 450 ms · blok **0** | hazır 1,9 sn · en kötü 146 ms |

**Normal makinede hiçbir ekranda 50 ms'yi aşan tek bir görev yok.** Zayıf
makinede tek istisna grafik kütüphanesinin ilk kurulumu (369 ms) — aşağıda.

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
