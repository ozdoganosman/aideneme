# Faz 7 — Strateji sıralaması (plan sonrası)

**Tarih:** 2026-09-14
**Durum:** Sürüyor — `npm run verify` yeşil (338 → 447 test; lint 50 uyarı → **0**)

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

## Paylaşılabilir tarama

Ürün ilkesi #4 tarayıcıda da karşılandı: kurallar, parametreler, sektör seçimi
ve sıralama URL'e yazılıyor.

    ?v=tarayici&f=1|rsi~b~40~70!chg21~g~0|14.14.20.50.14.20.250|Bankacılık|chg21~d
                   ^sürüm ^kurallar       ^parametreler         ^sektör    ^sıralama

Ham JSON yerine kısa ve gözle ayıklanabilir bir biçim: 120 karakterin altında
kalıyor ve bozulduğunda nerede bozulduğu görülebiliyor. URL `replace` ile
güncelleniyor — her tuşa basış bir geçmiş girdisi olsaydı geri tuşu
kullanılamaz hale gelirdi.

**Çözme katı ama sessiz değil.** Tanınmayan metrik, bilinmeyen operatör ya da
okunamayan sayı atılıyor ve ekranda "bağlantıdaki filtrenin bir kısmı
uygulanamadı: …" uyarısı çıkıyor. Sessizce düşürmek, kullanıcının paylaşılan
taramadan farklı bir sonuç görmesi demek olurdu.

Uçtan uca doğrulandı: filtre uygulanmış bağlantı yeni bir sekmede aynı sonucu
(10/200 sembol) ve aynı sektör rozetini veriyor.

### Yol boyunca yakalanan kusur

Eski bir kayıtlı taramayı geri yüklemek **yarım bir parametre nesnesi**
bırakıyordu (o sürümde yalnızca dört alan saklanıyordu); bağlantı kodlaması bu
nesneyi görünce çöküyordu. İki uçtan düzeltildi: geri yükleme varsayılanla
birleştiriyor, kodlama da eksik alanı varsayılana düşürüyor. İkisi de test
altında.

## Paylaşılabilir strateji

Laboratuvarda kurulan kural da artık URL'de:

    ?v=laboratuvar&s=THYAO&str=1|c~g~highest55@1|c~l~lowest20@1|0_0_14_3
                               ^sürüm ^giriş      ^çıkış        ^stop_hedef_atrUzunluk_atrKat

Operand dili kısa: `c` kapanış, `ema50` gösterge, `k30` sabit, `@1` bir bar
geri, `*0.97` ölçek. Kodlanamayan bir kural (VEYA/DEĞİL bağlacı gibi)
**sessizce basitleştirilmiyor** — kodlayıcı metin yerine gerekçe döndürüyor,
çünkü yanlış bir bağlantı paylaşmak hiç paylaşmamaktan kötü. Bozuk bir
bağlantı da sessizce başka bir strateji çalıştırmıyor, ekranda uyarı çıkıyor.

Uçtan uca doğrulandı: `st=breakout-55` ile açılan ekran URL'i tam kurala
çeviriyor ve o bağlantı yeni bir sekmede birebir aynı sonucu veriyor.

### Yol boyunca yakalanan iki kusur

1. **Ayırıcı çakışması:** stop alanları nokta ile ayrılıyordu, ATR katı `2.5`
   ise kendi içinde nokta taşıyor — alanlara bölünüp sessizce `2`ye düşüyordu.
   Ayırıcı `_` oldu.
2. **Operatör kodu gösterge adının içinde:** `adx14gk25` çözülürken "adx"
   içindeki `x` operatör sanılıp kural yanlış bölünüyordu. Operatör artık `~`
   ile ayrılıyor (`adx14~g~k25`).

İkisi de test altında; ikisi de gerçek veriyle karşılaşmadan önce yakalandı.

## Sembol masasında sektör bağlamı

"Bu hisse bugün %2 düştü" eksik bir cümledir: sektörü %3 düştüyse hisse aslında
iyi performans göstermiştir. Yeni **Sektör** sekmesi bu bağlamı veriyor —
sektör içindeki sıra (işlem değerine göre), sektörün ağırlıklı değişimi ve
akran listesi (tıklanınca o sembole geçer).

**Paket kendiliğinden inmiyor.** Sembol Masası bilinçli olarak tek sembolle
çalışıyor ve ~1 MB'lık paketi indirmiyor (bkz. `performans.md`); akran
karşılaştırması o paketi gerektirdiği için sekme önce boyutu söyleyip izin
istiyor. Panel ayrı bir chunk: grafiğe gelen kullanıcı bu kodu da indirmiyor.

Sembolün sektörü bilinmiyorsa **rastgele bir grup gösterilmiyor**; boş durum
nedenini yazıyor.

### Yol boyunca yakalanan kusur

