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
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"
SCHEMA_VERSION = 4  # bump when item fields change to force a recompute


def load_index_symbols() -> set:
    """Index symbols (XU100, XBANK, BISTTLREF, …) — excluded; this is a stock screener."""
    try:
        d = json.load(open(SYMBOLS_FILE, encoding="utf-8"))
        return {s["name"] for s in d.get("indices", [])}
    except Exception:
        return set()


def adx_wilder(high, low, close, length: int):
    """Wilder ADX (0–100). Mirrors the in-app indicators/calc.ts implementation."""
    n = len(close)
    out = np.full(n, np.nan)
    if n < length + 1:
        return out
    tr = np.zeros(n)
    pdm = np.zeros(n)
    ndm = np.zeros(n)
    for i in range(1, n):
        up = high[i] - high[i - 1]
        dn = low[i - 1] - low[i]
        pdm[i] = up if (up > dn and up > 0) else 0.0
        ndm[i] = dn if (dn > up and dn > 0) else 0.0
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    s_tr = tr[1:length + 1].sum()
    s_pdm = pdm[1:length + 1].sum()
    s_ndm = ndm[1:length + 1].sum()
    dx = np.full(n, np.nan)
    for i in range(length + 1, n):
        s_tr = s_tr - s_tr / length + tr[i]
        s_pdm = s_pdm - s_pdm / length + pdm[i]
        s_ndm = s_ndm - s_ndm / length + ndm[i]
        pdi = 100 * s_pdm / s_tr if s_tr else 0.0
        ndi = 100 * s_ndm / s_tr if s_tr else 0.0
        ds = pdi + ndi
        dx[i] = 100 * abs(pdi - ndi) / ds if ds else 0.0
    first = length + 1
    if first + length > n:
        return out
    adx = float(np.nanmean(dx[first:first + length]))
    out[first + length - 1] = adx
    for i in range(first + length, n):
        adx = (adx * (length - 1) + dx[i]) / length
        out[i] = adx
    return out


def load_names() -> dict:
    try:
        return json.load(open(OUT / "names.json", encoding="utf-8"))
    except Exception:
        return {}


def main() -> int:
    # Snapshot of "today"; refresh on the scheduled full run, reuse on pushes —
    # but always recompute when the schema changes.
    sj = OUT / "screener.json"
    if os.environ.get("FORCE_ALL") != "1" and sj.exists():
        try:
            if json.load(open(sj, encoding="utf-8")).get("v") == SCHEMA_VERSION:
                print("[screener] güncel, atlanıyor")
                return 0
        except Exception:  # noqa
            pass

    names = load_names()
    indices = load_index_symbols()
    items = []

    for fp in sorted(glob.glob(str(OUT / "*.json"))):
        if os.path.basename(fp) in SKIP:
            continue
        sym = os.path.splitext(os.path.basename(fp))[0]
        if sym in indices:
            continue  # endeks (XU100, XBANK, …) — hisse taramasına girmez
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

        # Williams Paşa: %R(260) (+100 convention) and its EMA(260).
        hh = pd.Series(high).rolling(260, min_periods=1).max().to_numpy()
        ll = pd.Series(low).rolling(260, min_periods=1).min().to_numpy()
        dpr = hh - ll
        pr = np.where(dpr != 0, 100.0 * (close - hh) / dpr + 100.0, np.nan)
        wr = float(pr[-1]) if np.isfinite(pr[-1]) else 50.0
        wre_arr = ema(pr, 260)
        wre = float(wre_arr[-1]) if np.isfinite(wre_arr[-1]) else wr

        # Standard MACD flag (for views/quick filters).
        macd_s = ema(close, 12) - ema(close, 26)
        sig_s = ema(macd_s, 9)
        mu = 1 if macd_s[-1] > sig_s[-1] else 0
        st = int(supertrend_pos(high, low, close, 10, 3.0)[-1])

        # NizamiCedid: MACD(120/260), Signal(50), VWMA-185 eMACD, Δ — normalized
        # by the fast EMA exactly like the on-chart indicator.
        fast = ema(close, 120)
        slow = ema(close, 260)
        macd = fast - slow
        signal = ema(macd, 50)
        vwn = pd.Series(macd * volu).rolling(185, min_periods=1).sum().to_numpy()
        vwd = pd.Series(volu).rolling(185, min_periods=1).sum().to_numpy()
        emacd = np.where(vwd != 0, vwn / vwd, np.nan)
        fl = fast[-1] if fast[-1] != 0 else np.nan
        mc = float(macd[-1] / fl) if np.isfinite(fl) else 0.0
        sg = float(signal[-1] / fl) if np.isfinite(fl) else 0.0
        em = float(emacd[-1] / fl) if (np.isfinite(fl) and np.isfinite(emacd[-1])) else 0.0
        dl = mc - em

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

        # ── New long-term indicators (match the chart, 260 paradigm) ───────────
        adx_arr = adx_wilder(high, low, close, 28)
        adx_last = float(adx_arr[-1]) if adx_arr.size and np.isfinite(adx_arr[-1]) else None
        wre2_arr = ema(pr, 120)  # %R EMA (120)
        wre2 = float(wre2_arr[-1]) if np.isfinite(wre2_arr[-1]) else wr
        roc = float((last / close[n - 261] - 1) * 100) if n > 260 and close[n - 261] > 0 else None

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
            "wre": round(wre),
            "mc": round(mc, 4),
            "sg": round(sg, 4),
            "em": round(em, 4),
            "dl": round(dl, 4),
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
            "adx": (round(adx_last) if adx_last is not None else None),
            "wre2": round(wre2),
            "roc": (round(roc) if roc is not None else None),
        })

    OUT.mkdir(parents=True, exist_ok=True)
    with open(sj, "w", encoding="utf-8") as fo:
        json.dump({"generated": int(time.time()), "v": SCHEMA_VERSION, "items": items}, fo, separators=(",", ":"))
    print(f"[screener] {len(items)} hisse -> screener.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
