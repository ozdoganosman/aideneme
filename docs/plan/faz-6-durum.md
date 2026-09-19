# Faz 6 — Rapor ve Dürüst Model Katmanı

**Tarih:** 2026-09-14
**Plan:** [`next-gen-finans-platformu.md`](./next-gen-finans-platformu.md) §7 (Faz 6)
**Durum:** Tamamlandı — `npm run verify` yeşil (296 → 338 test)

---

## Yapılanlar

| Madde | Durum | Nerede |
|---|---|---|
| Tek sayfa paylaşılabilir rapor | ✅ | `src/shell/screens/Report.tsx` |
| Yazdırma / PDF çıktısı | ✅ | `@media print` + `window.print()` |
| Raporda her sayının kaynağı | ✅ | formül + pencere sütunları |
| Üçlü bariyer etiketleme | ✅ | `src/core/ml/labels.ts` |
| Purged K-fold + embargo | ✅ | `src/core/ml/cv.ts` |
| Nedensel özellik matrisi | ✅ | `src/core/ml/features.ts` |
| L2 lojistik regresyon | ✅ | `src/core/ml/logistic.ts` |
| Kalibrasyon (Brier, ECE, Platt) | ✅ | `src/core/ml/calibration.ts` |
| Model kartı + hüküm | ✅ | `src/core/ml/model.ts` |
| Model ekranı | ✅ | `src/shell/screens/ModelScreen.tsx` |
| PNG çıktı | ⏭️ | yazdırma yeterli görüldü (aşağıda) |

## Kararlar

**Rapor, açıklamayı yanında taşır.** Özet tablosunda her metriğin yanında
formülü ve hesaplandığı pencere (tarih aralığı + bar sayısı) yazılı. Rapor
ekrandan kopup başka birine gittiğinde "bu %18,91 nereden geliyor?" sorusunun
cevabı kâğıdın üstünde kalıyor.

**Yazdırma ayrı bir sayfa değil, aynı sayfanın print stili.** İkinci bir
render yolu ikinci bir hata kaynağıdır; `@media print` ile kabuk gizleniyor,
bölümler `break-inside: avoid` ile sayfa arasında bölünmüyor. PNG üretimi
(canvas → blob) eklenmedi: tarayıcının "PDF olarak kaydet" çıktısı hem
vektörel hem de metin seçilebilir; PNG bunun yanında geriye düşüş olurdu.

**Model kartı olmadan tahmin gösterilmez.** Bu, kodda yazılı bir sözleşme:
`trainModel` hükmü `kullanma` ise `latest` hiç hesaplanmıyor (`model.ts`),
ekran da gösterecek bir olasılık bulamıyor. Referans projedeki "AI tahmini
%73" biçimindeki tek sayı, burada yapısal olarak mümkün değil.

**Etiket "yarın yükselir mi" değil, üçlü bariyer.** Sabit yüzdeli eşik yerine
o günkü oynaklıkla ölçeklenen kâr-al / zarar-kes / süre bariyerleri. Sabit
eşik, sakin ve çalkantılı dönemleri aynı kefeye koyar; model o zaman yön değil
rejim öğrenir. Aynı barda iki bariyere de değilirse **kötümser** karar veriliyor
(alt bariyer kazanır): gün içi sıra günlük veriden bilinemez, iyimser varsayım
sonucu şişirir.

**Çapraz doğrulama purged + embargolu.** Etiketler zaman içinde örtüştüğü için
sıradan K-fold sızdırır. Etiket penceresi test aralığıyla kesişen eğitim
örnekleri atılıyor, testten sonraki `horizon` bar da karantinaya alınıyor.
Atılan örnek sayısı model kartında yazıyor (gerçek veride ~%10–20).

**Kalibrasyon yalnızca eğitim katmanından öğreniliyor.** Platt ölçeklemesi test
katmanını görmüyor; görseydi "iyi kalibre" iddiası kendi kendini doğrulardı.

**Taban model her zaman ekranda.** "Her zaman taban oranı söyle" diyen aptal
model ile karşılaştırma (Brier beceri skoru) olmadan bir olasılık modeli
değerlendirilemez. Dengesiz sınıfta doğruluk %80 çıkabilir ve bu **hiçbir şey**
anlatmaz; test bunu ayrıca ölçüyor (`model.test.ts` → "sınıf dengesizse yüksek
doğruluğa kanmaz").

**Basit model bilinçli tercih.** Birkaç bin örnekle derin bir model
doğrulanamaz; burada iddia "daha iyi tahmin" değil, "dürüst ölçüm". Lojistik
regresyonun katsayıları ekranda tek tek görünüyor ve işareti katmanlar arasında
değişen özellik "kararlı mı: hayır" ile işaretleniyor.

## Ölçülen

Sentetik BIST verisinde (200 sembol) THYAO için model kurulduğunda:

| Ölçüm | Değer | Yorum |
|---|---|---|
| AUC | 0.524 | yazı turaya çok yakın |
| Brier | 0.249 | taban 0.249 |
| Brier becerisi | −0.002 | taban oranı bu modelden iyi |
| Hüküm | **kullanma** | tahmin üretilmedi |

Bu, katmanın **çalıştığının** kanıtı: rastgele yürüyüşe yakın bir seride
"kullanılabilir" demek yalan olurdu. Gömülü momentum rejimi olan sentetik
seride ise aynı hat AUC 0.64, Brier becerisi +0.05 ve "kullanılabilir" hükmü
veriyor (`model.test.ts`).

Eğitim + 5 katman doğrulama ~800 ms sürüyor; iş worker'a taşındı
(`WorkerRequest.type = 'model'`), ana iş parçacığı kilitlenmiyor.

## Test

| Dosya | Test | Neyi koruyor |
|---|---|---|
| `core/ml/labels.test.ts` | 5 | son pencere etiketlenmez, kötümser bariyer kuralı |
| `core/ml/cv.test.ts` | 5 | purge kesişimi sıfırlar, embargo eğitim kümesini daraltır |
| `core/ml/logistic.test.ts` | 5 | ayrılabilir veriyi öğrenir, determinizm, sabit sütun |
| `core/ml/calibration.test.ts` | 8 | AUC uçları, beraberlik, boş kova NaN kalır |
| `core/ml/model.test.ts` | 7 | rastgele seride "kullanma", dengesiz sınıfta beceri skoru |
| `shell/screens/Report.test.tsx` | 6 | formül/pencere sütunları, yazdır/kopyala, hata durumu |
| `shell/screens/ModelScreen.test.tsx` | 6 | "kullanma" hükmünde olasılık gösterilmez |

## Bilinçli eksikler

- **PNG çıktı yok** — yazdırma/PDF yolu daha iyi çıktı veriyor (yukarıda).
- **Strateji raporu yok** — rapor şimdilik sembol odaklı; strateji raporu
  laboratuvar ekranındaki rozet + metrik setinin aynısını taşıyacağı için
  ayrı bir ekran yerine laboratuvara yazdırma stili eklemek daha doğru olur.
- **Çoklu sembol modeli yok** — model tek sembolde eğitiliyor. Kesitsel model
  (tüm semboller tek havuzda) daha çok örnek verir ama sembol bazlı sızıntı
  kontrolü gerektirir; kart bunu "tek sembolde, tek dönemde ölçüldü" uyarısıyla
  açıkça söylüyor.
- **Maliyet modele dahil değil** — getiri ayrımı ham getiri üzerinden. Kart bunu
  yazıyor; maliyetli değerlendirme laboratuvar ekranının işi.
