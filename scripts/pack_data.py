#!/usr/bin/env python3
"""
Kolonsal ikili veri üreticisi.

public/data/<market>/<SEMBOL>.json (verbose OHLCV) → public/data/<market>/pack/
    <SEMBOL>.bin      seri dosyası (bar başına 24 bayt)
    latest-<N>.bin    tüm sembollerin son N barı, tek dosya
    manifest.json     boyut/hash/tarih aralığı dizini

Format: docs/plan/veri-formati.md

Kullanım:
    python scripts/pack_data.py --market all --verify
    python scripts/pack_data.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
MARKETS = ("bist", "us", "crypto")

SERIES_MAGIC = b"BRS1"
BUNDLE_MAGIC = b"BRSB"
VERSION = 1
SERIES_HEADER = 32
BUNDLE_HEADER = 24
DAY = 86400

# BIST endeks serileri (XU100, XBANK, BISTTLREF, …) sembol listesinde AYRI
# tutuluyor. Neden önemli: bunlar hisse DEĞİL. Tarayıcıda, radarda, nabızda
# ve strateji taramasında hisselerin arasında görünürlerse:
#   - "hisse ara" sonucuna işlem değeri 0 olan, alınamayacak satırlar girer
#     (gerçek veride ölçüldü: XFINK satırı işlem değeri 0, F/K "—"),
#   - sektör para akışı ve strateji sıralaması 48 fazla seriyle hesaplanır.
# Eski arayüz bunları zaten eliyordu; yeni kabuk bu eleği kaybetmişti.
#
# Ön ek TAHMİNİ ("X ile başlayanlar") kullanılmıyor: sembol listesinin kendi
# `indices` alanı var ve tahmin, ileride X ile başlayan bir hisse çıkarsa
# sessizce yanlış olurdu.
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"


def endeks_kumesi(market_name: str) -> set[str]:
    """Piyasanın endeks sembolleri. Liste yoksa BOŞ küme — eleme yapılmaz."""
    if market_name != "bist" or not SYMBOLS_FILE.exists():
        return set()
    try:
        data = json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {
        i["name"].upper()
        for i in data.get("indices", [])
        if isinstance(i, dict) and isinstance(i.get("name"), str)
    }


# Sembol dosyası olmayan yardımcı JSON'lar.
META_FILES = {
    "symbols.json", "quotes.json", "names.json", "spark.json",
    "screener.json", "strategies.json", "manifest.json",
}


# ── yardımcılar ──────────────────────────────────────────────────────────────

def epoch_day(t: int) -> int:
    """Unix saniye → epoch gün (aşağı yuvarlar; negatif tarihlerde de doğru)."""
    return t // DAY


def _f32(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)


def _i32(values: list[int]) -> bytes:
    return struct.pack(f"<{len(values)}i", *values)


def short_hash(payload: bytes) -> str:
    return hashlib.sha1(payload).hexdigest()[:8]


def read_series_json(path: Path) -> list[dict]:
    """Bir sembol dosyasını oku; şekli tutmuyorsa boş liste döner."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as e:  # noqa: BLE001
        print(f"[pack] {path.name} okunamadı: {e}", file=sys.stderr)
        return []
    recs = doc.get("data") if isinstance(doc, dict) else doc
    if not isinstance(recs, list):
        return []
    return [r for r in recs if isinstance(r, dict) and "t" in r and "c" in r]


def normalize(recs: list[dict]) -> list[tuple]:
    """(gün, o, h, l, c, v) — güne göre artan, tekrar eden gün son kayıtla ezilir."""
    by_day: dict[int, tuple] = {}
    for r in recs:
        try:
            d = epoch_day(int(r["t"]))
            row = (
                d,
                float(r.get("o", r["c"])),
                float(r.get("h", r["c"])),
                float(r.get("l", r["c"])),
                float(r["c"]),
                float(r.get("v", 0) or 0),
            )
        except (TypeError, ValueError, KeyError):
            continue
        if not all(math.isfinite(x) for x in row[1:]):
            continue
        by_day[d] = row
    return [by_day[d] for d in sorted(by_day)]


# ── seri dosyası ─────────────────────────────────────────────────────────────

