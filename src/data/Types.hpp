#pragma once
// Core market-data types.
//
// Data is stored COLUMNAR (separate arrays per field) rather than as an
// array-of-structs. This is the single most important data-layout decision for
// performance: it is cache-friendly for the per-frame min/max scan used by the
// decimator, and it matches what ImPlot wants (it draws from raw double arrays).

#include <vector>
#include <cstddef>

// One OHLCV bar. Time is a unix timestamp in *seconds* (double, because ImPlot's
// time axis works in floating-point seconds).
struct Candle {
    double time   = 0.0;
    double open   = 0.0;
    double high   = 0.0;
    double low    = 0.0;
    double close  = 0.0;
    double volume = 0.0;
};

// Columnar series. All vectors are kept the same length.
struct CandleSeries {
    std::vector<double> t, o, h, l, c, v;

    std::size_t size()  const { return t.size(); }
    bool        empty() const { return t.empty(); }

    void clear() { t.clear(); o.clear(); h.clear(); l.clear(); c.clear(); v.clear(); }

    void reserve(std::size_t n) {
        t.reserve(n); o.reserve(n); h.reserve(n);
        l.reserve(n); c.reserve(n); v.reserve(n);
    }

    void push(double T, double O, double H, double L, double C, double V) {
        t.push_back(T); o.push_back(O); h.push_back(H);
        l.push_back(L); c.push_back(C); v.push_back(V);
    }
};

// Supported timeframes. `binance` is the interval string for the Binance REST
// API; `seconds` is the bar duration used for synthetic generation and time
// formatting.
struct Timeframe {
    const char* label;
    const char* binance;
    long        seconds;
};

inline const Timeframe kTimeframes[] = {
    {"1m",  "1m",     60},
    {"5m",  "5m",    300},
    {"15m", "15m",   900},
    {"1h",  "1h",   3600},
    {"4h",  "4h",  14400},
    {"1d",  "1d",  86400},
};
inline const int kTimeframeCount = sizeof(kTimeframes) / sizeof(kTimeframes[0]);

// Parallel label array for ImGui::Combo.
inline const char* const kTfLabels[] = {"1m", "5m", "15m", "1h", "4h", "1d"};
