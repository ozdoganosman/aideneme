import type { KorunanGorunum } from '../../chart/lod';

/**
 * Grafik görünümünün BİLEŞEN AĞACI DIŞINDAKİ deposu.
 *
 * Sembol değişiminde görünüm `SymbolDesk` içindeki bir ref'te taşınıyordu ve
 * bu hisse geçişleri için yetiyordu. Başka bir EKRANA (Nabız, Tarayıcı,
 * Portföy…) gidip geri dönünce ise masanın kendisi söküldüğü için ref de
 * gidiyor; ölçüldü: 45 barlık görünüm dönüşte 119 bara (sığdırma varsayılanı)
 * düşüyordu — üç ekranın üçünde de.
 *
 * Depo modül düzeyinde: uygulama içi her gezinmede yaşıyor. Sayfa yeniden
 * yüklendiğinde sıfırlanıyor ve bu BİLEREK böyle — yeni bir oturum yeni bir
 * sayfadır; kalıcı kılmak isteyen tercih deposuna yazmalı.
 */
export interface GrafikGorunumu extends KorunanGorunum {
  /**
   * Görünümün hangi piyasa/periyot için kaydedildiği.
   *
   * Taşınması şart: yeniden kurulan grafik `fitKey`i "yeni" sanarsa görünümü
   * korumak yerine sığdırır.
   */
  anahtar?: string;
}

export const grafikGorunumDeposu: { current: GrafikGorunumu | null } = { current: null };