def encode_series(rows: list[tuple]) -> bytes:
    n = len(rows)
    first = rows[0][0] if n else 0
    last = rows[-1][0] if n else 0
    head = (
        SERIES_MAGIC
        + struct.pack("<HH", VERSION, 1)
        + struct.pack("<I", n)
        + struct.pack("<ii", first, last)
        + struct.pack("<III", 0, 0, 0)
    )
    assert len(head) == SERIES_HEADER
    cols = [_i32([r[0] for r in rows])]
    for i in range(1, 6):
        cols.append(_f32([r[i] for r in rows]))
    return head + b"".join(cols)


def decode_series(buf: bytes) -> list[tuple]:
    """Çözücü — doğrulama için; tarayıcı tarafındaki eşi src/core/data/pack.ts."""
    if len(buf) < SERIES_HEADER or buf[:4] != SERIES_MAGIC:
        raise ValueError("geçersiz seri dosyası")
    version, _flags = struct.unpack_from("<HH", buf, 4)
    if version != VERSION:
        raise ValueError(f"desteklenmeyen sürüm: {version}")
    (n,) = struct.unpack_from("<I", buf, 8)
    o = SERIES_HEADER
    days = struct.unpack_from(f"<{n}i", buf, o)
    o += 4 * n
    cols = []
    for _ in range(5):
        cols.append(struct.unpack_from(f"<{n}f", buf, o))
        o += 4 * n
    return [(days[i], *(c[i] for c in cols)) for i in range(n)]


# ── paket dosyası ────────────────────────────────────────────────────────────

def encode_bundle(series: dict[str, list[tuple]], bars: int) -> bytes:
    """Tüm sembollerin son N barı; ortak gün ekseni, eksik hücreler NaN."""
    names = sorted(series)
    all_days = sorted({row[0] for rows in series.values() for row in rows})
    axis = all_days[-bars:] if bars > 0 else all_days
    index = {d: i for i, d in enumerate(axis)}
    width = len(axis)

    cols = [[float("nan")] * (len(names) * width) for _ in range(5)]
    for si, name in enumerate(names):
        base = si * width
        for row in series[name]:
            i = index.get(row[0])
            if i is None:
                continue
            for c in range(5):
                cols[c][base + i] = row[1 + c]

    blob = "\n".join(names).encode("utf-8")
    pad = (-len(blob)) % 4
    head = (
        BUNDLE_MAGIC
        + struct.pack("<HH", VERSION, width)
        + struct.pack("<II", len(names), len(blob) + pad)
        + struct.pack("<II", 0, 0)
    )
    assert len(head) == BUNDLE_HEADER
    return head + blob + b"\x00" * pad + _i32(axis) + b"".join(_f32(c) for c in cols)


# ── üretim ───────────────────────────────────────────────────────────────────

def series_files(market_dir: Path) -> list[Path]:
    return sorted(
        p for p in market_dir.glob("*.json")
        if p.name not in META_FILES and not p.name.startswith("_")
    )