Grafik ayarları (EMA/Hacim anahtarları) diğer sekmelerde de görünüyordu:
`hidden` özniteliği veriliyordu ama `.desk__toggles { display: flex }` onu
eziyordu. Global bir `[hidden] { display: none !important }` kuralı eklendi —
gizlenen bir kontrolün ekranda kalması, yanlış sekmenin ayarını göstermek
demekti. Test altında.

## Devralınan ekranların erişilebilirlik borcu kapandı

Faz 0'da erişilebilirlik kuralları yeni kodda **hata**, devralınan ekranlarda
**uyarı** yapılmıştı: "taşıma sırasında tek tek kapatılacak bir borç listesi".
46 uyarı vardı, şimdi sıfır — ve o geçici blok kaldırıldı, yani eski ekranlarda
da geri gidiş artık derlemeyi kırar.

| Kalıp | Sayı | Ne yapıldı |
|---|---|---|
| Modallar (yalnızca fareyle kapanıyordu) | 4 | Ortak `ModalShell`: Escape, odak tuzağı, `role="dialog"` |
| Tıklanabilir kart/satırlar | 8 | Ortak `clickable()`: `role="button"`, sekme sırası, Enter/Space |
| Otomatik tamamlama listeleri | 2 | APG birleşik kutu: `aria-expanded`, `aria-activedescendant`, `role="listbox"` |
| Sarmalayan etiketler | 5 | Kural düzeltildi: `label-has-for` kullanımdan kalkmış, yerine `label-has-associated-control` |
| Boş tablo başlığı | 1 | Görsel olarak gizli metin |

Kazanç gerçek, kozmetik değil: modallar artık Escape ile kapanıyor ve odak
içeri girip çıkışta geldiği yere dönüyor; kartlar sekme ile geziliyor ve Enter
ile açılıyor; sembol arama listesi ekran okuyucuya listbox olarak bildiriliyor.

Tarayıcıda doğrulandı (yayındaki `index.html`): 24 grafik hâlâ çiziliyor,
birleşik kutuda ok tuşu `aria-activedescendant`'ı ilerletiyor, Enter sembolü
seçiyor, takip listesi satırı odak alıp Enter ile açılıyor, modal Escape ile
kapanıyor. Konsol temiz.

**`label-has-for` hakkında:** bu kural etiketin hem kontrolü sarmalamasını HEM
de `id` taşımasını istiyordu. Kontrolü sarmalayan etiket geçerli ve
erişilebilirdir; kural kullanımdan kalkmış durumda. Kodu kuralın eskimiş
biçimine uydurmak yerine kural güncellendi.

## Kalan lint uyarıları da kapandı

Erişilebilirlik borcundan sonra geriye dört `react-hooks/exhaustive-deps`
uyarısı kalmıştı. İkisi gerçek bir kusurdu, ikisi ölü ağırlıktı:

**`watchlist` her render'da yeni referans üretiyordu.** `activeList ?
activeList.items : []` — satır içi `[]` her render'da yeni bir dizi demek;
buna bağlı bir efekt ve bir memo her render'da yeniden koşuyordu. Modül
düzeyinde sabit bir boş diziyle çözüldü.

**`Chart.tsx`'in kurulum efekti eksik bağımlılıkla yazılmıştı.** Susturmak
yerine liste dürüstçe tamamlandı: o geri çağırımların hepsi `useCallback` ile
sabit (kendi bağımlılıkları boş, durumu ref üzerinden okuyorlar), dolayısıyla
eklemek efekti tekrar koşturmuyor. Tarayıcıda kanıtlandı — canvas'lar
işaretlenip sembol değiştirildi, 24'ünün hepsi yerinde kaldı, yani grafik
yeniden kurulmuyor.

Ayrıca artık hiçbir şey bildirmeyen bir `eslint-disable` satırı silindi.

Sonuç: `src/` ve `scripts/` genelinde **sıfır lint uyarısı**.

## Tarayıcıdan stratejilere köprü

Sistemde kopuk bir yer kalmıştı: tarayıcı hisseleri buluyordu, strateji ekranı
kuralları sıralıyordu, ama "bulduğum bu 10 hissede hangi kural çalışıyor?"
sorulamıyordu. Artık tarama sonucunun altındaki düğme seçili sembolleri strateji
ekranına taşıyor (URL'de `sy=`), orada yeni bir **"Tarama sonucu"** kapsamı
açılıyor ve o sembollerin TAM geçmişinde sekiz strateji koşuyor.

Sınır açıkça yazılı: seçim tarama kriterlerinden geldiği için sonuçlar **o
kriterlere koşulludur**, piyasanın tamamı için genelleme değildir. İndirme
boyutu yine önceden söyleniyor ve liste URL'e sığsın diye ilk 60 sembolle
sınırlı.

Ölçüm: 10 sembol · 0,8 MB · 80 backtest, worker 367 ms.

## Sırada

- Sektör kaynağının canlı yanıt formatını CI'da ilk çalıştırmada doğrulamak.
- Tarama kurallarını paylaşılabilir kılmak (sıkıştırılmış URL serileştirmesi).
