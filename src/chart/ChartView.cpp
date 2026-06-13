#include "chart/ChartView.hpp"
#include "chart/Decimate.hpp"

#include "imgui.h"
#include "implot.h"
#include "implot_internal.h"   // BeginItem/EndItem/FitThisFrame/FitPoint

#include <cmath>
#include <ctime>

namespace {

// Format an x-axis tick (unix seconds) as a date/time string.
int TimeAxisFormatter(double value, char* buff, int size, void* /*user*/) {
    std::time_t t = static_cast<std::time_t>(value);
    std::tm tmv{};
#if defined(_WIN32)
    gmtime_s(&tmv, &t);
#else
    gmtime_r(&t, &tmv);
#endif
    return static_cast<int>(std::strftime(buff, static_cast<size_t>(size),
                                           "%m-%d %H:%M", &tmv));
}

// Custom candlestick item. `d` is already decimated to ~pixel resolution, so the
// loop count is bounded by the plot width regardless of total series size.
void plotCandles(const char* id, const CandleSeries& d) {
    if (d.empty()) return;

    const ImVec4 bull(0.10f, 0.80f, 0.45f, 1.0f);
    const ImVec4 bear(0.92f, 0.28f, 0.32f, 1.0f);

    // Body half-width in plot (x) units: 35% of the bar spacing.
    const double halfW =
        d.size() > 1 ? (d.t[1] - d.t[0]) * 0.35 : 30.0;

    if (ImPlot::BeginItem(id)) {
        // Contribute to y-axis auto-fit using the visible highs/lows only.
        if (ImPlot::FitThisFrame()) {
            for (std::size_t i = 0; i < d.size(); ++i) {
                ImPlot::FitPoint(ImPlotPoint(d.t[i], d.l[i]));
                ImPlot::FitPoint(ImPlotPoint(d.t[i], d.h[i]));
            }
        }

        ImDrawList* dl = ImPlot::GetPlotDrawList();
        for (std::size_t i = 0; i < d.size(); ++i) {
            const bool  bullish = d.c[i] >= d.o[i];
            const ImU32 col = ImGui::GetColorU32(bullish ? bull : bear);

            // Wick: high-low vertical line.
            const ImVec2 hi = ImPlot::PlotToPixels(d.t[i], d.h[i]);
            const ImVec2 lo = ImPlot::PlotToPixels(d.t[i], d.l[i]);
            dl->AddLine(hi, lo, col, 1.0f);

            // Body: open-close rectangle (min 1px tall so dojis stay visible).
            ImVec2 a = ImPlot::PlotToPixels(d.t[i] - halfW, d.o[i]);
            ImVec2 b = ImPlot::PlotToPixels(d.t[i] + halfW, d.c[i]);
            if (std::fabs(b.y - a.y) < 1.0f) {
                const float y = (a.y + b.y) * 0.5f;
                a.y = y - 0.5f;
                b.y = y + 0.5f;
            }
            dl->AddRectFilled(a, b, col);
        }
        ImPlot::EndItem();
    }
}

// Tooltip with the OHLCV of the bar nearest the cursor. Reads the *full* series
// (not the decimated copy) so the numbers are exact.
void candleTooltip(const CandleSeries& s) {
    if (!ImPlot::IsPlotHovered()) return;

    const ImPlotPoint mp = ImPlot::GetPlotMousePos();
    std::size_t idx = lowerBoundTime(s.t, mp.x);
    if (idx >= s.size()) idx = s.size() - 1;
    if (idx > 0 && (mp.x - s.t[idx - 1]) < (s.t[idx] - mp.x)) --idx;

    char tbuf[64];
    std::time_t t = static_cast<std::time_t>(s.t[idx]);
    std::tm tmv{};
#if defined(_WIN32)
    gmtime_s(&tmv, &t);
#else
    gmtime_r(&t, &tmv);
#endif
    std::strftime(tbuf, sizeof tbuf, "%Y-%m-%d %H:%M", &tmv);

    const bool bullish = s.c[idx] >= s.o[idx];
    ImGui::BeginTooltip();
    ImGui::TextUnformatted(tbuf);
    ImGui::Separator();
    ImGui::Text("Acilis : %.2f", s.o[idx]);
    ImGui::Text("Yuksek : %.2f", s.h[idx]);
    ImGui::Text("Dusuk  : %.2f", s.l[idx]);
    ImGui::TextColored(bullish ? ImVec4(0.3f, 0.9f, 0.5f, 1) : ImVec4(0.95f, 0.4f, 0.4f, 1),
                       "Kapanis: %.2f", s.c[idx]);
    ImGui::Text("Hacim  : %.2f", s.v[idx]);
    ImGui::EndTooltip();
}

} // namespace

