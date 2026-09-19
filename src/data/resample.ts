// Geçiş kabuğu (shim) — gerçek uygulama: src/core/data/resample.ts
// Mevcut ekranlar hâlâ bu yoldan içe aktarıyor; Faz 2'de çağıranlar core/ yoluna
// taşınınca bu dosya silinecek. Yeni kod doğrudan core/ altından import etmeli.
export * from '../core/data/resample';
