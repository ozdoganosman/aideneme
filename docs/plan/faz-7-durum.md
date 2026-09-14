# Faz 7 — Strateji sıralaması (plan sonrası)

**Tarih:** 2026-09-14
**Durum:** Sürüyor — `npm run verify` yeşil (338 → 365 test)

Plandaki yedi faz bittikten sonra kullanıcı isteğinin son maddesi kaldı:
"en doğru stratejilere sunan bir sistem". Laboratuvar tek sembol × tek
stratejiyi doğruluyordu; eksik olan, **hangi kuralın gerçekten çalıştığını**
piyasa ölçeğinde gösteren görünümdü.

## Yapılanlar

| Madde | Nerede |
|---|---|
| Hazır strateji kitaplığı (8 kural) | `src/core/strategy/presets.ts` |
| Piyasa geneli sıralama + çoklu test düzeltmesi | `src/core/strategy/rank.ts` |
| Worker'da sembol aralığına bölünmüş backtest | `WorkerRequest.type = 'rank'` |
| Stratejiler ekranı (iki kapsam) | `src/shell/screens/Strategies.tsx` |
| Sıralamadan laboratuvara tek tıkla geçiş | `src/shell/screens/labRules.ts` |

## Kararlar

**İki kapsam, iki ayrı soru.** "Piyasa (ortak pencere)" aynı kuralı tüm
sembollerde çalıştırır ve "bu kural bu piyasada işe yarıyor mu?" sorusuna
bakar. "Tek sembol (tüm geçmiş)" sekiz kuralı tek sembolün tam geçmişinde
karşılaştırır ve "bu hisse için hangi kural doğru?" sorusuna bakar. İkisini
tek tabloda karıştırmak, farklı sorulara aynı cevabı vermek olurdu.

**Karşılaştırma tabanı al-tut ve al-tut aynı maliyeti öder.** Motor zaten
böyle kurulmuştu; sıralama tablosunun ana sütunu mutlak getiri değil,
**al-tut üzerine katılan yıllık fark**. Yükselen piyasada her strateji para
kazanır; soru "piyasadan fazlasını yaptı mı".

**Çoklu test düzeltmesi tabloya gömülü.** Sekiz strateji × yüzlerce sembol
denendiğinde en iyisinin şans eseri çıkma olasılığı yüksektir. Her satırda
işaret testi p-değeri var ve bu değer **Holm–Bonferroni** ile düzeltiliyor;
hüküm ("anlamlı") düzeltilmiş p'ye bakıyor.

**p-değerinin iyimser olduğu satırın yanında yazıyor.** İşaret testi
gözlemlerin bağımsız olduğunu varsayar; semboller aynı piyasada birlikte
hareket eder. `INDEPENDENCE_CAVEAT` bu yüzden çekirdekte sabit ve ekranda
tablodan ayrılmıyor — düzeltilmiş p bile gerçekte olduğundan küçüktür.

**"Ölçülemedi" ayrı bir hüküm.** EMA(200) tabanlı kurallar 250 barlık ortak
pencereye sığmıyor. Yarım ısınmış bir göstergeyle sayı üretmek yerine sembol
atlanıyor, satır "ölçülemedi" diyor ve kaç sembolde atlandığını yazıyor.
Ölçülmemiş bir kuralı "zayıf" saymak, olmayan bilgiyi varmış gibi
göstermektir.

**Tek sembol kapsamında p-değeri yok.** Tek gözlemden anlamlılık çıkarılamaz;
sütun gösterilmiyor ve bunun nedeni ekranda yazılı.

## Ölçülen

Sentetik BIST verisinde (200 sembol, 250 bar ortak pencere), maliyet dahil:
hiçbir hazır strateji al-tut'u yenmiyor (medyan fark −10% ile −33% arası,
yenme oranı %6–27). Rastgele yürüyüşe yakın sentetik veride beklenen sonuç
budur ve tablo bunu gizlemiyor. Hesap: 200 sembol × 8 strateji = 1600
backtest, worker'larda ~165 ms.

Tek sembol kapsamında (THYAO, 3400 bar): 8 strateji ~11 ms.

**Sıralamadan laboratuvara geçiş kayıpsız.** Tablodaki her satırda
"Laboratuvarda aç" var; strateji kimliği URL'e yazılıyor (`st=`), laboratuvar
kuralı editöre çeviriyor. Çevirici (`labRules.ts`) ya TAM çevirir ya da neyin
sığmadığını söyleyip reddeder — sığmayan bir parçayı sessizce kırpmak,
kullanıcının sandığından farklı bir stratejiyi test etmesi demektir. Testi
biçimi değil ÜRETİLEN SİNYALLERİ karşılaştırıyor: geri dönen kural bar bar
aynı sinyalleri vermek zorunda.

Bu geçiş için laboratuvar da genişledi: `≥`/`≤` karşılaştırmaları, ATR takip
stopu (motor destekliyordu, editörde yoktu) ve operand başına "× katsayı"
alanı (ör. "EMA(50) × 0,97"). Katsayı alanı yalnızca anlamlı olduğu yerde
görünüyor.

## Sırada

- Derin tarama: en likit N sembolün tam geçmişini indirip ortak pencere
  yerine tam tarihle sıralama (indirme boyutu kullanıcıya önceden söylenerek).
- Sektör/endüstri bazlı para akışı: şu an davranış kümeleri var, resmî
  sınıflandırma yok.
