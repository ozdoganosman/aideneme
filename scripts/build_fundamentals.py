#!/usr/bin/env python3
"""
BIST finansal tablo üreticisi.

isyatirimhisse ile gelir tablosu / bilanço / nakit akışını çeker, ihtiyaç
duyulan ~15 kalemi ayıklayıp sembol başına KOMPAKT bir dosya yazar:

    public/data/bist/fundamentals/<SEMBOL>.json   (dönem × alan matrisi)
    public/data/bist/fundamentals/snapshot.json   (tüm semboller, son TTM)

Neden tüm kalemler değil: referans projede ham tablolar sembol başına ~125 KB,
603 sembolde 75 MB tutuyor ve tarayıcı bunların %95'ini hiç kullanmıyor.
Burada yalnızca oran hesabına giren kalemler saklanıyor.

ÖNEMLİ — point-in-time sınırı: kaynak veride "bu tablo hangi tarihte
yayımlandı" bilgisi yok. Bu yüzden geçmişe dönük tarama yaparken o gün
bilinmeyen bir bilançoyu kullanmadığımızı garanti EDEMİYORUZ; snapshot yalnızca
GÜNCEL tarama için kullanılmalı, backtest'e girdi yapılmamalı.

Çalıştırma:
    pip install isyatirimhisse pandas
    python scripts/build_fundamentals.py [--limit 20] [--self-test]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "fundamentals"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"

BANK_SYMBOLS = {
    "GARAN", "AKBNK", "YKBNK", "HALKB", "VAKBN", "ISCTR", "TSKB", "ALBRK",
    "SKBNK", "ICBCT", "QNBFK", "QNBTR", "KLNMA", "ISATR", "ISBTR", "ISKUR",
    "ISFIN", "SEKFK", "VAKFN",
}

# Alan → kabul edilen kalem adları (İş Yatırım Türkçe adları; ilk eşleşen alınır).
# Birden çok ad var çünkü tablo şablonu sektöre ve yıla göre değişiyor.
FIELD_ITEMS: dict[str, list[str]] = {
    "revenue": ["Satış Gelirleri", "Hasılat", "Satış Gelirleri (net)", "FAALİYET GELİRLERİ"],
    "grossProfit": ["BRÜT KAR (ZARAR)", "Brüt Kar (Zarar)"],
    "operatingProfit": ["FAALİYET KARI (ZARARI)", "ESAS FAALİYET KARI (ZARARI)"],
    "netIncome": ["Ana Ortaklık Payları", "DÖNEM NET KARI (ZARARI)", "Net Dönem Karı (Zararı)"],
    "assets": ["TOPLAM VARLIKLAR", "AKTİF TOPLAMI"],
    "equity": ["Özkaynaklar", "ÖZKAYNAKLAR", "Ana Ortaklığa Ait Özkaynaklar"],
    "paidCapital": ["Ödenmiş Sermaye", "ÖDENMİŞ SERMAYE"],
    "currentAssets": ["DÖNEN VARLIKLAR"],
    "currentLiabilities": ["KISA VADELİ YÜKÜMLÜLÜKLER", "Kısa Vadeli Yükümlülükler"],
    "longLiabilities": ["UZUN VADELİ YÜKÜMLÜLÜKLER", "Uzun Vadeli Yükümlülükler"],
    "inventory": ["Stoklar"],
    "cash": ["Nakit ve Nakit Benzerleri", "Nakit ve Nakit Benzerleri (net)"],
    "operatingCashFlow": [
        "İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI",
        "A. İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI",
    ],
    "capex": [
        "Maddi ve maddi olmayan duran varlıkların alımından kaynaklanan nakit çıkışları",
        "Maddi Duran Varlık Alımından Kaynaklanan Nakit Çıkışları",
    ],
}

FIELDS = list(FIELD_ITEMS)


def load_symbols(limit: int | None) -> list[str]:
    try:
        data = json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
        syms = [s["name"] for s in data.get("stocks", [])]
    except Exception as e:  # noqa: BLE001
        print(f"[fund] sembol listesi okunamadı: {e}", file=sys.stderr)
        syms = ["THYAO", "GARAN", "ASELS", "EREGL", "BIMAS"]
    return syms[:limit] if limit else syms


def normalize(name: str) -> str:
    return " ".join(str(name).split()).strip().lower()


def extract(df, symbol: str) -> dict | None:
    """DataFrame → {periods, fields} (yalnızca ihtiyaç duyulan kalemler)."""
    if df is None or getattr(df, "empty", True):
        return None

    period_cols = [c for c in df.columns if "/" in str(c)]
    if not period_cols:
        return None
    period_cols.sort(key=lambda c: tuple(int(p) for p in str(c).split("/")[:2]))

    wanted = {}
    for field, names in FIELD_ITEMS.items():
        for name in names:
            wanted[normalize(name)] = wanted.get(normalize(name), field)

    fields: dict[str, list[float | None]] = {f: [None] * len(period_cols) for f in FIELDS}
    seen: set[str] = set()

    name_col = "FINANCIAL_ITEM_NAME_TR" if "FINANCIAL_ITEM_NAME_TR" in df.columns else None
    if name_col is None:
        return None

    for _, row in df.iterrows():
        field = wanted.get(normalize(row.get(name_col, "")))
        if not field or field in seen:
            continue
        seen.add(field)
        for i, col in enumerate(period_cols):
            value = row.get(col)
            try:
                if value is None or value != value:  # NaN
                    continue
                fields[field][i] = round(float(value), 2)
            except (TypeError, ValueError):
                continue

    if "revenue" not in seen and "netIncome" not in seen:
        return None  # tanınan hiçbir kalem yok → şablon uyuşmuyor

    return {
        "symbol": symbol,
        "periods": [str(c) for c in period_cols],
        "fields": fields,
        "missing": sorted(set(FIELDS) - seen),
    }


def fetch_one(symbol: str, start_year: int, end_year: int) -> dict | None:
    from isyatirimhisse import fetch_financials as isy_fetch

    group = "2" if symbol in BANK_SYMBOLS else "1"
    try:
        df = isy_fetch(
            symbols=symbol,
            start_year=start_year,
            end_year=end_year,
            exchange="TRY",
            financial_group=group,
        )
    except Exception as e:  # noqa: BLE001
        print(f"[fund] {symbol}: çekilemedi ({e})", file=sys.stderr)
        return None

    record = extract(df, symbol)
    if record:
        record["group"] = group
    return record


def ttm(periods: list[str], values: list[float | None], index: int) -> float | None:
    """
    Son 12 ay (TTM). İş Yatırım'da çeyrekler KÜMÜLATİFTİR (2024/9 = yılın ilk
    9 ayı), bu yüzden TTM = geçen yıl sonu + bu yıl kümülatif − geçen yıl aynı
    kümülatif. Yıl sonu (/12) dönemlerinde değer doğrudan yıllıktır.
    """
    if index < 0 or index >= len(periods):
        return None
    current = values[index]
    if current is None:
        return None

    year, month = (int(p) for p in periods[index].split("/")[:2])
    if month == 12:
        return current

    def find(y: int, m: int) -> float | None:
        target = f"{y}/{m}"
        return values[periods.index(target)] if target in periods else None

    prev_year_end = find(year - 1, 12)
    prev_same = find(year - 1, month)
    if prev_year_end is None or prev_same is None:
        return None
    return prev_year_end + current - prev_same


def build_snapshot(records: list[dict]) -> dict:
    """Tüm sembollerin son TTM/bilanço değerleri — tarama bunu kullanır."""
    rows = {}
    for record in records:
        periods = record["periods"]
        if not periods:
            continue
        last = len(periods) - 1
        fields = record["fields"]

        def stock(field: str) -> float | None:
            values = fields[field]
            for i in range(last, -1, -1):
                if values[i] is not None:
                    return values[i]
            return None

        rows[record["symbol"]] = {
            "period": periods[last],
            "revenueTtm": ttm(periods, fields["revenue"], last),
            "grossProfitTtm": ttm(periods, fields["grossProfit"], last),
            "operatingProfitTtm": ttm(periods, fields["operatingProfit"], last),
            "netIncomeTtm": ttm(periods, fields["netIncome"], last),
            "operatingCashFlowTtm": ttm(periods, fields["operatingCashFlow"], last),
            "equity": stock("equity"),
            "assets": stock("assets"),
            "paidCapital": stock("paidCapital"),
            "currentAssets": stock("currentAssets"),
            "currentLiabilities": stock("currentLiabilities"),
            "longLiabilities": stock("longLiabilities"),
            "inventory": stock("inventory"),
            "cash": stock("cash"),
        }
    return {
        "version": 1,
        "generated": int(__import__("time").time()),
        "note": (
            "Yayım tarihi bilgisi kaynakta yok; bu anlık görüntü yalnızca GÜNCEL "
            "tarama içindir, geçmişe dönük backtest'e girdi yapılmamalıdır."
        ),
        "symbols": rows,
    }


def self_test() -> None:
    """TTM mantığını sentetik dönemlerle sına (ağ gerektirmez)."""
    periods = ["2022/12", "2023/3", "2023/6", "2023/9", "2023/12", "2024/3", "2024/6"]
    # Kümülatif gelir: 2023 yılı 400, 2024 ilk yarı 250 (2023 ilk yarı 180 idi).
    values = [300.0, 80.0, 180.0, 290.0, 400.0, 100.0, 250.0]
    assert ttm(periods, values, 4) == 400.0, "yıl sonu doğrudan yıllıktır"
    got = ttm(periods, values, 6)
    assert got == 400.0 + 250.0 - 180.0, f"TTM yanlış: {got}"
    assert ttm(periods, [None] * 7, 3) is None
    assert ttm(["2024/6"], [100.0], 0) is None, "önceki yıl yoksa TTM üretilmez"

    # Kaldığı yerden devam + yarım işin kullanıcıya ulaşması.
    # CI adımı ~660 sembolü indirmeye yetmiyor; her çalıştırma baştan
    # başlasaydı liste hiç ilerlemez, anlık görüntü de yalnızca sondaki tek
    # yazmada oluştuğu için yarım iş tarayıcıya HİÇ ulaşmazdı.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "AAA.json").write_text(
            json.dumps({"symbol": "AAA", "periods": ["2024/6"], "fields": {}}), encoding="utf-8"
        )
        (out / "snapshot.json").write_text("{}", encoding="utf-8")
        (out / "BOZUK.json").write_text("{ bu json değil", encoding="utf-8")

        assert pending_symbols(["AAA", "BBB"], out) == ["BBB"], "var olan yeniden indirilmemeli"
        assert pending_symbols(["AAA", "BBB"], out, force_all=True) == ["AAA", "BBB"]

        found = [r["symbol"] for r in records_on_disk(out)]
        assert found == ["AAA"], f"anlık görüntü diskten kurulmalı: {found}"

    # KESİLME tatbikatı. CI adımı zaman sınırında öldürülüyor; döngüden SONRA
    # gelen bir yazma hiç çalışmıyor. İlk düzeltmemde anlık görüntüyü diskten
    # kurdum ama yine döngünün ARDINA koymuştum — kusur aynen sürdü ve
    # yayında "temel veri yok" yazmaya devam etti. Bu test onu yakalar.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)

        def fake_fetch(symbol: str):
            if symbol == "DUR":
                raise KeyboardInterrupt("adım öldürüldü")
            return {
                "symbol": symbol,
                "periods": ["2024/6"],
                "fields": {f: [1.0] for f in FIELDS},
            }

        try:
            build_all(["S1", "S2", "DUR", "S3"], out, fake_fetch, every=2)
        except KeyboardInterrupt:
            pass

        snap_path = out / "snapshot.json"
        assert snap_path.exists(), "kesilse bile anlık görüntü yazılmış olmalı"
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        assert set(snap["symbols"]) == {"S1", "S2"}, f"ara kayıt eksik: {sorted(snap['symbols'])}"

    print("[fund] self-test tamam")


def pending_symbols(symbols: list[str], out_dir: Path, force_all: bool = False) -> list[str]:
    """Henüz indirilmemiş semboller (FORCE_ALL ile hepsi)."""
    return [s for s in symbols if force_all or not (out_dir / f"{s}.json").exists()]


def records_on_disk(out_dir: Path) -> list[dict]:
    """Diskteki tüm sembol kayıtları. Bozuk dosya sessizce atlanır."""
    records: list[dict] = []
    for path in sorted(out_dir.glob("*.json")):
        if path.name == "snapshot.json":
            continue
        try:
            records.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return records


def write_snapshot(records: list[dict], out_dir: Path) -> None:
    """Anlık görüntüyü yaz — taramanın OKUDUĞU tek dosya budur."""
    if not records:
        return
    (out_dir / "snapshot.json").write_text(
        json.dumps(build_snapshot(records), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def build_all(
    pending: list[str],
    out_dir: Path,
    fetch,
    every: int = 25,
) -> tuple[list[dict], int, int]:
    """
    Eksik sembolleri indirip diske yazar; ARADA BİR anlık görüntüyü tazeler.

    Ara kayıt şart: bu iş bir CI adımının zaman sınırında ÖLDÜRÜLÜYOR.
    Ölçüldü — adım 8 dakikada kesildi, sembol dosyaları diske yazılmıştı ama
    döngüden SONRA gelen anlık görüntü kodu hiç çalışmadı; tarama yine
    "temel veri yok" dedi. Yani yapılan iş kullanıcıya yine ulaşmadı.
    """
    records = records_on_disk(out_dir)
    fetched = 0
    failed = 0
    for i, symbol in enumerate(pending, 1):
        record = fetch(symbol)
        if not record:
            failed += 1
            continue
        (out_dir / f"{symbol}.json").write_text(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        records.append(record)
        fetched += 1
        if i % every == 0:
            write_snapshot(records, out_dir)
            print(f"[fund] {i}/{len(pending)} · başarılı {fetched} · başarısız {failed}")
    write_snapshot(records, out_dir)
    return records, fetched, failed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None, help="ilk N sembol (deneme için)")
    ap.add_argument("--start-year", type=int, default=2015)
    ap.add_argument("--end-year", type=int, default=2026)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return

    symbols = load_symbols(args.limit)
    OUT.mkdir(parents=True, exist_ok=True)

    # KALDIĞI YERDEN devam: ~660 sembol tek tek indiriliyor ve bu iş bir CI
    # adımının zaman sınırına sığmıyor. Her çalıştırma baştan başlasaydı hep
    # aynı ilk kırk sembol indirilir, liste hiç ilerlemezdi. FORCE_ALL
    # verildiğinde (planlı tam tazeleme) hepsi yeniden çekilir.
    force_all = bool(os.environ.get("FORCE_ALL"))
    pending = pending_symbols(symbols, OUT, force_all)
    if not pending:
        print(f"[fund] {len(symbols)} sembolün hepsi zaten var (FORCE_ALL ile tazelenir)")
    else:
        print(f"[fund] {len(pending)}/{len(symbols)} sembol eksik, indiriliyor")

    records, fetched, failed = build_all(
        pending, OUT, lambda sym: fetch_one(sym, args.start_year, args.end_year)
    )

    if not records:
        print("[fund] hiçbir sembol için finansal tablo alınamadı")
        return

    total = sum(
        (OUT / f"{r['symbol']}.json").stat().st_size
        for r in records
        if (OUT / f"{r['symbol']}.json").exists()
    )
    print(
        f"[fund] diskte {len(records)} sembol · bu turda {fetched} indi, {failed} başarısız · "
        f"{total / 1e6:.1f} MB + anlık görüntü {(OUT / 'snapshot.json').stat().st_size / 1e3:.0f} KB"
    )


if __name__ == "__main__":
    main()
