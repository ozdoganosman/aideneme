// Geçiş kabuğu (shim) — gerçek uygulama: src/core/indicators/stats.ts
// Mevcut ekranlar hâlâ bu yoldan içe aktarıyor; Faz 2'de çağıranlar core/ yoluna
// taşınınca bu dosya silinecek. Yeni kod doğrudan core/ altından import etmeli.
export * from '../core/indicators/stats';
