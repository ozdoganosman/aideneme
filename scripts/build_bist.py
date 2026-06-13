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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "bist"

# Likit BIST hisseleri (gerekirse genişlet).
SYMBOLS = [
    "THYAO", "GARAN", "AKBNK", "ASELS", "KCHOL", "SISE", "EREGL", "BIMAS",
    "SAHOL", "TUPRS", "FROTO", "PGSUS", "TCELL", "ISCTR", "YKBNK", "KOZAL",
    "KOZAA", "SASA", "HEKTS", "TOASO", "TTKOM", "PETKM", "ENKAI", "KRDMD",
    "VESTL", "GUBRF", "ARCLK", "OYAKC", "TAVHL", "DOHOL", "EKGYO", "ALARK",
    "MGROS", "ULKER", "SOKM", "TKFEN", "AEFES", "BRSAN", "KONTR", "SMRTG",
    "ODAS", "CIMSA", "AKSEN", "ENJSA", "ZOREN", "OTKAR", "CCOLA", "TTRAK",
]

MAX_WORKERS = 8


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


def _fetch_one(sym: str):
    try:
        import borsapy as bp
        df = bp.Ticker(sym).history(period="max", interval="1d")
        if df is None or df.empty or len(df) < 5:
            return sym, None
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
        print(f"[bist] {sym} FAIL: {e}")
        return sym, None


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ok: list[str] = []
    try:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futs = {pool.submit(_fetch_one, s): s for s in SYMBOLS}
            for fut in as_completed(futs):
                sym, recs = fut.result()
                if recs:
                    with open(OUT / f"{sym}.json", "w", encoding="utf-8") as f:
                        json.dump({"data": recs}, f, separators=(",", ":"))
                    ok.append(sym)
                    print(f"[bist] {sym}: {len(recs)} bar")
    except Exception as e:  # noqa
        print(f"[bist] toplu hata: {e}")

    ok.sort()
    # symbols.json'u her durumda yaz ki uygulama 404 almasın.
    with open(OUT / "symbols.json", "w", encoding="utf-8") as f:
        json.dump({"symbols": ok}, f)
    print(f"[bist] bitti: {len(ok)}/{len(SYMBOLS)} sembol")
    return 0  # kısmi başarısızlık deploy'u düşürmesin


if __name__ == "__main__":
    raise SystemExit(main())
