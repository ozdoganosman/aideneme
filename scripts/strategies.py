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


def wilder_atr(high, low, close, length):
    n = len(close)
    tr = np.empty(n)
    tr[0] = high[0] - low[0]
    pc = close[:-1]
    tr[1:] = np.maximum.reduce([high[1:] - low[1:], np.abs(high[1:] - pc), np.abs(low[1:] - pc)])
    a = np.empty(n)
    a[0] = tr[0]
    k = (length - 1) / length
    inv = 1.0 / length
    for i in range(1, n):
        a[i] = a[i - 1] * k + tr[i] * inv
    return a


def supertrend_pos(high, low, close, length, mult):
    n = len(close)
    atr = wilder_atr(high, low, close, length)
    hl2 = (high + low) / 2.0
    ub = hl2 + mult * atr
    lb = hl2 - mult * atr
    p = np.zeros(n, dtype=np.int8)
    fu, fl, d = ub[0], lb[0], 1
    p[0] = 1
    for i in range(1, n):
        fu = ub[i] if (ub[i] < fu or close[i - 1] > fu) else fu
        fl = lb[i] if (lb[i] > fl or close[i - 1] < fl) else fl
        if close[i] > fu:
            d = 1
        elif close[i] < fl:
            d = 0
        p[i] = d
    return p


def donchian_pos(high, low, entry_n, exit_n):
    n = len(high)
    hh = pd.Series(high).rolling(entry_n, min_periods=1).max().to_numpy()
    ll = pd.Series(low).rolling(exit_n, min_periods=1).min().to_numpy()
    p = np.zeros(n, dtype=np.int8)
    cur = 0
    for i in range(1, n):
        if cur == 0 and high[i] >= hh[i - 1]:
            cur = 1
        elif cur == 1 and low[i] <= ll[i - 1]:
            cur = 0
        p[i] = cur
    return p


def roc_pos(close, length):
    n = len(close)
    p = np.zeros(n, dtype=np.int8)
    if n > length:
        p[length:] = (close[length:] > close[:-length]).astype(np.int8)
    return p


