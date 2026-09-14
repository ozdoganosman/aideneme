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
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "fundamentals"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"
# Yayındaki tam liste. Depodaki `bist_symbols.json` 607 sembol içeriyor ama
# veri hattının ürettiği liste 655 — yani depodaki kopya eskimiş ve finansal
# tablolar 48 sembol için hiç denenmiyordu. Yayındaki liste varsa o kazanır.
PUBLISHED_SYMBOLS = ROOT / "public" / "data" / "bist" / "symbols.json"

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
    """
    Sembol listesi — önce YAYINDAKİ liste, sonra depodaki kopya.

    Depodaki `bist_symbols.json` elle güncellenen bir dosya ve eskimiş: 607
    sembol var, oysa veri hattının ürettiği `symbols.json` 655 sembol
    içeriyor. Fark, finansal tabloların 48 sembol için HİÇ denenmemesi
    demekti — eksiklik sessizdi, çünkü liste dışı sembol "başarısız" bile
    sayılmıyordu.
    """
    syms: list[str] = []
    try:
        published = json.loads(PUBLISHED_SYMBOLS.read_text(encoding="utf-8"))
        syms = [str(s) for s in published.get("symbols", []) if s]
        if syms:
            print(f"[fund] sembol listesi: yayındaki {len(syms)} sembol")
    except (OSError, json.JSONDecodeError, AttributeError):
        pass

    if not syms:
        try:
            data = json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
            syms = [s["name"] for s in data.get("stocks", [])]
            print(f"[fund] sembol listesi: depodaki kopya, {len(syms)} sembol")
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
        # Şablon uyuşmuyor. Hangi kalem adlarının geldiğini YAZ: aksi hâlde
        # neyin eksik olduğunu tahmin etmek gerekiyor. Ölçüldü — AKBNK ve
        # ALBRK'de tablo GELİYOR ama tanınan kalem yok, yani sorun tablo
        # şablonu değil banka bilançosunun satır adları. Kaydı okuyup
        # FIELD_ITEMS'a doğru adı eklemek, ada körlemesine tahmin etmekten
        # iyidir.
        # İlk 15 adı basmak yetmedi: banka tablosunun ilk satırları bilanço
        # AKTİF tarafı (I. NAKİT DEĞERLER, III. BANKALAR…), aradığımız
        # kâr/özkaynak satırları çok daha aşağıda. İLGİLİ olanları süzüyoruz.
        ilgi = ("KAR", "ZARAR", "GELİR", "ÖZKAYNAK", "AKTİF", "TOPLAM", "VARLIK", "NET")
        gelen = []
        for _, row in df.iterrows():
            ad = str(row.get(name_col, "")).strip()
            if not ad or ad in gelen:
                continue
            if any(k in ad.upper() for k in ilgi):
                gelen.append(ad)
            if len(gelen) >= 40:
                break
        print(
            f"[fund] {symbol}: tanınan kalem yok · ilgili adlar ({len(gelen)}): {gelen}",
            file=sys.stderr,
        )
        return None

    return {
        "symbol": symbol,
        "periods": [str(c) for c in period_cols],
        "fields": fields,
        "missing": sorted(set(FIELDS) - seen),
    }


def group_order(symbol: str) -> list[str]:
    """
    Denenecek tablo şablonları, en olasıdan başlayarak.

    Şablon ELLE TUTULAN bir listeden tahmin ediliyordu ("bankaysa 2, değilse
    1") ve tahminin yanlış olduğu yerde veri hiç gelmiyordu. Ölçüldü: hiç
    alınamayan 12 sembolün neredeyse tamamı finans sektörü — AKBNK ve ALBRK
    listede olduğu hâlde "2" ile gelmiyor, AGESA/AKGRT/ANHYT (sigorta) ise
    listede olmadığı için "1" deniyor. Tahmini tek denemede bırakmak yerine
    sırayla hepsini deniyoruz: liste artık bir tahmin değil, yalnızca
    SIRALAMA ipucu.
    """
    if symbol in BANK_SYMBOLS:
        return ["2", "3", "1"]
    return ["1", "2", "3"]


