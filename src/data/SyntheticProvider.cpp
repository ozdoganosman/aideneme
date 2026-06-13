#include "data/SyntheticProvider.hpp"

#include <cmath>
#include <ctime>
#include <random>
#include <functional>

FetchResult SyntheticProvider::fetchHistory(const std::string& symbol,
                                            int                tfIndex,
                                            std::size_t        maxBars,
                                            const ProgressFn&  progress) {
    FetchResult r;
    r.ok = true;

    if (tfIndex < 0 || tfIndex >= kTimeframeCount) tfIndex = 0;
    const long tfSec = kTimeframes[tfIndex].seconds;

    const std::size_t n = maxBars ? maxBars : 1'000'000;
    r.series.reserve(n);

    // Seed from the symbol so the same input gives a reproducible series.
    std::mt19937_64 rng(0xC0FFEEULL ^ std::hash<std::string>{}(symbol));
    std::normal_distribution<double> nd(0.0, 1.0);

    double price = 100.0 + (std::hash<std::string>{}(symbol) % 50000) / 1.0;
    const double drift = 0.00002;  // tiny per-bar upward drift
    const double vol   = 0.004;    // per-bar volatility

    // End at the current bar boundary and walk backwards in time.
    std::time_t now   = std::time(nullptr);
    now -= now % tfSec;
    std::time_t start = now - static_cast<std::time_t>(n - 1) * tfSec;

    for (std::size_t i = 0; i < n; ++i) {
        const double open  = price;
        const double ret   = drift + vol * nd(rng);
        const double close = open * std::exp(ret);
        const double hi    = std::max(open, close) * (1.0 + std::fabs(vol * nd(rng)) * 0.5);
        const double lo    = std::min(open, close) * (1.0 - std::fabs(vol * nd(rng)) * 0.5);
        const double volu  = 10.0 + std::fabs(nd(rng)) * 1000.0;

        r.series.push(static_cast<double>(start + static_cast<std::time_t>(i) * tfSec),
                      open, hi, lo, close, volu);
        price = close;

        if (progress && (i & 0x3FFFF) == 0) progress(i, n);
    }
    if (progress) progress(n, n);
    return r;
}
