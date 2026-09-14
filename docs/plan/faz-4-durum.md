# Faz 4 — Uygulama Durumu

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §6 (L3–L5), §7 (Faz 4)
**Durum:** Tamamlandı — `npm run verify` yeşil (199 → 229 test)

---

## Plandaki maddeler

| Madde | Durum | Nerede |
|---|---|---|
| Kural DSL + editör | ✅ | `src/core/strategy/dsl.ts`, `src/shell/screens/Lab.tsx` |
| Olay güdümlü backtest (maliyet, slipaj, likidite tavanı, T+1) | ✅ | `src/core/backtest/engine.ts` |
| Metrik seti (Sortino/Calmar/Ulcer/MAE/MFE…) | ✅ | `src/core/backtest/metrics.ts` |
| Doğrulama rozetleri (5) | ✅ | `src/core/backtest/validate.ts` |
| Parametre platosu haritası | ✅ (veri) | `parameterPlateau` — görselleştirme Faz 6'da |
| Rapor çıktısı | ⏭️ Faz 6 | rapor ekranıyla birlikte |

## Kabul ölçütü

Plan: *"look-ahead içeren bir test kasıtlı yazıldığında motor reddediyor"*.

Bunu iddia etmek yerine **kanıtlayan bir test** yazıldı: seri ortadan kesilip
yeniden çalıştırıldığında geçmişteki işlemler (giriş/çıkış indeksi ve fiyatı)
birebir aynı çıkmalı. Gelecek veriye sızan bir motor bu testi geçemez.

```
Doğrulama (150 permütasyon + 4 katman walk-forward + plato): tarayıcıda 950 ms
Hızlı backtest (3.400 bar): worker 228 ms
229 test / 28 dosya · next.html ilk yük 52,9 KB gzip
```

## Beş rozet

| Rozet | Soru | Ölçüm |
|---|---|---|
| **Maliyet** | Komisyon ve slipaj dahil mi? | Maliyetsiz koşu rozeti KIRMIZI yapar |
| **OOS** | Parametre geçmişte seçilip sonuç ileride mi ölçüldü? | Yürüyen doğrulama, pozitif ileri pencere oranı |
| **Sağlamlık** | Komşu parametreler de kazanıyor mu? | Her düğme ±%20/±%40 → kârlı komşu yüzdesi |
| **Tesadüf** | Aynı sonucu rastgele seri de üretir mi? | Bar getirileri karıştırılıp yeniden koşulur, p-değeri |
| **Çoklu test** | Kaç kombinasyon denendi? | Deflated Sharpe (Bailey & López de Prado) |

Rozetlerin hiçbiri süs değil: her biri tıklanınca **gerekçesini** gösteriyor
("karıştırılmış 150 seride aynı sonuca ulaşma olasılığı p = 0,64" gibi).

### Sentetik veride ilk çalıştırma neyi gösterdi

Yerel doğrulama setinde (rastgele yürüyüş) EMA 20/50 kesişimi: Maliyet ✓,
OOS ✓, Sağlamlık ✓, **Tesadüf ✕**, Çoklu test ✓. Doğru sonuç: rastgele
yürüyüşte kesişim stratejisinin gerçek bir avantajı yoktur ve permütasyon
testi bunu yakalıyor. Sistem tam da bunun için var.

## Motorun pazarlıksız kuralları

1. **Look-ahead yok.** Sinyal `i` kapanışında, emir `i+1` açılışında. Stop/hedef
   yalnızca pozisyon açıldıktan sonraki barın kendi yüksek/düşüğüyle kontrol
   edilir.
2. **Maliyetsiz sonuç yoktur.** Komisyon + slipaj + likidite tavanı (o barın
   hacminin en fazla %X'i) modelin parçası. Maliyeti sıfırlamak mümkün ama
   sonuç kırmızı rozetle etiketleniyor.
3. **Kötümser varsayımlar.** Aynı barda hem stop hem hedef görülürse stop;
   boşluklu açılışta stop fiyatı değil gerçek (daha kötü) açılış fiyatı.
4. **Adil kıyas.** Al-tut karşılaştırması aynı maliyet modelini öder.
5. **Nakit ölü para değil.** Pozisyonsuz geçen süreye yıllık getiri
   uygulanabilir; TL'de strateji mevduatla yarışır.

## Yol boyunca düzeltilen kusurlar

- **Deflated Sharpe ölçek hatası:** eşik, gözlenen Sharpe'tan farklı birimdeydi
  (bar başına değer, birim Sharpe standart sapmasıyla karşılaştırılıyordu) ve
  her stratejiyi "şansa bağlı" gösteriyordu. Eşik artık Sharpe tahmininin
  standart hatasıyla ölçekleniyor.
- **Sıfıra yakın paydada Sharpe/Sortino** 2,9e14 gibi anlamsız sayılar
  üretiyordu; eşik altındaki oynaklık artık "yok" sayılıp oran tanımsız (∞)
  dönüyor — 0 döndürmek kayıpsız seriyi cezalandırmak olurdu.
- **Sıralanamayan tablo başlıkları** iç boşluk almıyor, komşu sütuna
  yapışıyordu.
- **İki canvas grafiği tek uygulamada birleşti:** normalize getiri ve sermaye
  eğrisi artık ortak `LineChart` üzerinden çiziliyor.

## Bilinen sınırlar

- Kural editörü tek düzey "VE" grubu sunuyor; DSL iç içe VE/VEYA/DEĞİL
  destekliyor (kayıtlı stratejide kullanılabilir), editör Faz 6'da genişleyecek.
- Yön yalnızca alış (long). Açığa satış BIST'te ayrı kurallar gerektiriyor.
- Çoklu test rozeti "denenen kombinasyon sayısını" kullanıcıdan alıyor;
  optimizasyon ekranı gelince bu sayı otomatik dolacak.

## Sıradaki: Faz 5

- Portföy: pozisyonlar, reel/USD getiri, risk (VaR/CVaR, korelasyon limitleri).
- Temel analiz: TTM çarpanlar, sektör medyanına göre yüzdelik, kalite skoru.