def fetch_one(symbol: str, start_year: int, end_year: int, fetch=None) -> dict | None:
    if fetch is None:
        from isyatirimhisse import fetch_financials as isy_fetch

        fetch = isy_fetch

    for group in group_order(symbol):
        try:
            df = fetch(
                symbols=symbol,
                start_year=start_year,
                end_year=end_year,
                exchange="TRY",
                financial_group=group,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[fund] {symbol}: grup {group} çekilemedi ({e})", file=sys.stderr)
            continue

        record = extract(df, symbol)
        if record:
            record["group"] = group
            return record
        print(f"[fund] {symbol}: grup {group} boş döndü, sıradaki şablon", file=sys.stderr)

    return None


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

    # SÜRE BÜTÇESİ. CI adımının kendi zaman sınırı bu süreci öldürmüyor
    # (öksüz kalıp yazmaya devam ediyor ve yayımlama adımıyla yarışıyor).
    # Döngü kendi süresini bilmeli ve DURMADAN ÖNCE anlık görüntüyü yazmalı.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        saat = [0.0]

        def sahte_saat() -> float:
            return saat[0]

        def yavas_fetch(symbol: str):
            saat[0] += 10.0  # her sembol 10 "saniye"
            return {
                "symbol": symbol,
                "periods": ["2024/6"],
                "fields": {f: [1.0] for f in FIELDS},
            }

        records, fetched, failed = build_all(
            [f"S{i}" for i in range(1, 11)],
            out,
            yavas_fetch,
            every=100,          # ara kayıt DEVREYE GİRMESİN: sonu sınanıyor
            max_seconds=25,
            now=sahte_saat,
        )
        assert fetched == 3, f"süre dolunca durmalıydı, {fetched} sembol indi"
        snap = json.loads((out / SNAPSHOT_FILE).read_text(encoding="utf-8"))
        assert set(snap["symbols"]) == {"S1", "S2", "S3"}, sorted(snap["symbols"])

    # SÜREKLİ BAŞARISIZ sembol listeden düşmeli. Ölçüldü: 135 sembollük
    # ilerlemede 11'i hiç alınamıyor ve her tur baştan deneniyordu; bir
    # başarısızlık 12 yıl isteğinin tamamının zaman aşımına uğraması demek.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)

        def hep_basarisiz(symbol: str):
            return None

        for tur in range(MAX_ATTEMPTS):
            kalan = pending_symbols(["YOK"], out, failures=read_failures(out))
            assert kalan == ["YOK"], f"{tur + 1}. turda hâlâ denenmeli"
            build_all(kalan, out, hep_basarisiz)

        kalan = pending_symbols(["YOK"], out, failures=read_failures(out))
        assert kalan == [], f"{MAX_ATTEMPTS} denemeden sonra listeden düşmeliydi"
        # FORCE_ALL kaynağın düzelmiş olabileceği durumda hepsini geri getirir.
        assert pending_symbols(["YOK"], out, force_all=True, failures=read_failures(out)) == ["YOK"]

        # Başarılı bir çekim sayacı sıfırlar.
        def basarili(symbol: str):
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}

        build_all(["YOK"], out, basarili)
        assert read_failures(out).get("YOK", 0) == 0, "başarı sayacı sıfırlamalı"

    # TABLO ŞABLONU tek denemede bırakılmamalı. Ölçüldü: hiç alınamayan 12
    # sembolün neredeyse tamamı finans sektörü — elle tutulan liste yanlış
    # tahmin ettiğinde veri hiç gelmiyordu.
    # SEMBOL LİSTESİ: yayındaki liste varsa o kazanmalı. Depodaki kopya 607,
    # yayındaki 655 sembol içeriyordu — fark, 48 sembolün finansal tablosunun
    # hiç denenmemesiydi ve bu eksiklik sessizdi.
    with tempfile.TemporaryDirectory() as tmp:
        kok = Path(tmp)
        (kok / "public" / "data" / "bist").mkdir(parents=True)
        (kok / "public" / "data" / "bist" / "symbols.json").write_text(
            json.dumps({"symbols": ["AAA", "BBB", "CCC"]}), encoding="utf-8"
        )
        global PUBLISHED_SYMBOLS
        gercek = PUBLISHED_SYMBOLS
        PUBLISHED_SYMBOLS = kok / "public" / "data" / "bist" / "symbols.json"
        try:
            assert load_symbols(None) == ["AAA", "BBB", "CCC"], "yayındaki liste kazanmalı"
            assert load_symbols(2) == ["AAA", "BBB"], "--limit uygulanmalı"
            PUBLISHED_SYMBOLS = kok / "yok.json"
            depo = load_symbols(None)
            assert len(depo) > 100, "yayındaki liste yoksa depodaki kopyaya düşmeli"
        finally:
            PUBLISHED_SYMBOLS = gercek

    assert group_order("AKBNK")[0] == "2", "bankada önce UFRS denenmeli"
    assert group_order("AGESA")[0] == "1", "sanayide önce XI_29 denenmeli"
    for sym in ("AKBNK", "AGESA"):
        assert sorted(group_order(sym)) == ["1", "2", "3"], "üç şablon da denenmeli"

    # Öz test ÜÇÜNCÜ PARTİ PAKET İSTEMEZ: CI'daki `verify` işi yalnızca saf
    # Python veriyor (pandas orada kurulu değil). İlk yazdığımda `import
    # pandas` koymuştum, yerelde geçti CI'da kırıldı — testin değeri tam da
    # bağımlılıksız çalışmasında. `extract` bir DataFrame'den yalnızca
    # `empty`, `columns`, `iterrows` ve satırın `get`'ini kullanıyor.
    class SahteSatir:
        def __init__(self, veri: dict):
            self._veri = veri

        def get(self, key, default=None):
            return self._veri.get(key, default)

    class SahteTablo:
        def __init__(self, satirlar: list[dict]):
            self._satirlar = satirlar
            self.columns = list(satirlar[0]) if satirlar else []
            self.empty = not satirlar

        def iterrows(self):
            for i, satir in enumerate(self._satirlar):
                yield i, SahteSatir(satir)

    denenen: list[str] = []

    def sahte_kaynak(symbols, start_year, end_year, exchange, financial_group):
        denenen.append(financial_group)
        if financial_group != "3":
            # İlk iki şablon tanınmayan kalem adı döndürüyor → şablon uymuyor.
            return SahteTablo([{"FINANCIAL_ITEM_NAME_TR": "Boş", "2024/6": 1.0}])
        return SahteTablo([{"FINANCIAL_ITEM_NAME_TR": "Ana Ortaklık Payları", "2024/6": 42.0}])

    record = fetch_one("AGESA", 2024, 2024, fetch=sahte_kaynak)
    assert record is not None, "üçüncü şablonda bulunmalıydı"
    assert record["group"] == "3", record["group"]
    assert denenen == ["1", "2", "3"], denenen

    # Şablon uymadığında GELEN kalem adları kayda yazılmalı. Ölçüldü:
    # AKBNK/ALBRK'de tablo geliyor ama tanınan kalem yok; hangi adların
    # geldiğini görmeden FIELD_ITEMS'a ne ekleneceği tahmin olurdu.
    import io

    tanimsiz = SahteTablo([{"FINANCIAL_ITEM_NAME_TR": "FAİZ GELİRLERİ", "2024/6": 1.0}])
    yakala = io.StringIO()
    gercek_stderr, sys.stderr = sys.stderr, yakala
    try:
        bos = extract(tanimsiz, "AKBNK")
    finally:
        sys.stderr = gercek_stderr
    assert bos is None, "tanınan kalem yokken kayıt üretilmemeli"
    assert "FAİZ GELİRLERİ" in yakala.getvalue(), yakala.getvalue()
    # Süzgeç ilgisiz satırı elemeli: banka tablosunun ilk on beş satırı
    # bilanço aktif tarafı ve aradığımız kâr satırları aşağıda kalıyordu.
    elenen = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "III. BANKALAR", "2024/6": 1.0},
            {"FINANCIAL_ITEM_NAME_TR": "NET DÖNEM KARI", "2024/6": 2.0},
        ]
    )
    yakala2 = io.StringIO()
    gercek_stderr, sys.stderr = sys.stderr, yakala2
    try:
        extract(elenen, "GARAN")
    finally:
        sys.stderr = gercek_stderr
    assert "NET DÖNEM KARI" in yakala2.getvalue(), yakala2.getvalue()
    assert "BANKALAR" not in yakala2.getvalue(), yakala2.getvalue()

    print("[fund] self-test tamam")


