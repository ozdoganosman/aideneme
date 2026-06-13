"""
BIST veri üreticisi — borsapy ile sunucu tarafında (CI'da) OHLCV çeker ve
public/data/bist/ altına statik JSON yazar. Tarayıcı bunları kendi origin'inden
okur: proxy/key/CORS gerekmez.

Çalıştırma:
  pip install borsapy numpy
  python scripts/build_bist.py
"""
from __future__ import annotations

import json
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "bist"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"


def load_symbols() -> list[str]:
    """Tüm BIST hisseleri (+ endeksleri) bist_symbols.json'dan."""
    try:
        with open(SYMBOLS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        syms = [s["name"] for s in data.get("stocks", [])]
        syms += [s["name"] for s in data.get("indices", [])]
        return syms
    except Exception as e:  # noqa
        print(f"[bist] sembol listesi okunamadı: {e}")
        return ["THYAO", "GARAN", "AKBNK", "ASELS", "SISE"]


MAX_WORKERS = 6


def _epoch(idx) -> int:
    """pandas Timestamp -> unix saniye (UTC)."""
    try:
        ts = idx.to_pydatetime()
    except Exception:
        import pandas as pd  # noqa
        ts = pd.Timestamp(idx).to_pydatetime()
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int(ts.timestamp())


RETRIES = 4


def _fetch_one(sym: str):
    import borsapy as bp
    last = ""
    for attempt in range(RETRIES):
        try:
            time.sleep(random.uniform(0.05, 0.35))  # jitter to ease rate limits
            df = bp.Ticker(sym).history(period="max", interval="1d")
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
                time.sleep(1.0 + attempt * 1.5 + random.random())  # backoff
    print(f"[bist] {sym} FAIL: {last}")
    return sym, None


def _quote(recs: list) -> dict:
    last = recs[-1]["c"]
    prev = recs[-2]["c"] if len(recs) >= 2 else last
    return {"c": last, "pc": prev}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    symbols = load_symbols()
    total = len(symbols)
    force_all = os.environ.get("FORCE_ALL") == "1"

    ok: list[str] = []
    quotes: dict = {}
    to_fetch: list[str] = []

    # Incremental: keep symbols that already have a JSON, fetch only the missing
    # ones. FORCE_ALL=1 (scheduled run) re-fetches everything for fresh prices.
    for sym in symbols:
        path = OUT / f"{sym}.json"
        if path.exists() and not force_all:
            try:
                recs = json.load(open(path, encoding="utf-8"))["data"]
                if recs:
                    ok.append(sym)
                    quotes[sym] = _quote(recs)
                    continue
            except Exception:  # noqa
                pass
        to_fetch.append(sym)

    print(f"[bist] {len(to_fetch)}/{total} cekilecek (mevcut {len(ok)} korunuyor, force={force_all})")
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
                if to_fetch and (done % 50 == 0 or done == len(to_fetch)):
                    print(f"[bist] {done}/{len(to_fetch)}  ok_total={len(ok)}")
    except Exception as e:  # noqa
        print(f"[bist] toplu hata: {e}")

    ok.sort()
    # symbols.json'u her durumda yaz ki uygulama 404 almasın.
    with open(OUT / "symbols.json", "w", encoding="utf-8") as f:
        json.dump({"symbols": ok}, f)
    # quotes.json: izleme listesi/portföy için tüm son fiyatlar (tek dosya).
    with open(OUT / "quotes.json", "w", encoding="utf-8") as f:
        json.dump(quotes, f, separators=(",", ":"))
    print(f"[bist] bitti: {len(ok)}/{total} sembol")
    return 0  # kısmi başarısızlık deploy'u düşürmesin


if __name__ == "__main__":
    raise SystemExit(main())
