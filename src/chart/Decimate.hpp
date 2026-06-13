#pragma once
// Viewport min/max decimation — the core technique that keeps the chart smooth
// regardless of dataset size.
//
// The screen is only ~2000px wide, so drawing 10,000,000 candles into it is
// pure waste. Each frame we look at the *visible* index range and bucket it into
// roughly one bucket per horizontal pixel. Each bucket is aggregated into a
// single synthetic candle:
//   open   = first bar's open
//   close  = last  bar's close
//   high   = max high in bucket
//   low    = min low  in bucket
//   volume = sum of volume in bucket
//
// Result: the number of candles actually drawn is bounded by the pixel width, so
// draw cost is O(pixels) no matter how large the series is. The only per-frame
// cost that scales with data is the linear min/max scan over the visible range,
// which is a few milliseconds even for millions of bars in native C++.

#include "data/Types.hpp"
#include <algorithm>
#include <cstddef>

// Index of the first element in sorted `t` that is >= x.
inline std::size_t lowerBoundTime(const std::vector<double>& t, double x) {
    return static_cast<std::size_t>(
        std::lower_bound(t.begin(), t.end(), x) - t.begin());
}

// Aggregate src[i0, i1) into at most `maxBuckets` candles, written to `dst`.
// If the visible range already fits, the range is copied verbatim (full detail
// when zoomed in). `dst` is reused across frames to avoid reallocation.
inline void decimateMinMax(const CandleSeries& s,
                           std::size_t i0, std::size_t i1,
                           std::size_t maxBuckets,
                           CandleSeries& dst) {
    dst.clear();
    if (i1 > s.size()) i1 = s.size();
    if (i1 <= i0) return;
    if (maxBuckets == 0) maxBuckets = 1;

    const std::size_t n = i1 - i0;

    // Zoomed in enough that every bar is at least one bucket: draw them all.
    if (n <= maxBuckets) {
        dst.reserve(n);
        for (std::size_t i = i0; i < i1; ++i)
            dst.push(s.t[i], s.o[i], s.h[i], s.l[i], s.c[i], s.v[i]);
        return;
    }

    dst.reserve(maxBuckets + 1);
    const double step = static_cast<double>(n) / static_cast<double>(maxBuckets);

    for (std::size_t b = 0; b < maxBuckets; ++b) {
        std::size_t bs = i0 + static_cast<std::size_t>(b * step);
        std::size_t be = i0 + static_cast<std::size_t>((b + 1) * step);
        if (be > i1) be = i1;
        if (bs >= be) continue;

        double O = s.o[bs];
        double C = s.c[be - 1];
        double H = s.h[bs];
        double L = s.l[bs];
        double Vsum = 0.0;
        for (std::size_t i = bs; i < be; ++i) {
            if (s.h[i] > H) H = s.h[i];
            if (s.l[i] < L) L = s.l[i];
            Vsum += s.v[i];
        }
        // Use the bucket's first timestamp as its x position.
        dst.push(s.t[bs], O, H, L, C, Vsum);
    }
}
