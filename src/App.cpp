#include "App.hpp"

#include "data/SyntheticProvider.hpp"
#include "data/BinanceProvider.hpp"
#include "net/Http.hpp"

#include "imgui.h"
#include "imgui_internal.h"   // ImGui::ClearActiveID
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <random>
#include <string>

using json = nlohmann::json;

namespace {
// Quick-pick list for the symbol combo. For Binance these are real pairs; for
// the synthetic provider the name only seeds the generator.
const char* const kPopularSymbols[] = {
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT",
    "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "TRXUSDT", "DOTUSDT", "LTCUSDT",
};
const int kPopularCount = sizeof(kPopularSymbols) / sizeof(kPopularSymbols[0]);

// Built-in symbol universe used for autocomplete before (or instead of) the full
// Binance list. Covers the common pairs so suggestions work offline.
const char* const kBuiltinSymbols[] = {
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT",
    "AVAXUSDT","LINKUSDT","TRXUSDT","DOTUSDT","LTCUSDT","MATICUSDT","SHIBUSDT",
    "BCHUSDT","UNIUSDT","XLMUSDT","ATOMUSDT","ETCUSDT","FILUSDT","APTUSDT",
    "NEARUSDT","ARBUSDT","OPUSDT","INJUSDT","SUIUSDT","AAVEUSDT","GRTUSDT",
    "ALGOUSDT","EOSUSDT","SANDUSDT","MANAUSDT","AXSUSDT","FTMUSDT","THETAUSDT",
    "EGLDUSDT","FLOWUSDT","XTZUSDT","CHZUSDT","ENJUSDT","RUNEUSDT","SNXUSDT",
    "CRVUSDT","FETUSDT","RNDRUSDT","IMXUSDT","PEPEUSDT","WIFUSDT","TIAUSDT",
    "SEIUSDT","BTCFDUSD","ETHFDUSD","BTCBUSD","ETHBTC","BNBBTC","SOLBTC",
};
const int kBuiltinCount = sizeof(kBuiltinSymbols) / sizeof(kBuiltinSymbols[0]);

std::string toUpper(const char* s) {
    std::string r(s);
    for (char& ch : r) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    return r;
}
bool startsWith(const std::string& s, const std::string& p) {
    return s.size() >= p.size() && std::equal(p.begin(), p.end(), s.begin());
}
} // namespace

App::App()
    : synthetic_(std::make_unique<SyntheticProvider>()),
      binance_(std::make_unique<BinanceProvider>()) {
    symbolList_.assign(kBuiltinSymbols, kBuiltinSymbols + kBuiltinCount);
}

App::~App() {
    live_ = false;
    if (liveThread_.joinable()) liveThread_.join();
    if (symbolFetch_.joinable()) symbolFetch_.join();
    joinLoader();
}

void App::startSymbolFetch() {
    symbolFetch_ = std::thread([this]() {
        HttpResponse resp = httpGet("https://api.binance.com/api/v3/exchangeInfo", 25);
        if (!resp.error.empty() || resp.status != 200) return;

        json j = json::parse(resp.body, nullptr, false);
        if (j.is_discarded() || !j.contains("symbols") || !j["symbols"].is_array()) return;

        std::vector<std::string> out;
        out.reserve(j["symbols"].size());
        for (const auto& s : j["symbols"]) {
            if (s.value("status", std::string()) == "TRADING")
                out.push_back(s.value("symbol", std::string()));
        }
        std::sort(out.begin(), out.end());

        if (!out.empty()) {
            std::lock_guard<std::mutex> lk(symbolMutex_);
            symbolIncoming_ = std::move(out);
            symbolReady_    = true;
        }
    });
}

void App::drawSymbolSuggestions(float x, float y, float width, bool inputActive) {
    // Show while the box is focused, or while the popup itself is hovered (so a
    // click on a suggestion registers even as the box loses focus).
    if ((!inputActive && !suggestHovered_) || symbolBuf_[0] == '\0') {
        suggestHovered_ = false;
        return;
    }

    const std::string q = toUpper(symbolBuf_);

    // Prefix matches first, then substring matches; cap the list.
    std::vector<const std::string*> matches;
    matches.reserve(12);
    for (const auto& s : symbolList_) {
        if (startsWith(s, q)) {
            matches.push_back(&s);
            if (matches.size() >= 12) break;
        }
    }
    if (matches.size() < 12) {
        for (const auto& s : symbolList_) {
            if (!startsWith(s, q) && s.find(q) != std::string::npos) {
                matches.push_back(&s);
                if (matches.size() >= 12) break;
            }
        }
    }

    // Nothing useful to suggest (no matches, or the only match is exactly typed).
    if (matches.empty() || (matches.size() == 1 && *matches[0] == q)) {
        suggestHovered_ = false;
        return;
    }

    if (width < 170.0f) width = 170.0f;
    ImGui::SetNextWindowPos(ImVec2(x, y));
    ImGui::SetNextWindowSize(ImVec2(width, 0.0f));
    const ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_AlwaysAutoResize |
        ImGuiWindowFlags_NoNav;

    bool picked = false;
    if (ImGui::Begin("##sym_suggest", nullptr, flags)) {
        for (const std::string* m : matches) {
            if (ImGui::Selectable(m->c_str())) {
                std::snprintf(symbolBuf_, sizeof symbolBuf_, "%s", m->c_str());
                startLoad();
                picked = true;
            }
        }
        suggestHovered_ = picked ? false : ImGui::IsWindowHovered();
    }
    ImGui::End();

    if (picked) ImGui::ClearActiveID();   // drop focus so the popup closes
}