def pack_market(market_dir: Path, bundle_bars: int, verify: bool) -> dict | None:
    files = series_files(market_dir)
    if not files:
        print(f"[pack] {market_dir.name}: sembol dosyası yok, atlanıyor")
        return None

    out = market_dir / "pack"
    out.mkdir(parents=True, exist_ok=True)

    manifest: dict = {
        "version": VERSION,
        "market": market_dir.name,
        "generated": int(__import__("time").time()),
        "symbols": {},
    }
    series: dict[str, list[tuple]] = {}
    endeksler = endeks_kumesi(market_dir.name)
    skipped = 0

    for path in files:
        symbol = path.stem
        rows = normalize(read_series_json(path))
        if not rows:
            skipped += 1
            continue
        payload = encode_series(rows)
        if verify:
            verify_series(symbol, rows, payload)
        (out / f"{symbol}.bin").write_bytes(payload)
        series[symbol] = rows
        manifest["symbols"][symbol] = {
            "f": f"{symbol}.bin",
            "n": len(rows),
            "d0": rows[0][0],
            "d1": rows[-1][0],
            "b": len(payload),
            "h": short_hash(payload),
        }
        # Endeks İŞARETLENİYOR ama manifest'ten SİLİNMİYOR: XU100'ü grafikte
        # açmak ve portföyü ona göre kıyaslamak hâlâ mümkün olmalı. Silinen
        # tek şey paket üyeliği, yani "hisse tara" evreni.
        if symbol.upper() in endeksler:
            manifest["symbols"][symbol]["e"] = 1

    if not series:
        print(f"[pack] {market_dir.name}: geçerli seri yok")
        return None

    # Paket = TARAMA EVRENİ. Endeksler dışarıda: hisse tarayan ekranlar
    # (tarayıcı, radar, nabız, strateji sıralaması) evrenini buradan alıyor.
    paket_serileri = {k: v for k, v in series.items() if k.upper() not in endeksler}
    elenen = len(series) - len(paket_serileri)
    if not paket_serileri:
        # Elemeden sonra hiç hisse kalmadıysa liste yanlıştır; boş paket
        # yayımlamak tüm tarama ekranlarını sessizce boşaltırdı.
        print(f"[pack] {market_dir.name}: UYARI — eleme sonrası hisse kalmadı, eleme yok sayıldı")
        paket_serileri = series
        elenen = 0
    bundle = encode_bundle(paket_serileri, bundle_bars)
    bundle_name = f"latest-{bundle_bars}.bin"
    (out / bundle_name).write_bytes(bundle)
    manifest["bundle"] = {
        "file": bundle_name,
        "bars": bundle_bars,
        "bytes": len(bundle),
        "hash": short_hash(bundle),
    }

    # ENDEKS PAKETİ — ayrı ve küçük.
    #
    # Endeksler tarama evreninden çıktı ama "hangi sektör kazandırıyor"
    # sorusunun cevabı onlarda: BIST'in alt sektör endeksleri (XBANK, XGIDA …)
    # sınıflandırma dosyası olmadan da sektör getirisini veriyor.
    #
    # Neden ayrı dosya: tek tek seri dosyaları TAM geçmiş taşıyor (sembol
    # başına ~80 KB, 23 sektör ≈ 1,8 MB). Son N barlık paket aynı iş için
    # ~140 KB ve TEK istek. Ana pakete geri koymak ise endeksleri tarama
    # evrenine geri sokardı.
    endeks_serileri = {k: v for k, v in series.items() if k.upper() in endeksler}
    if endeks_serileri:
        endeks_paket = encode_bundle(endeks_serileri, bundle_bars)
        endeks_adi = f"endeks-{bundle_bars}.bin"
        (out / endeks_adi).write_bytes(endeks_paket)
        manifest["indices"] = {
            "file": endeks_adi,
            "bars": bundle_bars,
            "bytes": len(endeks_paket),
            "hash": short_hash(endeks_paket),
            "symbols": len(endeks_serileri),
        }

    (out / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
    )

    src_bytes = sum(p.stat().st_size for p in files)
    packed = sum(s["b"] for s in manifest["symbols"].values())
    print(
        f"[pack] {market_dir.name}: {len(series)} sembol"
        f"{f' ({skipped} boş atlandı)' if skipped else ''}"
        f"{f' · paket {len(paket_serileri)} hisse, {elenen} endeks hariç' if elenen else ''} · "
        f"{src_bytes / 1e6:.1f} MB JSON → {packed / 1e6:.1f} MB bin "
        f"({src_bytes / max(packed, 1):.1f}×) + paket {len(bundle) / 1e6:.1f} MB"
    )
    return manifest


def verify_series(symbol: str, rows: list[tuple], payload: bytes) -> None:
    """Yazılanı geri oku ve bar bar karşılaştır. Uyuşmazlık = hata."""
    back = decode_series(payload)
    if len(back) != len(rows):
        raise SystemExit(f"[pack] {symbol}: bar sayısı uyuşmuyor {len(back)} ≠ {len(rows)}")
    for i, (a, b) in enumerate(zip(rows, back)):
        if a[0] != b[0]:
            raise SystemExit(f"[pack] {symbol}: bar {i} gün {b[0]} ≠ {a[0]}")
        for c in range(1, 6):
            lhs, rhs = a[c], b[c]
            tol = max(abs(lhs), abs(rhs)) * 1e-6
            if abs(lhs - rhs) > tol:
                raise SystemExit(
                    f"[pack] {symbol}: bar {i} kolon {c} {rhs} ≠ {lhs} (tolerans {tol:.3g})"
                )