def rsi_arr(close, length):
    n = len(close)
    rsi = np.full(n, np.nan)
    if n <= length:
        return rsi
    diff = np.diff(close)
    gain = np.where(diff > 0, diff, 0.0)
    loss = np.where(diff < 0, -diff, 0.0)
    ag = gain[:length].mean()
    al = loss[:length].mean()
    rsi[length] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    k = (length - 1) / length
    inv = 1.0 / length
    for i in range(length + 1, n):
        ag = ag * k + gain[i - 1] * inv
        al = al * k + loss[i - 1] * inv
        rsi[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return rsi


def pasa_cedid_pos(close):
    n = len(close)
    e377 = ema(close, 377)
    e610 = ema(close, 610)
    fast = ema(close, 120)
    slow = ema(close, 260)
    macd = fast - slow
    sig = ema(macd, 50)
    p = np.zeros(n, dtype=np.int8)
    cur = 0
    for i in range(n):
        if cur == 0:
            if close[i] > e610[i] and close[i] > e377[i] and macd[i] > sig[i]:
                cur = 1
        elif close[i] < e610[i]:
            cur = 0
        p[i] = cur
    return p


def bollinger_pos(close, length, k):
    n = len(close)
    s = pd.Series(close)
    mean = s.rolling(length, min_periods=length).mean().to_numpy()
    std = s.rolling(length, min_periods=length).std(ddof=0).to_numpy()
    upper = mean + k * std
    p = np.zeros(n, dtype=np.int8)
    cur = 0
    for i in range(n):
        if not np.isfinite(upper[i]):
            p[i] = cur
            continue
        if cur == 0 and close[i] > upper[i]:
            cur = 1
        elif cur == 1 and close[i] < mean[i]:
            cur = 0
        p[i] = cur
    return p


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
        out[f"%R {L} > 50"] = np.where(np.isfinite(pr) & (pr > 50), 1, 0).astype(np.int8)

    # ── Stronger trend / breakout / volatility strategies ──────────────────────
    out["Supertrend 10/3"] = supertrend_pos(high, low, close, 10, 3.0)
    out["Supertrend 20/4"] = supertrend_pos(high, low, close, 20, 4.0)
    out["Donchian 20/10 kırılımı"] = donchian_pos(high, low, 20, 10)
    out["Donchian 55/20 kırılımı"] = donchian_pos(high, low, 55, 20)
    out["Momentum 120 (ROC>0)"] = roc_pos(close, 120)
    out["Momentum 252 (ROC>0)"] = roc_pos(close, 252)

    e200 = ema(close, 200)
    out["EMA 9/21 + Trend 200"] = ((ema(close, 9) > ema(close, 21)) & (close > e200)).astype(np.int8)
    out["EMA 20/50 + Trend 200"] = ((ema(close, 20) > ema(close, 50)) & (close > e200)).astype(np.int8)

    hh260 = pd.Series(high).rolling(260, min_periods=1).max().to_numpy()
    ll260 = pd.Series(low).rolling(260, min_periods=1).min().to_numpy()
    d260 = hh260 - ll260
    pr260 = np.where(d260 != 0, 100.0 * (close - hh260) / d260 + 100.0, np.nan)
    out["%R 260 > 50 + Trend 200"] = (np.isfinite(pr260) & (pr260 > 50) & (close > e200)).astype(np.int8)

    out["RSI 14 > 50"] = np.where(np.isfinite(r14 := rsi_arr(close, 14)) & (r14 > 50), 1, 0).astype(np.int8)
    out["RSI 50 > 50"] = np.where(np.isfinite(r50 := rsi_arr(close, 50)) & (r50 > 50), 1, 0).astype(np.int8)

    out["Bollinger 20 kırılımı"] = bollinger_pos(close, 20, 2.0)
    out["Paşa+Cedid (Trend 610 + MACD)"] = pasa_cedid_pos(close)

    return out


def current_names() -> set[str]:
    n = 700
    close = np.linspace(10.0, 50.0, n)
    high = close * 1.01
    low = close * 0.99
    return set(strategies_for(close, high, low).keys())


def main() -> int:
    # Self-gate: skip if strategies.json is already up to date (annualized metric
    # present AND same strategy set), unless FORCE_ALL=1 (scheduled full refresh).
    # Recomputes automatically when strategies are added/removed.
    sj = OUT / "strategies.json"
    if os.environ.get("FORCE_ALL") != "1" and sj.exists():
        try:
            cur = json.load(open(sj, encoding="utf-8"))
            names_file = {r["name"] for r in cur.get("results", [])}
            if cur.get("results") and "avgAnn" in cur["results"][0] and cur.get("top") and names_file == current_names():
                print("[strategies] güncel, atlanıyor")
                return 0
        except Exception:  # noqa
            pass

    agg: dict[str, dict] = {}
    holds = []
    hold_anns = []
    nsym = 0
    best_per_sym: dict[str, tuple] = {}  # symbol -> its single best (annualized) combo

    for fp in sorted(glob.glob(str(OUT / "*.json"))):
        if os.path.basename(fp) in SKIP:
            continue
        sym = os.path.splitext(os.path.basename(fp))[0]
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
            # Best (stock × strategy) combos for the Top-20 view — one per stock,
            # with enough history and not ultra-short-term/churny.
            if nbars >= 252 and trades >= 2 and mult > 1 and (nbars / trades) >= 25:
                prev = best_per_sym.get(sym)
                if prev is None or ann > prev[0]:
                    best_per_sym[sym] = (ann, ret, trades, win, dd, nbars / trades, sym, sname)
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

    # Top 20 (stock × strategy) combos overall — best annualized per stock.
    top_sorted = sorted(best_per_sym.values(), key=lambda x: x[0], reverse=True)[:20]
    top = [
        {
            "sym": s,
            "name": nm,
            "ann": round(an, 1),
            "ret": round(rt, 1),
            "trades": int(tr),
            "win": round(wn, 1),
            "dd": round(dd_, 1),
            "hold": round(hd, 0),
        }
        for (an, rt, tr, wn, dd_, hd, s, nm) in top_sorted
    ]

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "strategies.json", "w", encoding="utf-8") as f:
        json.dump({
            "generated": int(time.time()),
            "nSymbols": nsym,
            "holdAvg": round(float(np.mean(holds)), 1) if holds else 0,
            "holdAnnAvg": round(float(np.mean(hold_anns)), 1) if hold_anns else 0,
            "results": results,
            "top": top,
        }, f, separators=(",", ":"))
    print(f"[strategies] {nsym} hisse, {len(results)} strateji -> strategies.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