DataProvider* App::currentProvider() {
    return providerIndex_ == 1 ? binance_.get() : synthetic_.get();
}

void App::joinLoader() {
    if (loader_.joinable()) loader_.join();
}

void App::startLoad() {
    if (loading_.load()) return;
    joinLoader();  // reap a previously finished thread

    // If the live feed is running it captured the *previous* selection, so its
    // ticks must not bleed into the newly loaded series. Pause it now and resume
    // (against the new selection) once the load is applied.
    if (live_.load()) {
        stopLive();
        restartLiveAfterLoad_ = true;
    }

    loading_   = true;
    progCur_   = 0;
    progTot_   = 0;
    status_    = "Yukleniyor...";

    // Capture the selection this load represents so the live feed and tick-merge
    // logic stay consistent with what ends up on screen.
    pendingSymbol_        = symbolBuf_;
    pendingTf_            = tfIndex_;
    pendingProviderIndex_ = providerIndex_;

    const std::string sym  = pendingSymbol_;
    const int         tf   = pendingTf_;
    const std::size_t bars = static_cast<std::size_t>(requestBars_ < 100 ? 100 : requestBars_);
    DataProvider*     prov = currentProvider();

    loader_ = std::thread([this, sym, tf, bars, prov]() {
        FetchResult r = prov->fetchHistory(
            sym, tf, bars,
            [this](std::size_t cur, std::size_t tot) {
                progCur_ = cur;
                progTot_ = tot;
            });
        {
            std::lock_guard<std::mutex> lk(resultMutex_);
            result_      = std::move(r);
            resultReady_ = true;
        }
        loading_ = false;
    });
}

