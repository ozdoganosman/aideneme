"""
US (NYSE/NASDAQ büyük kaplar) veri üreticisi — S&P 500 + Nasdaq-100 listesini
çeker, yfinance ile günlük OHLCV indirir ve public/data/us/ altına build_bist.py
ile AYNI şemada statik JSON yazar. Tarayıcı kendi origin'inden okur.

Çalıştırma:
  pip install yfinance pandas requests
  python scripts/build_us.py        # incremental (sadece eksikler)
  FORCE_ALL=1 python scripts/build_us.py   # tam yenileme (taze fiyatlar)
"""
from __future__ import annotations

import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "us"
MAX_WORKERS = 6
RETRIES = 4

# Kaynaklar düşerse en azından bunlar gelsin (büyük kaplar).
CORE_FALLBACK = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "AMZN": "Amazon",
    "GOOGL": "Alphabet", "META": "Meta Platforms", "TSLA": "Tesla", "BRK-B": "Berkshire Hathaway",
    "JPM": "JPMorgan Chase", "V": "Visa", "UNH": "UnitedHealth", "XOM": "Exxon Mobil",
    "JNJ": "Johnson & Johnson", "WMT": "Walmart", "MA": "Mastercard", "PG": "Procter & Gamble",
    "HD": "Home Depot", "COST": "Costco", "ORCL": "Oracle", "BAC": "Bank of America",
    "KO": "Coca-Cola", "PEP": "PepsiCo", "NFLX": "Netflix", "AMD": "AMD", "ADBE": "Adobe",
    "CRM": "Salesforce", "INTC": "Intel", "CSCO": "Cisco", "MCD": "McDonald's", "ABBV": "AbbVie",
    "WFC": "Wells Fargo", "DIS": "Walt Disney", "QCOM": "Qualcomm", "TXN": "Texas Instruments",
    "AVGO": "Broadcom", "NKE": "Nike", "PM": "Philip Morris", "AMAT": "Applied Materials",
    "HON": "Honeywell", "IBM": "IBM", "GE": "GE Aerospace", "CAT": "Caterpillar", "BA": "Boeing",
    "PFE": "Pfizer", "T": "AT&T", "VZ": "Verizon", "MU": "Micron", "GS": "Goldman Sachs",
}


def _norm(sym: str) -> str:
    return sym.strip().upper().replace(".", "-")


def _valid(sym: str) -> bool:
    return bool(re.fullmatch(r"[A-Z][A-Z0-9-]{0,6}", sym))


def load_constituents() -> dict:
    """symbol -> company name. S&P 500 (datahub CSV) + Nasdaq-100 (Wikipedia)."""
    out: dict[str, str] = {}
    try:
        import pandas as pd
    except Exception as e:  # noqa
        print("[us] pandas yok:", e)
        return dict(CORE_FALLBACK)

    for url in (
        "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
        "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv",
    ):
        try:
            df = pd.read_csv(url)
            sc = next((c for c in df.columns if str(c).lower() in ("symbol", "ticker")), None)
            nc = next((c for c in df.columns if str(c).lower() in ("security", "name", "company")), None)
            if sc:
                for _, r in df.iterrows():
                    s = _norm(str(r[sc]))
                    if _valid(s):
                        out[s] = str(r[nc]) if nc else s
            if out:
                print(f"[us] S&P 500: {len(out)} sembol")
                break
        except Exception as e:  # noqa
            print("[us] S&P500 kaynak hata:", e)

    try:
        import pandas as pd
        tabs = pd.read_html("https://en.wikipedia.org/wiki/Nasdaq-100")
        added = 0
        for t in tabs:
            low = {str(c).lower(): c for c in t.columns}
            tk = low.get("ticker") or low.get("symbol")
            nm = low.get("company") or low.get("security") or low.get("name")
            if not tk:
                continue
            for _, r in t.iterrows():
                s = _norm(str(r[tk]))
                if _valid(s):
                    out.setdefault(s, str(r[nm]) if nm else s)
                    added += 1
            if added:
                break
        print(f"[us] Nasdaq-100 sonrası toplam: {len(out)} sembol")
    except Exception as e:  # noqa
        print("[us] Nasdaq-100 kaynak hata:", e)

    if len(out) < 50:
        print("[us] kaynaklar yetersiz → CORE fallback")
        for k, v in CORE_FALLBACK.items():
            out.setdefault(k, v)
    return out


