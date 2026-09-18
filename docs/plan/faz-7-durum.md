# Faz 7 — Strateji sıralaması (plan sonrası)

**Tarih:** 2026-09-14
**Durum:** Sürüyor — `npm run verify` yeşil (338 → 459 test; lint 50 uyarı → **0**)

Plandaki yedi faz bittikten sonra kullanıcı isteğinin son maddesi kaldı:
"en doğru stratejilere sunan bir sistem". Laboratuvar tek sembol × tek
stratejiyi doğruluyordu; eksik olan, **hangi kuralın gerçekten çalıştığını**
piyasa ölçeğinde gösteren görünümdü.

## Yapılanlar

| Madde                                          | Nerede                              |
| ---------------------------------------------- | ----------------------------------- |
| Hazır strateji kitaplığı (8 kural)             | `src/core/strategy/presets.ts`      |
| Piyasa geneli sıralama + çoklu test düzeltmesi | `src/core/strategy/rank.ts`         |
| Worker'da sembol aralığına bölünmüş backtest   | `WorkerRequest.type = 'rank'`       |
| Stratejiler ekranı (iki kapsam)                | `src/shell/screens/Strategies.tsx`  |
| Sıralamadan laboratuvara tek tıkla geçiş       | `src/shell/screens/labRules.ts`     |
| Derin tarama (en likitler, tam geçmiş)         | `WorkerRequest.type = 'rankSeries'` |
| `prev` operandı (kırılım kuralları için)       | `src/core/strategy/dsl.ts`          |
| Sektör bazlı para akışı                        | `src/core/screen/sectors.ts`        |
| Sektör sınıflandırma üreticisi                 | `scripts/build_sectors.py`          |
| Tarayıcıda sektör filtresi                     | `ScreenSpec.sectors`                |

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

### Kaynak: Borsa İstanbul'un kendi bileşen dosyası

Bu bölüm bir süre "kaynak uç noktası doğrulanamadı" diyordu ve ayrıştırıcı
`SECTOR`/`Sektor` gibi alan adlarını tahminle deniyordu. Üç aday uç noktanın
üçü de `HTTP 401` döndürdü — çünkü üçü de TAHMİNDİ.

Doğru hamle, fiyat verimizi zaten çeken kütüphanenin (borsapy) kaynağını
okumaktı: `borsapy/_providers/bist_index.py` borsanın kendi yayımladığı
bileşen dosyasını indiriyor —
`https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv`. Her satır bir
(endeks, bileşen hisse) çifti. Bir hissenin BIST'in alt sektör endekslerinden
hangisinde olduğu onun sektörüdür.

**İKİ TABAKA.** Önce 23 alt sektör endeksi; hiçbiri sahiplenmezse
XUSIN/XUMAL/XUHIZ/XUTEK üst gruplarına düşülüyor ve o hisseler
"… (alt sektörsüz)" adıyla yazılıyor. Sıra kritik: ikisi aynı anda
uygulansaydı Bilişim'deki 35 hisse hem XBLSM hem XUTEK üyesi olduğu için
çakışır ve hepsi sektörsüz kalırdı.

**ÖLÇÜLEN SONUÇ** (yayındaki veri, 584 hisse):

|                                      | korelasyon vekili | yalnız alt sektör | + üst grup |
| ------------------------------------ | ----------------- | ----------------- | ---------- |
| sınıflandırılan sembol               | 35                | 496               | **541**    |
| sınıflandırılmamış işlem değeri payı | —                 | %9,7              | **%0,1**   |

Vekilin kapsamı %6'ydı. Alt sektör tabakası tek başına 496 sembolü bağladı
ama dışarıda kalan %9,7'nin neredeyse tamamı TEK hisseydi: ASELS, piyasanın
son-bar işlem değerinin %6,4'ü (13,1 mlr / 203,2 mlr). Tanı turu sebebini
söyledi — ASELS'in tek sektör endeksi XUTEK ve bir savunma alt endeksi yok.
Üst grup tabakasından sonra ASELS "Teknoloji (alt sektörsüz)" oldu; kalan 43
sektörsüz hissenin en büyüğü 38 mn TL.

**TANI YAYIMLANIYOR.** `sectors-tani.json`: kaç sembol yazıldı, çakışanlar,
sektörsüz kalanlar, bunların hangi (listemizde olmayan) endekslerde
toplandığı ve on örnek üyelik. Sebep pratik — iş akışı kaydının kuyruğu
sektör adımına ulaşmıyor ve tüm kaydı indirmek her seferinde yirmi bin token.

`build_sectors.py`'nin ayrıştırıcısı ağdan bağımsız: `--self-test` sabit örnek
CSV üzerinde çalışıyor ve doğrulama iş akışına eklendi. Sektör adları TEK
kaynaktan — betik `src/core/screen/sectorIndices.ts` listesini okuyor.

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

| Kalıp                                   | Sayı | Ne yapıldı                                                                                   |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| Modallar (yalnızca fareyle kapanıyordu) | 4    | Ortak `ModalShell`: Escape, odak tuzağı, `role="dialog"`                                     |
| Tıklanabilir kart/satırlar              | 8    | Ortak `clickable()`: `role="button"`, sekme sırası, Enter/Space                              |
| Otomatik tamamlama listeleri            | 2    | APG birleşik kutu: `aria-expanded`, `aria-activedescendant`, `role="listbox"`                |
| Sarmalayan etiketler                    | 5    | Kural düzeltildi: `label-has-for` kullanımdan kalkmış, yerine `label-has-associated-control` |
| Boş tablo başlığı                       | 1    | Görsel olarak gizli metin                                                                    |

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

## Kesitsel (havuzlanmış) model

Model kartı tek sembolde haklı olarak "tek sembolde, tek dönemde ölçüldü"
diyordu. Havuz bu uyarının ilk yarısını gerçekten kapatıyor: Model ekranında
**Kapsam = Havuz (kesitsel)** seçilince en uzun geçmişe sahip N sembolün
örnekleri tek havuzda eğitiliyor.

İki yapısal değişiklik gerekti:

1. `model.ts` ikiye ayrıldı — `buildSamples` (örnek üretimi) ve
   `evaluateSamples` (purged CV + kart). Tek sembol de havuz da AYNI
   çekirdekten geçiyor, yani ölçüm yöntemi ikisinde birebir aynı.
2. Sızıntı ekseni bar indeksinden **takvim gününe** taşındı. Havuzda bar
   indeksleri semboller arasında kıyaslanamaz; sembollere göre bölmek
   (yarısı eğitim, yarısı test) aynı güne ait bilgiyi iki tarafta bırakırdı —
   piyasa genelinde güçlü bir gün, eğitimdeki A hissesinden testteki B
   hissesine sızardı. Katmanlar artık zaman blokları.

Bunun yan etkisi: **embargo birimi de gün oldu.** 10 işlem günü ≈ 14 takvim
günü; bar sayısı olduğu gibi kullanılsaydı embargo olması gerekenden kısa
kalırdı. Varsayılan ufku 1,4 ile ölçekliyor.

**Havuzun ölçülen değeri.** 400 barlık sekiz sentetik sembolde gömülü bir
momentum rejimi varken tek sembol modellerinin HEPSİ "kullanma" diyor
(AUC ort. 0,428 — gürültü). Aynı kural havuzlandığında örnek 330 → 2.640,
AUC 0,617, Brier becerisi +0,042, hüküm "kullanılabilir". Bu ayrım kalıcı
test altında.

**Havuz kendiliğinden bir üstünlük üretmiyor.** Yerel sentetik BIST verisinde
(rastgele yürüyüşe yakın) 15 sembol · 49.950 örnek havuzlandığında hüküm yine
**kullanma** (AUC 0,506). Örnek sayısını artırmak olmayan bir ayrımı var
etmiyor ve tablo bunu gizlemiyor.

Diğer kararlar: havuzda canlı tahmin üretilmiyor (hangi sembol için olacağı
belirsiz), örneği yetersiz semboller gerekçesiyle kartta listeleniyor, indirme
boyutu önceden söyleniyor ve eğitim kullanıcı başlatınca koşuyor.

## Uçtan uca testler (planın §8 kalite kapısı)

Plan "5 kritik akış için Playwright" diyordu; bu turlar boyunca o akışları her
değişiklikten sonra ELLE doğruluyordum. Elle yapılan doğrulama regresyonu
yakalamaz — artık altısı da otomatik:

| Akış                 | Neyi koruyor                                                                            |
| -------------------- | --------------------------------------------------------------------------------------- |
| Nabız                | ısı haritası + sektör akışı gerçek worker'da; "Sınıflandırılmamış" gizlenmiyor          |
| Tarama               | filtre → sonuç → **paylaşılan bağlantı aynı sonucu veriyor**                            |
| Tarama → Stratejiler | semboller taşınıyor, ağır iş onaysız başlamıyor                                         |
| Sembol masası        | grafik/finansal/sektör sekmeleri; paket izinsiz inmiyor; ayarlar diğer sekmelerde gizli |
| Laboratuvar          | sıralamadan gelen kural URL'de, beş doğrulama rozeti çıkıyor                            |
| Model                | hüküm "kullanma" ise ekranda olasılık YOK                                               |

Her test konsol hatası biriktiren bir akışı da düşürüyor: sessiz bir istisna
"geçti" sayılmamalı.

Kırılganlığa karşı iki karar: worker süresi gibi ölçümden ölçüme değişen
değerler karşılaştırılmıyor (sonuç sayısı karşılaştırılıyor), ve CI'da tek
işçi kullanılıyor — paralel sekmeler aynı çekirdekleri paylaşınca ölçüm değil
kuyruk beklenir.

Ayrı iş akışı (`e2e.yml`): gerçek tarayıcı indirmek `verify` kapısını
yavaşlatırdı. Süre: 6 akış, yerelde 9 sn; **CI'da 7,8 sn** (ilk koşu yeşil,
veri iş akışında üretiliyor).

Bağlantı paylaşımı da tamamlandı: tarayıcı, laboratuvar ve raporda ortak bir
"kopyala" düğmesi var. Pano erişilemezse düğme sessizce "kopyalandı" demiyor,
hata durumunu gösteriyor.

## Döviz bazlı getiri

"TL'de %16 kaybettim" tek başına eksik bir cümle: aynı dönemde kur %46
arttıysa dolar bazında kayıp %43'tür. Portföy ekranı artık üç bazı yan yana
gösteriyor — nominal TL, **USD bazında** ve reel (TÜFE).

