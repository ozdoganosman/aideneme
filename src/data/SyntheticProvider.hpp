#pragma once
// Generates large synthetic OHLCV series via geometric Brownian motion.
// Needs no network and produces millions of bars in a fraction of a second, so
// it is the offline stress test for the "no lag on huge data" claim.

#include "data/DataProvider.hpp"

class SyntheticProvider : public DataProvider {
public:
    const char* name() const override { return "Sentetik"; }

    FetchResult fetchHistory(const std::string& symbol,
                             int                tfIndex,
                             std::size_t        maxBars,
                             const ProgressFn&  progress) override;
};
