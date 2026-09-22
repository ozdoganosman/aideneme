/**
 * Türkçe ondalık ayırıcı — ÇEKİRDEK katmanı için.
 *
 * Arayüz katmanında sayı biçimleme tek kaynağa toplanmıştı (`src/ui/format.ts`)
 * ama çekirdek katmanın da kullanıcıya GÖRÜNEN metin ürettiği yerler var:
 * veri sağlığı bulguları hazır cümleler olarak dönüyor ve doğrudan ekrana
 * yazılıyor. Orada `toFixed` kullanılıyordu ve `toFixed` her zaman NOKTA
 * üretir — yani çekirdek, arayüzün düzelttiği kusuru geri getiriyordu.
 *
 * Gerçek veride ölçüldü: ISKUR'un raporunda "40 bar (%1.9) sıfır hacimli"
 * yazıyordu. Aynı ekranın geri kalanı virgül kullanıyor; iki biçim yan yana
 * duruyordu. Örnek veride hiç görünmüyordu çünkü orada sıfır hacimli bar yok.
 *
 * `Intl` bir ECMAScript yeteneği, DOM değil: çekirdeğin saflık kuralını
 * bozmuyor ve worker'da da çalışıyor (tarih biçimi de aynı yolu kullanıyor).
 */

const BICIMLER = new Map<number, Intl.NumberFormat>();

function bicim(basamak: number): Intl.NumberFormat {
  let f = BICIMLER.get(basamak);
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: basamak,
      maximumFractionDigits: basamak,
    });
    BICIMLER.set(basamak, f);
  }
  return f;
}

/** Sayı → "1,9" (Türkçe ondalık ayırıcı). Sonlu değilse "—". */
export function trSayi(v: number, basamak = 1): string {
  if (!Number.isFinite(v)) return '—';
  return bicim(basamak).format(v);
}