**Kur tablosu koda gömülmedi.** Hafızadan yazılmış bir kur tablosu yanlış
olduğunda sessizce yanlış bir getiri gösterirdi; seri veri hattından geliyor
(`public/data/<piyasa>/fx.json`, `scripts/build_fx.py` ile TCMB EVDS'ten).
Dosya yoksa kart "kur serisi yok" diyor.

İki hesap kararı:

- **Enterpolasyon yok.** Ara günlerde son bilinen kur taşınıyor; iki gün
  arasında düz çizgi varsaymak olmayan bir fiyat üretir.
- **Serinin başlangıcından önce hesap yok.** "En eski kuru kullan" demek
  geçmişi çarpıtır; kart "ilk işlem kur serisinden eski" diyor.

### Yol boyunca yakalanan kusur

Testi yazarken işlem tarihini varsayılan (bugün) bırakınca ortaya çıktı: fiyat
verisi bayatsa işlem tarihi değerleme gününden SONRA olabiliyor ve iki uçta da
son bilinen kur kullanılıyordu — kur etkisi sıfırlanıp TL getirisi "döviz
getirisi" diye gösteriliyordu. Artık `dayFrom > dayTo` durumunda sonuç
üretilmiyor. Test altında.

## Kayıtlı taramaların taşınabilirliği

Kayıtlar tarayıcıda duruyor; başka bir makineye geçen kullanıcı kitaplığını
kaybediyordu. Tek bir taramayı paylaşmak için bağlantı yeterliydi, koleksiyonu
taşımak için metin biçimi gerekiyordu: "Koleksiyonu dışa aktar" metni veriyor,
"Koleksiyonu içe aktar" geri alıyor.

İçe aktarma **katı**: tanınmayan metrik, bozuk sayı, adı olmayan kayıt ya da
başka bir JSON dosyası sessizce kabul edilmiyor; her biri gerekçesiyle
listeleniyor. Yarım anlaşılmış bir taramayı almak, kullanıcının sandığından
farklı bir filtreyle çalışması demek olurdu.

Aynı adlı kayıt **üzerine yazılmıyor**, "(içe aktarılan)" ekiyle yanına
ekleniyor — mevcut kitaplığı sessizce değiştirmek kullanıcının kararı değil.

Yol boyunca küçük bir düzeltme: araç çubuğundaki ve pencere içindeki iki düğme
de "İçe aktar" diyordu. Aynı ada sahip iki düğme ekran okuyucuda ayırt
edilemez; dıştaki "Koleksiyonu içe aktar" oldu.

## Bütünsel gözden geçirme: aynı adlı düğmeler

Dokuz ekran bir kullanıcı gibi gezildi. Konsol temiz, her ekranda tek ve doğru
bir `h1`, adsız düğme ya da etiketsiz giriş alanı yok. Ama denetim lint'in
göremediği bir kusuru buldu: **aynı adı taşıyan düğmeler.**

| Ekran          | Tekrar                                                 |
| -------------- | ------------------------------------------------------ |
| Stratejiler    | "Laboratuvarda aç" ×8                                  |
| Sembol Masası  | "Bu sayı nereden geliyor?" ×9                          |
| Tarayıcı       | "Bu metrik nasıl hesaplanıyor?" ×2, "Kuralı kaldır" ×2 |
| Laboratuvar    | "Kuralı kaldır" ×2, "+ Kural" ×2                       |
| Nabız, Portföy | "Bu sayı nereden geliyor?" ×2                          |

Lint bunları göremez çünkü teknik olarak hepsi etiketli. Ama sekiz satırda
sekiz kez "Laboratuvarda aç" duyan bir ekran okuyucu kullanıcısı hangisinin
hangi strateji olduğunu bilemez. Hepsi bağlamıyla yeniden adlandırıldı
("EMA 20/50 kesişimi stratejisini laboratuvarda aç", "Son kapanış: bu sayı
nereden geliyor?", "Giriş kuralları: 2. kuralı kaldır").

Denetim kalıcı bir teste bağlandı (`e2e/erisilebilirlik.spec.ts`): dokuz ekranın
her biri için h1 sayısı, adsız düğme, etiketsiz giriş ve **tekrar eden düğme
adı** sıfır olmalı. Bu kusur artık sessizce geri gelemez.

## Klavye gezintisi denetimi

Altı ekran klavyeyle gezildi: her birinde ilk sekme durağı **"İçeriğe atla"**
(kullanıcı her sayfada menüyü baştan geçmek zorunda kalmıyor), 40 sekme boyunca
odak ilerliyor, tuzak yok ve odak halkası her durakta görünür.

Tek iyileştirme sektör rozetlerinde: odak halkası yalnızca küçük onay kutusunda
çıkıyordu, artık `:focus-within` ile **rozetin tamamı** vurgulanıyor — klavyeyle
gezen kullanıcı nerede olduğunu bir bakışta görüyor.

### Yol boyunca: ölçütün kendisi yanlıştı

İlk yazdığım tuzak ölçütü "art arda on kez aynı METİN" diye bakıyordu ve
Tarayıcı ekranında yanlış alarm verdi: dokuz sektör rozetinin onay kutusu da
metinsiz (adları sarmalayan `<label>`'dan gelir). Ölçüt öğe kimliğine çevrildi.
Bir denetim aracının kendisi de yanılabilir; alarmı düzeltmeden önce nedenini
görmek gerekiyordu.

`e2e/klavye.spec.ts` bunları kalıcı hale getirdi (6 akış).

## Dar ekran denetimi (390 px)

Tasarım sistemi tek bir responsive ağaç üzerine kurulu ama dar ekranda hiç
denetim yapılmamıştı. Sekiz ekran 390 px genişlikte gezildi ve ilk ölçüm
sorunu gösterdi: **her ekran 481 px'lik bir yerleşim genişliğiyle
çiziliyordu.** Neden dokuz maddelik gezinti rayıydı — dar ekranda yatay
dizilen raf 390 px'e sığmıyor, tarayıcı da sayfayı küçültüp sığdırıyordu.
Sonuç: kullanıcı 390 px'lik telefonda 481 px'lik bir sayfayı uzaktan
görüyordu, her yazı orantılı olarak küçülmüştü.

Çözüm rafı **yatay kaydırılabilir** yapmak oldu (`overflow-x: auto`,
öğeler `flex: 0 0 auto`, kaydırma çubuğu gizli). Yeniden ölçümde sekiz
ekranın da `scrollWidth` değeri 390 ve yatay taşma yok.

### Dokunma hedefleri

WCAG 2.5.8 en az 24×24 px istiyor. Ölçüm üç kusur buldu:

| Öğe                       | Önce  | Sonra                       |
| ------------------------- | ----- | --------------------------- |
| Tablo satır düğmesi (×97) | 86×20 | satırın tamamı, en az 32 px |
| Tablo sıralama başlığı    | 24×33 | en az 32 px yükseklik       |
| Veri kaynağı rozeti       | 16×16 | 24×24                       |

Rozet görsel olarak hâlâ 16 px'lik bir daire: büyüme saydam kenarlıkla
(`border: 4px solid transparent; background-clip: content-box`) yapıldı,
yani tıklama alanı büyüdü ama tasarım değişmedi.

### Yol boyunca: adsız bir bağlantı

Yeniden ölçümde geriye iki şey kaldı. Biri yanlış alarm (sektör rozetlerinin
onay kutuları; gerçek hedef 98×26'lık `<label>`). Diğeri gerçekti: grafik
kütüphanesinin eklediği **atıf bağlantısının erişilebilir adı yoktu** —
ekran okuyucu "boş bağlantı" diye okuyordu. Atfı kaldırmak doğru olmazdı;
bağlantıya `aria-label` verildi.

`e2e/erisilebilirlik.spec.ts` artık adsız bağlantıyı da eliyor, yeni
`e2e/mobil.spec.ts` ise altı ekranda 390 px genişlik ve yatay taşma
olmadığını doğruluyor (toplam 27 uçtan uca akış).

## Para akışından hisseye: Nabız → Tarayıcı

Sektör akış tablosu "Bankacılık'a para giriyor" diyordu ama cümlenin devamı
yoktu. Kullanıcı hangi bankaya bakacağını bulmak için tarayıcıya gidip
sektörü elle seçmek zorundaydı.

Artık her sektör satırında iki geçiş var:

| Tıklanan   | Gidilen                               |
| ---------- | ------------------------------------- |
| Sektör adı | O sektörün en çok işlem gören sembolü |
| **Tara**   | Tarayıcı, o sektör seçili             |

Tarayıcıya **kuralsız** geçiliyor. Kullanıcı adına bir filtre varsaymak
(ör. "RSI 40–70") sektörün hisselerinin bir kısmını daha ilk ekranda
gizlerdi; filtreyi kuran kullanıcıdır, biz yalnızca kapsamı taşıyoruz.

İki durumda düğme **hiç çıkmıyor**, çünkü karşılığı dürüstçe kurulamaz:

- **Sınıflandırılmamış** satırı bir sektör değil, bir eksiktir; tarayıcının
  sektör filtresinde karşılığı yok.
- Adında virgül ya da `|` olan sektör bağlantı biçiminde taşınamaz
  (`isShareableSector`). Taşınamaz adı yine de gönderseydik tarayıcı
  **sessizce tüm piyasayı** gösterirdi — kullanıcının istediğinden başka bir
  şey. Kodlamadaki eleme ile arayüzdeki düğme artık aynı ölçütü kullanıyor.

Yol boyunca bir yanıltıcı boş durum düzeltildi: sektör seçili gelen bir
bağlantıda sınıflandırma dosyası inene kadar sonuç zorunlu olarak boştur ve
ekran "Kriterlere uyan sembol yok" diyordu — kullanıcı filtresini gevşetmeye
çalışırdı. Artık "Sektör sınıflandırması yükleniyor" diyor.

Akış uçtan uca teste bağlandı (`e2e/akislar.spec.ts`): Nabız'daki ilk sektör
satırından geçiliyor, tarayıcıda tam olarak o rozet seçili çıkıyor ve URL
paylaşılabilir kalıyor.

## Kayıtlı taramada "ne değişti"

Plandaki `tarayici` maddelerinden biri — "kayıtlı taramalar ve **alarm
kurma**" — açıkta kalmıştı. Bu uygulamanın canlı akışı yok; veri, hattın
ürettiği durağan bir paket. O yüzden bildirim gönderen bir alarm dürüst
olmazdı. Dürüst olan şu: kullanıcı taramayı kaydettiğinde sonucu bir anlık
görüntü olarak saklamak, uygulamayı bir sonraki açışında YENİ VERİYLE aynı
taramayı çalıştırıp farkı göstermek.

Kayıtlı tarama düğmesinde artık rozet var — kaydı açmaya gerek yok:

    Tarama 1  [+2 / −1]

Açıldığında ayrıntı şeridi çıkıyor: "2026-09-11 işaretinden bu yana ·
2 giren · 1 çıkan · 95 kalan · +X002 +X004 −YOKSA". Giren/çıkan sembollerin
her biri sembol masasına götüren bir düğme.

Farkın anlamlı olması iki şarta bağlı ve ikisi de `core/screen/watch.ts`
içinde **kontrol ediliyor** (`diffScreen`):

| Durum                          | Ne yapılır                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Anlık görüntü yok              | Fark uydurulmaz; "işaretle" önerilir                                                      |
| Veri paketi aynı (hash eşit)   | Fark **aranmaz** — çıkacak fark piyasadan değil bizim hatamızdan gelirdi                  |
| Kayıt başka bir kural setinden | Fark **gösterilmez** — "yeni giren" piyasa hareketi değil kullanıcının değişikliği olurdu |
| Paket yeni, kural aynı         | Giren/çıkan/kalan                                                                         |

İki ayrıntı bilinçli:

- Fark, ekranda o an düzenlenen kurallara değil **kaydın tanımına** bakıyor.
  "Tarama 1'e bugün ne girdi" sorusunun cevabı, kullanıcının o sırada ne
  denediğinden bağımsız olmalı.
- Taramanın kimliği **sıralamayı içermiyor**. Sıralama hangi sembolün
  eşleştiğini değiştirmez; kimliğe katsaydık sütun başlığına tıklamak
  "kural değişti" sayılırdı.

Veri kimliği olarak manifest'teki paket hash'i kullanılıyor, üretim damgası
değil: hat aynı veriyi yeniden paketlerse damga değişir, baytlar değişmez.
Anlık görüntüler kayıtlı tarama koleksiyonunun DIŞINDA, ayrı bir anahtarda
duruyor — koleksiyon taramanın tanımıdır, anlık görüntü ise bu cihazdaki
gözlem.

## Rejim kırılımı: strateji hangi piyasada çalışıyor?

Planın L2 maddesindeki "rejim kırılımı: yüksek/düşük volatilite, trend/yatay"
açıkta kalmıştı. Bir stratejinin ortalama getirisi tek başına eksik bir
cümledir: yalnızca sakin piyasada kazanan bir strateji, piyasa sertleştiğinde
kullanıcının beklediğinden başka bir şey yapar.

Laboratuvar artık işlemleri **giriş barındaki** rejime göre dört kovaya
ayırıyor (X001, hazır kural):

| Rejim                   | Bar payı | İşlem | Medyan           | İsabet |
| ----------------------- | -------- | ----- | ---------------- | ------ |
| Düşük oynaklık · yatay  | 25%      | 11    | −4,86%           | 18%    |
| Düşük oynaklık · trend  | 23%      | 9     | −5,93%           | 33%    |
| Yüksek oynaklık · yatay | 22%      | 6     | −1,34%           | 33%    |
| Yüksek oynaklık · trend | 30%      | 4     | _yetersiz örnek_ | —      |

Üç karar, üçü de dürüstlük gereği:

1. **Sınıflandırma nedensel.** Oynaklık eşiği, o bara kadarki geçmişin
   medyanı — bugünkü barı ve geleceği içermez. Tam örneklem medyanı
   kullansaydık "bu strateji yüksek oynaklıkta iyi" cümlesi geleceği bilerek
   kurulmuş olurdu. Test bunu ayrıca sınıyor.
2. **Az örnekte sayı yok.** Beşten az işlem taşıyan kova medyan/ortalama/
   isabet göstermiyor, "yetersiz örnek" diyor. Dört işlemin medyanını bir
   rejim hükmü gibi sunmak, olmayan bir bilgiyi varmış gibi göstermek olurdu.
3. **Isınmada açılan işlem gizlenmiyor.** Rejimi bilinmeyen işlem hiçbir
   satıra yazılmıyor ve sayısı ayrıca söyleniyor; yoksa satır toplamları
   sessizce işlem sayısının altında kalırdı.

Tablonun altında kaldırılamaz bir uyarı var: **kırılım bir teşhistir,
strateji değil.** "Yalnızca şu rejimde işlem yap" kuralını bu tablodan
çıkarmak aynı veriye ikinci kez bakmaktır ve buradaki sayıları geçersiz
kılar.

Hesap worker'da: sınıflandırma barları bir kez tarıyor (5000 barda ~3,7 ms,
ölçüldü) ve ana iş parçacığı yalnızca dört satırlık özeti alıyor — rejim
dizilerini aktarsaydık her kural değişikliğinde onlarca kilobayt taşınırdı.

## Ekranlar arası tutarlılık denetimi

Ekranlar tek tek doğruydu ama hiç YAN YANA koyulmamıştı. X140 sembolüyle
aynı sayıyı üç ekrandan okudum:

| Ekran         | "1 ay"      |
| ------------- | ----------- |
| Tarayıcı      | **+17,53%** |
| Sembol Masası | **+18,67%** |
| Rapor         | +18,67%     |

Kusur gerçekti: tarayıcı **21 bar**, masa ve rapor **30 takvim günü** geriye
bakıyordu. Her ikisinin de formül katmanı doğruyu yazıyordu, yani hiçbiri
yalan söylemiyordu — ama aynı adı taşıyan iki sayıdan hangisine güveneceğini
kullanıcı bilemezdi.

Takvim penceresi kazandı ve tek kaynağa taşındı (`changeSince`, `core/stats/
summary.ts`): tatiller ve yarım günler yüzünden "21 bar önce" her sembolde
farklı bir tarihe denk gelir, "30 gün önce" gelmez. Tarayıcının 1 hafta /
1 ay / 3 ay sütunları artık 7 / 30 / 90 takvim gününe bakıyor; "1 gün" bar
tabanlı kaldı (günlük değişim zaten bir önceki kapanış demektir).

Yanında bir dürüstlük kuralı: **pencere tam kapsanmıyorsa sayı üretilmiyor.**
Kısa geçmişli bir sembol için daha dar bir pencereyi "1 aylık getiri" diye
sunup ötekilerle aynı sütunda sıralamak, farklı şeyleri karşılaştırmak
olurdu. Eskiden 21 bar yoksa NaN'dı; şimdi 30 gün yoksa NaN.

Tutarlılık kalıcı teste bağlandı: aynı seride tarayıcının `chg21` değeri ile
Sembol Masası'nın `r1m` metriği birbirinden ayrılırsa test kırılıyor.

### İkinci tur: aynı ad, başka pencere

Denetim sürünce ikinci bir çift çıktı — ama bu kez sayılar HAKLI olarak
farklıydı:

| Ekran         | Metrik                                             | X140    |
| ------------- | -------------------------------------------------- | ------- |
| Tarayıcı      | Zirveden (son 250 barın en **yükseği**)            | −10,65% |
| Sembol Masası | Tepeden uzaklık (tüm geçmişin **kapanış** zirvesi) | −59,96% |

İkisi farklı sorular: biri "son bir yılın zirvesine göre neredeyiz" (klasik
bir tarama ölçütü), öteki "tarihsel tepeden ne kadar aşağıdayız". Kusur
hesapta değil **adlandırmadaydı**: iki başlık da "zirveden uzaklık" diye
okunuyordu ve −%10 ile −%60 arasındaki uçurum kullanıcıya birinin bozuk
olduğunu düşündürürdü.

- Sembol Masası'nın metriği **"Tarihsel zirveden"** oldu; formülü de artık
  "TÜM GEÇMİŞTEKİ en yüksek kapanış" diyor.
- Tarayıcı sütun başlıkları, penceresi araç çubuğunda **görünmeyen**
  metriklerde pencereyi taşıyor: **"Zirveden (250 bar)"**, **"Hacim oranı
  (20 bar)"**. RSI/ADX/EMA'da başlık sade kaldı, çünkü uzunlukları zaten
  araç çubuğunda görünüyor ve kullanıcı değiştirdiğinde başlık da değişir.

Geri kalan çakışan metrikler (fiyat, 1 gün, F/K, PD/DD, özkaynak kârlılığı,
net marj) tarayıcı ile finansallar panelinde birebir aynı çıktı.

### Üçüncü tur: Stratejiler ↔ Laboratuvar

Aynı stratejiyi iki ekrandan okudum (X001, "55 bar kırılımı"):

```
Stratejiler : al-tut farkı +8,5% · yıllık +0,4% · maks. düşüş 45,6% · 35 işlem
Laboratuvar : al-tut farkı +8,5% · yıllık +0,4% · maks. düşüş -45,6% · 35 işlem
```

Sayılar birebir aynı — iki ekran arasındaki köprü ("Laboratuvarda aç")
gerçekten aynı hesabı açıyor. Tek fark işaretteydi: Laboratuvar düşüşü
işaretli, sıralama tablosu büyüklük olarak yazıyordu. Aynı sayının iki
ekranda iki farklı işaretle çıkması gereksiz bir tereddüt üretiyor;
sıralama tablosu da işaretli oldu.

Nabız'ın satır metrikleri de kontrol edildi: günlük değişim tarayıcıyla aynı
tanımda (bir önceki kapanış). Nabız'ın kendi `fromHigh` alanı KAPANIŞ
zirvesine bakıyor ama hiçbir yerde gösterilmiyor — üçüncü bir "zirveden"
tanımı ekrana sızmıyor.

## Yeni kabuğa giden yol yoktu

Bütün bu iş `next.html` içinde duruyordu ve siteye gelen kullanıcı oraya
**hiçbir yerden ulaşamıyordu**: `index.html` (yayındaki uygulama) yeni
kabuktan haberdar değildi, yeni kabukta da geri dönüş yolu yoktu. Yapılan
işin kullanıcıya ulaşmaması, yapılmamış olmasıyla aynı kapıya çıkar.

İki bağlantı eklendi — varsayılan giriş noktası DEĞİŞTİRİLMEDİ, bu bir ürün
kararı ve tek taraflı alınmamalı:

- Eski araç çubuğunda **"Yeni arayüz"** (dar ekranda da gizlenmiyor;
  keşfedilmesi gereken tek şey bu).
- Yeni kabuğun üst çubuğunda **"Eski arayüz"** — yeni kabukta henüz olmayan
  bir şeye ihtiyacı olan kullanıcı geri dönebilmeli.

Bağlantı uçtan uca teste bağlandı: kopsa kimse fark etmezdi.

### Yol boyunca: eski sayfada iki kusur

- `index.html` yakınlaştırmayı **engelliyordu** (`maximum-scale=1.0,
user-scalable=no`). Bu WCAG 1.4.4'e aykırı ve az gören kullanıcıyı
  uygulamanın dışında bırakıyor. Kaldırıldı; grafiğin kendi dokunma
  hareketleri etkilenmiyor.
- Sayfanın ikonu yoktu, yani her ziyarette `/favicon.ico` için bir **404**
  ve konsolda bir hata. Yeni kabuktaki satır içi SVG ikon buraya da
  eklendi — ek istek yok.

## Sessiz başarısızlık denetimi

Bütün veri istekleri kesilerek (çevrimdışı taklidi) dokuz ekran tek tek
açıldı. Altısı doğru davrandı — "Piyasa verisi yüklenemedi · Failed to
fetch" gibi net bir mesaj. **Üçü yanlış davrandı:**

| Ekran       | Hata durumunda görünen   |
| ----------- | ------------------------ |
| Stratejiler | 7 iskelet, sonsuza kadar |
| Model       | 6 iskelet, sonsuza kadar |
| Rapor       | 6 iskelet, sonsuza kadar |

Rapor ekranında hata zaten yakalanıyor ve `error` durumuna yazılıyordu —
ama hiçbir yerde GÖSTERİLMİYORDU. Kullanıcı yüklenmeyi bekliyor sanıyor,
oysa istek çoktan başarısız olmuş. Sessiz başarısızlık, yanlış sayı
göstermenin bir adım gerisindeki kusurdur: ikisinde de kullanıcı gerçekte
olmayan bir şeye güveniyor.

Üç ekran da artık nedeni yazıyor (`DataError`, tek bileşen). Araç çubuğu
ekranda kalıyor: piyasa ya da sembol değiştirerek toparlanmak mümkün olsun.
Nabız da aynı kalıba çekildi — eskiden hata durumunda TÜM ekranı bir boş
duruma çeviriyordu, yani piyasa seçici de kayboluyordu ve kullanıcı çalışan
bir piyasaya geçemiyordu.

Dördü de teste bağlandı. Testin gerçekten koruduğu doğrulandı: düzeltme geri
alındığında test kırılıyor.

### Bozuk veri: beş senaryo

Kesilmiş bağlantının yanında BOZUK veri de denendi — yavaş mobil bağlantıda
yarım inen dosya gerçek bir durumdur:

| Senaryo                 | Kullanıcının gördüğü                                  |
| ----------------------- | ----------------------------------------------------- |
| Manifest bozuk JSON     | "Piyasa verisi yüklenemedi · Expected property name…" |
| Manifest yanlış şema    | "bist: manifest biçimi tanınmadı"                     |
| Paket çöp bayt          | "pack: sihirli sayı tutmuyor"                         |
| Sembol serisi kırpılmış | "pack: beklenen 81632 bayt, gelen 120"                |
| **Paket kırpılmış**     | **"Invalid typed array length: 1000"** ← motor hatası |

Son satır kusurdu: paket çözücüsünde uzunluk kontrolü, tipli dizi
görünümleri KURULDUKTAN sonra geliyordu; yarım inen dosyada JavaScript
motorunun kendi hatası kullanıcıya sızıyordu. Tek sembol çözücüsünde aynı
kontrol doğru yerdeydi. Kontrol öne alındı, mesaj artık "pack: sembol adları
için 1024 bayt gerekiyor, gelen 200".

Sektör dosyası bozuk gelirse filtre hiç görünmüyor (şema doğrulaması zaten
vardı), temel veri bozuksa tarama teknik metriklerle çalışmaya devam
ediyor — ikisi de sessizce yanlış sayı üretmiyor.

## Depolama kapalıyken: yayındaki uygulama boş sayfa açıyordu

Üçüncü dayanıklılık senaryosu: `localStorage` hem okumada hem yazmada istisna
fırlatıyor (Safari özel sekmesi, dolu kota, gizlilik eklentisi).

Yeni kabuğun dokuz ekranı da sorunsuz açıldı — okuma/yazmaların hepsi zaten
`try/catch` içindeydi. **Yayındaki uygulama (`index.html`) hiç açılmadı:**
0 canvas, 0 araç çubuğu, konsolda `QuotaExceededError`.

Sebep asimetrikti: OKUMALAR korunuyordu (`lsGet` sarmalayıcısı), YAZMALAR
korunmuyordu. On dört ayrı `useEffect` doğrudan `localStorage.setItem`
çağırıyordu; ilki patlayınca React ağacı çöküyor ve kullanıcı bembeyaz bir
sayfa görüyordu.

Tek bir sarmalayıcıya toplandı (`src/storage.ts`): `lsRead`, `lsReadRaw`,
`lsWrite`, `lsRemove`. Kural açıkça yazılı — **tercih saklamak bir
kolaylıktır, uygulamanın çalışma şartı değil.** Yazma başarısızsa sessizce
vazgeçiliyor, okuma başarısızsa varsayılan dönüyor.

Uçtan uca teste bağlandı ve testin gerçekten koruduğu doğrulandı: düzeltme
geri alındığında test kırılıyor, geri konduğunda geçiyor.

### Worker yoksa, IndexedDB yoksa

İki ortam daha denendi:

- **IndexedDB yok** (özel sekme, eski tarayıcı): üç ekran da sorunsuz açıldı.
  Önbellek katmanı zaten sessizce devre dışı kalıyor; tek fark her ziyarette
  yeniden indirmek.
- **Worker kurulamıyor** (katı içerik güvenliği politikası, eklenti): ekranlar
  hata veriyordu ama mesaj tarayıcının ham istisnasıydı — _"Worker blocked"_.
  Kullanıcıya hiçbir şey anlatmıyor. Artık alan diliyle: _"Bu tarayıcıda arka
  plan işçisi (Web Worker) başlatılamadı; analiz çalıştırılamıyor. Katı bir
  içerik güvenliği politikası ya da bir tarayıcı eklentisi engelliyor
  olabilir."_ Ham istisna parantez içinde duruyor — teşhis için gerekli.

Aynı denemede **dördüncü bir sessiz başarısızlık** çıktı: Sembol Masası'nda
analiz hatası `catch(() => setAnalysisResult(null))` ile yutuluyordu. Ekranda
araç çubuğu ve sekmeler duruyor, altında hiçbir şey yok — grafik yok, metrik
yok, hata da yok. Artık nedenini yazıyor ve teste bağlı.

### Kalıbı aramak: "boş sonuç" ile "çöken hesap" aynı şey değil

Dördüncüsü çıkınca kalıp sistematik olarak arandı (`catch` içinde yalnızca
null/boş atayan yerler). Üç tane daha vardı ve üçü de **yanlış bir hikâye
anlatıyordu**:

| Ekran       | Hesap çöktüğünde görünen     | Kullanıcı ne yapardı      |
| ----------- | ---------------------------- | ------------------------- |
| Tarayıcı    | "Kriterlere uyan sembol yok" | Filtresini gevşetirdi     |
| Karşılaştır | "En az iki sembol seç"       | Zaten seçmişti, şaşırırdı |
| Nabız       | İskelet, sonsuza kadar       | Beklerdi                  |

Boş sonuç ile çöken hesap aynı ekranla anlatılamaz: ilkinde kullanıcı
filtresini değiştirir, ikincisinde bekler ya da sayfayı yeniler. Üçü de artık
"… hesaplanamadı" diyip worker'ın hatasını gösteriyor; üçü de teste bağlandı.

Bu, veri İNMEME hatasından (zaten kapatılmıştı) ayrı bir yol: paket inmiş ama
hesap çökmüş. İki durum ayrı ayrı ele alınıyor çünkü kullanıcının yapacağı
şey de farklı.

## "Her sayı tıklanabilir" ölçüldü: 33 karttan 13'ü değildi

Plan §11 "her yayınlanan metriğin provenance popover'ı var (kapsam %100)"
diyordu. Dokuz ekranın sayı kartları tek tek sayıldı:

| Ekran         | Kart | Provenance'ı olan |
| ------------- | ---- | ----------------- |
| Sembol Masası | 9    | 9                 |
| Nabız         | 4    | **2**             |
| Laboratuvar   | 8    | **0**             |
| Model         | 9    | **0**             |
| Stratejiler   | 3    | **0**             |

Yani Sembol Masası'nda yapısal olan şey (metrik formülünü kendisi taşıyor)
öteki ekranlara hiç taşınmamıştı. En kötüsü Laboratuvar: Sharpe'ın hangi
risksiz oranla hesaplandığını, maks. düşüşün hangi pencerede ölçüldüğünü,
maliyet yükünün neyi içerdiğini kullanıcı göremiyordu — oysa bunlar
stratejiye güvenip güvenmeyeceğine karar verdiği sayılar.

Otuz üç kartın hepsi artık katman taşıyor. Backtest metriklerinin formülleri
`core/backtest/metrics.ts` içinde, **hesabın yanında** duruyor
(`BACKTEST_METRIC_FORMULA`): metni hesaptan uzağa koymak, hesap değişince
açıklamanın sessizce eskimesi demekti.

Birkaç katman yalnızca formül değil, **sınır** da söylüyor:

- _Doğruluk:_ "%80'i pozitif olan veride hep 'olur' demek %80 doğruluk verir
  ve hiçbir şey öğrenmemiştir."
- _Sinyal ortalaması:_ "Maliyet dahil değil ve kesişen pencereler bağımsız
  değil — bir strateji sonucu olarak okunamaz."
- _Sharpe:_ "Risksiz oran 0 kabul edilir — mutlak yorum için değil."

Ölçüm kalıcı: `e2e/erisilebilirlik.spec.ts` artık provenance'sız bir sayı
kartı görürse CI'yı kırıyor. İddia, iddia olmaktan çıktı.

## "İndikatörlerin %100'ü testli" ölçüldü: yarısı değildi

Planın ikinci ölçülmemiş iddiası. Kapsam raporu şunu gösterdi: EMA, RSI, ATR,
ADX, ROC, VWMA ve kayan en yüksek/en düşük testliydi (yedi fonksiyon); ama
**destek/direnç, formasyon tanıma, özet istatistikler ve bileşik gösterge
paketi (%R + MACD) hiç test edilmemişti** — `patterns.ts` %0, `stats.ts` %0,
`calc.ts` %58.

Bunlar grafikte çizgi çizen ve eski uygulamanın özet kartlarını besleyen
fonksiyonlar; sessiz bir hata "ekranda bir şey görünmüyor" diye fark edilmeden
kalır. Testler kurgu serilerle yazıldı — şekil biliniyor, doğru cevap da:

- **Omuz-baş-omuz** şekli kurulup `obo` bulunması, **ters** şekilde `tobo`
  bulunması ve ikisinin BİRBİRİNE karışmaması.
- Düz seride formasyon **uydurulmaması**.
- Destek/direnç: aynı seviyeye iki dokunuş bir seviye; **tek dokunuş değil**.
- `computeStats`: 2 yılda 100 → 121 serisinde CAGR %10, tepe-dip düşüş %50,
  52 haftalık uçların pencere DIŞINDAKİ zirveyi almaması.
- `%R` sabit fiyatta NaN (sıfıra bölme sessizce sıfır olmuyor),
  `histN = macdN − signalN` özdeşliğinin normalizasyondan sonra korunması.

Sonuç:

| Dosya           | Önce  | Sonra     |
| --------------- | ----- | --------- |
| `calc.ts`       | %58   | **%98**   |
| `patterns.ts`   | %0    | **%81**   |
| `stats.ts`      | %0    | **%100**  |
| Tüm `src/core/` | %76,8 | **%89,2** |

İndikatörler artık kapsam kapısının **içinde**: dışarıda kalan tek şey eski
uygulamanın strateji motoru (`analysis.ts`, `backtest.ts`,
`customStrategy.ts`), yerini `core/backtest/` aldı.

## Ekran Türkçe konuşmuyordu: 127,63 ama +3.61%

Uygulamanın dili Türkçe ve fiyatlar Türkçe yazılıyordu (`127,63` — virgül,
binlik nokta). Ama yüzdeler İngilizce yazılıyordu: **`+3.61%`**. Aynı satırda
iki farklı yazım.

Bu yalnızca bir görgü meselesi değil: ondalık **virgülle noktanın** aynı
tabloda karışması gerçek bir yanlış okuma riski. Üstelik uygulama kendi
içinde de tutarsızdı — bazı yerlerde Türkçe kurala uyup `%40` yazıyor, bazı
yerlerde `40.00%`.

Türkçe kural tek kaynağa toplandı (`src/ui/format.ts`): ondalık virgül,
binlik nokta, **yüzde işareti sayının önünde**, işaret en başta.

```
önce : +3.61%   -45.6%   0.610   39.7%
sonra: +%3,61   -%45,6   0,610   %39,7
```

Yirmi dört çağrı yeri ve dokuz ekran geçirildi; grafik eksen etiketleri, ısı
haritası ipuçları ve rejim hükmü cümlesi dahil. Tarayıcıda doğrulandı:
ekranlarda İngilizce biçimde tek bir yüzde kalmadı.

Yardımcı kendi testini taşıyor (sonsuz `∞`, tanımsız `—`, sıfırda işaret yok)
ve tek yerde durduğu için bundan sonra yeni bir kart eklerken biçim sorusu
yeniden çıkmıyor.

## Renk kontrastı ölçüldü: iki tema da eşiğin altındaydı

Erişilebilirlik denetimleri şimdiye kadar etiketlere, klavyeye ve dokunma
hedeflerine baktı; **renge hiç bakmamıştı.** Dokuz ekranın her metin düğümü,
zeminine karşı ölçüldü (WCAG AA: normal metin 4,5:1, büyük metin 3:1).

| Kusur                           | Açık               | Koyu     |
| ------------------------------- | ------------------ | -------- |
| İkincil metin (`--text-muted`)  | 3,98               | 4,27     |
| Rozet: yükseliş / düşüş / uyarı | 3,85 / 4,17 / 3,98 | ✓        |
| Yeşil–kırmızı sayılar           | 4,36               | ✓        |
| Birincil düğme metni            | ✓                  | **3,13** |
| Bağlantı görünümlü düğmeler     | 4,27               | ✓        |

En can alıcısı ilk satır: **açıklama metinlerinin çoğu bu tokenı kullanıyor.**
Yani ürünün ayırt edici özelliği olan "neden böyle" yazısı, tam da onu okumaya
çalışan kullanıcı için okunaksızdı.

Düzeltmeler ölçüyle seçildi, göz kararıyla değil:

- `--text-muted`: açık `#78808f` → `#656d7e` (4,55–5,20), koyu `#6d7788` →
  `#8b95a6` (5,65–6,39). Hâlâ ikincil görünüyor.
- Anlam renkleri koyulaştırıldı (`#0f8a5f` → `#0a7a53` gibi); hem kendi rozet
  zemininde hem yüzeyde geçiyor, renk kimliği bozulmuyor.
- Koyu temada birincil düğme: accent PARLAK olduğu için beyaz metin 3,13
  veriyordu. Accent'i karartmak yerine (bağlantılar ve grafik çizgileri de onu
  kullanıyor) **metin rengi** tokenlaştırıldı: `--accent-on` koyu temada koyu
  metin → 6,16.
- Metin olarak kullanılan accent'ler `--accent-text`e çevrildi. İlginç olan:
  bu token ZATEN VARDI, üç yerde kullanılmamıştı.

Ölçüm kalıcı: `e2e/kontrast.spec.ts` dokuz ekranı **iki temada** da denetliyor
(18 test). Eşiğin altına düşen tek bir metin CI'yı kırıyor.

## Yazdırma: koyu tema kâğıda taşıyordu

Rapor ekranının "Yazdır / PDF" düğmesi Faz 6'dan beri duruyordu ama **çıktıya
hiç bakılmamıştı.** Bakılınca açık temada iş görüyordu: gezinti rayı, üst
çubuk ve araç çubuğu gizli, tek sayfa, tablolar bölünmüyor.

**Koyu temada ise rapor koyu çıkıyordu** — zemin `#0b0e14`, metin açık gri.
Yazıcı arka planları basmıyorsa beyaz kâğıtta açık gri metin (okunmaz);
basıyorsa sayfa dolusu mürekkep. Ekranın teması kâğıdın işi değil.

`@media print` içinde **açık palet zorlanıyor**: yüzeyler beyaz, metin koyu,
anlam renkleri kâğıtta okunur tonlarda.

### Yol boyunca: özgüllük tuzağı

İlk deneme işe yaramadı ve nedeni öğreticiydi: sistem koyu teması
`:root:not([data-theme='light'])` ile tanımlı (özgüllük 0,2,0); yazdırma
bloğunda yalnızca `:root` yazmak (0,1,0) yetmiyor, kural sessizce eziliyordu.
Aynı şekli tekrarlayınca (`:root:not([data-theme='light'])`) özgüllük eşitlendi
ve sıra bizde olduğu için kazandı. Ölçmeden "düzeltildi" demek burada kolay
olurdu — tarayıcıda bakınca hâlâ koyuydu.

Bu arada raporun temel göstergeler tablosunda İngilizce biçimde kalmış
yüzdeler (`-3.0%`) ve oranlar (`3.43`) da görüldü; onlar da Türkçe biçime
çevrildi.

Uçtan uca teste bağlandı: koyu tema açıkken yazdırma ortamında sayfa zemini
beyaz, metin koyu ve gezinti öğeleri gizli olmalı.

## Koyu temaya gözle bakmak

Kontrast ölçüldü ama ekranlara koyu temada **bakılmamıştı.** Ekran
görüntüleriyle bakınca iki görsel kusur çıktı — ikisi de ölçümle değil, gözle
görülür:

1. **"Ulaştırma Tara"** — sektör satırındaki tarama eylemi ghost düğme olarak
   sektör adının yanına düz metin gibi oturuyordu; iki kelime gibi okunuyordu.
   Çerçeveli küçük bir çip oldu: tıklanabilir olduğunu kendi başına söylüyor.
2. **Akış sütunu satır yüksekliğini bozuyordu.** Çubuğun genişliği hücreye
   göreydi; %70'i geçen sektörlerde sayı alt satıra kayıyor ve o satır
   ötekilerden yüksek duruyordu. Çubuk artık sabit genişlikte bir rayın
   içinde; on bir satırın yüksekliği de 35 px.

Grafik renkleri de ölçüldü (WCAG 1.4.11 metin dışı öğelerde 3:1 ister):
EMA 50 açık temada 4,54 · koyu temada 6,16; EMA 200 6,15 · 8,71. Hepsi
geçiyor, değişiklik gerekmedi.

### Türkçe biçim: gözle bakınca kaçanlar çıktı

Bir önceki turda "ekranlarda İngilizce biçimde tek bir yüzde kalmadı" demiştim
— doğruydu ama **eksikti**: yalnızca yüzdeleri taramıştım. Portföy ekranına
işlem ekleyip bakınca aynı tabloda `18.24` (ondalık nokta) ile `39.818`
(binlik nokta) yan yana duruyordu. Yani asıl karışıklık riski hâlâ oradaydı.

Bu kez tarama ondalık NOKTAYA göre yapıldı ve dokuz ekran tek tek geçildi:

| Ekran         | Kalan                                    |
| ------------- | ---------------------------------------- |
| Portföy       | fiyat, ort. maliyet, kur, etkin pozisyon |
| Tarayıcı      | oran (`1.40×`), seviye (RSI/ADX)         |
| Nabız, Sektör | `16.6 mlr`, `3.1 mlr` kısaltmaları       |
| Sembol Masası | `13.0 yıl`, dört haneli fiyatlar         |
| Model         | bariyer katı `±1.5σ`                     |

Hepsi çevrildi; `Stat` bileşeninin delta rozeti de (Portföy'de `+487.71%`
yazıyordu) ortak biçimlendiriciye bağlandı.

İki okuma kusuru daha: **"En büyük pozisyon +%95"** — pay bir getiri değil,
artı işareti onu kazanç gibi gösteriyordu; işaretsiz oldu. Tarih alanının
`09/14/2026` görünmesi ise kusur değil: `<input type="date">` tarayıcı diline
göre biçimlenir, Türkçe tarayıcıda `14.09.2026` çıkıyor (ölçüldü).

### Elle tarama iki kez eksik kaldı → teste taşındı

Aynı işi iki turda iki kez elle yaptım ve ikisinde de bir şeyler kaçtı. Yeni
bir kart eklenince üçüncüsü de kaçardı. `e2e/bicim.spec.ts` sekiz ekranda iki
kuralı denetliyor: ondalık ayırıcı nokta olmamalı, yüzde işareti sayıdan önce
gelmeli.

Denetimi yazarken **ölçütün kendisi iki kez yanlış alarm verdi** — ikisi de
kaydedilmeye değer:

- Türkçe binlik ayırıcı (`39.818`) ve tarih (`14.09.2026`) ondalık nokta
  sanılıyordu. Kalıp, önünde/ardında nokta ya da rakam olmayan `12.3`
  biçimine daraltıldı.
- Doğru yazılmış iki yüzde yan yana gelince (`-%2,37 %18`) aradaki `7 %`
  parçası "sondan yüzde" sanılıyordu. İşaretin ardından rakam geliyorsa o
  zaten bir sonraki sayının başıdır.

Testin gerçekten koruduğu kanıtlandı: tarayıcıdaki bir biçim bilerek
bozulunca kırılıyor, geri alınınca geçiyor.

## Eski arayüz: neyi düzeltip neyi düzeltmediğim

İki arayüz artık birbirine bağlı olduğu için yayındaki uygulamaya da aynı
gözle bakıldı.

**Düzeltilen** (ucuz, riski yok, kullanıcıyı doğrudan etkiliyor):

- `prefers-reduced-motion` hiç onurlandırılmıyordu. İki sonsuz animasyon var
  (canlı veri noktasının nabzı, yükleniyor çarkı) ve hareket duyarlılığı olan
  kullanıcı için bunlar rahatsız edici. Yeni kabukta kural zaten vardı; aynı
  kullanıcı iki arayüzde iki farklı davranış görüyordu. Ölçüldü: tercih açıkken
  nabız süresi 1,4 sn → 0,00001 sn.
- (Daha önce) depolama kapalıyken boş sayfa, yakınlaştırma engeli, favicon 404.

**Düzeltilmeyen — bilinçli:**

Eski arayüzün sayıları İngilizce biçimde (`47.60`, `-4.2%`, `0.27%`). Yeni
kabukta bu Türkçeye çevrildi ama eskide **101 ayrı `toFixed` çağrısı** var ve
o katmanın test kapsamı düşük. Kısmî çevirme daha kötü olurdu: uygulamanın
kendi içinde tutarsız olması, baştan sona İngilizce olmasından beterdir.

Karar: eski arayüz **çalışır ve erişilebilir** tutuluyor (çöken, engelleyen,
yanıltan kusurlar düzeltiliyor); kozmetik hizalama yeni kabuğa yatırılıyor —
çünkü asıl ürün o. Bu bir eksik, gizlenmiyor: PR'ın "bilinen sınırlar"
listesinde yazıyor.

## Hesap bitti ama kimse söylemiyordu (WCAG 4.1.3)

Ölçüm: dokuz ekranda, "sonuç hazır" bilgisi taşıyan her metin bulundu ve
canlı bölge (`role="status"` / `aria-live`) içinde olup olmadığına bakıldı.

```
nabiz        → "200 sembol · worker 15 ms"                DUYURULMUYOR
tarayici     → "96 / 200 sembol"                          DUYURULMUYOR
             → "200 sembol × 250 bar · worker 34 ms"      DUYURULMUYOR
karsilastir  → "200 sembol · 200 küme · worker 93 ms"     DUYURULMUYOR
laboratuvar  → "worker 22 ms"                             DUYURULMUYOR
```

Hiçbiri değildi. Gören kullanıcı tablonun dolduğunu görüyor; ekran okuyucu
kullanıcısı için **hiçbir şey olmuyor**. Odak değişmediği için başka bir
duyuru da tetiklenmiyor. En kötüsü Stratejiler ve Model: saniyeler süren
hesapların sonunda "bitti mi, dondu mu?" sorusunun cevabı yok.

**Neden görünür durum şeridini canlı bölgeye çevirmedim:** o şerit köken
notunu, temel veri rozetini ve süreyi de taşıyor; her filtre değişiminde
tamamı okunurdu. Bunun yerine tek cümlelik, görünmez bir bölge eklendi
(`src/shell/Announce.tsx`) ve yalnızca sonuç oturduğunda yazılıyor.

Tarayıcıdaki eşik alanları her adımda yeni bir sayı ürettiği için duyuru
**gecikmeli**: `delay` boyunca değişmeyen ilk mesaj yayımlanıyor, ara
sonuçlar okunmuyor.

Dokuz ekranın dokuzu da artık duyuruyor; sekizi uçtan uca testle bağlandı
(Portföy'ünki birim testiyle — boş portföyde duyurulacak bir sonuç yok):

```
nabiz        → Piyasa nabzı hazır: 200 sembol, 101 yükselen, 99 düşen.
sembol       → X001 hazır: 3400 bar.
tarayici     → Tarama tamamlandı: 200 sembolden 96 tanesi ölçütlere uyuyor.
karsilastir  → Korelasyon hazır: 200 sembol, 200 küme.
laboratuvar  → Backtest tamamlandı: 27 işlem.
stratejiler  → Strateji sıralaması hazır: 8 strateji, 200 sembol.
model        → Model eğitimi tamamlandı. Hüküm: kullanma.
rapor        → X001 raporu hazır: 3400 bar.
portfoy      → Portföy değerlemesi hazır: 1 pozisyon.
```

### Yol boyunca: Portföy saniyede 228 istek atıyordu

Portföy'e duyuru eklerken mesaj hiç yayımlanmadı: `loading` sonsuza kadar
açık kalıyordu. Nedeni aranınca çok daha ciddi bir kusur çıktı.

Efekt, açık pozisyonların serisini indiriyor ve sonucu `setSeries` ile
yazıyordu. Bağımlılıklarında `series` var. İstek **başarısız** olduğunda da
`setSeries` yeni bir nesneyle çağrılıyordu → `series` kimliği değişiyor →
efekt yeniden koşuyor → eksik sembol hâlâ eksik → yeniden istek… Kapanmayan
bir döngü.

Ölçüldü (serisi indirilemeyen tek bir pozisyon, 8 saniye):

|       | X001.bin isteği | "Fiyatlar yükleniyor…" |
| ----- | --------------- | ---------------------- |
| Önce  | **1.827**       | hâlâ açık              |
| Sonra | 1               | kapandı                |

Saniyede ~228 istek. Zayıf makinede ve mobil veride bu yalnızca yavaşlık
değil, kotanın yenmesi demek. Kullanıcının gördüğü tek belirti "Fiyatlar
yükleniyor…" rozetinin hiç kaybolmamasıydı — sessiz başarısızlığın bir
başka yüzü.

Üç ayrı düzeltme:

1. **Başarısız `piyasa:sembol` anahtarları işaretleniyor** (`failed` ref) —
   döngüyü kapatan şey bu. Aynı sembol ikinci kez istenmiyor.
2. **`loading` bayrağı yerine süren istek SAYACI.** Bayrağın `false`'a
   dönüşü `cancelled` kontrolüne bağlıydı; efekt kendi `setSeries`'i
   yüzünden yeniden koştuğunda temizlik `cancelled`'ı true yapıyor ve
   `setLoading(false)` hiç çalışmayabiliyordu. Sayaçta her artışın tam bir
   azalışı var; yarışa kapalı.
3. **Seri önbelleği piyasaya bağlandı.** Anahtar yalnızca semboldü ve piyasa
   değişince sıfırlanmıyordu: aynı koda sahip bir sembolün BAŞKA piyasadaki
   serisi değerlemeye girebilirdi.

Üçü de teste bağlandı. Düzeltme geri alındığında birim test takımı
**hiç bitmiyor** (döngü jsdom'da da kuruluyor) — kusurun kendisi kadar net
bir kanıt.

### Uzun oturumda bellek: sızıntı yok

Duyuru işi bittikten sonra aynı gözle belleğe bakıldı, çünkü "zayıf
makinede akıcı" iddiası uzun oturumu da kapsıyor.

| Senaryo                         | Yığın          | Düğüm     | Dinleyici |
| ------------------------------- | -------------- | --------- | --------- |
| 9 ekran × 14 tur (126 geçiş)    | 5,20 → 6,70 MB | 417 → 417 | 184 → 184 |
| 19 sembol × 8 tur (152 değişim) | 4,24 → 4,38 MB | 242 → 242 | 191 → 191 |

Yığın artışı son turlarda duruyor (11 → 14. tur arası toplam +0,04 MB):
sızıntı değil, ısınma ve önbellek. Düğüm ve dinleyici sayısı **tam olarak**
sabit — grafik `remove()`, `ResizeObserver` `disconnect()` ve tema
dinleyicisi temizlikleri çalışıyor. Düzeltilecek bir şey çıkmadı; ölçüm
`docs/plan/performans.md`'ye eklendi.

## "Gecikmeli veri" rozeti hiçbir şey söylemiyordu

Üst çubuktaki rozet **sabit metindi**: veri bir gün de bir yıl da eski olsa
aynı üç kelime. Tazelik ölçüsü aslında vardı — `health.ts` `staleWeekdays`
hesaplıyor ve "veri bayat olabilir" bulgusu üretiyor — ama bu yalnızca
SEMBOL bazlı iki ekrana (Sembol Masası, Rapor) ulaşıyordu.

Ölçüldü, dokuz ekranda, rozetin metni ve başlığı okunarak:

```
nabiz … rapor   rozet: "Gecikmeli veri"   (hepsinde aynı, bilgi yok)
veri yaşı bilgisi VAR : sembol, rapor     (2/9)
veri yaşı bilgisi YOK : diğer yedisi
```

Aynı anda manifest okundu: örnek veri setinin **en yeni barı 2025-09-28**,
"bugün" 2026-09-14. Yani Nabız ekranı _"Piyasada bugün ne oluyor?"_ başlığı
altında **251 iş günü eski** veri gösteriyor ve bunu hiçbir yerde
söylemiyordu. Bir finans aracında bu, yanlış sayı göstermenin bir adım
gerisindeki kusurdur: sayılar doğru, ama hangi tarihe ait olduğu gizli.

Rozet ölçülen hâline çevrildi (`core/data/freshness.ts`, saf; "bugün"
çağırandan gelir):

| Durum     | Eşik (hafta içi gün) | Rozet                             |
| --------- | -------------------- | --------------------------------- |
| taze      | ≤ 1                  | `Veri 14 Eyl 2026` (yeşil)        |
| gecikmeli | ≤ 3                  | `Veri 11 Eyl 2026` (sarı)         |
| bayat     | > 3                  | `Veri 251 iş günü eski` (kırmızı) |

Üç karar:

- **En yeni bar alınıyor, ortanca değil.** Bir sembolün işlem görmemesi
  piyasanın tamamını bayat yapmaz; tersi de doğru — en yeni bar eskiyse
  daha yenisi yoktur, yani ölçü iyimser tarafta yanılmaz.
- **Hafta sonu bayatlık üretmiyor.** Cuma kapanışına pazartesi bakmak
  "3 gün eski" değildir; sayaç `weekdaysBetween` ile hafta içi gün sayıyor.
- **Yasal uyarı kaybolmadı.** "Veriler gecikmelidir; yatırım tavsiyesi
  değildir" her durumda rozetin başlığında; bayat durumda başlık ayrıca
  "ekrandaki tüm hesaplar bu tarihe aittir, bugüne değil" diyor.

Manifest zaten oturumda bir kez iniyor (istemci onu bilerek
önbelleklemiyor — tazelik ölçüsü odur), yani rozet ek ağ maliyeti
getirmiyor. Dokuz ekranın dokuzu da artık aynı gerçek yaşı gösteriyor;
uçtan uca test hem sabit metnin geri gelmesini hem de ekrandan ekrana
değişen bir cevabı kırıyor.

## Likidite: "hacim oranı" bunun yerine geçmiyordu

Tarayıcıda 26 filtrelenebilir metrik var (12 teknik + 14 temel) ve bunlardan
biri "hacim oranı". Ama o **göreli** bir ölçü: son bar hacmi ÷ son 20 barın
ortalaması, yani "bugün normale göre ne kadar". Günde 50 bin TL dönen bir
sembolde de 1,40× görülebilir.

Eksik olan **mutlak** eşikti. Kullanıcının işi "kriterlerime uyan hisseleri
bul" değil, "uygulayabileceğim bir şey bul": taramanın ilk sırasındaki
sembolde emir geçemiyorsan orada bulunan strateji de bir şey ifade etmiyor.
Backtest aynı sembolde çalışıp güzel sayılar üretir — likidite varsayımı
sessizce yanlıştır.

`turnover` eklendi: son `volLookback` barın **kapanış × hacim** ortalaması,
yani günlük ortalama işlem değeri. Varsayılan sütun oldu, çünkü sonucun
uygulanabilir olup olmadığını söyleyen tek sayı bu.

Test, iki ölçünün ayrıştığını gösteriyor: aynı hacim oranına (2,00×) sahip
iki sembolün işlem değerleri arasında **dört büyüklük mertebesi** olabiliyor.

### Yol boyunca: ikinci bir biçim kopyası doğmak üzereydi

Nabız ekranının içinde yerel bir kısaltma fonksiyonu vardı (`16,6 mlr`).
Tarayıcıya işlem değeri sütunu gelince ikincisi gerekecekti — iki kopya iki
farklı eşik demektir ve bu dosyada daha önce Türkçe biçim tam da bu yüzden
tek kaynağa toplanmıştı. `trCompact` `ui/format.ts`'e taşındı.

Taşırken yerel kopyada bir kusur çıktı: **negatif değerde kısaltmayı
atlıyordu** (`-2.450.000` → "-2.450.000", oysa pozitifi "2,5 mn"). Para akışı
farkı gibi işaretli bir değer o sütuna girdiğinde aynı sütunda iki ayrı biçim
görünürdü. Ortak sürümde işaret ayrılıp mutlak değer kısaltılıyor; test
negatif eşikleri de kapsıyor.

## Önizleme yayını ve iki turda kapanmayan bir kusur

Yeni kabuk yalnızca yerelde görülebiliyordu; kökteki Pages yayını main'den
gelen eski arayüz. Dalı kökü ezmeden yayımlamak için ayrı bir iş akışı
(`onizleme.yml`): uygulama `onizleme/` altına kuruluyor, veri kökteki TEK
kopyadan okunuyor (`VITE_DATA_BASE`). İkinci bir kopya ~29 MB yer kaplar ve
iki kopya farklı zamanlarda tazelenip birbirini tutmazdı.

Yayındaki veri gerçek: **655 sembol, en yeni bar 11 Eyl 2026**, paket 3,3 MB.

### Aynı kusuru iki kez "düzelttim"

İlk çalıştırma yayımlandı ama finansal veri gelmedi. Neden: ~660 sembolün
bilançosu tek tek indiriliyor ve adım 8 dakikada kesiliyor.

**Birinci düzeltme** — kaldığı yerden devam (diskte dosyası olan sembol
atlanıyor) ve anlık görüntüyü diskteki her şeyden kurmak. İkisi de doğruydu,
ikisi de teste bağlandı. Sonraki çalıştırmada sembol dosyaları gerçekten
ilerledi (A1CAP…ALVES).

**Ama `snapshot.json` yine yazılmadı.** Çünkü düzeltmeyi yine **döngüden
SONRA** koymuştum: adım zaman sınırında ÖLDÜRÜLÜYOR, döngüden sonrası hiç
çalışmıyor. Taramanın okuduğu tek dosya o olduğu için, yapılan onca iş
kullanıcıya yine ulaşmadı — ekranda yine "temel veri yok" yazdı.

**İkinci düzeltme**: anlık görüntü artık her 25 sembolde bir yazılıyor.
Kesilme nerede olursa olsun diskte geçerli bir anlık görüntü kalıyor.

Bu kez teste bağlanan şey "diskten kurulma" değil, **kesilmenin kendisi**:
sahte bir indirici üçüncü sembolde `KeyboardInterrupt` atıyor, test
`snapshot.json`'ın yine de var olmasını ve ilk iki sembolü taşımasını
istiyor. Ara kayıt kaldırıldığında test kırılıyor, geri konduğunda geçiyor —
kanıtlandı.

**Üçüncü tur — ve asıl sebep.** Ara kayıt eklendi, yine olmadı. İş
kaydının son satırı sebebi söyledi:

```
Cleaning up orphan processes
Terminate orphan process: pid (2132) (python)
```

`timeout-minutes` **süreci öldürmüyor.** Adımın kabuğunu kesip "tamamlandı"
diyor, python öksüz süreç olarak çalışmaya devam ediyor; runner onu ancak
işin en sonunda topluyor. Yani zaman sınırı işi durdurmadı, yalnızca
_beklemeyi_ bıraktı — ve sonraki adımlar hâlâ dosya yazan bir süreçle
YARIŞTI. Yayımlama o anki yarım klasörü kopyaladı, anlık görüntü yazımı o
ana yetişmedi.

**Üçüncü düzeltme**: süreyi adım değil **betiğin kendisi** sınırlıyor
(`--max-seconds` / `FUND_MAX_SECONDS`). Döngü süresi dolunca temiz duruyor
ve durmadan önce anlık görüntüyü yazıyor; adımdaki sınır artık yalnızca
emniyet freni. Testi sahte saatle yapılıyor: her sembol 10 "saniye" sürüyor,
bütçe 25 saniye, üç sembolden sonra durması ve anlık görüntüde tam o üçünün
bulunması bekleniyor.

Ders üç turda üç kere aynı yerden geldi: **"düzelttim" demek için işin
kullanıcıya ulaştığını görmek gerekiyor.** Sırasıyla yanlış olan şeyler —
kaldığı yerden devam etmemek, yazmayı döngüden sonraya koymak, ve sürecin
gerçekten durduğunu varsaymak. Üçü de "mantıken doğru" görünüyordu.

Bu turda "düzeltildi" demeden önce yayındaki dosyaya bakıldı:

```
data/bist/fundamentals/snapshot.json → 50 sembol, 14 Eyl 2026 13:20 üretim
```

### Kapsam neden yavaş ilerliyor

Mekanizma çalışıyor ama 655 sembolün yalnızca %7,6'sı var. Sebep kaynağın
istek deseni: kütüphane sembol başına **yıl yıl** istek atıyor
(`year1=2015…`, `year2=2016…`), yani 2015–2026 için sembol başına 12 istek,
~15–30 saniye. Sembol listesi vermek istek sayısını azaltmıyor — döngüyü
yalnızca kütüphanenin içine taşıyor (kaynağın uç noktası tek sembol alıyor).

Çözüm hız değil, bütçe ayrımı: her push'ta 7 dakika (ucuz, artımlı),
**elle tetiklenen** çalıştırmada 25 dakika. Betik kaldığı yerden devam
ettiği için ikisi aynı listeyi ilerletiyor; birikmiş liste birkaç elle
çalıştırmayla kapanıyor.

Yıl aralığını daraltmak akla geliyor ama ölçünce **yanlış** çıktı: finansal
panel yıllık (`/12`) dönemleri grafikliyor ve tüm geçmişi çiziyor; 2015
yerine 2021'den başlamak ciro grafiğini 11 noktadan 5 noktaya düşürürdü.
Kullanıcıya görünen bir şeyi hız için kısaltmıyorum.

İki fazlı çekim de tartıldı (önce son yıllar → anlık görüntü hızla dolsun,
geçmiş sonra). Kazanç gerçek, ama bedeli iki parçalı finansal kaydı
birleştirme mantığı — yani sessiz bir hatanın **yanlış bilançoyu doğruymuş
gibi** göstereceği tek yer. Bu projenin tüm disiplini "savunamadığın sayıyı
gösterme" üzerine kurulu; hız için oraya risk konmadı.

### Sürekli başarısız sembol her turda yeniden deneniyordu

Turlar arası hız düştü: +38 sembol (25 dk) → +17 sembol (25 dk). Hipotez,
başarısız sembollerin birikip her turda baştan denenmesiydi. Ölçüldü:

```
alfabetik sınır DIRIT → sıra 135
yazılan dosya        → 124
hiç alınamayan       →  11  (%8)
```

Hipotez **kısmen** doğruydu: büyüyen bir yığın yok, 11 sembol var. Ama bir
başarısızlık ucuz değil — 12 yıl isteğinin hepsi yeniden denenip zaman
aşımına uğruyor, ve bu 25 dakikalık bütçenin ciddi bir kısmını yiyor
olabilir. Hız düşüşünün tamamını buna bağlayamam (kaynağın kendi hızı da
değişiyor olabilir, kanıtlamadım), ama sürekli başarısız olan bir sembolü
her turda yeniden denemek **maliyeti ne olursa olsun yanlış**.

Artık başarısızlıklar `failures.json`'da sayılıyor; üç denemede alınamayan
sembol listeden düşüyor, başarılı bir çekim sayacı sıfırlıyor, `FORCE_ALL`
hepsini geri getiriyor (kaynak düzelmiş olabilir). Sayaç başarısızlık
anında diske yazılıyor: süre dolup kesilsek bile bir sonraki tur aynı
sembole aynı süreyi harcamıyor.

Not: hedef sembol sayısı **607** (fiyat manifestindeki 655 değil; ikisi
farklı listeler).

### Hipotez bir sonraki ölçümde çürüdü

Düzeltmeden sonraki ilk tur (7 dakikalık push bütçesi) **+21 sembol** ekledi
— sembol başına 20 saniye, bir önceki turun 88 saniyesinin dörtte biri. Ama
o turda hiçbir sembol ATLANMAMIŞTI: `failures.json`'daki sayaçların hepsi
1'di, yani 12 başarısızın tamamı yine denendi.

Yani hız düşüşünün açıklaması benim hipotezim değildi; **kaynağın kendi
hızı değişiyor**. Bir önceki turda "kısmen doğru" demiştim, bu ölçümden
sonra dürüst hâli şu: hipotez yanlıştı. Başarısızları atlamak yine de
doğru bir düzeltme — ama bu hızlanmayı o sağlamadı ve öyleymiş gibi
yazılmamalı.

### Asıl kusur: tablo şablonu tek denemede bırakılıyordu

Başarısız listesine bakınca kategori çıktı: AGESA, AKBNK, AKGRT, ALBRK,
ANHYT — bankalar ve sigortalar. Betik `financial_group`'u elle tutulan bir
`BANK_SYMBOLS` listesinden tahmin ediyordu ("bankaysa 2, değilse 1") ve
tahmin yanlış olduğunda veri HİÇ gelmiyordu:

- AKBNK ve ALBRK listede, yani "2" deneniyor — gelmiyor.
- AGESA, AKGRT, ANHYT sigorta, listede değil, yani "1" deneniyor — gelmiyor.

BIST'te finans sektörü piyasa değerinin büyük kısmı; tarayıcının temel
filtrelerinde bankaların hiç olmaması gerçek bir boşluk.

Artık üç şablon da sırayla deneniyor (`group_order`); elle tutulan liste
bir tahmin değil yalnızca SIRALAMA ipucu. Bir şablon boş tablo döndürürse
sıradakine geçiliyor. Test sahte bir kaynakla üçüncü şablonda bulmayı ve
sıranın doğru olmasını sınıyor.

**Sonuç ölçüldü — yarısı tuttu.**

|                                         | Önce      | Sonra              |
| --------------------------------------- | --------- | ------------------ |
| Sigortalar (AGESA, AKGRT, ANHYT, ANSGR) | başarısız | anlık görüntüde    |
| Bankalar (AKBNK, ALBRK)                 | başarısız | **hâlâ başarısız** |
| Başarısız kayıt                         | 12        | 8                  |

Kayıt, banka sorununun şablon OLMADIĞINI söyledi:

```
[fund] AKBNK: grup 2 boş döndü, sıradaki şablon
[fund] AKBNK: grup 3 boş döndü, sıradaki şablon
[fund] AKBNK: grup 1 çekilemedi (No financial data was fetched…)
```

"Boş döndü" = tablo GELİYOR ama `extract` tanıdığı hiçbir kalemi bulamıyor.
Yani eksik olan şey `FIELD_ITEMS`'taki satır adları: banka bilançosu başka
adlar kullanıyor. Hangi adlar olduğunu tahmin etmek yerine betiğe kendi
teşhisini bastırdım — şablon uymadığında gelen ilk 15 kalem adı kayda
yazılıyor. Bir sonraki tur hangi adın ekleneceğini söyleyecek.

Aynı kayıt hızın asıl suçlusunu da verdi: `Read timed out. (read
timeout=10)` uyarıları dönem dönem tekrarlanıyor. O turda 5 sembol /
420 saniye işlendi ve üçü başarısızdı — yani başarısızları atlamak,
ilk tahminimden çok daha değerli bir düzeltmeymiş.

## Üç alan boştu; ikisi kusur, biri gerçek yokluk (15 Eylül 2026)

Yayımlanan 561 sembolün TAMAMINI taradım. On bir alan %96–100 dolu, üç alan
tamamen boştu: `currentAssets`, `operatingCashFlow`, `capex`. İkisi ürüne
doğrudan yansıyordu — "Nakde dönüşüm" kartı her şirkette boş ve "Cari oran"
süzgeci (radar + tarayıcı) hiçbir sonuç veremiyordu. Kullanıcı o ölçütle bir
tarama kurup sessizce sıfır satır alıyordu.

Doğru kalem adını TAHMİN ETMEDİM. Teşhis zaten vardı ama stderr'e basıyordu
ve iş kaydı dört yüz satır, satır da kaydın başında. Teşhis
`fundamentals/_tani.json` olarak yayımlanır hâle getirildi: alan başına kaç
sembolde dolu olduğu ve eksik alanlar için kaynakta görülen ilgili kalem
adları. Cevap bir turda geldi ve iki farklı arıza olduğunu söyledi.

**`currentAssets` — Türkçe küçültme tuzağı.** Kaynak o satırı "Dönen
Varlıklar" diye gönderiyor; `normalize()` düz `.lower()` kullanıyordu:

    "DÖNEN VARLIKLAR".lower() → "dönen varliklar"   (noktalı i)
    "Dönen Varlıklar".lower() → "dönen varlıklar"   (noktasız ı)

Eşit değiller. Tuzak bu dosyada ZATEN belgelenmişti — ama yalnızca teşhis
yolunda (`fold`); eşleşme yolu güncellenmemişti. `currentLiabilities` tuzağa
düşmemişti çünkü listede iki yazım da vardı, yani kusur "her ada iki yazım
eklemeyi unutmak" ile gizleniyordu.

**`operatingCashFlow` ve `capex` — VAR, ama başka adla.** Bu satırda önce
"gerçekten yok" yazıyordu ve YANLIŞTI. Sonucu kendi teşhisimin kapağından
çıkarmışım: aday adlar satır sırasıyla taranıp alan başına on ikide
kesiliyordu ve bilanço satırları önce geldiği için kapak nakit akış
satırlarına hiç ulaşmıyordu.

Cevapta bir `FINANCIAL_ITEM_CODE` sütunu olduğunu, aynı uç noktayı kullanan
borsapy'nin kaynağından öğrendim (nakit akışını `itemCode` öneki "4" ile
süzüyor). Teşhis o soruyu sorunca 25 nakit akış satırı geldi:

    4C    İşletme Faaliyetlerinden Kaynaklanan Net Nakit
    4CAI  Sabit Sermaye Yatırımları

Listemizde "İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI" aranıyordu; kaynak
"…Kaynaklanan Net Nakit" diyor. Eşleşme artık ÖNCE KODA bakıyor — ad kararsız
(şablona, yazıma, sürüme göre değişiyor), kod kararlı. Kod sütunu olmayan
şablonda ada düşülüyor.

ÖLÇÜLEN SONUÇ: v5 kuralıyla çekilen 152 sembolün 145'inde (%95,4) nakit akışı
dolu; kalan 408 sembol henüz tazelenmedi (tur 45 dakikalık bütçesine takıldı)
ve sıradaki turlar kaldığı yerden devam ediyor.

**Üçüncü kusur: zorlamalı tazeleme yakınsamıyordu.** `force_all` her turda
aynı sırayla tüm sembolleri veriyordu; bütçe 559'un yarısına yetiyor ve her
tur baştan başlıyor, yani kuyruk hiç tazelenmiyordu. Üreticide yapılan hiçbir
düzeltme mevcut verinin yarısına ulaşamazdı — bu düzeltme dahil. Kayıtlara
`fetched` damgası eklendi, tazeleme en eskiden başlıyor.

ÖLÇÜLEN SONUÇ (zorlamalı tazeleme sonrası, 559 sembol):

|                          | önce | sonra                      |
| ------------------------ | ---- | -------------------------- |
| `currentAssets` dolu     | 0    | **540**                    |
| Cari oran hesaplanabilir | %0   | **%96,6**                  |
| Medyan cari oran         | —    | 1,43                       |
| `operatingCashFlow` dolu | 0    | tazelenenlerin **%95,4**'ü |

Kalan semboller banka ve benzeri: bilançolarında dönen/duran ayrımı yok.

### Ortak ders

Bu dört kusur birbirini gizliyordu ve üçü aynı kalıptan çıktı: **bir aracın
"bulamadım"ı, "yok" demek değildir.** Aynı oturumda üç kez düştüm — kaydırma
ölçümü yapılmamış bir ölçümün güzel sayısını raporluyordu, ölçüm aracı gerçek
veride hiç çalışmıyordu, teşhis kapağı "nakit akış satırı yok" gibi okundu.
Her seferinde doğru hamle cevabı değil ARACI sorgulamak oldu.

DÖRDÜNCÜ KEZ, aynı oturumda: `npm run preview` önceden derlenmiş `dist/`'i
sunuyor ve `reuseExistingServer` ile ayakta olanı yeniden kullanıyor. Kaynağı
değiştirip uçtan uca test koşmak paketi tazelemiyor. "Düzelttim ama test hâlâ
kırmızı" diye birkaç tur bayat derlemeyi ölçtüm; kaynağa iz düşüp izlerin
HEPSİNİN sıfır çıkması uyandırdı. Kaynak değiştiyse `npm run build` şart.

## Nakit akışı: 0 → 540 (kapandı)

İki kusur daha çıktı ve ikisi de aynı kalıptandı — bir yargı, kural
değişiminin denenmesini engelliyordu.

**Artımlı tur eski kuralla yazılmış kaydı hiç ziyaret etmiyordu.** Tek ölçüt
"dosya var mı" idi ve sembol kaydında sürüm yazmıyordu; düzeltme yalnızca
`FORCE_ALL` ile ve onun bütçesi kadar yayılıyordu. Ölçüm, çekilme damgasına
göre ayırdı: 09:33'te yazılan 70 sembolün %0'ında, 11:20 sonrasının
%93-100'ünde nakit akışı vardı. Eksikler alfabenin kuyruğunda kümelenmişti —
gerçek bir veri sınırı alfabetik kümelenmez. `EXTRACT_VERSION` artık kayda da
yazılıyor (diske yazan TEK noktada) ve sürümü tutmayan kayıt bayat sayılıyor.
Sıralama da düzeltildi: artımlı yol da en eski tazelenen kaydı önce alıyor,
yoksa bütçe zaten güncel olan baştaki kayıtlara gidiyordu.

**Atlama listesi eski kaydı veto ediyordu.** Kalan 11 sembol hem "kaynak tablo
yayımlamıyor" listesindeydi hem de kendi kaydında 12 alanın 10'u doluydu; yargı
onlar için olgusal olarak yanlıştı. Sürümü artırmak da kurtarmazdı — listeye
zaten v5 altında girmişlerdi. Artık liste yalnızca KAYDI OLMAYAN sembolü veto
ediyor; veri taşıyan eski kayıt listeyi bir kez deliyor ve damgayı alınca bir
daha geçmiyor.

ÖLÇÜLEN SONUÇ (yayındaki veri, 559 sembol):

|                          | önce | sonra   |
| ------------------------ | ---- | ------- |
| `operatingCashFlow` dolu | 0    | **540** |
| `capex` dolu             | 0    | **540** |
| v5 ile yazılmış kayıt    | —    | 559/559 |
| sanayi şablonunda boşluk | —    | **0**   |

Kalan 19 YAPISAL: 12 banka + 5 sigorta + 2 sınıfsız, hepsi şablon grubu 2 ve 3. O şablonlar nakit akış tablosu vermiyor — kaynak sınırı, kod sınırı değil.
`operatingCashFlow` artık `currentAssets` ile aynı seviyede (540), yani
bilançosu olan her şirkette nakit akışı da var.

## Katman panelleri kaydırılamıyordu

Filtre paneli ve sütun listesi aşağı kaydırılamıyor, her kaydırışta başa
sarıyordu. Yerleştirme, doğal yüksekliği ölçmek için sınırı bir an
kaldırıyordu; sınır kalkınca taşma da kalkıyor ve tarayıcı `scrollTop`'u 0'a
KENETLİYOR. Değeri elle geri yazmak yetmedi (denendi) — düzen o anda yeniden
hesaplanmadığı için yazılan değer de kenetleniyor. Çözüm panele hiç
dokunmamak: `scrollHeight` aynı bilgiyi zaten veriyor.

Denetimdeki kör nokta buydu: testler panelin ekrana SIĞDIĞINI ölçüyordu ve
sığdırmanın yolu "yüksekliği sınırla, içeriği kaydırılabilir yap" — ama
kaydırmanın GERÇEKTEN çalıştığını hiçbir test ölçmüyordu. **"Sığıyor" ile
"kullanılabiliyor" aynı şey değil.**

## Strateji sunumu gerçek veride denetlendi

Döngü hedefinin "en doğru stratejilere sunan" ayağı, yayındaki gerçek veriyle
uçtan uca denetlendi.

ÖLÇÜM — yayındaki piyasa taraması (651 sembol, tam geçmiş, 27 strateji):

|                         | en iyi                                       |
| ----------------------- | -------------------------------------------- |
| yenme oranı             | **%47,9** (yani yarıdan AZ sembolde yeniyor) |
| medyan yıllık           | %26,3 · al-tut ortalaması %36,1              |
| al-tut'u yenen strateji | **0 / 27**                                   |

SUNUM DÜRÜST ÇIKTI. Ekran gerçek veride şunu yazıyor:

> 15 ölçülebilen stratejinin **hiçbiri** al-tut'u istatistiksel olarak
> yenmiyor. En yüksek fark MACD 12/26/9 > Sinyal (+%2,6) ama düzeltilmiş
> p=0,986 — bu kadar kombinasyon denendiğinde bu fark şansla da çıkar.

Tablodaki hükümler de buna uyuyor: `belirsiz` ve `zayıf`, tek bir sahte
"anlamlı" yok; p sütunu Holm ile düzeltilmiş. Yani sıralı bir tablo gösterip
"işte kazandıran kurallar" izlenimi verilmiyor. Değişiklik gerekmedi.

### Bulunan boşluk: en güçlü kanıt arayüzde yok

`strategies.json` — 651 sembol × TAM GEÇMİŞ, 27 strateji — üretiliyor,
yayımlanıyor ve yalnızca ESKİ uygulama okuyor (`src/data/bistStatic.ts`).
Yeni kabuk onu hiç kullanmıyor; kendi hesabını yapıyor ve kapsamları şöyle:

- **Piyasa**: tüm semboller ama yalnızca son 250 bar (bir yıl),
- **Derin**: tam geçmiş ama en fazla **100** sembol.

Yani yeni arayüz, elindeki en güçlü kanıtı (651 sembol × tam geçmiş) hiçbir
kapsamda gösteremiyor — oysa o hesap zaten yapılmış ve veride duruyor.

BUNU KENDİ BAŞIMA BAĞLAMADIM ve sebebi bu deponun kendi tarihinde yazılı:
`strategies.json`'ı Python (`scripts/strategies.py`), kabuktaki tabloyu ise
TypeScript çekirdeği üretiyor. İki motoru aynı ekranda yan yana koymak, daha
önce yaşanan ve bir denetim turu gerektiren "ekranlar arası tutarsızlık"
kusurunun (X140'ın iki farklı pencereyle iki farklı getiri vermesi) tam
olarak aynı sınıfı. Doğru sıra: önce iki motorun aynı soruya aynı cevabı
verdiğini ÖLÇMEK, sonra bağlamak. Bu bir ürün kararı olduğu için kullanıcıya
bırakıldı.

## Sektör para akışı gerçek veride denetlendi

Döngü hedefinin son denetlenmemiş ayağı. Ekranın gösterdiği tablo çekilip
sayıları kendi içinde sınandı (yayındaki gerçek veri):

| kontrol                             | sonuç                            |
| ----------------------------------- | -------------------------------- |
| sektör satırı / sembol              | 28 / 582                         |
| payların toplamı                    | **%99,9** (yuvarlama farkı)      |
| pay = değer ÷ toplam tutmayan satır | **0**                            |
| sınıflandırılmamış                  | 42 sembol · 295,1 mn · **%0,13** |
| toplam işlem değeri                 | 220,9 mlr TL                     |

En büyük üç sektör: Kimya/Petrol/Plastik %16,7 · Banka %16,3 · Holding %11,7.

ÖNEMLİ OLAN SINIFLANDIRILMAMIŞ SATIRI: gizlenmiyor, kendi grubunda duruyor.
`flowBySector` bunu bilerek yapıyor — gizlenseydi toplam küçülür ve bütün
paylar sessizce şişerdi. Ölçüm bunu doğruluyor: payların toplamı %100 ve
sınıflandırılmamışın payı %0,13.

### Yine kendi aracıma kandım (beşinci)

İlk koşumda "28 satırın 28'i tutarsız" çıktı ve neredeyse öyle bildirecektim.
Sayılar saçmaydı — "en büyük" sektörler en küçükleri olarak listeleniyordu.
Sebep ayrıştırıcımdaydı: birim listeme `mlr` (milyar) yazmamıştım, o yüzden
"37,0 mlr" değeri 37 olarak okunuyordu. Uygulamada kusur yoktu.

Ders yine aynı: bir ölçüm aracının verdiği alarmı, aracın kendisini
sınamadan raporlamak, kusur uydurmaktır.

## Sırada

- Nakit akış tablosu banka/sigorta şablonunda yok; başka bir kaynak var mı.
- `strategies.json` (651 × tam geçmiş) yeni kabuğa bağlanacak mı — önce iki
  motorun uyumu ölçülmeli.
