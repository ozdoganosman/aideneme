"""
Market-wide strategy backtest. Reads the per-symbol OHLCV JSON produced by
build_bist.py and backtests the same ~25 indicator strategies on EVERY symbol,
then aggregates per strategy (avg/median return, % of symbols where it beat
buy & hold, avg win rate / drawdown). Output: public/data/bist/strategies.json

Run after build_bist.py:
  pip install numpy pandas
  python scripts/strategies.py
"""
from __future__ import annotations

import bisect
import glob
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "bist"
SKIP = {"symbols.json", "quotes.json", "strategies.json"}


def ema(a: np.ndarray, length: int) -> np.ndarray:
    return pd.Series(a).ewm(span=length, adjust=False).mean().to_numpy()


def backtest(close: np.ndarray, pos: np.ndarray):
    n = len(close)
    if n < 3:
        return None
    rets = close[1:] / close[:-1]
    held = np.where(pos[:-1] > 0, rets, 1.0)
    eq = np.cumprod(held)
    ret = (eq[-1] - 1) * 100.0
    peak = np.maximum.accumulate(eq)
    dd = float(((peak - eq) / peak).max() * 100.0)

    p = pos.astype(np.int8)
    entries = (np.where((p[1:] == 1) & (p[:-1] == 0))[0] + 1).tolist()
    exits = (np.where((p[1:] == 0) & (p[:-1] == 1))[0] + 1).tolist()
    trades = 0
    wins = 0
    for e in entries:
        i = bisect.bisect_right(exits, e)
        x = exits[i] if i < len(exits) else n - 1
        trades += 1
        if close[x] > close[e]:
            wins += 1
    win = (wins / trades * 100.0) if trades else 0.0
    return ret, trades, win, dd


def strategies_for(close, high, low):
    n = len(close)
    out: dict[str, np.ndarray] = {}

    for a, b in [(9, 21), (20, 50), (50, 200), (89, 377), (377, 610)]:
        out[f"EMA {a}/{b} kesişimi"] = (ema(close, a) > ema(close, b)).astype(np.int8)

    for f, sl, sg in [(12, 26, 9), (120, 260, 50), (50, 100, 20), (8, 21, 5)]:
        fast, slow = ema(close, f), ema(close, sl)
        macd = fast - slow
        sig = ema(macd, sg)
        out[f"MACD {f}/{sl}/{sg} > Sinyal"] = (macd > sig).astype(np.int8)
        out[f"MACD {f}/{sl} > 0"] = (macd > 0).astype(np.int8)

    for L in [14, 50, 260]:
        hh = pd.Series(high).rolling(L, min_periods=1).max().to_numpy()
        ll = pd.Series(low).rolling(L, min_periods=1).min().to_numpy()
        d = hh - ll
        pr = np.where(d != 0, 100.0 * (close - hh) / d + 100.0, np.nan)
        for lo, hi in [(20, 80), (30, 70), (10, 90)]:
            pos = np.zeros(n, dtype=np.int8)
            cur = 0
            for i in range(1, n):
                a, bb = pr[i - 1], pr[i]
                if np.isfinite(a) and np.isfinite(bb):
                    if cur == 0 and a <= lo and bb > lo:
                        cur = 1
                    elif cur == 1 and a >= hi and bb < hi:
                        cur = 0
                pos[i] = cur
            out[f"%R {L} ({lo}/{hi})"] = pos
        out[f"%R {L} > 50"] = np.where(np.isfinite(pr) & (pr > 50), 1, 0).astype(np.int8)

    return out


def main() -> int:
    agg: dict[str, dict] = {}
    holds = []
    nsym = 0

    for fp in sorted(glob.glob(str(OUT / "*.json"))):
        if os.path.basename(fp) in SKIP:
            continue
        try:
            recs = json.load(open(fp, encoding="utf-8"))["data"]
        except Exception:
            continue
        if len(recs) < 80:
            continue
        close = np.array([r["c"] for r in recs], dtype=float)
        high = np.array([r["h"] for r in recs], dtype=float)
        low = np.array([r["l"] for r in recs], dtype=float)
        if not np.all(np.isfinite(close)) or close.min() <= 0:
            continue

        hold = (close[-1] / close[0] - 1) * 100.0
        holds.append(hold)
        nsym += 1
        for sname, pos in strategies_for(close, high, low).items():
            bt = backtest(close, pos)
            if not bt:
                continue
            ret, _trades, win, dd = bt
            a = agg.setdefault(sname, {"rets": [], "wins": [], "dds": [], "beats": 0, "n": 0})
            a["rets"].append(ret)
            a["wins"].append(win)
            a["dds"].append(dd)
            a["n"] += 1
            if ret > hold:
                a["beats"] += 1

    results = []
    for sname, a in agg.items():
        rets = np.array(a["rets"])
        results.append({
            "name": sname,
            "avgRet": round(float(rets.mean()), 1),
            "medRet": round(float(np.median(rets)), 1),
            "beatPct": round(a["beats"] / a["n"] * 100.0, 1),
            "avgWin": round(float(np.mean(a["wins"])), 1),
            "avgDD": round(float(np.mean(a["dds"])), 1),
            "n": a["n"],
        })
    results.sort(key=lambda x: x["avgRet"], reverse=True)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "strategies.json", "w", encoding="utf-8") as f:
        json.dump({
            "generated": int(time.time()),
            "nSymbols": nsym,
            "holdAvg": round(float(np.mean(holds)), 1) if holds else 0,
            "results": results,
        }, f, separators=(",", ":"))
    print(f"[strategies] {nsym} hisse, {len(results)} strateji -> strategies.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
