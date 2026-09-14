# Faz 5 (1/2) — Portföy

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §6 (L6), §7 (Faz 5)
**Durum:** Portföy tarafı tamamlandı — temel analiz (finansallar) sırada

---

## Yapılanlar

| Madde | Durum | Nerede |
|---|---|---|
| Pozisyonlar, işlem günlüğü | ✅ | `src/core/portfolio/ledger.ts` |
| Reel (TÜFE düzeltmeli) getiri | ✅ | `src/core/portfolio/real.ts` |
| Para ağırlıklı getiri (IRR) | ✅ | `moneyWeightedReturn` |
| Risk: VaR/CVaR, yoğunlaşma | ✅ | `src/core/portfolio/risk.ts` |
| Tarihsel stres senaryoları | ✅ | `BIST_SCENARIOS` + `runScenario` |
| Portföy ekranı | ✅ | `src/shell/screens/Portfolio.tsx` |
| USD bazlı getiri | ⏭️ | kur serisi veri hattında yok (aşağıda) |

## Kararlar

**Maliyet yöntemi ağırlıklı ortalama** (komisyon dahil) — Türkiye'de aracı
kurum ekstrelerinin varsayılanı. FIFO farklı sonuç verir; arayüz yöntemi
açıkça yazıyor ki karşılaştıran kullanıcı şaşırmasın.

**Para ağırlıklı getiri (IRR) var, çünkü zaman ağırlıklı getiri yatırımcının
getirisi değildir.** Zirvede para eklediyseniz fon performansı iyi görünür ama
sizin sonucunuz kötüdür; bunu yalnızca IRR gösterir.

**Tarihsel VaR/CVaR, parametrik değil.** Normal dağılım varsayımı finansal
getirilerin şişman kuyruğunu sistematik olarak küçük gösterir; burada
gerçekleşmiş getiriler sıralanıyor. CVaR ayrıca raporlanıyor: "eşik aşıldığında
ortalama kayıp" kararı VaR'dan daha iyi bilgilendirir.

**Senaryolar simülasyon değil.** Ağustos 2018 kur şoku, Mart 2020, Şubat 2023
deprem haftası, Kasım–Aralık 2021: gerçekten yaşanmış pencerelerde portföyün
ne yapacağı, o günlerin gerçek fiyatlarıyla hesaplanıyor. Pencerede verisi
olmayan sembol sayısı ("kapsam 3/3") açıkça gösteriliyor.

**Uyarılar yutulmuyor.** Elde olmayan hissenin satışı, geçersiz adet/fiyat gibi
tutarsızlıklar sessizce düzeltilmiyor; defter uyarı listesi döndürüyor ve ekran
bunu gösteriyor.

## Yol boyunca yakalanan kusur

**Reel getiri "bugüne" kadar hesaplanıyordu, oysa değerleme son veri gününün
fiyatıyla yapılıyor.** Veri birkaç gün (bayat veride aylarca) geride olabilir;
aradaki enflasyonu da düşmek reel getiriyi sistematik olarak kötü gösterirdi.
Artık değerleme tarihi = elimizdeki son fiyat günü ve bu tarih kartta yazılı.
IRR'nin bitiş tarihi de aynı güne çekildi.

Testte de bir tuzak çıktı: sayfadaki native `<select>` öğelerinin `<option>`'ları
da `option` rolünde olduğu için, "ilk seçeneği tıkla" adımı sembol yerine piyasa
kutusunu seçiyordu. Test artık seçim listesine kapsam veriyor.

## USD bazlı getiri neden yok

Kur serisi (USDTRY) veri hattında üretilmiyor: bu dalda yalnızca BIST üreticisi
var (`scripts/build_bist.py`), çoklu market üreticileri açık olan #6'da. Kuru
"yaklaşık" bir katsayıyla uydurmak yerine, kur serisi veri hattına eklendiğinde
gerçek seriyle hesaplanacak. Reel (TÜFE) getiri şu an mevcut ve TL yatırımcısı
için asıl ölçü odur.

## Sıradaki

- Temel analiz: finansal tablolar veri hattı (`scripts/build_fundamentals.py`),
  TTM çarpanlar, sektör medyanına göre yüzdelik, kalite skoru; Sembol Masası'na
  finansal sekmesi ve Tarayıcı'ya temel filtreler.
