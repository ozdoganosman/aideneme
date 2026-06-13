#pragma once
// Abstract market-data source. Swap implementations (synthetic, Binance, and
// later a keyed BIST/US-stock provider) behind this one interface.

#include "data/Types.hpp"
#include <string>
#include <functional>

struct FetchResult {
    bool         ok = false;
    std::string  error;
    CandleSeries series;
};

// progress(current, total) is called periodically from the worker thread so the
// UI can show a loading indicator. Either argument may be 0 if unknown.
using ProgressFn = std::function<void(std::size_t /*cur*/, std::size_t /*total*/)>;

class DataProvider {
public:
    virtual ~DataProvider() = default;

    // Human-readable name for the UI.
    virtual const char* name() const = 0;

    // Load up to `maxBars` historical candles for `symbol` at timeframe index
    // `tfIndex` (into kTimeframes). Runs on a background thread.
    virtual FetchResult fetchHistory(const std::string& symbol,
                                     int                 tfIndex,
                                     std::size_t         maxBars,
                                     const ProgressFn&   progress) = 0;

    // Fetch the latest (possibly still-forming) candle for live updates.
    // Returns false if the provider does not support it. Default: unsupported.
    virtual bool fetchLatest(const std::string& /*symbol*/,
                             int                /*tfIndex*/,
                             Candle&            /*out*/) {
        return false;
    }
};
