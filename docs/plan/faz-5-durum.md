# Faz 5 — Portföy ve Temel Analiz

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §6 (L6), §7 (Faz 5)
**Durum:** Tamamlandı — `npm run verify` yeşil (264 → 296 test)

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

---

## Temel analiz (finansallar)

| Madde | Durum | Nerede |
|---|---|---|
| Finansal tablo veri hattı | ✅ | `scripts/build_fundamentals.py` (İş Yatırım) |
| TTM çarpanlar, marjlar, borçluluk | ✅ | `src/core/fundamentals/metrics.ts` |
| Kalite skoru (Piotroski benzeri) | ✅ | `qualityScore` — 9 ölçüt, her biri etiketli |
| Büyüme (TTM bazlı yıllık) | ✅ | `growth` |
| Kesitsel yüzdelik | ✅ | `percentileRank` |
| Sembol Masası finansal sekmesi | ✅ | `src/shell/screens/FinancialsPanel.tsx` |
| Tarayıcı'da temel + teknik karışık filtre | ✅ | `src/core/screen/fundamentalMetrics.ts` |

### Kompakt veri hattı

Referans projede ham tablolar sembol başına ~125 KB, 603 sembolde **75 MB** ve
tarayıcı bunların %95'ini hiç kullanmıyor. Burada yalnızca orana giren ~14 kalem
saklanıyor; ayrıca tüm sembollerin son TTM değerlerini taşıyan tek bir
`snapshot.json` üretiliyor — tarama bunu kullanıyor, sembol başına dosya
indirmiyor.

### İki tuzak bilinçli olarak kapatıldı

1. **Kümülatif çeyrekler.** İş Yatırım'da `2024/9`, yılın ilk DOKUZ AYIDIR.
   Bunu çeyrek sanıp toplamak ciroyu üçe katlar. TTM = geçen yıl sonu + bu yıl
   kümülatif − geçen yıl aynı kümülatif. Hem Python üreticisinde hem TypeScript
   tarafında aynı mantık, ikisi de testli.
2. **Zarar eden şirkette F/K.** Negatif F/K sıralamada "ucuz" gibi görünür;
   bu yüzden zarar edende F/K boş bırakılıyor, marjlar yine gösteriliyor.

### Point-in-time sınırı (dürüstlük notu)

Kaynak veride "bu tablo hangi tarihte yayımlandı" bilgisi yok. Bu yüzden
geçmişe dönük tarama yaparken o gün bilinmeyen bir bilançoyu kullanmadığımızı
**garanti edemiyoruz**. Anlık görüntü bu uyarıyı kendi içinde taşıyor ve arayüz
onu gösteriyor: yalnızca güncel tarama için, backtest girdisi değil.

### Filtre birleşimi

Temel metrikler tarama satırlarına ekleniyor, ayrı bir makine kurulmuyor:
"RSI 40–70 arası VE F/K < 10 VE ciro büyümesi %20+" gibi karışık filtreler
mevcut kural motoruyla çalışıyor. Fiyat teknik satırdan alınıyor ki iki kaynak
arasında fiyat tutarsızlığı olmasın.

## Sıradaki

- Faz 6: rapor ekranı (paylaşılabilir tek sayfa özet) ve ML (dürüst çerçeve).
- Zayıf makine performansı: düşük güçlü cihaz profiliyle ölçüm ve iyileştirme.