# ── kendi kendine test ───────────────────────────────────────────────────────

def self_test(bundle_bars: int = 8) -> None:
    """Sentetik veriyle uçtan uca: JSON yaz → paketle → doğrula → paketi çöz."""
    with tempfile.TemporaryDirectory() as tmp:
        market = Path(tmp) / "bist"
        market.mkdir()
        expected: dict[str, list[tuple]] = {}
        for si, symbol in enumerate(["AAA", "BBB"]):
            recs = []
            for i in range(12):
                if symbol == "BBB" and i % 5 == 2:
                    continue  # bilinçli boşluk: takvim delikleri korunmalı
                price = 10 + si * 5 + i * 0.25
                recs.append({
                    "t": (20000 + i) * DAY,
                    "o": price, "h": price + 1, "l": price - 1,
                    "c": price + 0.5, "v": 1000 + i,
                })
            (market / f"{symbol}.json").write_text(json.dumps({"data": recs}), encoding="utf-8")
            expected[symbol] = normalize(recs)

        manifest = pack_market(market, bundle_bars, verify=True)
        assert manifest is not None, "manifest üretilmedi"
        assert set(manifest["symbols"]) == {"AAA", "BBB"}

        # Seri dosyası: bar bar aynı mı?
        for symbol, rows in expected.items():
            back = decode_series((market / "pack" / f"{symbol}.bin").read_bytes())
            assert len(back) == len(rows), f"{symbol}: {len(back)} ≠ {len(rows)}"
            for a, b in zip(rows, back):
                assert a[0] == b[0]
                assert all(abs(a[c] - b[c]) <= abs(a[c]) * 1e-6 for c in range(1, 6))

        # Paket: eksik günler NaN olmalı, dolu günler seriyle aynı.
        bundle = (market / "pack" / manifest["bundle"]["file"]).read_bytes()
        names, axis, cols = decode_bundle(bundle)
        assert names == ["AAA", "BBB"], names
        assert len(axis) == bundle_bars
        width = len(axis)
        for si, symbol in enumerate(names):
            by_day = {r[0]: r for r in expected[symbol]}
            for di, day in enumerate(axis):
                close = cols[3][si * width + di]
                if day in by_day:
                    assert abs(close - by_day[day][4]) <= abs(close) * 1e-6
                else:
                    assert math.isnan(close), f"{symbol} {day}: boşluk NaN olmalı"

        endeks_self_test(bundle_bars)
        print("[pack] self-test tamam")


def endeks_self_test(bundle_bars: int) -> None:
    """
    Endeks eleme sözleşmesi: manifest'te KALIR, pakette KALMAZ.

    Ayrı bir dizin, çünkü sembol listesini geçici olarak değiştirmek gerekiyor
    ve asıl self-test'in verisini kirletmemeli.
    """
    global SYMBOLS_FILE
    with tempfile.TemporaryDirectory() as tmp:
        kok = Path(tmp)
        market = kok / "bist"
        market.mkdir()
        for symbol in ("AAA", "XU100"):
            recs = [
                {"t": (20000 + i) * DAY, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 100}
                for i in range(12)
            ]
            (market / f"{symbol}.json").write_text(json.dumps({"data": recs}), encoding="utf-8")

        liste = kok / "semboller.json"
        liste.write_text(
            json.dumps({"stocks": [{"name": "AAA"}], "indices": [{"name": "XU100"}]}),
            encoding="utf-8",
        )
        onceki, SYMBOLS_FILE = SYMBOLS_FILE, liste
        try:
            manifest = pack_market(market, bundle_bars, verify=False)
        finally:
            SYMBOLS_FILE = onceki

        assert manifest is not None
        # Manifest'te DURUYOR — XU100 grafikte açılabilmeli.
        assert set(manifest["symbols"]) == {"AAA", "XU100"}, manifest["symbols"].keys()
        assert manifest["symbols"]["XU100"].get("e") == 1
        assert "e" not in manifest["symbols"]["AAA"]
        # Pakette YOK — tarama evreni yalnızca hisseler.
        names, _, _ = decode_bundle((market / "pack" / manifest["bundle"]["file"]).read_bytes())
        assert names == ["AAA"], names
        # Seri dosyası yine de yazılıyor.
        assert (market / "pack" / "XU100.bin").exists()
        # ENDEKS PAKETİ ayrı yazılıyor ve YALNIZCA endeksleri taşıyor.
        assert manifest["indices"]["symbols"] == 1, manifest["indices"]
        e_adlar, _, _ = decode_bundle((market / "pack" / manifest["indices"]["file"]).read_bytes())
        assert e_adlar == ["XU100"], e_adlar


