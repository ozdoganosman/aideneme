# Kolonsal veri formatı (v1)

**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §4.2
**Durum:** uygulandı (Faz 2) — üretici `scripts/pack_data.py`, okuyucu `src/core/data/pack.ts`

## Neden

Bugünkü JSON, her barda anahtarları tekrar ediyor:

```json
{"t":1329696000,"o":2.42,"h":2.47,"l":2.4,"c":2.47,"v":27763824}
```

3.500 barlık bir sembol ≈ **370 KB**. Referans projede 603 sembol × bu = 143 MB;
tek bir hisseyi açmak 370 KB indirme + JSON.parse demek. Aynı veri kolonsal
ikili formatta **bar başına 24 bayt** tutuyor: 3.400 bar ≈ **82 KB**, ve
çözümleme `new Float64Array(...)` kadar ucuz (ayrıştırma yok).

Ölçülen kazanç veriye göre **3,5–4,5×** arasında değişir (ondalık basamak sayısı
ve hacim büyüklüğü JSON tarafını şişirir): 20 sembollük doğrulama setinde
6,1 MB JSON → 1,6 MB bin (**3,7×**), sembol başına 305 KB → 81 KB.

### Ölçüm (200 sembol / 680.000 bar, 2026-09-14)

| | bayt/bar | toplam | oran |
|---|---|---|---|
| JSON, ham | 90,3 | 61,4 MB | — |
| İkili, ham | 24,0 | 16,3 MB | **3,76×** |
| JSON, gzip | 26,4 | 18,0 MB | — |
| İkili, gzip | 19,0 | 12,9 MB | **1,39×** |

**Dürüst okuma: asıl kazanç bayt değil, AYRIŞTIRMA.** Gzip JSON'u çok iyi
sıkıştırıyor (anahtarlar tekrar ediyor, sıkıştırıcı bunu sever); ağ üzerinde
fark 1,4×'e iniyor. Depolamada 3,8× duruyor ve planın "227 MB → ≤ 60 MB"
hedefi bu oranla tutuyor.

Formatın gerçek gerekçesi ana iş parçacığında harcanan zaman. Aynı sembol
(3.400 bar), tarayıcıda ölçüldü — JSON tarafında yalnızca `JSON.parse` değil,
uygulamanın gerçekten yaptığı iş (nesne dizisinden tipli dizilere aktarım):

| | 1× | 6× (zayıf makine) |
|---|---|---|
| JSON → tipli dizi | 2,2 ms | **17,2 ms** |
| İkili → tipli dizi | 0,010 ms | **0,16 ms** |

Yani zayıf makinede tek sembol için ~17 ms'lik bir ana thread bloğu yerine
0,16 ms. 200 sembollük paket JSON olsaydı bu iş ~3,4 saniye sürerdi; ikili
formatta görünüm kurmak kopyalama bile gerektirmiyor.

## Seri dosyası — `<SEMBOL>.bin`

Little-endian. Başlık 32 bayt, ardından 4 bayt hizalı kolonlar:

| Ofset | Tip | Alan |
|---|---|---|
| 0 | char[4] | sihirli sayı `BRS1` |
| 4 | uint16 | sürüm (= 1) |
| 6 | uint16 | bayraklar (bit0: hacim var) |
| 8 | uint32 | `count` — bar sayısı |
| 12 | int32 | `firstDay` — ilk barın epoch günü |
| 16 | int32 | `lastDay` — son barın epoch günü |
| 20 | uint32 | ayrılmış (0) |
| 24 | uint32 | ayrılmış (0) |
| 28 | uint32 | ayrılmış (0) |
| 32 | int32[count] | **gün** (epoch gün, artan) |
| … | float32[count] | **açılış** |
| … | float32[count] | **yüksek** |
| … | float32[count] | **düşük** |
| … | float32[count] | **kapanış** |
| … | float32[count] | **hacim** |

Toplam: `32 + count * 24` bayt.

### Kararlar ve sınırları

- **Zaman epoch gün olarak saklanır** (saniye değil). Günlük barda saat bilgisi
  taşımanın anlamı yok; int32 gün 5 milyon yıl yeter, int32 saniye ise 2038'de
  taşardı. Çözümlerken `gün × 86400` (UTC gece yarısı) üretilir.
