# Borsa — Yüksek Performanslı Mum Grafiği (C++ / ImGui + ImPlot)

Milyonlarca mumu **kasmadan** pan/zoom edebilen, native (GPU hızlandırmalı) bir
borsa/trading grafik uygulaması. Dear ImGui + ImPlot + GLFW/OpenGL üzerine
kuruludur. Veri kaynağı olarak **API key gerektirmeyen, ücretsiz Binance public
API** ile gerçek piyasa verisini ve offline stres testi için **sentetik üreteci**
kullanır.

## Neden kasmıyor? (Mimarinin özü)

Performans dilden (C++/JS) değil, iki tasarım kararından gelir:

1. **GPU hızlandırmalı immediate-mode çizim** (ImGui/ImPlot → OpenGL). DOM/SVG
   gibi düğüm tabanlı bir yapı yok.
2. **Viewport min/max decimation** — asıl numara bu. Ekran ~2000px geniştir;
   10.000.000 mumu 2000 piksele çizmenin anlamı yok. Her karede yalnızca
   **görünen** aralık alınır ve piksel başına ~1 "kova"ya indirgenir. Her kova tek
   bir sentetik muma toplanır (open=ilk, close=son, high=max, low=min, vol=Σ).
   Sonuç: **çizilen mum sayısı veri boyutundan bağımsız**, ekran genişliğiyle
   sınırlıdır. Yakınlaştırınca tam detay görünür.

Bkz. `src/chart/Decimate.hpp`.

### Ölçülen performans (sadece veri tarafı, tek çekirdek; GPU çizimi hariç)

| Veri seti | Üretim | Tam zoom-out decimation (en kötü durum) | Çizilen mum |
|-----------|--------|------------------------------------------|-------------|
| 1.000.000 | 121 ms | **2.2 ms/kare** | 2000 |
| 4.000.000 | 491 ms | **8.8 ms/kare** | 2000 |
| 10.000.000| 1.2 s  | **21.8 ms/kare** | 2000 |

Zoom yapınca görünür aralık küçülür ve maliyet doğrusal olarak düşer (ör. 100
mum görünüyorsa yalnızca 100 mum çizilir, tam detay). En kötü durum yalnızca
*tüm* veriye birden tam zoom-out yapıldığında geçerlidir.

## Veri kaynakları

- **Binance (canlı, ücretsiz, API key YOK)** — `GET /api/v3/klines`. 1m mumlarını
  sayfalayarak yüz binlerce nokta çeker. WebSocket yerine basit REST polling ile
  canlı güncelleme. Tek istek başına çekilen mum, kibar olmak için `kMaxBars`
  (100.000) ile sınırlandırılmıştır.
- **Sentetik (offline)** — geometrik Brownian hareketiyle anında milyonlarca mum.
  İnternet gerektirmez; "kasmama" iddiasını kanıtlamak için idealdir.

> **BIST / ABD hisseleri:** Tick seviyesinde ücretsiz + key'siz kaynak pratikte
> yoktur (Finnhub/Alpha Vantage/TwelveData hepsi key ister). `DataProvider`
> arayüzü (`src/data/DataProvider.hpp`) sayesinde keyli bir sağlayıcı sonradan
> kolayca eklenebilir.

## Derleme

### Bağımlılıklar

Sistem kütüphaneleri (pencere + GL + HTTP), ImGui/ImPlot/json ise CMake
FetchContent ile GitHub'dan otomatik çekilir.

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get install -y build-essential cmake \
    libglfw3-dev libgl1-mesa-dev libcurl4-openssl-dev xorg-dev
```

**macOS:**
```bash
brew install cmake glfw curl
```

**Windows:** vcpkg ile `glfw3` ve `curl` kurun, ardından
`-DCMAKE_TOOLCHAIN_FILE=...vcpkg.cmake` ile yapılandırın.

### Build

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./build/borsa
```

## Kullanım

Üst çubuktan:
- **Kaynak**: Sentetik (offline) veya Binance (canlı)
- **Sembol**: ör. `BTCUSDT`, `ETHUSDT` (Binance için)
- **Periyot**: 1m / 5m / 15m / 1h / 4h / 1d
- **Mum sayısı**: çekilecek/üretilecek bar sayısı (Sentetik'te milyonlar deneyin)
- **Yükle**: veriyi arka plan thread'inde yükler (UI donmaz)
- **Canlı**: ~1 sn'de bir son mumu günceller

Grafikte: sürükle = pan, tekerlek = zoom, üzerine gel = OHLCV tooltip. Fiyat ve
hacim panelleri ortak x-ekseninde birlikte hareket eder.

## Mimari

```
src/
├── main.cpp              GLFW + OpenGL + ImGui/ImPlot kurulumu, kare döngüsü
├── App.{hpp,cpp}         Durum, kontroller, arka plan yükleme/canlı thread'leri
├── chart/
│   ├── ChartView.{hpp,cpp}  ImPlot mum + hacim çizimi, crosshair, tooltip
│   └── Decimate.hpp         Viewport min/max decimation (performansın kalbi)
├── data/
│   ├── Types.hpp            Candle / CandleSeries (kolon bazlı tipli diziler)
│   ├── DataProvider.hpp     Soyut kaynak arayüzü
│   ├── SyntheticProvider.*  GBM ile milyonlarca mum
│   └── BinanceProvider.*    Ücretsiz, key'siz REST klines
└── net/Http.{hpp,cpp}   libcurl HTTP GET sarmalayıcı
```

Veri kolon bazlı (her alan ayrı dizi) tutulur: hem cache-dostu (decimation
taraması için) hem de ImPlot'un beklediği ham `double` dizi formatına uygun.
Ağ/üretim işleri arka plan thread'lerinde, UI ana thread'de.

## Bilinen sınırlar / sonraki adımlar

- **10M+ tam zoom-out** için her karede tüm veri taranır (~45 fps). Çok seviyeli
  bir **mip/piramit ön-decimation** cache'i ile bu sabit zamana indirilebilir.
- Canlı veri şu an **REST polling**; gerçek tick akışı için **WebSocket**
  (Binance stream) eklenebilir.
- İndikatörler (MA/EMA/RSI), çoklu sembol, çizim araçları eklenebilir.
- Keyli **BIST/ABD hisse** sağlayıcısı `DataProvider` arkasına eklenebilir.

## Lisans

Eğitim/demonstrasyon amaçlıdır. ImGui/ImPlot/nlohmann-json kendi lisanslarına tabidir.
