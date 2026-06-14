"""
Per-symbol CURRENT indicator snapshot for the in-app stock screener. Reads the
per-symbol OHLCV JSON produced by build_bist.py and emits a compact
public/data/bist/screener.json the browser can filter instantly (no need to
fetch every symbol's full history). Reuses helpers from strategies.py.

Run after build_bist.py:
  python scripts/screener.py
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from strategies import ema, rsi_arr, supertrend_pos  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "bist"
SKIP = {"symbols.json", "quotes.json", "strategies.json", "names.json", "spark.json", "screener.json"}


def load_names() -> dict:
    try:
        return json.load(open(OUT / "names.json", encoding="utf-8"))
    except Exception:
        return {}


def main() -> int:
    # Snapshot of "today"; refresh on the scheduled full run, reuse on pushes.
    sj = OUT / "screener.json"
    if os.environ.get("FORCE_ALL") != "1" and sj.exists():
        print("[screener] güncel, atlanıyor")
        return 0

    names = load_names()
    items = []

    for fp in sorted(glob.glob(str(OUT / "*.json"))):
        if os.path.basename(fp) in SKIP:
            continue
        sym = os.path.splitext(os.path.basename(fp))[0]
        try:
            recs = json.load(open(fp, encoding="utf-8"))["data"]
        except Exception:
            continue
        if len(recs) < 60:
            continue
        close = np.array([r["c"] for r in recs], dtype=float)
        high = np.array([r["h"] for r in recs], dtype=float)
        low = np.array([r["l"] for r in recs], dtype=float)
        volu = np.array([r.get("v", 0) for r in recs], dtype=float)
        if not np.all(np.isfinite(close)) or close.min() <= 0:
            continue

        n = len(close)
        last = close[-1]
        prev = close[-2] if n > 1 else last
        times = [r.get("t", 0) for r in recs]
        t0, t1 = times[0], times[-1]
        years = (t1 - t0) / (365.25 * 86400.0) if t0 and t1 and t1 > t0 else n / 252.0

        def idx_since(days: int) -> int:
            if not t1:
                return max(0, n - int(days * 252 / 365))
            cut = t1 - days * 86400
            i = n - 1
            while i > 0 and times[i - 1] >= cut:
                i -= 1
            return i

        def ret(days: int) -> float:
            i = idx_since(days)
            return (last / close[i] - 1) * 100 if close[i] > 0 else 0.0

        e50 = ema(close, 50)
        e200 = ema(close, 200)
        rsi = rsi_arr(close, 14)
        rsi_last = float(rsi[-1]) if np.isfinite(rsi[-1]) else 50.0

        hh260 = float(pd.Series(high).rolling(260, min_periods=1).max().to_numpy()[-1])
        ll260 = float(pd.Series(low).rolling(260, min_periods=1).min().to_numpy()[-1])
        wr = (100.0 * (last - hh260) / (hh260 - ll260) + 100.0) if hh260 > ll260 else 50.0

        macd = ema(close, 12) - ema(close, 26)
        sig = ema(macd, 9)
        mu = 1 if macd[-1] > sig[-1] else 0
        st = int(supertrend_pos(high, low, close, 10, 3.0)[-1])

        i1y = idx_since(365)
        hi52 = float(high[i1y:].max())
        fh = (last / hi52 - 1) * 100 if hi52 > 0 else 0.0

        start = max(1, n - 252)
        rs = close[start:] / close[start - 1:-1] - 1
        rs = rs[np.isfinite(rs)]
        vol = float(np.std(rs, ddof=1) * np.sqrt(252) * 100) if rs.size > 1 else 0.0

        peak = np.maximum.accumulate(close)
        dd = float(((peak - close) / peak).max() * 100)
        av = float(volu[-20:].mean()) if n >= 1 else 0.0
        ch = (last / prev - 1) * 100 if prev > 0 else 0.0

        items.append({
            "s": sym,
            "n": names.get(sym, ""),
            "p": round(last, 2),
            "ch": round(ch, 2),
            "rsi": round(rsi_last),
            "e50": 1 if last > e50[-1] else 0,
            "e200": 1 if last > e200[-1] else 0,
            "gc": 1 if e50[-1] > e200[-1] else 0,
            "wr": round(wr),
            "mu": mu,
            "st": st,
            "fh": round(fh, 1),
            "r1m": round(ret(30)),
            "r3m": round(ret(90)),
            "r1y": round(ret(365)),
            "vol": round(vol),
            "dd": round(dd),
            "av": round(av),
            "yr": round(years, 1),
        })

    OUT.mkdir(parents=True, exist_ok=True)
    with open(sj, "w", encoding="utf-8") as fo:
        json.dump({"generated": int(time.time()), "items": items}, fo, separators=(",", ":"))
    print(f"[screener] {len(items)} hisse -> screener.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