void ChartView::draw(const CandleSeries& s, int /*tfIndex*/) {
    if (s.empty()) {
        ImGui::TextDisabled("Veri yok. Ust cubuktan 'Yukle' butonuna bas.");
        return;
    }

    // On first frame after a load, frame the most recent ~400 bars.
    if (!inited_) {
        const std::size_t n = s.size();
        const std::size_t show = n < 400 ? n : 400;
        const double bar = n > 1 ? (s.t[n - 1] - s.t[n - 2]) : 60.0;
        xmin_ = s.t[n - show];
        xmax_ = s.t[n - 1] + bar;
        inited_ = true;
    }

    const ImVec2 avail = ImGui::GetContentRegionAvail();
    const float priceH = avail.y * 0.72f;
    const float volH   = avail.y * 0.26f;

    // ---- Price pane ----------------------------------------------------------
    if (ImPlot::BeginPlot("##price", ImVec2(-1, priceH),
                          ImPlotFlags_NoTitle | ImPlotFlags_NoLegend |
                          ImPlotFlags_Crosshairs)) {
        ImPlot::SetupAxisLinks(ImAxis_X1, &xmin_, &xmax_);
        ImPlot::SetupAxes(nullptr, nullptr,
                          ImPlotAxisFlags_NoLabel,
                          ImPlotAxisFlags_AutoFit | ImPlotAxisFlags_NoLabel);
        ImPlot::SetupAxisFormat(ImAxis_X1, TimeAxisFormatter, nullptr);

        const ImPlotRect lim = ImPlot::GetPlotLimits();
        std::size_t i0 = lowerBoundTime(s.t, lim.X.Min);
        std::size_t i1 = lowerBoundTime(s.t, lim.X.Max);
        if (i0 > 0) --i0;
        if (i1 < s.size()) ++i1;

        const std::size_t buckets =
            static_cast<std::size_t>(ImPlot::GetPlotSize().x);
        decimateMinMax(s, i0, i1, buckets, decPrice_);

        plotCandles("Fiyat", decPrice_);
        candleTooltip(s);
        ImPlot::EndPlot();
    }

    // ---- Volume pane ---------------------------------------------------------
    if (ImPlot::BeginPlot("##vol", ImVec2(-1, volH),
                          ImPlotFlags_NoTitle | ImPlotFlags_NoLegend)) {
        ImPlot::SetupAxisLinks(ImAxis_X1, &xmin_, &xmax_);
        ImPlot::SetupAxes(nullptr, nullptr,
                          ImPlotAxisFlags_NoLabel,
                          ImPlotAxisFlags_AutoFit | ImPlotAxisFlags_NoLabel);
        ImPlot::SetupAxisFormat(ImAxis_X1, TimeAxisFormatter, nullptr);

        const ImPlotRect lim = ImPlot::GetPlotLimits();
        std::size_t i0 = lowerBoundTime(s.t, lim.X.Min);
        std::size_t i1 = lowerBoundTime(s.t, lim.X.Max);
        if (i0 > 0) --i0;
        if (i1 < s.size()) ++i1;

        const std::size_t buckets =
            static_cast<std::size_t>(ImPlot::GetPlotSize().x);
        decimateMinMax(s, i0, i1, buckets, decVol_);

        const double barW =
            decVol_.size() > 1 ? (decVol_.t[1] - decVol_.t[0]) * 0.7 : 30.0;
        ImPlot::SetNextFillStyle(ImVec4(0.30f, 0.45f, 0.78f, 0.75f));
        ImPlot::PlotBars("Hacim", decVol_.t.data(), decVol_.v.data(),
                         static_cast<int>(decVol_.size()), barW);
        ImPlot::EndPlot();
    }
}
