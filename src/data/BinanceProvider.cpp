#include "data/BinanceProvider.hpp"
#include "net/Http.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::json;

namespace {

// Parse one Binance kline array element into a Candle.
// Format: [openTime(ms), "open", "high", "low", "close", "volume", ...]
bool parseKline(const json& k, Candle& c) {
    if (!k.is_array() || k.size() < 6) return false;
    try {
        c.time   = static_cast<double>(k[0].get<long long>() / 1000);
        c.open   = std::stod(k[1].get<std::string>());
        c.high   = std::stod(k[2].get<std::string>());
        c.low    = std::stod(k[3].get<std::string>());
        c.close  = std::stod(k[4].get<std::string>());
        c.volume = std::stod(k[5].get<std::string>());
    } catch (...) {
        return false;
    }
    return true;
}

std::string buildUrl(const std::string& symbol, const char* interval,
                     std::size_t limit, long long endTimeMs) {
    std::string url = "https://api.binance.com/api/v3/klines?symbol=" + symbol +
                      "&interval=" + interval +
                      "&limit=" + std::to_string(limit);
    if (endTimeMs > 0) url += "&endTime=" + std::to_string(endTimeMs);
    return url;
}

} // namespace

FetchResult BinanceProvider::fetchHistory(const std::string& symbol,
                                          int                tfIndex,
                                          std::size_t        maxBars,
                                          const ProgressFn&  progress) {
    FetchResult r;
    if (tfIndex < 0 || tfIndex >= kTimeframeCount) tfIndex = 0;
    const char* interval = kTimeframes[tfIndex].binance;

    std::size_t want = maxBars ? maxBars : 1000;
    want = std::min(want, kMaxBars);

    // Each page returns up to 1000 klines, oldest->newest. We page backwards from
    // "now" and collect pages, then emit them oldest-first.
    std::vector<std::vector<Candle>> pages;
    long long endTimeMs = 0;          // 0 == now
    std::size_t collected = 0;

    while (collected < want) {
        const std::size_t limit = std::min<std::size_t>(1000, want - collected);
        const std::string url = buildUrl(symbol, interval, limit, endTimeMs);

        HttpResponse resp = httpGet(url);
        if (!resp.error.empty()) {
            r.error = "Ag hatasi: " + resp.error;
            break;
        }
        if (resp.status != 200) {
            r.error = "HTTP " + std::to_string(resp.status) + ": " +
                      resp.body.substr(0, 200);
            break;
        }

        json j = json::parse(resp.body, nullptr, /*allow_exceptions=*/false);
        if (j.is_discarded() || !j.is_array() || j.empty()) break;

        std::vector<Candle> page;
        page.reserve(j.size());
        for (const auto& k : j) {
            Candle c;
            if (parseKline(k, c)) page.push_back(c);
        }
        if (page.empty()) break;

        // Next page ends just before this page's first bar.
        const long long firstOpenMs = j.front()[0].get<long long>();
        endTimeMs = firstOpenMs - 1;

        collected += page.size();
        pages.push_back(std::move(page));
        if (progress) progress(collected, want);

        if (j.size() < limit) break;  // reached the start of history

        // Be polite to the public API.
        std::this_thread::sleep_for(std::chrono::milliseconds(120));
    }

    // Emit oldest-first: pages were gathered newest-page-first, each page ascending.
    r.series.reserve(collected);
    for (auto it = pages.rbegin(); it != pages.rend(); ++it)
        for (const Candle& c : *it)
            r.series.push(c.time, c.open, c.high, c.low, c.close, c.volume);

    r.ok = !r.series.empty();
    if (!r.ok && r.error.empty())
        r.error = "Veri alinamadi (sembol gecerli mi? orn. BTCUSDT)";
    return r;
}

bool BinanceProvider::fetchLatest(const std::string& symbol, int tfIndex, Candle& out) {
    if (tfIndex < 0 || tfIndex >= kTimeframeCount) tfIndex = 0;
    const char* interval = kTimeframes[tfIndex].binance;

    HttpResponse resp = httpGet(buildUrl(symbol, interval, 1, 0));
    if (!resp.error.empty() || resp.status != 200) return false;

    json j = json::parse(resp.body, nullptr, false);
    if (j.is_discarded() || !j.is_array() || j.empty()) return false;
    return parseKline(j.back(), out);
}
