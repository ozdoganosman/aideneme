# Faz 7 — Strateji sıralaması (plan sonrası)

**Tarih:** 2026-09-14
**Durum:** Sürüyor — `npm run verify` yeşil (338 → 403 test)

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
| Derin tarama (en likitler, tam geçmiş) | `WorkerRequest.type = 'rankSeries'` |
| `prev` operandı (kırılım kuralları için) | `src/core/strategy/dsl.ts` |
| Sektör bazlı para akışı | `src/core/screen/sectors.ts` |
| Sektör sınıflandırma üreticisi | `scripts/build_sectors.py` |
| Tarayıcıda sektör filtresi | `ScreenSpec.sectors` |

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

**Derin tarama kendiliğinden başlamaz.** Megabaytlarca indirme demek; ekran
önce ne indirileceğini **manifestten okuyup** söylüyor ("30 sembol · 2,3 MB
indirilecek ve 240 backtest koşacak"), başlatma kararı kullanıcının. Aynı anda
üç sembol işleniyor ki zayıf makinede de akıcı kalsın; inen seriler
önbellekte kaldığı için ikinci çalıştırma ağa çıkmıyor. Ölçüm: 30 sembol ×
8 strateji = 240 backtest, 1,6 sn duvar saati (410 ms worker).

## Yol boyunca yakalanan gerçek kusur

İki hazır strateji **yapısal olarak ölüydü**: `highest(55)` içinde bulunulan
barı da kapsar, dolayısıyla "kapanış > 55 barın en yükseği" hiçbir zaman doğru
olamaz (kapanış o barın yükseğini aşamaz). Kural hiç tetiklenmiyordu ve tablo
bunu "ölçülemedi" diye gösteriyordu — iki ayrı hatayı aynı anda gizleyen bir
görünüm.

İkisi de düzeltildi:

1. DSL'e `prev` operandı eklendi: bir operandın N bar önceki değeri. Kırılım
   kuralları artık `prev(highest(55), 1)` ile doğru yazılıyor; kaydırma ısınma
   penceresine **ekleniyor** (55 bar + 1 = 56 bar veri gerekir). Editörde
   "kaç bar önce" alanı olarak görünüyor.
2. `rank.ts` "ölçülemedi" ile "sinyal yok" hükümlerini ayırdı: biri backtest'in
   hiç koşmadığı, diğeri koşup kuralın hiç tetiklenmediği durum. İkisi de
   "kaybetti" değildir.

Düzeltme sonrası THYAO'nun tam geçmişinde: `breakout-55` 0 → 41 işlem,
`new-high-momentum` 0 → 29 işlem.

## Sektör bazlı para akışı

Nabız ekranı şimdiye kadar yalnızca **davranış kümelerine** (birlikte hareket
edenler) bakabiliyordu. Bu iyi bir ölçüdür ama "endüstriden para akışı"
sorusunun cevabı değildir: bir bankanın çimento şirketiyle aynı kümeye düşmesi
mümkündür, sektörü değişmez. Artık ikisi ayrı görünüm ve sınıflandırma varsa
varsayılan olan sektör.

**Eşleşmeyen sembol gizlenmiyor.** "Sınıflandırılmamış" ayrı bir satır ve
paylar toplam işlem değerinin TAMAMI üzerinden hesaplanıyor; gizleseydik
kalan sektörlerin payı sessizce şişerdi. Kapsama oranı ("189/200 sembol
eşleşti") başlıkta yazıyor.

**Sınıflandırma yoksa uydurulmuyor.** `sectors.json` yoksa ekran davranış
kümelerine düşüyor ve nedenini söylüyor; üretici script kaynağa erişemezse
dosyayı YAZMIYOR (yarım bir sınıflandırma, olmayan bilgiyi varmış gibi
gösterirdi). CI adımı bu yüzden `continue-on-error`.

`build_sectors.py`'nin ayrıştırıcısı ağdan bağımsız: `--self-test` sabit örnek
kayıtlar üzerinde çalışıyor ve doğrulama iş akışına eklendi. **Not:** kaynak uç
noktası bu geliştirme ortamından erişilemediği için canlı yanıt formatı
doğrulanamadı; ayrıştırıcı birden çok alan adını (SECTOR/Sektor/…) deniyor ve
okunamayan kaydı atlıyor. Ekran görüntüleri yerel sentetik sınıflandırmayla
alındı.

## Tarayıcıda sektör filtresi

Sektör **sayısal kural olarak modellenmedi**: kategoriktir, "> 3" gibi bir
karşılaştırması yoktur ve sayıya çevirmek sıralamayı anlamlıymış gibi
gösterirdi. `ScreenSpec.sectors` ayrı bir alan; seçili sektör yoksa eleme de
yok.

Seçim yapıldığında **sektörü bilinmeyen sembol de eleniyor** — NaN'ın hiçbir
kuralı geçmemesiyle aynı ilke: "bilinmiyor", seçilen sektöre ait sayılamaz.
Rozet satırı bunu açıkça yazıyor.

Böylece "yalnızca bankacılık ve enerji + RSI 40–70 + 1 aylık getiri > 0" gibi
teknik, temel ve sektör filtreleri tek tabloda birleşiyor (ölçüm: 200 sembolde
17 sonuç, worker 28 ms).

Kayıtlı taramalar sektör seçimini de taşıyor; sektör alanı olmayan ESKİ
kayıtlar filtreyi temizliyor (kaydedilmemiş bir seçim geri yüklenmiş gibi
görünmesin). Tabloda sektör sütunu var ve sınıflandırması olmayan sembol boş
hücre değil açık bir "—" gösteriyor.

## Bilinen boşluk

Tarama kuralları (ve şimdi sektör seçimi) URL'e yazılmıyor; paylaşılan bağlantı
ekranı açıyor ama filtreleri taşımıyor. Kayıtlı taramalar tarayıcıda duruyor.
Ürün ilkesi #4 ("her görünüm paylaşılabilir") burada henüz karşılanmıyor —
kural listesi URL'e sığmayacak kadar büyüyebildiği için sıkıştırılmış bir
serileştirme gerekiyor.

## Sırada

- Sektör kaynağının canlı yanıt formatını CI'da ilk çalıştırmada doğrulamak.
- Tarama kurallarını paylaşılabilir kılmak (sıkıştırılmış URL serileştirmesi).
