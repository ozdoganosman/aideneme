import { useEffect, useState } from 'react';

/**
 * Hesap bitti duyurusu — WCAG 2.2 §4.1.3 "Durum Mesajları" (AA).
 *
 * Ölçüldü: dokuz ekranın hiçbirinde hesap sonucu canlı bölgede değildi.
 * Gören kullanıcı tablonun dolduğunu görüyor; ekran okuyucu kullanıcısına
 * HİÇBİR ŞEY söylenmiyordu — Stratejiler ve Model gibi saniyeler süren
 * ekranlarda "bitti mi, dondu mu?" sorusunun cevabı yoktu.
 *
 * Neden görünür durum şeridini canlı bölgeye çevirmedik: o şerit köken
 * notunu, temel veri rozetini ve süreyi de taşıyor. Her filtre değişiminde
 * tamamı okunurdu. Burada tek cümle var, ve yalnızca sonuç OTURDUĞUNDA.
 *
 * Gecikme neden: tarayıcıdaki eşik kaydırıcısı her adımda yeni bir sayı
 * üretiyor. Gecikmesiz duyuru ekran okuyucuyu ara sonuçlarla doldururdu;
 * `delay` boyunca değişmeyen ilk mesaj yayımlanıyor.
 */
export function Announce({ message, delay = 700 }: { message: string; delay?: number }) {
  const [published, setPublished] = useState('');

  useEffect(() => {
    if (message === published) return;
    const timer = setTimeout(() => setPublished(message), delay);
    return () => clearTimeout(timer);
  }, [message, published, delay]);

  // Bölge DOM'da mesajdan ÖNCE var olmalı: sonradan eklenen canlı bölgenin
  // ilk içeriğini çoğu ekran okuyucu duyurmaz.
  return (
    <p className="visually-hidden" role="status">
      {published}
    </p>
  );
}