def decode_bundle(buf: bytes):
    if buf[:4] != BUNDLE_MAGIC:
        raise ValueError("geçersiz paket dosyası")
    version, bars = struct.unpack_from("<HH", buf, 4)
    if version != VERSION:
        raise ValueError(f"desteklenmeyen sürüm: {version}")
    count, names_len = struct.unpack_from("<II", buf, 8)
    names = buf[BUNDLE_HEADER:BUNDLE_HEADER + names_len].rstrip(b"\x00").decode("utf-8").split("\n")
    o = BUNDLE_HEADER + names_len
    axis = list(struct.unpack_from(f"<{bars}i", buf, o))
    o += 4 * bars
    cols = []
    for _ in range(5):
        cols.append(list(struct.unpack_from(f"<{count * bars}f", buf, o)))
        o += 4 * count * bars
    return names, axis, cols


# ── fixture (TS tarafıyla sözleşme testi) ────────────────────────────────────

def write_fixture(dest: Path) -> None:
    """TS çözücüsünün karşı sınanacağı küçük dosyayı ve beklenen değerleri yaz."""
    dest.mkdir(parents=True, exist_ok=True)
    rows_by_symbol = {
        "AAA": [(20000 + i, 10 + i, 11 + i, 9 + i, 10.5 + i, 1000 + i * 10) for i in range(6)],
        "BB": [(20001 + i * 2, 50 + i, 51 + i, 49 + i, 50.5 + i, 2000 + i) for i in range(3)],
    }
    (dest / "series-AAA.bin").write_bytes(encode_series(rows_by_symbol["AAA"]))
    bundle_bars = 6
    (dest / "bundle-6.bin").write_bytes(encode_bundle(rows_by_symbol, bundle_bars))
    names, axis, cols = decode_bundle((dest / "bundle-6.bin").read_bytes())
    (dest / "expected.json").write_text(
        json.dumps(
            {
                "note": "scripts/pack_data.py --write-fixture ile üretildi; elle düzenlemeyin",
                "series": {"symbol": "AAA", "rows": rows_by_symbol["AAA"]},
                "bundle": {"bars": bundle_bars, "names": names, "axis": axis,
                           "close": [None if math.isnan(v) else round(v, 6) for v in cols[3]]},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[pack] fixture yazıldı: {dest}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--market", default="all", choices=[*MARKETS, "all"])
    ap.add_argument("--bundle-bars", type=int, default=250)
    ap.add_argument("--verify", action="store_true", help="yazılanı geri okuyup karşılaştır")
    ap.add_argument("--self-test", action="store_true", help="sentetik veriyle uçtan uca test")
    ap.add_argument("--write-fixture", metavar="DIZIN", help="TS testleri için örnek dosya üret")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return
    if args.write_fixture:
        write_fixture(Path(args.write_fixture))
        return

    markets = MARKETS if args.market == "all" else (args.market,)
    produced = 0
    for name in markets:
        d = DATA / name
        if not d.is_dir():
            print(f"[pack] {name}: veri dizini yok, atlanıyor")
            continue
        if pack_market(d, args.bundle_bars, args.verify):
            produced += 1
    if produced == 0:
        print("[pack] paketlenecek veri bulunamadı")


if __name__ == "__main__":
    main()
