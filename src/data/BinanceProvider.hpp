#pragma once
// Real market data from Binance's public REST API.
//
// Binance requires NO API KEY for public market data, which is exactly why it
// was chosen: free, key-less, and rich enough to return millions of points by
// paginating 1m klines. Endpoint: GET /api/v3/klines.

#include "data/DataProvider.hpp"

class BinanceProvider : public DataProvider {
public:
    const char* name() const override { return "Binance"; }

    FetchResult fetchHistory(const std::string& symbol,
                             int                tfIndex,
                             std::size_t        maxBars,
                             const ProgressFn&  progress) override;

    bool fetchLatest(const std::string& symbol,
                     int                tfIndex,
                     Candle&            out) override;

    // Paginating the REST API too aggressively gets you rate-limited, so cap how
    // many bars a single load will pull. Synthetic mode covers the "millions"
    // stress test without hammering the network.
    static constexpr std::size_t kMaxBars = 100'000;
};
