#pragma once
// Application state and UI. Owns the data providers, the loaded series, the
// chart view, and the background worker threads for loading + live updates.

#include "data/Types.hpp"
#include "data/DataProvider.hpp"
#include "chart/ChartView.hpp"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

class App {
public:
    App();
    ~App();

    // Build + render the whole UI for one frame.
    void draw();

private:
    DataProvider* currentProvider();
    void startLoad();
    void drainResults();   // apply finished loads + live ticks (main thread)
    void startLive();
    void stopLive();
    void joinLoader();

    // --- providers ---
    std::unique_ptr<DataProvider> synthetic_;
    std::unique_ptr<DataProvider> binance_;

    // --- loaded data (owned by main thread) ---
    CandleSeries series_;
    ChartView    chart_;

    // --- UI state ---
    char  symbolBuf_[32]  = "BTCUSDT";
    int   tfIndex_        = 0;
    int   providerIndex_  = 0;   // 0 = synthetic, 1 = binance
    int   requestBars_    = 100000;
    std::string status_   = "Hazir. Bir kaynak secip 'Yukle'ye bas.";

    // Selection that series_ currently represents (the live feed targets this so
    // its ticks never merge into a mismatched series).
    std::string loadedSymbol_        = "BTCUSDT";
    int         loadedTf_            = 0;
    int         loadedProviderIndex_ = 0;
    // Selection captured for the in-flight load, promoted to loaded* on success.
    std::string pendingSymbol_        = "BTCUSDT";
    int         pendingTf_            = 0;
    int         pendingProviderIndex_ = 0;
    bool        restartLiveAfterLoad_ = false;

    // --- background loader ---
    std::thread          loader_;
    std::atomic<bool>    loading_{false};
    std::atomic<size_t>  progCur_{0};
    std::atomic<size_t>  progTot_{0};
    std::mutex           resultMutex_;
    bool                 resultReady_ = false;
    FetchResult          result_;

    // --- live feed ---
    std::thread          liveThread_;
    std::atomic<bool>    live_{false};
    std::atomic<double>  liveLastClose_{0.0};
    std::mutex           liveMutex_;
    bool                 liveHas_ = false;
    Candle               liveCandle_;
};
