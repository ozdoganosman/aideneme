#!/usr/bin/env python3
"""
BIST sektör sınıflandırması üreticisi.

    public/data/bist/sectors.json   {"source": ..., "generated": ..., "of": {SEMBOL: sektör}}

Neden ayrı bir dosya: nabız ekranındaki para akışı şimdiye kadar yalnızca
DAVRANIŞ kümelerine (birlikte hareket edenler) bakabiliyordu. Bu iyi bir
ölçüdür ama "endüstriden para akışı" sorusunun cevabı değildir; onun için
resmî sınıflandırma gerekir.

Dürüstlük sınırı: kaynak erişilemezse dosya YAZILMAZ. Eksik dosya, arayüzde
"sektör sınıflandırması yok, davranış kümeleri gösteriliyor" olarak görünür;
tahmini bir sınıflandırma üretmek, olmayan bilgiyi varmış gibi göstermek olur.

Çalıştırma:
    python scripts/build_sectors.py [--self-test]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "sectors.json"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"

# İş Yatırım'ın hisse listesi uç noktası: sembol + sektör alanlarını taşır.
SOURCE_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/"
    "IndexCompanies?endeks=09"
)
SOURCE_NAME = "İş Yatırım — endeks şirketleri"

# Kaynakta sektör alanı sürüme göre farklı adlarla geliyor; ilk eşleşen alınır.
SECTOR_KEYS = ("SECTOR", "Sektor", "SektorAdi", "sector", "IndustryName")
SYMBOL_KEYS = ("CODE", "Kod", "HisseKodu", "code", "symbol")


def pick(record: dict, keys: tuple[str, ...]) -> str | None:
    """Kayıttan ilk dolu alanı seçer; hiçbiri yoksa None."""
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def parse_records(records: list[dict], known: set[str] | None = None) -> dict[str, str]:
    """
    Ham kayıtları {SEMBOL: sektör} sözlüğüne çevirir.

    Ağ ERİŞİMİ YOK — saf dönüşüm, bu yüzden `--self-test` ile çevrimdışı
    doğrulanabiliyor. Sembolü ya da sektörü okunamayan kayıt ATLANIR; boş
    string yazmak "sektörü yok" ile "okunamadı"yı birbirine karıştırırdı.
    """
    out: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        symbol = pick(record, SYMBOL_KEYS)
        sector = pick(record, SECTOR_KEYS)
        if not symbol or not sector:
            continue
        symbol = symbol.upper()
        if known is not None and symbol not in known:
            continue
        out[symbol] = sector
    return out


def fetch_records(url: str = SOURCE_URL, timeout: int = 30) -> list[dict]:
    request = urllib.request.Request(url, headers={"User-Agent": "aideneme-sectors/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    # Uç nokta {"value": [...]} ya da doğrudan liste dönebiliyor.
    if isinstance(payload, dict):
        for key in ("value", "d", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return []
    return payload if isinstance(payload, list) else []


def known_symbols() -> set[str]:
    if not SYMBOLS_FILE.exists():
        return set()
    data = json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
    return {s["name"].upper() for s in data.get("stocks", []) if s.get("name")}


def self_test() -> int:
    sample = [
        {"CODE": "garan", "SECTOR": "Bankacılık"},
        {"Kod": "EREGL", "Sektor": "Demir Çelik"},
        {"CODE": "NOSECTOR"},
        {"SECTOR": "Kimya"},
        "bozuk kayıt",
        {"CODE": "XXXXX", "SECTOR": "Bilinmeyen"},
    ]
    parsed = parse_records(sample, known={"GARAN", "EREGL"})
    assert parsed == {"GARAN": "Bankacılık", "EREGL": "Demir Çelik"}, parsed

    # Bilinen sembol listesi verilmezse filtreleme yapılmaz.
    parsed_all = parse_records(sample)
    assert set(parsed_all) == {"GARAN", "EREGL", "XXXXX"}, parsed_all

    # Sektörü okunamayan kayıt boş string ile YAZILMAZ.
    assert "NOSECTOR" not in parsed_all

    print("build_sectors self-test: tamam")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--url", default=SOURCE_URL)
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    try:
        records = fetch_records(args.url)
    except Exception as err:  # noqa: BLE001 — kaynak hatası ölümcül değil
        print(f"sektör kaynağına erişilemedi: {err}", file=sys.stderr)
        print("sectors.json YAZILMADI; arayüz davranış kümelerine düşecek.", file=sys.stderr)
        return 1

    mapping = parse_records(records, known=known_symbols() or None)
    if not mapping:
        print("kaynaktan sektör okunamadı; dosya yazılmadı.", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"source": SOURCE_NAME, "generated": int(time.time()), "of": mapping},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"{len(mapping)} sembol → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