def _epoch(idx) -> int:
    try:
        ts = idx.to_pydatetime()
    except Exception:  # noqa
        import pandas as pd  # noqa
        ts = pd.Timestamp(idx).to_pydatetime()
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int(ts.timestamp())


def _fetch_one(sym: str):
    import yfinance as yf
    last = ""
    for attempt in range(RETRIES):
        try:
            time.sleep(random.uniform(0.05, 0.35))
            df = yf.Ticker(sym).history(period="max", interval="1d", auto_adjust=True)
            if df is None or df.empty or len(df) < 5:
                last = "empty"
                raise RuntimeError("empty")
            recs = []
            for idx, row in df.iterrows():
                v = row["Volume"]
                recs.append({
                    "t": _epoch(idx),
                    "o": round(float(row["Open"]), 4),
                    "h": round(float(row["High"]), 4),
                    "l": round(float(row["Low"]), 4),
                    "c": round(float(row["Close"]), 4),
                    "v": 0 if (v is None or v != v) else int(v),
                })
            return sym, recs
        except Exception as e:  # noqa
            last = str(e) or last
            if attempt < RETRIES - 1:
                time.sleep(1.0 + attempt * 1.5 + random.random())
    print(f"[us] {sym} FAIL: {last}")
    return sym, None


def _quote(recs: list) -> dict:
    last = recs[-1]["c"]
    prev = recs[-2]["c"] if len(recs) >= 2 else last
    return {"c": last, "pc": prev}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    names = load_constituents()
    symbols = sorted(names.keys())
    total = len(symbols)
    force_all = os.environ.get("FORCE_ALL") == "1"

    ok: list[str] = []
    quotes: dict = {}
    spark: dict = {}
    to_fetch: list[str] = []
    for sym in symbols:
        path = OUT / f"{sym}.json"
        if path.exists() and not force_all:
            try:
                recs = json.load(open(path, encoding="utf-8"))["data"]
                if recs:
                    ok.append(sym)
                    quotes[sym] = _quote(recs)
                    spark[sym] = [r["c"] for r in recs[-30:]]
                    continue
            except Exception:  # noqa
                pass
        to_fetch.append(sym)

    print(f"[us] {len(to_fetch)}/{total} cekilecek (mevcut {len(ok)} korunuyor, force={force_all})")
    done = 0
    try:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futs = {pool.submit(_fetch_one, s): s for s in to_fetch}
            for fut in as_completed(futs):
                done += 1
                sym, recs = fut.result()
                if recs:
                    with open(OUT / f"{sym}.json", "w", encoding="utf-8") as f:
                        json.dump({"data": recs}, f, separators=(",", ":"))
                    ok.append(sym)
                    quotes[sym] = _quote(recs)
                    spark[sym] = [r["c"] for r in recs[-30:]]
                if to_fetch and (done % 50 == 0 or done == len(to_fetch)):
                    print(f"[us] {done}/{len(to_fetch)}  ok_total={len(ok)}")
    except Exception as e:  # noqa
        print(f"[us] toplu hata: {e}")

    ok.sort()
    with open(OUT / "symbols.json", "w", encoding="utf-8") as f:
        json.dump({"symbols": ok}, f)
    with open(OUT / "quotes.json", "w", encoding="utf-8") as f:
        json.dump(quotes, f, separators=(",", ":"))
    with open(OUT / "names.json", "w", encoding="utf-8") as f:
        json.dump({s: names.get(s, s) for s in ok}, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "spark.json", "w", encoding="utf-8") as f:
        json.dump(spark, f, separators=(",", ":"))
    print(f"[us] bitti: {len(ok)}/{total} sembol")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
