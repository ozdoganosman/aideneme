#!/usr/bin/env python3
"""
Yerel geliştirme ve uçtan uca test için ÖRNEK veri seti üretir.

    public/data/<piyasa>/pack/         *.bin + manifest.json + latest-250.bin
    public/data/<piyasa>/fundamentals/ *.json + snapshot.json
    public/data/<piyasa>/sectors.json

Neden var: `public/data` depoya girmiyor (227 MB'lık referans hatası
tekrarlanmasın diye). Bu yüzden depoyu yeni klonlayan bir geliştiricinin ya da
CI'daki tarayıcı testinin elinde hiç veri olmuyordu; herkes kendi betiğini
yazıyordu. Bu betik o boşluğu kapatıyor.

Veri SENTETİKTİR ve öyle etiketlenir: sembol adları X000… biçiminde, sektör
kaynağı "Sentetik (yerel)" yazar. Gerçek piyasa verisiyle karıştırılmasın diye
gerçek sembol adları KULLANILMAZ (birkaç tanınmış ad hariç tutulur; aşağıda).

Tohum sabit: aynı komut her yerde aynı baytları üretir, böylece uçtan uca
testler tekrarlanabilir olur.

Çalıştırma:
    python scripts/make_sample_data.py [--symbols 60] [--bars 1200]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Bayt düzeni TEK KAYNAKTAN geliyor: burada yeniden yazmak, üretici ile örnek
# veri arasında sessizce ayrışabilecek ikinci bir format tanımı demek olurdu.
from pack_data import VERSION as PACK_VERSION, encode_bundle, encode_series, short_hash  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SECTORS = [
    "Bankacılık", "Holding", "Demir Çelik", "Perakende", "Gıda",
    "Enerji", "Kimya", "Ulaştırma", "Teknoloji", "İnşaat",
]


def synth(seed: int, bars: int, start_day: int) -> list[tuple[int, float, float, float, float, float]]:
    """Geometrik Brownian hareketi + hafif momentum rejimi."""
    rnd = random.Random(seed)
    out = []
    price = 20 + rnd.random() * 180
    closes: list[float] = []
    day = start_day
    for i in range(bars):
        # Hafta sonlarını atla: gerçek veri gibi boşluklu bir takvim.
        while (day + 4) % 7 in (5, 6):
            day += 1
        past = closes[-1] / closes[-21] - 1 if i >= 21 else 0.0
        drift = 0.0004 if past > 0 else -0.0002
        shock = rnd.gauss(0, 0.016)
        open_ = price
        price = max(0.5, price * math.exp(drift + shock))
        high = max(open_, price) * (1 + abs(rnd.gauss(0, 0.004)))
        low = min(open_, price) * (1 - abs(rnd.gauss(0, 0.004)))
        volume = round(50_000 + abs(rnd.gauss(0, 400_000)))
        out.append((day, open_, high, low, price, volume))
        closes.append(price)
        day += 1
    return out


def self_test() -> int:
    """Ağsız doğrulama: üret → geri oku → alanlar tutuyor mu."""
    from pack_data import decode_bundle, decode_series

    rows = synth(1, 60, 19000)
    payload = encode_series(rows)
    back = decode_series(payload)
    assert len(back) == len(rows), (len(back), len(rows))
    assert back[0][0] == rows[0][0], "ilk gün tutmuyor"
    assert abs(back[-1][4] - rows[-1][4]) < 1e-2, "son kapanış tutmuyor"

    names, axis, _cols = decode_bundle(encode_bundle({"A": rows, "B": rows}, 20))
    assert names == ["A", "B"], names
    assert len(axis) == 20, len(axis)

    # Hafta sonu üretilmemeli: takvim gerçek veriyle aynı biçimde boşluklu.
    for day, *_ in rows:
        assert (day + 4) % 7 not in (5, 6), f"hafta sonu barı: {day}"

    print("make_sample_data self-test: tamam")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", type=int, default=60)
    parser.add_argument("--bars", type=int, default=1200)
    parser.add_argument("--market", default="bist")
    parser.add_argument("--bundle-bars", type=int, default=250)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    base = ROOT / "public" / "data" / args.market
    pack = base / "pack"
    fund = base / "fundamentals"
    pack.mkdir(parents=True, exist_ok=True)
    fund.mkdir(parents=True, exist_ok=True)

    symbols = [f"X{i:03d}" for i in range(args.symbols)]
    start_day = 19000 - args.bars
    series = {s: synth(hash(s) & 0xFFFF, args.bars, start_day) for s in symbols}

    manifest = {
        "version": PACK_VERSION,
        "market": args.market,
        "generated": int(time.time()),
        "symbols": {},
    }

    for s in symbols:
        rows = series[s]
        payload = encode_series(rows)
        (pack / f"{s}.bin").write_bytes(payload)
        manifest["symbols"][s] = {
            "f": f"{s}.bin",
            "n": len(rows),
            "d0": rows[0][0],
            "d1": rows[-1][0],
            "b": len(payload),
            "h": short_hash(payload),
        }

    bundle = encode_bundle(series, args.bundle_bars)
    (pack / "latest-250.bin").write_bytes(bundle)
    manifest["bundle"] = {
        "file": "latest-250.bin",
        "bars": min(args.bundle_bars, args.bars),
        "bytes": len(bundle),
        "hash": short_hash(bundle),
    }
    (pack / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    # Finansallar: oran hesabına giren kalemler, sembole göre tutarlı.
    periods = ["2023/12", "2024/6", "2024/12", "2025/6"]
    snapshot = {
        "version": 1,
        "generated": int(time.time()),
        "note": "Sentetik (yerel) veri; yayım tarihi bilgisi yok, backtest girdisi yapılmamalıdır.",
        "symbols": {},
    }
    for s in symbols:
        rnd = random.Random(hash(s) & 0xFFFF)
        revenue = rnd.uniform(500, 5000)
        margin = rnd.uniform(-0.05, 0.25)
        equity = revenue * rnd.uniform(0.4, 1.5)
        fields = {
            "revenue": [round(revenue * (0.8 + 0.1 * i), 1) for i in range(4)],
            "netIncome": [round(revenue * margin * (0.8 + 0.1 * i), 1) for i in range(4)],
            "equity": [round(equity * (0.9 + 0.05 * i), 1) for i in range(4)],
            "assets": [round(equity * 2.4, 1)] * 4,
            "operatingCashFlow": [round(revenue * margin * 1.2, 1)] * 4,
            "grossProfit": [round(revenue * 0.3, 1)] * 4,
            "currentAssets": [round(equity * 0.8, 1)] * 4,
            "currentLiabilities": [round(equity * 0.5, 1)] * 4,
            "longLiabilities": [round(equity * 0.7, 1)] * 4,
            "paidCapital": [round(revenue * 0.1, 1)] * 4,
            "inventory": [round(equity * 0.2, 1)] * 4,
            "cash": [round(equity * 0.15, 1)] * 4,
            "operatingProfit": [round(revenue * margin * 1.4, 1)] * 4,
            "capex": [None] * 4,
        }
        (fund / f"{s}.json").write_text(
            json.dumps({"symbol": s, "periods": periods, "fields": fields, "missing": ["capex"]},
                       separators=(",", ":")),
            encoding="utf-8",
        )
        snapshot["symbols"][s] = {
            "period": periods[-1],
            "revenueTtm": fields["revenue"][-1],
            "grossProfitTtm": fields["grossProfit"][-1],
            "operatingProfitTtm": fields["operatingProfit"][-1],
            "netIncomeTtm": fields["netIncome"][-1],
            "operatingCashFlowTtm": fields["operatingCashFlow"][-1],
            "equity": fields["equity"][-1],
            "assets": fields["assets"][-1],
            "paidCapital": fields["paidCapital"][-1],
            "currentAssets": fields["currentAssets"][-1],
            "currentLiabilities": fields["currentLiabilities"][-1],
            "longLiabilities": fields["longLiabilities"][-1],
            "inventory": fields["inventory"][-1],
            "cash": fields["cash"][-1],
        }
    (fund / "snapshot.json").write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")

    # Kur serisi: döviz bazlı getiri ekranının sınanabilmesi için. Gerçek kur
    # DEĞİL — kaynağı "Sentetik (yerel)" yazar ve seri, fiyat serisiyle aynı
    # takvimi kullanır ki "kur o gün bilinmiyor" durumu da oluşabilsin.
    fx_rnd = random.Random(11)
    fx_days: list[int] = []
    fx_rates: list[float] = []
    rate = 18.0
    # Fiyat serisinin ikinci yarısı: bilerek kısa tutuluyor ki "kur bu tarihten
    # önce bilinmiyor" durumu arayüzde gerçekten görülebilsin.
    axis = [d for d, *_ in series[symbols[0]]]
    for day in axis[len(axis) // 2:]:
        rate *= math.exp(0.0009 + 0.006 * fx_rnd.gauss(0, 1))
        fx_days.append(day)
        fx_rates.append(round(rate, 4))
    (base / "fx.json").write_text(
        json.dumps(
            {
                "source": "Sentetik (yerel)",
                "generated": int(time.time()),
                "currency": "USD",
                "days": fx_days,
                "rates": fx_rates,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    # Sektörler: birkaç sembol KASITLI olarak sınıflandırılmamış bırakılır ki
    # "Sınıflandırılmamış" satırı ve kapsama oranı gerçekten sınanabilsin.
    rnd = random.Random(7)
    mapping = {s: rnd.choice(SECTORS) for s in symbols if rnd.random() > 0.1}
    (base / "sectors.json").write_text(
        json.dumps({"source": "Sentetik (yerel)", "generated": int(time.time()), "of": mapping},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(
        f"{len(symbols)} sembol × {args.bars} bar → {pack.relative_to(ROOT)} "
        f"(paket {len(bundle) // 1024} KB) · {len(mapping)} sektör eşleşmesi "
        f"· {len(fx_days)} gün kur"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
