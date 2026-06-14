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
    mult = float(eq[-1])  # final equity multiple (1.0 = flat)
    ret = (mult - 1) * 100.0
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
    return ret, trades, win, dd, mult


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
    # Self-gate: skip if strategies.json is already up to date (has avgHold),
    # unless FORCE_ALL=1 (scheduled full refresh). Lets the step run every deploy
    # but stay fast when nothing changed.
    sj = OUT / "strategies.json"
    if os.environ.get("FORCE_ALL") != "1" and sj.exists():
        try:
            cur = json.load(open(sj, encoding="utf-8"))
            if cur.get("results") and "avgAnn" in cur["results"][0]:
                print("[strategies] güncel, atlanıyor")
                return 0
        except Exception:  # noqa
            pass

    agg: dict[str, dict] = {}
    holds = []
    hold_anns = []
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

        nbars = len(close)
        # Calendar span (t is unix seconds); fall back to daily-bar count. Floor at
        # 0.75y so a short-history rocket can't explode the annualized figure.
        t0 = recs[0].get("t")
        t1 = recs[-1].get("t")
        if t0 and t1 and t1 > t0:
            years = (t1 - t0) / (365.25 * 86400.0)
        else:
            years = nbars / 252.0
        years = max(years, 0.75)

        hold = (close[-1] / close[0] - 1) * 100.0
        holds.append(hold)
        hold_anns.append(((close[-1] / close[0]) ** (1.0 / years) - 1) * 100.0)
        nsym += 1
        for sname, pos in strategies_for(close, high, low).items():
            bt = backtest(close, pos)
            if not bt:
                continue
            ret, trades, win, dd, mult = bt
            ann = (mult ** (1.0 / years) - 1) * 100.0 if mult > 0 else -100.0
            a = agg.setdefault(
                sname,
                {"rets": [], "anns": [], "wins": [], "dds": [], "holds": [], "trd": [], "beats": 0, "n": 0},
            )
            a["rets"].append(ret)
            a["anns"].append(ann)
            a["wins"].append(win)
            a["dds"].append(dd)
            a["holds"].append(nbars / trades if trades > 0 else nbars)  # avg holding (bars)
            a["trd"].append(trades)
            a["n"] += 1
            if ret > hold:
                a["beats"] += 1

    results = []
    for sname, a in agg.items():
        rets = np.array(a["rets"])
        anns = np.array(a["anns"])
        results.append({
            "name": sname,
            "avgRet": round(float(rets.mean()), 1),
            "medRet": round(float(np.median(rets)), 1),
            "avgAnn": round(float(anns.mean()), 1),
            "medAnn": round(float(np.median(anns)), 1),
            "beatPct": round(a["beats"] / a["n"] * 100.0, 1),
            "avgWin": round(float(np.mean(a["wins"])), 1),
            "avgDD": round(float(np.mean(a["dds"])), 1),
            "avgHold": round(float(np.mean(a["holds"])), 0),
            "avgTrades": round(float(np.mean(a["trd"])), 0),
            "n": a["n"],
        })
    # Rank by annualized (per-day-normalized) return, not raw total.
    results.sort(key=lambda x: x["avgAnn"], reverse=True)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "strategies.json", "w", encoding="utf-8") as f:
        json.dump({
            "generated": int(time.time()),
            "nSymbols": nsym,
            "holdAvg": round(float(np.mean(holds)), 1) if holds else 0,
            "holdAnnAvg": round(float(np.mean(hold_anns)), 1) if hold_anns else 0,
            "results": results,
        }, f, separators=(",", ":"))
    print(f"[strategies] {nsym} hisse, {len(results)} strateji -> strategies.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
