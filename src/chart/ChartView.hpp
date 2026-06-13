#pragma once
// Renders the price (candlestick) + volume panes with ImPlot.
//
// Each frame it reads the current visible x-range, decimates the visible bars to
// roughly one-per-pixel, and draws only those. The price/volume panes share a
// linked x-axis so they pan and zoom together.

#include "data/Types.hpp"

class ChartView {
public:
    // Draws into the current ImGui window's content region.
    void draw(const CandleSeries& s, int tfIndex);

    // Re-frame to show the most recent bars (call when a new series is loaded).
    void resetView() { inited_ = false; }

private:
    // Reused scratch buffers so we don't reallocate every frame.
    CandleSeries decPrice_;
    CandleSeries decVol_;

    // Linked x-axis range, shared by both panes.
    double xmin_ = 0.0;
    double xmax_ = 0.0;
    bool   inited_ = false;
};