- **Fiyatlar float32.** 24 bitlik mantis ≈ 7 anlamlı basamak; BIST/ABD/kripto
  fiyat aralığında (0,0001 – 100.000) kuruş hassasiyetinin çok üzerinde.
- **Hacim de float32.** ~1e10 mertebesinde bağıl hata ~1e-7 (birkaç yüz adet);
  hacim çubuğu ve göreli karşılaştırma için önemsiz, ama **hacmi tam sayı olarak
  geri almak isteyen kod bunu varsaymamalı.** Doğrulama betiği bu toleransı
  (bağıl 1e-6) kullanır.
- Veri yoksa (tatil, eksik bar) bar hiç yazılmaz — takvim boşluğu korunur,
  doldurma yapılmaz. Eksik barları veri sağlık paneli raporlar.

## Paket dosyası — `latest-<N>.bin`

Tüm sembollerin son N barı **tek istekte**: nabız ekranı, ısı haritası ve
canlı parametreli tarama bunu kullanır (referans projede bu iş CI'da pişirilmiş
`scan.json` ile yapılıyordu, yani parametre değiştirilemiyordu).

| Ofset | Tip | Alan |
|---|---|---|
| 0 | char[4] | `BRSB` |
| 4 | uint16 | sürüm (= 1) |
| 6 | uint16 | `bars` — sembol başına bar sayısı |
| 8 | uint32 | `symbolCount` |
| 12 | uint32 | `namesByteLen` |
| 16 | uint32 | ayrılmış (0) |
| 20 | uint32 | ayrılmış (0) |
| 24 | utf8[namesByteLen] | semboller, `\n` ile ayrık (4'e hizalamak için sıfırla doldurulur) |
| … | int32[bars] | **ortak gün ekseni** (piyasanın son N işlem günü) |
| … | float32[symbolCount × bars] | açılış (satır = sembol) |
| … | float32[symbolCount × bars] | yüksek |
| … | float32[symbolCount × bars] | düşük |
| … | float32[symbolCount × bars] | kapanış |
| … | float32[symbolCount × bars] | hacim |

O gün işlem görmeyen sembolün hücresi **NaN**'dır (sıfır değil — sıfır fiyat
gerçek bir veri gibi davranır, NaN "veri yok" der ve indikatörler onu atlar).

603 sembol × 250 bar ≈ **3 MB** (gzip sonrası ~1 MB).

> Uzun periyotlu göstergeler (ör. EMA-610) 250 barlık pakete sığmaz; bunlar
> sembolün tam geçmişini (`<SEMBOL>.bin`) ister. Paket, piyasa geneli hızlı
> bakış içindir.

## Manifest — `manifest.json`

```json
{
  "version": 1,
  "market": "bist",
  "generated": 1757808000,
  "bundle": { "file": "latest-250.bin", "bars": 250, "bytes": 3014928, "hash": "1f3a9c7d" },
  "symbols": {
    "THYAO": { "f": "THYAO.bin", "n": 3500, "d0": 15390, "d1": 20710, "b": 84032, "h": "9f3c1a02" }
  }
}
```

`h` = dosya içeriğinin SHA-1'inin ilk 8 hane'si. İki işi var: **önbellek
anahtarı** (IndexedDB'de aynı hash varsa ağa çıkılmaz) ve **cache-busting**
(`THYAO.bin?h=9f3c1a02`), böylece CDN/tarayıcı önbelleği bayat veri servis
edemez.

## Üretim ve doğrulama

```bash
python scripts/pack_data.py --market all --verify   # JSON → pack/ + bar bar doğrula
python scripts/pack_data.py --self-test             # sentetik veriyle uçtan uca test
```

`--verify`, yazılan `.bin`'i geri okuyup kaynak JSON ile **bar bar** karşılaştırır
(fiyatlarda bağıl tolerans 1e-6). CI'da veri üretiminden sonra çalışır; uyuşmazlık
derlemeyi kırar.

Aynı formatı okuyan TypeScript çözücü `src/core/data/pack.ts` içindedir ve
`src/core/data/__fixtures__/` altındaki Python üretimi dosyaya karşı test edilir —
iki dil arasındaki sözleşme böyle kilitlenir.
