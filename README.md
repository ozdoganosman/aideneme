# Borsa — Yüksek Performanslı Web Grafiği

Milyonlarca mumu **kasmadan** pan/zoom edebilen, web tabanlı borsa/trading grafiği.
**React + TypeScript + Vite** ve **TradingView Lightweight Charts** üzerine kurulu.
Veri: **API key gerektirmeyen, ücretsiz Binance public API** (gerçek piyasa, canlı
WebSocket) + offline stres testi için **sentetik üreteç**.

## Canlı demo

GitHub Pages'e her push'ta otomatik yayınlanır:
**https://ozdoganosman.github.io/aideneme/**

(İlk yayında repo'da **Settings → Pages → Source: GitHub Actions** seçili olmalı;
workflow bunu otomatik etkinleştirmeye çalışır.)

## Neden kasmıyor?

Performansın sırrı kütüphane değil, **viewport decimation + LOD**'dur
(`src/chart/lod.ts`):

- Tüm veri seti bellekte tutulur (kolon bazlı `Float64Array`'ler).
- Grafiğe **her zaman yalnızca görünen aralığın, ekran çözünürlüğüne indirgenmiş
  bir penceresi** beslenir (min/max OHLC kovaları, ~4000 nokta).
- Çizilen nokta sayısı **veri boyutundan bağımsız**; yakınlaştıkça detay artar
  (LOD adımları 2'nin katı stride ile).

Sonuç: 1m, 100k veya milyonlarca mum — pan/zoom hep akıcı.

## Çalıştırma

```bash
npm install
npm run dev      # http://localhost:5173
# veya
npm run build && npm run preview
```

## Kullanım

- **Kaynak**: Sentetik (offline) veya Binance (canlı)
- **Sembol**: kutuya yaz → otomatik tamamlama önerir (Binance seçiliyken tüm
  pariteler ~2000+; offline'da yerleşik liste). Öneriden seç veya Enter.
- **Periyot**: 1m / 5m / 15m / 1h / 4h / 1d
- **Mum**: üretilecek/çekilecek bar sayısı (Sentetik'te milyonları dene)
- **Yükle** · **Canlı** (Binance'de WebSocket, sentetikte simülasyon)
- Grafik: sürükle = kaydır, tekerlek = zoom, çift tık = sığdır, üzerine gel = OHLCV

## Mimari

```
src/
├── main.tsx               React girişi
├── App.tsx                durum + toolbar + canlı feed
├── index.css             koyu tema / yerleşim
├── components/
│   ├── Chart.tsx          Lightweight Charts sarmalayıcı (mum + hacim)
│   └── SymbolSearch.tsx   otomatik tamamlamalı sembol arama
├── chart/
│   └── lod.ts             viewport decimation + LOD (performansın kalbi)
└── data/
    ├── types.ts           Candles (kolon bazlı tipli diziler), periyotlar
    ├── synthetic.ts       GBM ile milyonlarca mum (offline)
    └── binance.ts         ücretsiz/key'siz REST klines + exchangeInfo + WS
```

## Veri kaynakları

- **Binance** (ücretsiz, **API key YOK**): `klines` (geçmiş), `exchangeInfo`
  (sembol listesi), `@kline` WebSocket (canlı). Tarayıcıdan CORS ile çalışır.
- **Sentetik**: geometrik Brownian hareketi; internet gerekmez.
- BIST/ABD hisseleri tick seviyesinde ücretsiz+key'siz yok; `binance.ts`
  benzeri bir sağlayıcı sonradan eklenebilir.

## Dağıtım

`.github/workflows/deploy.yml` her push'ta build alır ve GitHub Pages'e yayınlar.
`vite.config.ts` içinde `base: './'` olduğundan alt-yol (`/aideneme/`) altında sorunsuz çalışır.