void App::startLive() {
    if (live_.load()) return;
    if (liveThread_.joinable()) liveThread_.join();

    live_ = true;
    liveLastClose_ = series_.empty() ? 30000.0 : series_.c.back();

    // Target the selection that series_ actually represents — not the live UI
    // widgets, which may have been changed without a reload.
    const std::string sym  = loadedSymbol_;
    const int         tf   = loadedTf_;
    const int         pidx = loadedProviderIndex_;

    liveThread_ = std::thread([this, sym, tf, pidx]() {
        std::mt19937_64 rng(std::random_device{}());
        std::normal_distribution<double> nd(0.0, 1.0);
        const long tfSec = kTimeframes[(tf >= 0 && tf < kTimeframeCount) ? tf : 0].seconds;

        while (live_.load()) {
            Candle c{};
            bool ok = false;

            if (pidx == 1) {
                ok = binance_->fetchLatest(sym, tf, c);
            } else {
                // Synthetic tick: random-walk the last close into the current bar.
                std::time_t now = std::time(nullptr);
                std::time_t bar = now - (now % tfSec);
                double last  = liveLastClose_.load();
                double close = last * std::exp(0.001 * nd(rng));
                c.time   = static_cast<double>(bar);
                c.open   = last;
                c.close  = close;
                c.high   = std::max(last, close) * (1.0 + std::fabs(0.0008 * nd(rng)));
                c.low    = std::min(last, close) * (1.0 - std::fabs(0.0008 * nd(rng)));
                c.volume = 10.0 + std::fabs(nd(rng)) * 500.0;
                liveLastClose_ = close;
                ok = true;
            }

            if (ok) {
                std::lock_guard<std::mutex> lk(liveMutex_);
                liveCandle_ = c;
                liveHas_    = true;
            }

            // Sleep ~1s but stay responsive to the off switch.
            for (int i = 0; i < 10 && live_.load(); ++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    });
}

void App::stopLive() {
    live_ = false;
    if (liveThread_.joinable()) liveThread_.join();
}

void App::drainResults() {
    // Full symbol list arrived?
    {
        std::lock_guard<std::mutex> lk(symbolMutex_);
        if (symbolReady_) {
            symbolList_   = std::move(symbolIncoming_);
            symbolReady_  = false;
        }
    }

    // Finished history load?
    bool apply = false;
    FetchResult r;
    {
        std::lock_guard<std::mutex> lk(resultMutex_);
        if (resultReady_) {
            r            = std::move(result_);
            resultReady_ = false;
            apply        = true;
        }
    }
    if (apply) {
        if (r.ok) {
            series_ = std::move(r.series);
            chart_.resetView();
            // series_ now represents the selection captured at load start.
            loadedSymbol_        = pendingSymbol_;
            loadedTf_            = pendingTf_;
            loadedProviderIndex_ = pendingProviderIndex_;
            status_ = "Yuklendi: " + std::to_string(series_.size()) + " mum";
            liveLastClose_ = series_.empty() ? liveLastClose_.load() : series_.c.back();
        } else {
            status_ = "Hata: " + r.error;
        }
        // Resume the live feed (paused in startLoad) against the loaded selection.
        if (restartLiveAfterLoad_) {
            restartLiveAfterLoad_ = false;
            startLive();
        }
    }

    // Live tick?
    Candle lc{};
    bool haveLive = false;
    {
        std::lock_guard<std::mutex> lk(liveMutex_);
        if (liveHas_) {
            lc       = liveCandle_;
            liveHas_ = false;
            haveLive = true;
        }
    }
    if (haveLive && !series_.empty()) {
        const std::size_t n = series_.size();
        if (lc.time <= series_.t[n - 1]) {
            // Update the still-forming last bar.
            series_.c[n - 1] = lc.close;
            if (lc.high > series_.h[n - 1]) series_.h[n - 1] = lc.high;
            if (lc.low  < series_.l[n - 1]) series_.l[n - 1] = lc.low;
            series_.v[n - 1] = lc.volume;
        } else {
            series_.push(lc.time, lc.open, lc.high, lc.low, lc.close, lc.volume);
        }
    }
}

void App::draw() {
    drainResults();

    // Load something immediately so the first screen isn't an empty chart.
    if (firstFrame_) {
        firstFrame_ = false;
        startLoad();
    }

    const ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    // NoScrollWithMouse: let the mouse wheel zoom the chart instead of being
    // swallowed by the window as a scroll.
    ImGui::Begin("Borsa", nullptr,
                 ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                 ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse |
                 ImGuiWindowFlags_NoBringToFrontOnFocus |
                 ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);

    // --- control row ---
    const char* providers[] = {"Sentetik (offline)", "Binance (canli)"};
    ImGui::SetNextItemWidth(150);
    ImGui::Combo("Kaynak", &providerIndex_, providers, 2);
    ImGui::SameLine();

    // First time Binance is selected, pull the full symbol universe in the
    // background so autocomplete can suggest any real pair.
    if (providerIndex_ == 1 && !symbolFetchStarted_) {
        symbolFetchStarted_ = true;
        startSymbolFetch();
    }

    // Symbol box with autocomplete (suggestion popup is drawn below, once the
    // control row is complete, so it doesn't disturb the row layout).
    ImGui::SetNextItemWidth(120);
    if (ImGui::InputText("Sembol", symbolBuf_, sizeof symbolBuf_,
                         ImGuiInputTextFlags_EnterReturnsTrue)) {
        startLoad();
        ImGui::ClearActiveID();   // hide suggestions after pressing Enter
    }
    const bool   symInputActive = ImGui::IsItemActive();
    const ImVec2 symMin = ImGui::GetItemRectMin();
    const ImVec2 symMax = ImGui::GetItemRectMax();
    const float  symW   = symMax.x - symMin.x;
    ImGui::SameLine();

    // Quick-pick popular symbols: selecting one fills the box and loads it.
    ImGui::SetNextItemWidth(130);
    if (ImGui::Combo("Hizli", &popularIndex_, kPopularSymbols, kPopularCount)) {
        std::snprintf(symbolBuf_, sizeof symbolBuf_, "%s", kPopularSymbols[popularIndex_]);
        startLoad();
    }
    ImGui::SameLine();

    ImGui::SetNextItemWidth(70);
    ImGui::Combo("Periyot", &tfIndex_, kTfLabels, kTimeframeCount);
    ImGui::SameLine();

    ImGui::SetNextItemWidth(130);
    ImGui::InputInt("Mum sayisi", &requestBars_, 0, 0);
    if (requestBars_ < 100) requestBars_ = 100;
    ImGui::SameLine();

    const bool busy = loading_.load();
    if (busy) ImGui::BeginDisabled();
    if (ImGui::Button("Yukle")) startLoad();
    if (busy) ImGui::EndDisabled();
    ImGui::SameLine();

    // Disabled during a load: startLoad/drainResults manage the live feed across
    // a load so it always matches the displayed series.
    if (busy) ImGui::BeginDisabled();
    bool liveUi = live_.load();
    if (ImGui::Checkbox("Canli", &liveUi)) {
        if (liveUi) startLive();
        else        stopLive();
    }
    if (busy) ImGui::EndDisabled();

    if (busy) {
        ImGui::SameLine();
        ImGui::Text("(%zu / %zu)", progCur_.load(), progTot_.load());
    }

    // --- status row ---
    ImGui::Text("Durum: %s   |   Mum: %zu   |   FPS: %.0f",
                status_.c_str(), series_.size(), ImGui::GetIO().Framerate);
    ImGui::TextDisabled(
        "Fare: surukle = kaydir   tekerlek = yakinlastir/uzaklastir   "
        "cift tiklama = ekrana sigdir");
    ImGui::Separator();

    // Autocomplete dropdown under the symbol box (overlay).
    drawSymbolSuggestions(symMin.x, symMax.y, symW, symInputActive);

    // --- chart ---
    chart_.draw(series_, tfIndex_);

    ImGui::End();
}
