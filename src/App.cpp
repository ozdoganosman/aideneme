#include "App.hpp"

#include "data/SyntheticProvider.hpp"
#include "data/BinanceProvider.hpp"

#include "imgui.h"

#include <chrono>
#include <cmath>
#include <ctime>
#include <random>
#include <string>

App::App()
    : synthetic_(std::make_unique<SyntheticProvider>()),
      binance_(std::make_unique<BinanceProvider>()) {}

App::~App() {
    live_ = false;
    if (liveThread_.joinable()) liveThread_.join();
    joinLoader();
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

    loading_   = true;
    progCur_   = 0;
    progTot_   = 0;
    status_    = "Yukleniyor...";

    const std::string sym(symbolBuf_);
    const int         tf   = tfIndex_;
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

    const std::string sym(symbolBuf_);
    const int         tf  = tfIndex_;
    const int         pidx = providerIndex_;

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
            status_ = "Yuklendi: " + std::to_string(series_.size()) + " mum";
            liveLastClose_ = series_.empty() ? liveLastClose_.load() : series_.c.back();
        } else {
            status_ = "Hata: " + r.error;
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

    const ImGuiViewport* vp = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(vp->WorkPos);
    ImGui::SetNextWindowSize(vp->WorkSize);
    ImGui::Begin("Borsa", nullptr,
                 ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                 ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse |
                 ImGuiWindowFlags_NoBringToFrontOnFocus);

    // --- control row ---
    const char* providers[] = {"Sentetik (offline)", "Binance (canli)"};
    ImGui::SetNextItemWidth(150);
    ImGui::Combo("Kaynak", &providerIndex_, providers, 2);
    ImGui::SameLine();

    ImGui::SetNextItemWidth(120);
    ImGui::InputText("Sembol", symbolBuf_, sizeof symbolBuf_);
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

    bool liveUi = live_.load();
    if (ImGui::Checkbox("Canli", &liveUi)) {
        if (liveUi) startLive();
        else        stopLive();
    }

    if (busy) {
        ImGui::SameLine();
        ImGui::Text("(%zu / %zu)", progCur_.load(), progTot_.load());
    }

    // --- status row ---
    ImGui::Text("Durum: %s   |   Mum: %zu   |   FPS: %.0f   |   Cizim: <=ekran genisligi",
                status_.c_str(), series_.size(), ImGui::GetIO().Framerate);
    ImGui::Separator();

    // --- chart ---
    chart_.draw(series_, tfIndex_);

    ImGui::End();
}
