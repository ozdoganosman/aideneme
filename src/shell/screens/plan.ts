/**
 * Her ekranın "buraya ne gelecek" listesi. Boş durumlar bunu gösterir —
 * kabuk gezilebilir ama hiçbir yerde sahte veri yok (ürün ilkesi #7).
 */
export const SCREEN_PLAN: Record<string, string[]> = {
  nabiz: [
    'Piyasa özeti: endeks, genişlik (yükselen/düşen), hacim rejimi',
    'Isı haritası — sektör ve kümeleme sıralı',
    'Takip listesi kartları + veri tazelik rozeti',
  ],
  sembol: [
    'LOD grafik çekirdeği (mevcut src/chart/lod.ts) üzerinde mum + hacim',
    'İndikatör paneli; her metrik için "bu sayı nereden geliyor" katmanı',
    'Özet kartları: getiri, volatilite, drawdown, reel (enflasyon düzeltmeli) getiri',
    'Temel tablolar: TTM çarpanlar, sektör medyanına göre yüzdelik dilim',
  ],
  tarayici: [
    'Kural tabanlı filtre — parametreler canlı, sonuç Worker havuzunda',
    'Kayıtlı taramalar ve alarm kurma',
    'Pencerelenmiş sonuç tablosu (600+ satır, sıralanabilir)',
  ],
  karsilastir: [
    '2–8 sembol: normalize getiri, drawdown, korelasyon',
    'Hiyerarşik kümeleme ile sıralanmış korelasyon matrisi',
    'Rejim kırılımı: yüksek/düşük volatilite, trend/yatay',
  ],
  portfoy: [
    'Pozisyonlar, işlem günlüğü, gerçekleşen vs planlanan',
    'Risk: VaR/CVaR, Calmar, Ulcer, korelasyon limitleri',
    'Reel ve USD bazlı performans, tarihsel stres senaryoları',
  ],
};
