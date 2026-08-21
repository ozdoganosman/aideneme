"""
Kripto (market-cap top N) veri üreticisi — CoinGecko'dan mcap'e göre sıralı liste,
yfinance ile USD bazlı günlük OHLCV. public/data/crypto/ altına build_bist.py ile
AYNI şemada statik JSON yazar.

Çalıştırma:
  pip install yfinance requests
  CRYPTO_N=100 python scripts/build_crypto.py
"""
from __future__ import annotations

import json
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "crypto"
N = int(os.environ.get("CRYPTO_N", "100"))
MAX_WORKERS = 6
RETRIES = 4
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Stablecoin / sarmalanmış (wrapped) — fiyat hareketi yok / yfinance'te anlamsız.
SKIP = {
    "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDE", "FDUSD", "USDS", "PYUSD", "GUSD",
    "WBTC", "WETH", "WEETH", "WSTETH", "STETH", "WBETH", "CBBTC", "RETH", "LEO",
}
CORE_FALLBACK = [
    ("BTC", "Bitcoin"), ("ETH", "Ethereum"), ("BNB", "BNB"), ("SOL", "Solana"),
    ("XRP", "XRP"), ("ADA", "Cardano"), ("DOGE", "Dogecoin"), ("TRX", "TRON"),
    ("AVAX", "Avalanche"), ("LINK", "Chainlink"), ("DOT", "Polkadot"), ("MATIC", "Polygon"),
    ("LTC", "Litecoin"), ("BCH", "Bitcoin Cash"), ("XLM", "Stellar"), ("ATOM", "Cosmos"),
    ("UNI", "Uniswap"), ("ETC", "Ethereum Classic"), ("FIL", "Filecoin"), ("APT", "Aptos"),
    ("NEAR", "NEAR Protocol"), ("ICP", "Internet Computer"), ("AAVE", "Aave"), ("ARB", "Arbitrum"),
]


def coin_list(n: int) -> list[tuple[str, str]]:
    """(base symbol, name) — CoinGecko mcap sırası; düşerse CORE fallback."""
    try:
        import requests
        r = requests.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            params={"vs_currency": "usd", "order": "market_cap_desc",
                    "per_page": min(n + 30, 250), "page": 1, "sparkline": "false"},
            headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30,
        )
        r.raise_for_status()
        out: list[tuple[str, str]] = []
        seen = set()
        for c in r.json():
            sym = str(c.get("symbol", "")).upper().strip()
            if not sym or sym in SKIP or sym in seen or not sym.isalnum():
                continue
            seen.add(sym)
            out.append((sym, c.get("name") or sym))
            if len(out) >= n:
                break
        if out:
            print(f"[crypto] CoinGecko: {len(out)} coin")
            return out
    except Exception as e:  # noqa
        print("[crypto] CoinGecko hata:", e)
    print("[crypto] CORE fallback")
    return CORE_FALLBACK[:n]


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
    """sym = base (BTC); yfinance ticker = BTC-USD."""
    import yfinance as yf
    last = ""
    for attempt in range(RETRIES):
        try:
            time.sleep(random.uniform(0.05, 0.35))
            df = yf.Ticker(f"{sym}-USD").history(period="max", interval="1d", auto_adjust=True)
            if df is None or df.empty or len(df) < 5:
                last = "empty"
                raise RuntimeError("empty")
            recs = []
            for idx, row in df.iterrows():
                v = row["Volume"]
                recs.append({
                    "t": _epoch(idx),
                    "o": round(float(row["Open"]), 6),
                    "h": round(float(row["High"]), 6),
                    "l": round(float(row["Low"]), 6),
                    "c": round(float(row["Close"]), 6),
                    "v": 0 if (v is None or v != v) else int(v),
                })
            return sym, recs
        except Exception as e:  # noqa
            last = str(e) or last
            if attempt < RETRIES - 1:
                time.sleep(1.0 + attempt * 1.5 + random.random())
    print(f"[crypto] {sym} FAIL: {last}")
    return sym, None


def _quote(recs: list) -> dict:
    last = recs[-1]["c"]
    prev = recs[-2]["c"] if len(recs) >= 2 else last
    return {"c": last, "pc": prev}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    coins = coin_list(N)
    names = {s: n for s, n in coins}
    symbols = [s for s, _ in coins]
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

    print(f"[crypto] {len(to_fetch)}/{total} cekilecek (mevcut {len(ok)}, force={force_all})")
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
    except Exception as e:  # noqa
        print(f"[crypto] toplu hata: {e}")

    # Sıralama mcap'e göre (coin_list sırası); symbols.json bu sırayı korur.
    ok_sorted = [s for s in symbols if s in set(ok)]
    with open(OUT / "symbols.json", "w", encoding="utf-8") as f:
        json.dump({"symbols": ok_sorted}, f)
    with open(OUT / "quotes.json", "w", encoding="utf-8") as f:
        json.dump(quotes, f, separators=(",", ":"))
    with open(OUT / "names.json", "w", encoding="utf-8") as f:
        json.dump({s: names.get(s, s) for s in ok_sorted}, f, ensure_ascii=False, separators=(",", ":"))
    with open(OUT / "spark.json", "w", encoding="utf-8") as f:
        json.dump(spark, f, separators=(",", ":"))
    print(f"[crypto] bitti: {len(ok_sorted)}/{total} coin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