SNAPSHOT_FILE = "snapshot.json"
FAILURES_FILE = "failures.json"
MAX_ATTEMPTS = 3


def read_failures(out_dir: Path) -> dict[str, int]:
    """Sembol → üst üste başarısız deneme sayısı."""
    try:
        data = json.loads((out_dir / FAILURES_FILE).read_text(encoding="utf-8"))
        return {k: int(v) for k, v in data.items() if isinstance(v, (int, float))}
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return {}


def write_failures(failures: dict[str, int], out_dir: Path) -> None:
    (out_dir / FAILURES_FILE).write_text(
        json.dumps(failures, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def pending_symbols(
    symbols: list[str],
    out_dir: Path,
    force_all: bool = False,
    failures: dict[str, int] | None = None,
) -> list[str]:
    """
    Henüz indirilmemiş semboller (FORCE_ALL ile hepsi).

    Üst üste `MAX_ATTEMPTS` kez başarısız olan sembol listeden düşüyor.
    Ölçüldü: 135 sembollük ilerlemede 11'i hiç alınamıyor ve her çalıştırma
    onları BAŞTAN deniyor. Bir başarısızlık ucuz değil — 12 yıl isteğinin
    hepsi yeniden denenip zaman aşımına uğruyor. Sürekli başarısız olan bir
    sembolü her turda yeniden denemek, maliyeti ne olursa olsun yanlış:
    ilerlemeyi yiyor ve kayıt gürültüsü üretiyor. FORCE_ALL hepsini geri
    getiriyor (kaynak düzelmiş olabilir).
    """
    fails = failures or {}
    return [
        s
        for s in symbols
        if force_all
        or (not (out_dir / f"{s}.json").exists() and fails.get(s, 0) < MAX_ATTEMPTS)
    ]


def records_on_disk(out_dir: Path) -> list[dict]:
    """Diskteki tüm sembol kayıtları. Bozuk dosya sessizce atlanır."""
    records: list[dict] = []
    for path in sorted(out_dir.glob("*.json")):
        if path.name in (SNAPSHOT_FILE, FAILURES_FILE):
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
    (out_dir / SNAPSHOT_FILE).write_text(
        json.dumps(build_snapshot(records), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def build_all(
    pending: list[str],
    out_dir: Path,
    fetch,
    every: int = 25,
    max_seconds: float | None = None,
    now=time.monotonic,
) -> tuple[list[dict], int, int]:
    """
    Eksik sembolleri indirip diske yazar; arada bir anlık görüntüyü tazeler ve
    KENDİ SÜRESİNİ kendisi sınırlar.

    Süreyi neden betik sınırlıyor: CI adımının `timeout-minutes` ayarı bu
    süreci ÖLDÜRMÜYOR. Ölçüldü — adım 8 dakikada "tamamlandı" sayıldı ama
    python öksüz süreç olarak çalışmaya devam etti (iş sonunda runner
    "Terminate orphan process: (python)" diye topladı). Yani sonraki adımlar
    hâlâ dosya yazan bir süreçle YARIŞTI: yayımlama o anki yarım klasörü
    kopyaladı, anlık görüntü yazımı yetişmedi ve tarama yine "temel veri yok"
    dedi. Kendi süresini bilen bir döngü hem temiz duruyor hem de durmadan
    önce anlık görüntüyü yazıyor.

    Ara kayıt yine de duruyor: süre dolmadan başka bir sebeple kesilirse
    (bellek, ağ, elle iptal) diskte geçerli bir anlık görüntü kalsın.
    """
    records = records_on_disk(out_dir)
    failures = read_failures(out_dir)
    fetched = 0
    failed = 0
    started = now()
    for i, symbol in enumerate(pending, 1):
        if max_seconds is not None and now() - started >= max_seconds:
            print(
                f"[fund] süre doldu ({max_seconds:.0f} sn) — {i - 1}/{len(pending)} işlendi, "
                "kalanlar bir sonraki çalıştırmaya"
            )
            break
        record = fetch(symbol)
        if not record:
            failed += 1
            # Başarısızlık HEMEN kaydediliyor: süre dolup kesilirsek de
            # bir sonraki tur aynı sembole aynı süreyi harcamasın.
            failures[symbol] = failures.get(symbol, 0) + 1
            write_failures(failures, out_dir)
            continue
        # Başarı sayacı sıfırlar VE diske yazar: yoksa kaynak düzeldikten
        # sonra bile eski sayaç sembolü gereksiz yere listeden düşürürdü.
        if failures.pop(symbol, None) is not None:
            write_failures(failures, out_dir)
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
    ap.add_argument(
        "--only",
        default=os.environ.get("FUND_ONLY", ""),
        help="yalnızca bu semboller (virgülle); atlama listesini de yok sayar",
    )
    ap.add_argument(
        "--max-seconds",
        type=float,
        default=float(os.environ.get("FUND_MAX_SECONDS", 0)) or None,
        help="bu süreden sonra temiz dur (CI adım sınırından ÖNCE bitmek için)",
    )
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
    failures = read_failures(OUT)

    # Hedefli çalıştırma: belirli sembolleri, atlama listesine RAĞMEN dene.
    # Buna ihtiyaç doğdu çünkü kendi düzeltmem teşhisi engelledi — üç denemede
    # alınamayan sembol listeden düşünce, o sembolün NEDEN alınamadığını yazan
    # teşhis koduna da hiç sıra gelmiyor. Bir kusuru inceleyebilmek için onu
    # bir kez daha çalıştırabilmek gerekiyor.
    only = [s.strip().upper() for s in args.only.split(",") if s.strip()]
    if only:
        pending = only
        print(f"[fund] hedefli çalıştırma: {', '.join(pending)} (atlama listesi yok sayıldı)")
    else:
        pending = pending_symbols(symbols, OUT, force_all, failures)
        skipped = sum(1 for c in failures.values() if c >= MAX_ATTEMPTS)
        if skipped:
            print(f"[fund] {skipped} sembol {MAX_ATTEMPTS} denemede alınamadı, atlanıyor")
    if not pending:
        print(f"[fund] {len(symbols)} sembolün hepsi zaten var (FORCE_ALL ile tazelenir)")
    else:
        print(f"[fund] {len(pending)}/{len(symbols)} sembol eksik, indiriliyor")

    records, fetched, failed = build_all(
        pending,
        OUT,
        lambda sym: fetch_one(sym, args.start_year, args.end_year),
        max_seconds=args.max_seconds,
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
