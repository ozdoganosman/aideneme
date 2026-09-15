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
import re
import sys
import tempfile
import threading
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
    "revenue": [
        "Satış Gelirleri",
        "Hasılat",
        "Satış Gelirleri (net)",
        "FAALİYET GELİRLERİ",
        # Banka: ciro yerine faiz geliri.
        "FAİZ GELİRLERİ",
    ],
    "grossProfit": ["BRÜT KAR (ZARAR)", "Brüt Kar (Zarar)"],
    "operatingProfit": ["FAALİYET KARI (ZARARI)", "ESAS FAALİYET KARI (ZARARI)"],
    "netIncome": [
        "Ana Ortaklık Payları",
        "DÖNEM NET KARI (ZARARI)",
        "Net Dönem Karı (Zararı)",
        # Banka tablosu aynı kalemi başka sırayla ve eğik çizgiyle yazıyor.
        "Dönem Net Kar/Zararı",
        "Net Dönem Kar/Zararı",
    ],
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

# KALEM KODU ile eşleşme — addan ÖNCE denenir.
#
# Neden kod: ad kararsız, kod kararlı. Nakit akış kalemleri listede
# "İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI" diye aranıyordu; kaynak o satıra
# "İşletme Faaliyetlerinden Kaynaklanan Net Nakit" diyor. Ad tutmadığı için
# `operatingCashFlow` 559 sembolün hiçbirinde doldurulamadı ve "Nakde
# dönüşüm" kartı her şirkette boş kaldı.
#
# BU SONUCU BİR KEZ YANLIŞ OKUDUM: teşhis, aday adları satır sırasıyla
# tarayıp alan başına on ikide kesiyordu ve bilanço satırları önce geldiği
# için kapak nakit akış satırlarına hiç ulaşmıyordu. "Kaynak bu tabloyu
# vermiyor" diye yazdım — yanlıştı. Kod önekiyle sorunca 25 nakit akış satırı
# geldi.
#
# Kodlar TAM eşleşiyor, önek değil: "4C" ile "4CA" farklı kalemler.
FIELD_CODES: dict[str, tuple[str, ...]] = {
    "operatingCashFlow": ("4C",),   # İşletme Faaliyetlerinden Kaynaklanan Net Nakit
    "capex": ("4CAI",),             # Sabit Sermaye Yatırımları
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


# Madde numarası ön eki: "XVI. ÖZKAYNAKLAR", "16.4.2 Dönem Net Kar/Zararı",
# "I. FAİZ GELİRLERİ". Banka ve sigorta tabloları her satırı böyle numaralar;
# sanayi tabloları numaralamaz.
_MADDE_NO = re.compile(r"^(?:[IVXLCDM]+\.|\d+(?:\.\d+)*\.?)\s+")


def normalize(name: str) -> str:
    """
    Kalem adını eşleştirmeye hazırlar: boşlukları sadeleştirir, MADDE
    NUMARASINI soyar, TÜRKÇE-GÜVENLİ biçimde büyütür.

    Numara soyma olmadan banka bilançosu hiç eşleşmiyordu. Ölçüldü: aranan
    satırlar veride VARDI — 'AKTİF TOPLAMI' zaten listede, 'XVI. ÖZKAYNAKLAR'
    listedeki 'ÖZKAYNAKLAR' ile aynı kalem, '16.4.2 Dönem Net Kar/Zararı' ise
    net kâr. Eksik olan ad değil, ön ekti. Kırk banka adını tek tek listeye
    eklemek yanlış çözüm olurdu: aynı tablo sigortada ve yatırım ortaklığında
    başka numaralarla geliyor.

    KÜÇÜLTME DEĞİL `fold`. Burada düz `.lower()` vardı ve Türkçe'de sessizce
    yanlış eşleştiriyordu:

        "DÖNEN VARLIKLAR".lower() → "dönen varliklar"   (noktalı i)
        "Dönen Varlıklar".lower() → "dönen varlıklar"   (noktasız ı)

    İki metin EŞİT DEĞİL. Yayındaki veriyle ölçüldü: `currentAssets` 561
    sembolün HİÇBİRİNDE yoktu, oysa kaynak o satırı "Dönen Varlıklar" diye
    gönderiyor — listemizde yalnızca büyük harfli yazım vardı. Ürüne yansıması
    somut: "Cari oran" süzgeci hiçbir sonuç veremiyordu.

    DÜZELTME SONRASI ÖLÇÜLDÜ (zorlamalı tazeleme, 559 sembol): `currentAssets`
    522 sembolde dolu (%93,4) ve cari oran aynı sayıda sembolde hesaplanabilir
    hâle geldi; medyanı 1,43. Kalan 37 sembol banka ve benzeri — onların
    bilançosunda dönen/duran ayrımı yok, yani boş kalmaları doğru.

    `currentLiabilities` bu tuzağa düşmemişti, çünkü listede HEM büyük harfli
    HEM başlık yazımı vardı; yani kusur, her ada iki yazım eklemeyi unutmakla
    gizleniyordu. Kökü düzeltmek, listeye ikinci yazım eklemekten iyidir.

    Aynı tuzak bu dosyada `fold` için zaten belgelenmişti; eşleşme yolu
    güncellenmemişti.
    """
    text = " ".join(str(name).split()).strip()
    text = _MADDE_NO.sub("", text)
    return fold(text)


def fold(text: str) -> str:
    """
    Karşılaştırma için büyüt ve NOKTALI/NOKTASIZ i ayrımını kaldır.

    `str.upper()` Türkçe bilmiyor: "Nakit".upper() → "NAKIT" (noktasız I),
    yani "NAKİT" anahtarı HİÇ eşleşmiyor. Teşhis anahtarlarını düz `.upper()`
    ile aramak bu yüzden sessizce boş sonuç veriyordu — banka tablolarında
    fark edilmedi çünkü oradaki adlar zaten tamamı büyük harfti ("I. FAİZ
    GELİRLERİ"), ama karışık yazılan adlarda ("Nakit ve Nakit Benzerleri")
    tutmuyor. Teşhis için noktayı tamamen yok saymak en güvenlisi.
    """
    return text.upper().replace("İ", "I")


# Eksik alan → gelen kalem adlarında aranacak anahtarlar. Teşhis içindir:
# hangi adın hangi alana karşılık geldiğini TAHMİN etmemek için.
_EKSIK_ANAHTAR = {
    "currentAssets": ("DÖNEN", "CARİ"),
    "currentLiabilities": ("KISA VADELİ", "CARİ"),
    "longLiabilities": ("UZUN VADELİ",),
    "operatingCashFlow": ("NAKİT", "FAALİYET"),
    "capex": ("YATIRIM", "DURAN VARLIK", "ALIM"),
    "inventory": ("STOK",),
    "cash": ("NAKİT",),
    "equity": ("ÖZKAYNAK",),
    "paidCapital": ("SERMAYE",),
    "grossProfit": ("BRÜT",),
    "operatingProfit": ("FAALİYET",),
    "revenue": ("SATIŞ", "HASILAT", "GELİR"),
    "netIncome": ("NET", "DÖNEM"),
    "assets": ("VARLIK", "AKTİF"),
}

# Teşhis tur başına BİR kez basılıyor: 655 sembolde her seferinde basmak
# kaydı okunamaz hale getirir, bir örnek ise soruyu cevaplamaya yetiyor.
_eksik_basildi: set[str] = set()

# Eksik alan → kaynakta görülen İLGİLİ kalem adları. Tek bir sembolün
# çıktısını stderr'e basmak yetmedi: kayıt 400 satır ve teşhis onun başında,
# yani okumak için tüm kaydı indirmek gerekiyordu. Adlar birikip yayımlanan
# bir dosyaya yazılıyor (bkz. `write_tani`).
_aday_adlar: dict[str, list[str]] = {}
# Aday toplanan sembol sayısı — her sembolde tablo taramak boşuna iş.
_ADAY_SEMBOL_SINIRI = 20
# Cevapta hangi kolonlar geliyor ve KOD sütunu var mı? borsapy aynı uç
# noktadan nakit akışını `itemCode` öneki "4" ile süzüyor, yani cevapta bir
# kod sütunu olması bekleniyor. Bizim eşleşmemiz yalnızca Türkçe ADA bakıyor.
_kolon_ornegi: list[str] = []
# Kod öneki "4" olan satırlar (kod, ad) — nakit akış kalemleri.
_nakit_satirlari: list[tuple[str, str]] = []


def missing_candidates(df, name_col: str, missing: list[str], limit: int = 30) -> list[str]:
    """
    Eksik alanlarla İLGİLİ olabilecek gelen kalem adları.

    Var olan teşhis yalnızca HİÇBİR kalem tanınmadığında çalışıyordu; oysa
    asıl sık durum kısmî eksiklik. Ölçüldü: 559 sembolün TAMAMINDA
    `currentAssets`, `operatingCashFlow` ve `capex` boş — tablo geliyor,
    öteki kalemler tanınıyor, yalnızca bu üçü tutmuyor. Hiçbir teşhis
    satırı çıkmadığı için gelen adın ne olduğu görünmüyordu ve FIELD_ITEMS'a
    ne ekleneceği tahmine kalıyordu.
    """
    anahtarlar = tuple(k for alan in missing for k in _EKSIK_ANAHTAR.get(alan, ()))
    if not anahtarlar:
        return []
    adlar: list[str] = []
    for _, row in df.iterrows():
        ad = str(row.get(name_col, "")).strip()
        if not ad or ad in adlar:
            continue
        if any(fold(k) in fold(ad) for k in anahtarlar):
            adlar.append(ad)
        if len(adlar) >= limit:
            break
    return adlar


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

    # Kod sütunu her şablonda olmayabilir; yoksa ada düşülüyor.
    code_col = "FINANCIAL_ITEM_CODE" if "FINANCIAL_ITEM_CODE" in df.columns else None
    wanted_code = {kod: alan for alan, kodlar in FIELD_CODES.items() for kod in kodlar}

    for _, row in df.iterrows():
        field = None
        if code_col is not None:
            field = wanted_code.get(str(row.get(code_col, "")).strip())
        if field is None:
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
            if any(fold(k) in fold(ad) for k in ilgi):
                gelen.append(ad)
            if len(gelen) >= 40:
                break
        print(
            f"[fund] {symbol}: tanınan kalem yok · ilgili adlar ({len(gelen)}): {gelen}",
            file=sys.stderr,
        )
        return None

    missing = sorted(set(FIELDS) - seen)
    if missing and len(_eksik_basildi) < _ADAY_SEMBOL_SINIRI:
        ilk = not _eksik_basildi
        _eksik_basildi.add(symbol)
        adaylar = missing_candidates(df, name_col, missing)
        for alan in missing:
            for ad in missing_candidates(df, name_col, [alan]):
                liste = _aday_adlar.setdefault(alan, [])
                if ad not in liste and len(liste) < 12:
                    liste.append(ad)

        # KOD SÜTUNU VAR MI ve nakit akış satırları geliyor mu?
        #
        # Önceki tur "nakit akış tablosu gerçekten yok" dedirtti, ama o sonuç
        # KENDİ teşhisimin kapağından çıkmış olabilir: adaylar satır sırasıyla
        # taranıyor ve alan başına on ikide kesiliyor; bilanço satırları önce
        # geldiği için kapak nakit akış satırlarına ulaşmadan dolabilir.
        #
        # Kod öneki daha güvenilir bir soru: aynı uç noktayı kullanan borsapy
        # nakit akışını `itemCode` öneki "4" ile süzüyor. Kod sütununun adını
        # da TAHMİN ETMİYORUZ — gelen kolon adları olduğu gibi raporlanıyor.
        if not _kolon_ornegi:
            _kolon_ornegi.extend(str(c) for c in df.columns)
        kod_sutun = next(
            (c for c in df.columns if "CODE" in str(c).upper() or "KOD" in str(c).upper()),
            None,
        )
        if kod_sutun is not None and not _nakit_satirlari:
            for _, satir in df.iterrows():
                kod = str(satir.get(kod_sutun, "")).strip()
                if kod.startswith("4") and len(_nakit_satirlari) < 25:
                    _nakit_satirlari.append((kod, str(satir.get(name_col, "")).strip()))
        if ilk:
            # Tur başına tek satır: kayıt zaten uzun, dosya asıl kaynak.
            print(
                f"[fund] {symbol}: eksik alan {missing} · ilgili gelen adlar: {adaylar}",
                file=sys.stderr,
            )

    return {
        "symbol": symbol,
        "periods": [str(c) for c in period_cols],
        "fields": fields,
        "missing": missing,
        # Tazeleme sırası için. Dosya mtime'ı işe yaramıyor: gh-pages klonu
        # bütün dosyalara aynı damgayı veriyor.
        "fetched": int(time.time()),
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


# Kaynak kütüphanesinin "bu sembol için veri yok" hatasının imzası. Kütüphane
# üç şablon adını da doğruluyor ve BAŞKA bir şablon kabul etmiyor
# ('1' XI_29, '2' UFRS, '3' UFRS_K) — yani denenecek dördüncü bir tablo yok.
_VERI_YOK = "no financial data was fetched"

# Ağın çalıştığını sınamak için kullanılan kontrol sembolü: finansal tablosu
# kesin olan, kotasyondan düşme ihtimali düşük bir sembol.
CANARY_SYMBOL = "THYAO"


def fetch_one(
    symbol: str, start_year: int, end_year: int, fetch=None
) -> tuple[dict | None, str]:
    """
    (kayıt, sonuç) — sonuç: "ok" · "veriyok" · "tanimsiz" · "hata".

    "Tablo alınamadı"ın üç ayrı anlamı var ve karıştırmak pahalıya patlıyor:

    - **veriyok**: üç şablonun üçü de kütüphanenin "hiç finansal veri
      çekilemedi" hatasını attı. Endeksler (XU100, XBANK), fonlar (ALTIN,
      GLDTR, ZGOLD) ve varantlar bilanço YAYIMLAMAZ; bu bir eksiklik değil,
      aracın türü. Ölçüldü: 655 sembolün 96'sı böyle, 52'si doğrudan endeks.
    - **tanimsiz**: tablo GELDİ ama tanınan kalem yok. Bu bir AYIKLAMA
      boşluğu, aracın türü değil — banka bilançolarında tam olarak bu oldu
      (kalemler oradaydı, madde numarası yüzünden eşleşmiyordu). Bunu
      "tablosuz" saymak gerçek bir kusuru kalıcı olarak gizlerdi, o yüzden
      başarısızlık sayılıyor ve teşhis satırları basılıyor.
    - **hata**: başka bir istisna — ağ, zaman aşımı, kaynak arızası.

    NOT: kütüphane ağ hatasını da yutup aynı "veri yok" hatasına çeviriyor
    (ölçüldü: proxy engelliyken de aynı ValueError çıkıyor). Bu yüzden
    "veriyok" tek başına yeterli kanıt değil; build_all bunu ancak AYNI
    turda başka semboller inmişse (yani ağ çalışıyorsa) kalıcı sayıyor.
    """
    if fetch is None:
        from isyatirimhisse import fetch_financials as isy_fetch

        fetch = isy_fetch

    tablo_geldi = False
    baska_hata = False
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
            if _VERI_YOK not in str(e).lower():
                baska_hata = True
            print(f"[fund] {symbol}: grup {group} çekilemedi ({e})", file=sys.stderr)
            continue

        tablo_geldi = True
        record = extract(df, symbol)
        if record:
            record["group"] = group
            return record, "ok"
        print(f"[fund] {symbol}: grup {group} boş döndü, sıradaki şablon", file=sys.stderr)

    if tablo_geldi:
        return None, "tanimsiz"
    return None, ("hata" if baska_hata else "veriyok")


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


def _uyarla(f):
    """
    Test sahtelerini (sembol → kayıt|None) build_all'ın sözleşmesine uyarlar.

    Sahteler kasten basit tutuluyor: sınananlar kaldığı yerden devam,
    süre bütçesi ve sayaçlar; sonuç kodu bunların hiçbirini değiştirmiyor.
    "tablosuz" ayrımının kendi testi ayrıca var.
    """

    def g(symbol: str):
        r = f(symbol)
        return r, ("ok" if r else "hata")

    return g


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
        # `v` alanı şart: artımlı tur güncel sürümle yazılmış kaydı atlıyor,
        # eski sürümlüyü yeniden çekiyor (aşağıdaki bayatlama sınamasına bak).
        (out / "AAA.json").write_text(
            json.dumps(
                {"symbol": "AAA", "periods": ["2024/6"], "fields": {}, "v": EXTRACT_VERSION}
            ),
            encoding="utf-8",
        )
        (out / "snapshot.json").write_text("{}", encoding="utf-8")
        (out / "BOZUK.json").write_text("{ bu json değil", encoding="utf-8")

        assert pending_symbols(["AAA", "BBB"], out) == ["BBB"], "var olan yeniden indirilmemeli"
        assert pending_symbols(["AAA", "BBB"], out, force_all=True) == ["AAA", "BBB"]

        found = [r["symbol"] for r in records_on_disk(out)]
        assert found == ["AAA"], f"anlık görüntü diskten kurulmalı: {found}"

        # Birleşik tablo dosyası. Tarayıcıda "Kalite skoru", "Ciro büyümesi"
        # ve "Kâr büyümesi" filtreleri HER eşikte sıfır sonuç veriyordu:
        # bu metrikler dönem DİZİSİ ister, anlık görüntüde ise yalnızca son
        # TTM var ve tarayıcı sembol başına tabloyu hiç yüklemiyordu.
        write_all(records_on_disk(out), out)
        hepsi = json.loads((out / ALL_FILE).read_text(encoding="utf-8"))
        assert hepsi["symbols"]["AAA"]["periods"] == ["2024/6"], "tam tablo taşınmalı"
        assert "BOZUK" not in hepsi["symbols"], "bozuk dosya sessizce atlanmalı"
        # Kendi çıktısını yeniden okumamalı: hepsi.json bir sembol kaydı değil.
        write_all(records_on_disk(out), out)
        assert set(json.loads((out / ALL_FILE).read_text(encoding="utf-8"))["symbols"]) == {"AAA"}

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
            build_all(["S1", "S2", "DUR", "S3"], out, _uyarla(fake_fetch), every=2)
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
            _uyarla(yavas_fetch),
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
            build_all(kalan, out, _uyarla(hep_basarisiz))

        kalan = pending_symbols(["YOK"], out, failures=read_failures(out))
        assert kalan == [], f"{MAX_ATTEMPTS} denemeden sonra listeden düşmeliydi"
        # FORCE_ALL kaynağın düzelmiş olabileceği durumda hepsini geri getirir.
        assert pending_symbols(["YOK"], out, force_all=True, failures=read_failures(out)) == ["YOK"]

        # ...ve EN ESKİ TAZELENEN ÖNCE gelir. Sıra giriş sırası olsaydı
        # zorlamalı tazeleme yakınsamazdı: bütçe listenin yarısına yetiyor ve
        # her tur aynı baştan başlıyor, kuyruk hiç tazelenmiyordu.
        (out / "ESKI.json").write_text(
            json.dumps({"symbol": "ESKI", "periods": [], "fields": {}, "fetched": 100}), encoding="utf-8"
        )
        (out / "YENI.json").write_text(
            json.dumps({"symbol": "YENI", "periods": [], "fields": {}, "fetched": 900}), encoding="utf-8"
        )
        (out / "DAMGASIZ.json").write_text(
            json.dumps({"symbol": "DAMGASIZ", "periods": [], "fields": {}}), encoding="utf-8"
        )
        sira = pending_symbols(["YENI", "ESKI", "DAMGASIZ"], out, force_all=True)
        # Damgasız eski kayıt 0 sayılır ve en öne geçer.
        assert sira == ["DAMGASIZ", "ESKI", "YENI"], sira

        # ARTIMLI TUR ESKİ KURALLA YAZILMIŞ KAYDI YENİDEN ÇEKER. Eskiden tek
        # ölçüt "dosya var mı" idi; ayıklama kuralı değişince eski kayıtlar
        # ancak FORCE_ALL ile ziyaret ediliyordu ve zorlamalı turun bütçesi
        # listenin yarısına yettiği için kuyruk aylarca eski kuralda kalıyordu.
        # Ölçüldü: yayındaki 87 eksik nakit akışının 72'si tam olarak buydu.
        for ad, kayit in (
            ("GUNCEL", {"fetched": 100, "v": EXTRACT_VERSION}),
            ("ESKISURUM", {"fetched": 100, "v": EXTRACT_VERSION - 1}),
            ("SURUMSUZ", {"fetched": 100}),
            ("BOZUK", None),
        ):
            path = out / f"{ad}.json"
            if kayit is None:
                path.write_text("{bozuk", encoding="utf-8")
            else:
                path.write_text(
                    json.dumps({"symbol": ad, "periods": [], "fields": {}, **kayit}),
                    encoding="utf-8",
                )
        bekleyen = pending_symbols(["GUNCEL", "ESKISURUM", "SURUMSUZ", "BOZUK"], out)
        assert bekleyen == ["ESKISURUM", "SURUMSUZ", "BOZUK"], bekleyen

        # Güncel sürümle yazılan kayıt artımlı turda YENİDEN ÇEKİLMEZ; yoksa
        # her tur bütün evreni tarar ve bütçe hiçbir şeye yetmez.
        def damgali(symbol: str):
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}

        build_all(["TAZE"], out, _uyarla(damgali))
        assert json.loads((out / "TAZE.json").read_text(encoding="utf-8"))["v"] == EXTRACT_VERSION
        assert pending_symbols(["TAZE"], out) == [], "taze kayıt yeniden çekilmemeli"

        # Başarılı bir çekim sayacı sıfırlar.
        def basarili(symbol: str):
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}

        build_all(["YOK"], out, _uyarla(basarili))
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

    # PARALEL İNDİRME. Sırayla 420 sembol 2–3,5 saat sürüyor ve hiçbir CI
    # işine sığmıyor; liste her turda birkaç sembol ilerlediği için kullanıcı
    # yıllarca "finansal veri yok" görüyordu.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        eszamanli = {"simdi": 0, "en_cok": 0}
        kilit = threading.Lock()

        def yavas(symbol: str):
            with kilit:
                eszamanli["simdi"] += 1
                eszamanli["en_cok"] = max(eszamanli["en_cok"], eszamanli["simdi"])
            time.sleep(0.02)  # ağ beklemesini taklit et
            with kilit:
                eszamanli["simdi"] -= 1
            if symbol == "KOTU":
                return None
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}

        hedef = [f"P{i}" for i in range(1, 13)] + ["KOTU"]
        _, fetched, failed = build_all(hedef, out, _uyarla(yavas), workers=4)
        assert fetched == 12, f"paralel yolda 12 sembol inmeliydi, {fetched}"
        assert failed == 1, f"başarısız sembol paralel yolda da sayılmalı, {failed}"
        assert eszamanli["en_cok"] > 1, "eşzamanlılık hiç oluşmadı — paralel yol çalışmıyor"
        assert eszamanli["en_cok"] <= 4, f"işçi sınırı aşıldı: {eszamanli['en_cok']}"
        snap = json.loads((out / SNAPSHOT_FILE).read_text(encoding="utf-8"))
        assert len(snap["symbols"]) == 12, sorted(snap["symbols"])
        assert read_failures(out).get("KOTU") == 1, "paralel yolda sayaç işlemedi"

    # Paralel yolda da SÜRE BÜTÇESİ geçerli: dolduğunda yeni iş verilmemeli.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        saat = [0.0]

        def saatli(symbol: str):
            saat[0] += 10.0
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}

        _, fetched, _ = build_all(
            [f"Q{i}" for i in range(1, 21)],
            out,
            _uyarla(saatli),
            every=100,
            max_seconds=25,
            now=lambda: saat[0],
            workers=3,
        )
        # Uçuştaki işler toplanıyor, yenisi verilmiyor: sayı işçi sayısı kadar
        # taşabilir ama listenin tamamı İNMEMELİ.
        assert 3 <= fetched <= 8, f"süre bütçesi paralel yolda tutmadı: {fetched}"

    # BAŞARISIZLIK SAYAÇLARI ayıklama kuralı değişince sıfırlanmalı. Ölçüldü:
    # madde numarası soyma eklendikten sonra AKBNK/ALBRK/GARAN'a tek istek bile
    # gitmedi, çünkü eski kuralla biriken sayaç onları listeden düşürmüştü.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        write_failures({"AKBNK": 5}, out)
        assert read_failures(out) == {"AKBNK": 5}, "aynı sürümde sayaç korunmalı"
        eski = json.loads((out / FAILURES_FILE).read_text(encoding="utf-8"))
        eski["_version"] = EXTRACT_VERSION - 1
        (out / FAILURES_FILE).write_text(json.dumps(eski), encoding="utf-8")
        assert read_failures(out) == {}, "eski kuralın sayaçları atılmalı"
        # Sürüm alanı olmayan dosya da eski kuraldandır.
        (out / FAILURES_FILE).write_text(json.dumps({"AKBNK": 5}), encoding="utf-8")
        assert read_failures(out) == {}, "sürümsüz dosya eski kuraldandır"
        # ...ve sıfırlanınca sembol yeniden denenir.
        assert pending_symbols(["AKBNK"], out, failures=read_failures(out)) == ["AKBNK"]

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

    record, sonuc = fetch_one("AGESA", 2024, 2024, fetch=sahte_kaynak)
    assert record is not None, "üçüncü şablonda bulunmalıydı"
    assert sonuc == "ok", sonuc
    assert record["group"] == "3", record["group"]
    assert denenen == ["1", "2", "3"], denenen

    # TABLOSUZ ile HATA ayrı şeyler. Ölçüldü: 655 sembolün 97'si hiç tablo
    # vermiyor ve 52'si doğrudan endeks (XU100, XBANK…); fonlar ve varantlar
    # da bilanço yayımlamaz. Bunları "başarısız" saymak her turda boşuna
    # istek demek, arayüzde de kullanıcıya bir kusur varmış gibi görünüyor.
    def hep_bos(symbols, start_year, end_year, exchange, financial_group):
        return SahteTablo([{"FINANCIAL_ITEM_NAME_TR": "Tanınmayan", "2024/6": 1.0}])

    # Tablo GELDİ ama kalem tanınmadı → ayıklama boşluğu, aracın türü değil.
    # Bunu "tablosuz" saymak banka kusurunu kalıcı olarak gizlerdi.
    kayit, sonuc = fetch_one("AKBNK", 2024, 2024, fetch=hep_bos)
    assert kayit is None and sonuc == "tanimsiz", sonuc

    # Kaynağın "hiç veri yok" hatası → araç tablo yayımlamıyor olabilir.
    def veri_yok(symbols, start_year, end_year, exchange, financial_group):
        raise ValueError("No financial data was fetched for any symbol.")

    kayit, sonuc = fetch_one("XU100", 2024, 2024, fetch=veri_yok)
    assert kayit is None and sonuc == "veriyok", sonuc

    # Başka bir istisna → gerçek hata, yeniden denenmeli.
    def hep_patla(symbols, start_year, end_year, exchange, financial_group):
        raise RuntimeError("ağ")

    kayit, sonuc = fetch_one("THYAO", 2024, 2024, fetch=hep_patla)
    assert kayit is None and sonuc == "hata", sonuc

    # KISMÎ EKSİKLİK teşhisi. Var olan teşhis yalnızca HİÇBİR kalem
    # tanınmadığında çalışıyordu; asıl sık durum ise kısmî eksiklik.
    # Ölçüldü: 559 sembolün tamamında currentAssets/operatingCashFlow/capex
    # boş — tablo geliyor, öteki kalemler tanınıyor, yalnızca bu üçü
    # tutmuyor ve hiçbir teşhis satırı çıkmıyordu.
    tablo = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "TOPLAM DÖNEN VARLIKLAR", "2024/6": 5.0},
            {"FINANCIAL_ITEM_NAME_TR": "Stoklar", "2024/6": 1.0},
            {"FINANCIAL_ITEM_NAME_TR": "A. İşletme Faaliyetlerinden Nakit Akışları", "2024/6": 2.0},
            {"FINANCIAL_ITEM_NAME_TR": "Ana Ortaklık Payları", "2024/6": 3.0},
        ]
    )
    adaylar = missing_candidates(tablo, "FINANCIAL_ITEM_NAME_TR", ["currentAssets"])
    assert adaylar == ["TOPLAM DÖNEN VARLIKLAR"], adaylar
    nakit = missing_candidates(tablo, "FINANCIAL_ITEM_NAME_TR", ["operatingCashFlow"])
    assert nakit == ["A. İşletme Faaliyetlerinden Nakit Akışları"], nakit
    # Eksik alan için anahtar tanımlı değilse tahmin üretilmiyor.
    assert missing_candidates(tablo, "FINANCIAL_ITEM_NAME_TR", ["bilinmeyen"]) == []

    # TÜRKÇE BÜYÜTME TUZAĞI: "Nakit".upper() → "NAKIT" (noktasız I), yani
    # "NAKİT" anahtarı düz upper() ile HİÇ eşleşmiyor. Banka tablolarında
    # fark edilmedi çünkü oradaki adlar zaten büyük harfti.
    assert "NAKİT" not in "Nakit".upper(), "tuzağın kendisi kaybolduysa test anlamsız"
    assert fold("Nakit") == fold("NAKİT") == "NAKIT"
    assert fold("İşletme") == fold("işletme") == fold("IŞLETME")

    # ...ve build_all ikisini ayrı kovalara koymalı.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)

        def karisik(symbol: str):
            if symbol == "XU100":
                return None, "veriyok"
            if symbol == "KIRIK":
                return None, "hata"
            return {"symbol": symbol, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}, "ok"

        # AAA önce iniyor: ağın çalıştığı kanıtlanıyor, XU100 kalıcı sayılabilir.
        _, fetched, failed = build_all(["AAA", "XU100", "KIRIK"], out, karisik)
        assert fetched == 1 and failed == 1, (fetched, failed)
        assert read_nostatement(out) == {"XU100"}, read_nostatement(out)
        assert read_failures(out).get("XU100") is None, "tablosuz sembol başarısız sayılmamalı"
        assert read_failures(out).get("KIRIK") == 1, "gerçek hata sayılmalı"
        # Tablosuz sembol bir daha denenmiyor, hatalı sembol deneniyor.
        kalan = pending_symbols(
            ["AAA", "XU100", "KIRIK"], out,
            failures=read_failures(out), nostatement=read_nostatement(out),
        )
        assert kalan == ["KIRIK"], kalan
        # AĞ ÇÖKTÜĞÜNDE "veriyok" kalıcı sayılmamalı. Kütüphane ağ hatasını da
        # aynı hataya çeviriyor; hiçbir sembol inmediği bir turda 655 sembolü
        # birden "tablo yayımlamıyor" diye işaretlemek veriyi yok ederdi.
        with tempfile.TemporaryDirectory() as tmp2:
            out2 = Path(tmp2)
            _, f2, b2 = build_all(["AAA", "BBB"], out2, lambda s: (None, "veriyok"))
            assert (f2, b2) == (0, 2), (f2, b2)
            assert read_nostatement(out2) == set(), "kanıt yokken kalıcı yargı verilmemeli"

        # KONTROL SEMBOLÜ. "Bu turda bir şey indiyse ağ iyidir" ölçütü tek
        # başına yetmiyor: kalan listede YALNIZCA tablosuz semboller kalınca
        # tur boyunca hiçbir şey inmiyor ve hiçbir yargı verilemiyor.
        # Ölçüldü — 96 sembollük tur başarıyla bitti, tek sembol bile
        # işaretlenemedi. Kontrol sembolü bu tavuk-yumurtayı kırıyor.
        with tempfile.TemporaryDirectory() as tmp3:
            out3 = Path(tmp3)
            sorgu = {"n": 0}

            def iyi_kontrol():
                sorgu["n"] += 1
                return {"symbol": "THYAO", "periods": ["2024/6"], "fields": {}}, "ok"

            _, f3, b3 = build_all(
                ["XU100", "XBANK"], out3, lambda s: (None, "veriyok"), canary=iyi_kontrol
            )
            assert (f3, b3) == (0, 0), (f3, b3)
            assert read_nostatement(out3) == {"XU100", "XBANK"}, read_nostatement(out3)
            assert sorgu["n"] == 1, f"kontrol sembolü bir kez sorulmalı, {sorgu['n']}"

        # Kontrol sembolü de gelmiyorsa suçlu ağdır: hiçbir yargı verilmez.
        with tempfile.TemporaryDirectory() as tmp4:
            out4 = Path(tmp4)
            _, f4, b4 = build_all(
                ["XU100", "XBANK"],
                out4,
                lambda s: (None, "veriyok"),
                canary=lambda: (None, "hata"),
            )
            assert (f4, b4) == (0, 2), (f4, b4)
            assert read_nostatement(out4) == set(), "ağ çökükken hiçbir sembol işaretlenmemeli"

        # Kaynak düzelirse "tablosuz" kaydı kalkıyor.
        build_all(["XU100"], out, lambda s: ({"symbol": s, "periods": ["2024/6"], "fields": {f: [1.0] for f in FIELDS}}, "ok"))
        assert read_nostatement(out) == set(), read_nostatement(out)

    # Şablon uymadığında GELEN kalem adları kayda yazılmalı. Ölçüldü:
    # AKBNK/ALBRK'de tablo geliyor ama tanınan kalem yok; hangi adların
    # geldiğini görmeden FIELD_ITEMS'a ne ekleneceği tahmin olurdu.
    import io

    # NOT: burada "FAİZ GELİRLERİ" kullanılamaz — artık TANINIYOR (banka
    # cirosu). Teşhisin sınandığı şey, hiçbir kalemin eşleşmediği durum.
    tanimsiz = SahteTablo([{"FINANCIAL_ITEM_NAME_TR": "12.1 Genel Karşılıklar", "2024/6": 1.0}])
    yakala = io.StringIO()
    gercek_stderr, sys.stderr = sys.stderr, yakala
    try:
        bos = extract(tanimsiz, "AKBNK")
    finally:
        sys.stderr = gercek_stderr
    assert bos is None, "tanınan kalem yokken kayıt üretilmemeli"
    assert "Genel Karşılıklar" in yakala.getvalue(), yakala.getvalue()
    # Süzgeç ilgisiz satırı elemeli: banka tablosunun ilk on beş satırı
    # bilanço aktif tarafı ve aradığımız kâr satırları aşağıda kalıyordu.
    elenen = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "I. NAKİT DEĞERLER VE MERKEZ BANKASI", "2024/6": 1.0},
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
    assert "MERKEZ BANKASI" not in yakala2.getvalue(), yakala2.getvalue()

    # BANKA TABLOSU. Aranan satırlar veride vardı ama hiç eşleşmiyordu:
    # banka bilançosu her satırı madde numarasıyla başlatıyor ve
    # 'XVI. ÖZKAYNAKLAR' listedeki 'ÖZKAYNAKLAR' ile eşleşmiyordu.
    assert normalize("XVI. ÖZKAYNAKLAR") == normalize("ÖZKAYNAKLAR")
    assert normalize("16.4.2 Dönem Net Kar/Zararı") == normalize("Dönem Net Kar/Zararı")
    assert normalize("I. FAİZ GELİRLERİ") == normalize("FAİZ GELİRLERİ")
    # Numarasız adlar bozulmamalı. (Katlama BÜYÜTÜYOR: `.lower()` Türkçe'de
    # noktalı/noktasız i'yi ayrıştırıyordu, bkz. `normalize` notu.)
    assert normalize("Satış Gelirleri") == "SATIŞ GELIRLERI"

    banka = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "I. NAKİT DEĞERLER VE MERKEZ BANKASI", "2026/6": 1.0},
            {"FINANCIAL_ITEM_NAME_TR": "AKTİF TOPLAMI", "2026/6": 900.0},
            {"FINANCIAL_ITEM_NAME_TR": "XVI. ÖZKAYNAKLAR", "2026/6": 300.0},
            {"FINANCIAL_ITEM_NAME_TR": "16.4.2 Dönem Net Kar/Zararı", "2026/6": 45.0},
            {"FINANCIAL_ITEM_NAME_TR": "I. FAİZ GELİRLERİ", "2026/6": 210.0},
        ]
    )
    kayit = extract(banka, "AKBNK")
    assert kayit is not None, "banka tablosu artık tanınmalı"
    assert kayit["fields"]["netIncome"] == [45.0], kayit["fields"]["netIncome"]
    assert kayit["fields"]["revenue"] == [210.0], kayit["fields"]["revenue"]
    assert kayit["fields"]["equity"] == [300.0], kayit["fields"]["equity"]
    assert kayit["fields"]["assets"] == [900.0], kayit["fields"]["assets"]


    # TÜRKÇE KÜÇÜLTME TUZAĞI — EŞLEŞME YOLUNDA.
    #
    # `normalize` düz `.lower()` kullanıyordu ve iki yazım sessizce
    # ayrışıyordu: "DÖNEN VARLIKLAR".lower() noktalı i üretiyor,
    # "Dönen Varlıklar".lower() noktasız ı bırakıyor. Yayındaki veriyle
    # ölçüldü: `currentAssets` 561 sembolün hiçbirinde yoktu, oysa kaynak o
    # satırı "Dönen Varlıklar" diye gönderiyor.
    assert normalize("DÖNEN VARLIKLAR") == normalize("Dönen Varlıklar")
    assert normalize("NAKİT VE NAKİT BENZERLERİ") == normalize("Nakit ve Nakit Benzerleri")
    # Tuzağın kendisi kaybolduysa test anlamsız olur.
    assert "DÖNEN VARLIKLAR".lower() != "Dönen Varlıklar".lower()
    # Madde numarası soyma korunuyor.
    assert normalize("16.4.2 Dönem Net Kar/Zararı") == normalize("DÖNEM NET KAR/ZARARI")
    # Farklı kalemler BİRLEŞMEMELİ: katlama yalnızca yazım farkını siler.
    assert normalize("Dönen Varlıklar") != normalize("Duran Varlıklar")

    # ...ve ÇIKARIM da başlık yazımını tanımalı. Asıl kusur buradaydı.
    class _BaslikTablo(SahteTablo):
        pass

    tablo_baslik = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "Hasılat", "2024/6": 10.0},
            {"FINANCIAL_ITEM_NAME_TR": "Dönen Varlıklar", "2024/6": 7.0},
            {"FINANCIAL_ITEM_NAME_TR": "Kısa Vadeli Yükümlülükler", "2024/6": 4.0},
        ]
    )
    kayit = extract(tablo_baslik, "TEST")
    assert kayit is not None, "başlık yazımlı tablo hiç okunamadı"
    assert kayit["fields"]["currentAssets"] == [7.0], kayit["fields"]["currentAssets"]
    assert kayit["fields"]["currentLiabilities"] == [4.0], kayit["fields"]["currentLiabilities"]

    # KALEM KODU İLE EŞLEŞME. Gerçek cevapta doğrulandı:
    #   4C   = "İşletme Faaliyetlerinden Kaynaklanan Net Nakit"
    #   4CAI = "Sabit Sermaye Yatırımları"
    # Listemizdeki adlar ("İŞLETME FAALİYETLERİNDEN NAKİT AKIŞLARI") kaynakta
    # HİÇ geçmiyor, o yüzden bu iki alan 559 sembolün hiçbirinde dolmuyordu.
    kodlu_gercek = SahteTablo(
        [
            {"FINANCIAL_ITEM_CODE": "3C", "FINANCIAL_ITEM_NAME_TR": "Hasılat", "2024/6": 9.0},
            {
                "FINANCIAL_ITEM_CODE": "4C",
                "FINANCIAL_ITEM_NAME_TR": "İşletme Faaliyetlerinden Kaynaklanan Net Nakit",
                "2024/6": 12.0,
            },
            {
                "FINANCIAL_ITEM_CODE": "4CAI",
                "FINANCIAL_ITEM_NAME_TR": "Sabit Sermaye Yatırımları",
                "2024/6": -3.0,
            },
            # TAM eşleşme: "4CA" ile "4C" farklı kalemler, önek eşleşmesi
            # ikisini birbirine karıştırırdı.
            {"FINANCIAL_ITEM_CODE": "4CA", "FINANCIAL_ITEM_NAME_TR": "Düzeltme Öncesi Kar", "2024/6": 99.0},
        ]
    )
    kayit = extract(kodlu_gercek, "KOD")
    assert kayit["fields"]["operatingCashFlow"] == [12.0], kayit["fields"]["operatingCashFlow"]
    assert kayit["fields"]["capex"] == [-3.0], kayit["fields"]["capex"]

    # KOD SÜTUNU YOKSA ada düşülmeli: her şablonda kod gelmiyor.
    adli = SahteTablo(
        [
            {"FINANCIAL_ITEM_NAME_TR": "Hasılat", "2024/6": 9.0},
            {"FINANCIAL_ITEM_NAME_TR": "Dönen Varlıklar", "2024/6": 5.0},
        ]
    )
    assert extract(adli, "AD")["fields"]["currentAssets"] == [5.0]

    # KOD ÖNEKİ TEŞHİSİ. "Nakit akış tablosu yok" sonucunu ilk turda kendi
    # teşhisimin KAPAĞINDAN çıkarmış olabilirim: adaylar satır sırasıyla
    # taranıp alan başına on ikide kesiliyor ve bilanço satırları önce
    # geliyor. Kod öneki daha güvenilir bir soru — aynı uç noktayı kullanan
    # borsapy nakit akışını `itemCode` öneki "4" ile süzüyor.
    _kolon_ornegi.clear()
    _nakit_satirlari.clear()
    _eksik_basildi.clear()
    kodlu = SahteTablo(
        [
            {"FINANCIAL_ITEM_CODE": "3AA", "FINANCIAL_ITEM_NAME_TR": "Hasılat", "2024/6": 9.0},
            {"FINANCIAL_ITEM_CODE": "1AA", "FINANCIAL_ITEM_NAME_TR": "Dönen Varlıklar", "2024/6": 5.0},
            {"FINANCIAL_ITEM_CODE": "4AA", "FINANCIAL_ITEM_NAME_TR": "İşletme Faaliyetleri", "2024/6": 2.0},
            {"FINANCIAL_ITEM_CODE": "4BB", "FINANCIAL_ITEM_NAME_TR": "Yatırım Faaliyetleri", "2024/6": 1.0},
        ]
    )
    extract(kodlu, "KODLU")
    assert _kolon_ornegi[:1] == ["FINANCIAL_ITEM_CODE"], _kolon_ornegi
    assert [k for k, _ in _nakit_satirlari] == ["4AA", "4BB"], _nakit_satirlari
    _kolon_ornegi.clear()
    _nakit_satirlari.clear()
    _eksik_basildi.clear()

    # ÜRETİM TANISI. Yayındaki veriyle ölçtüm: üç alan 561 sembolün hiçbirinde
    # yok ve ikisi ürüne doğrudan yansıyor ("Nakde dönüşüm" hep boş, "Cari
    # oran" süzgeci hiç sonuç veremez). Doğru kalem adını tahmin etmemek için
    # teşhis yayımlanıyor.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "AAA.json").write_text(
            json.dumps(
                {
                    "symbol": "AAA",
                    "periods": ["2024/6"],
                    "fields": {f: ([1.0] if f != "currentAssets" else [None]) for f in FIELDS},
                }
            ),
            encoding="utf-8",
        )
        write_tani(records_on_disk(out), out)
        tani = json.loads((out / TANI_FILE).read_text(encoding="utf-8"))
        # Kolon ve nakit akış alanları HER ZAMAN yazılmalı (boş olsa bile):
        # "alan yok" ile "değer yok" farklı şeyler ve okuyan taraf ayırt
        # edebilmeli.
        assert "kolonlar" in tani and "nakit_satirlari" in tani, sorted(tani)
        assert tani["sembol"] == 1, tani
        assert tani["kapsam"]["revenue"] == 1, tani["kapsam"]
        # Boş seri DOLU sayılmamalı: "alan var" ile "değer var" farklı şeyler.
        assert tani["kapsam"]["currentAssets"] == 0, tani["kapsam"]

        # Tanı dosyası SEMBOL KAYDI sanılmamalı, yoksa kendi kendini sayar.
        assert [r["symbol"] for r in records_on_disk(out)] == ["AAA"], records_on_disk(out)

    print("[fund] self-test tamam")


SNAPSHOT_FILE = "snapshot.json"
ALL_FILE = "hepsi.json"
FAILURES_FILE = "failures.json"
# Kaynağın "bu sembolde finansal tablo yok" dediği semboller. Arayüz bunu
# "henüz indirilmedi"den ayırmak için okuyor.
NOSTATEMENT_FILE = "tablosuz.json"
# ÜRETİM TANISI — uygulamanın okuduğu bir veri değil, üretim sürecine ait.
# Alt çizgiyle başlıyor: sembol dosyalarıyla karışmasın.
TANI_FILE = "_tani.json"
MAX_ATTEMPTS = 3

# Ayıklama kurallarının sürümü. Kalem adları, madde numarası soyma ya da
# şablon sırası değiştiğinde ELLE artırılır.
#
# Neden gerekli: "AKBNK üç kez alınamadı" kaydı, o üç denemenin YAPILDIĞI
# kuralların ifadesidir. Madde numarası soyma eklendiğinde aynı sembol artık
# okunabiliyordu ama sayaç 5'te kalmıştı ve sembol listeden düşük olduğu için
# düzeltme HİÇ denenmedi. Ölçüldü: düzeltmeden sonraki turlarda AKBNK, ALBRK
# ve GARAN'a tek bir istek bile gitmedi. Kural değişince eski sayaç bir kanıt
# değil, yalnızca eski bir kusurun gölgesidir; sürüm atlayınca sıfırlanır.
#
# v3: üçlü sınıflandırma (veriyok / tanimsiz / hata) geldi. Aynı tuzağa
# ikinci kez düşüldü — 96 sembolün 86'sı eski kuralla MAX_ATTEMPTS'e
# ulaşmıştı ve atlama listesindeydi, dolayısıyla onları AÇIKLAYACAK yeni
# sınıflandırmaya hiç sıra gelmedi (ölçüldü: tur yeşil bitti, tablosuz.json
# boş kaldı). Sayaçları sıfırlamak bir "yeniden dene" değil, kuralın
# değiştiğini kabul etmek.
#
# v5: kalem KODU ile eşleşme eklendi (4C = işletme nakit akışı, 4CAI = sabit
# sermaye yatırımları). Ayıklama kuralı değişti, sürüm de artıyor — bu notu
# bir kez atladığım için hemen sonrasında uygulanıyor.
#
# v4: `normalize` Türkçe-güvenli katlamaya geçti ("Dönen Varlıklar" artık
# "DÖNEN VARLIKLAR" ile eşleşiyor). ÜÇÜNCÜ KEZ aynı tuzak: kuralı değiştirdim
# ama sürümü artırmayı atladım, oysa bu notun kendisi bunu söylüyordu.
# Atlama listesindeki 25 gerçek şirket (finansal kiralama, faktoring, sigorta,
# varlık yönetimi) yeni kuralla bir kez bile denenmeyecekti.
#
# SÜRÜM ARTIK SEMBOL KAYDINA DA YAZILIYOR (`"v"`, diske yazan tek noktada).
# Bu not uzun süre YALNIZCA sayaç/atlama dosyalarını koruyordu; sembol
# kayıtlarının kendisi korumasızdı. Artımlı turun tek ölçütü "dosya var mı"
# olduğu için eski kuralla yazılmış kayıt bir daha ziyaret edilmiyor, kural
# düzeltmesi yalnızca FORCE_ALL ile ve onun bütçesi kadar yayılıyordu.
#
# Ölçüldü (v5 geçişi, yayındaki veri): 09:33-10:20 arasında yazılan 72
# sembolün %0'ında nakit akışı vardı; 11:20 sonrasında yazılanların
# %93-100'ünde vardı. Eksik 87 kaydın 72'si "kaynakta yok" değil, "eski
# kuralla yazılmış ve bir daha hiç denenmemiş"ti. Sürüm eşleşmeyen kayıt
# artık artımlı turda da bayat sayılıp yeniden çekiliyor.
EXTRACT_VERSION = 5


def read_failures(out_dir: Path) -> dict[str, int]:
    """
    Sembol → üst üste başarısız deneme sayısı.

    Dosya başka bir ayıklama sürümünde yazılmışsa sayaçlar ATILIR (yukarıdaki
    EXTRACT_VERSION notuna bakın). Sürüm alanı olmayan eski dosyalar da öyle:
    onlar madde numarası soyma öncesinden kalma.
    """
    try:
        data = json.loads((out_dir / FAILURES_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return {}
    if not isinstance(data, dict):
        return {}
    if data.get("_version") != EXTRACT_VERSION:
        print(
            f"[fund] başarısızlık sayaçları eski kurala ait "
            f"(v{data.get('_version')!r} ≠ v{EXTRACT_VERSION}) — sıfırlanıyor"
        )
        return {}
    counts = data.get("counts", {})
    if not isinstance(counts, dict):
        return {}
    return {k: int(v) for k, v in counts.items() if isinstance(v, (int, float))}


def write_failures(failures: dict[str, int], out_dir: Path) -> None:
    (out_dir / FAILURES_FILE).write_text(
        json.dumps(
            {"_version": EXTRACT_VERSION, "counts": failures},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def read_nostatement(out_dir: Path) -> set[str]:
    """Kaynakta finansal tablosu OLMAYAN semboller (endeks, fon, varant)."""
    try:
        data = json.loads((out_dir / NOSTATEMENT_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return set()
    if not isinstance(data, dict) or data.get("_version") != EXTRACT_VERSION:
        return set()
    return {str(s) for s in data.get("symbols", []) if s}


def write_nostatement(symbols: set[str], out_dir: Path) -> None:
    (out_dir / NOSTATEMENT_FILE).write_text(
        json.dumps(
            {"_version": EXTRACT_VERSION, "symbols": sorted(symbols)},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def pending_symbols(
    symbols: list[str],
    out_dir: Path,
    force_all: bool = False,
    failures: dict[str, int] | None = None,
    nostatement: set[str] | None = None,
) -> list[str]:
    """
    Yeniden çekilmesi gereken semboller (FORCE_ALL ile hepsi).

    "Gereken" = dosyası yok, YA DA dosyası eski bir `EXTRACT_VERSION` ile
    yazılmış. İkincisi olmadan ayıklama kuralı düzeltmeleri mevcut kayıtlara
    hiç ulaşmıyordu (bkz. EXTRACT_VERSION notu).

    Üst üste `MAX_ATTEMPTS` kez başarısız olan sembol listeden düşüyor.
    Ölçüldü: 135 sembollük ilerlemede 11'i hiç alınamıyor ve her çalıştırma
    onları BAŞTAN deniyor. Bir başarısızlık ucuz değil — 12 yıl isteğinin
    hepsi yeniden denenip zaman aşımına uğruyor. Sürekli başarısız olan bir
    sembolü her turda yeniden denemek, maliyeti ne olursa olsun yanlış:
    ilerlemeyi yiyor ve kayıt gürültüsü üretiyor. FORCE_ALL hepsini geri
    getiriyor (kaynak düzelmiş olabilir).
    """
    fails = failures or {}
    yok = nostatement or set()
    if force_all:
        # EN ESKİ TAZELENEN ÖNCE. Sıra giriş sırası olduğu sürece zorlamalı
        # tazeleme YAKINSAMIYORDU: bütçe 559 sembolün yarısına yetiyor ve her
        # tur aynı baştan başlıyor, yani listenin kuyruğu hiçbir zaman
        # tazelenmiyor. Üreticide yapılan bir düzeltme (ör. kalem adı
        # eşleşmesi) mevcut verinin yarısına hiç ulaşamazdı.
        #
        # Dosya mtime'ı kullanılamıyor: gh-pages klonu bütün dosyalara aynı
        # damgayı veriyor. Kaydın KENDİ `fetched` damgası kullanılıyor; damgası
        # olmayan eski kayıtlar 0 sayılıp öne geçiyor, yani ilk tur onları
        # alıyor ve sonraki turlar kaldığı yerden devam ediyor.
        def damga(sembol: str) -> float:
            path = out_dir / f"{sembol}.json"
            try:
                return float(json.loads(path.read_text(encoding="utf-8")).get("fetched") or 0)
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                return 0.0

        return sorted(symbols, key=damga)
    def bayat(sembol: str) -> bool:
        """Dosya yok ya da ESKİ ayıklama kuralıyla yazılmış."""
        path = out_dir / f"{sembol}.json"
        if not path.exists():
            return True
        try:
            return json.loads(path.read_text(encoding="utf-8")).get("v") != EXTRACT_VERSION
        except (OSError, json.JSONDecodeError):
            # Okunamayan kaydı yeniden çekmek, bozuk kaydı sonsuza dek
            # taşımaktan iyi.
            return True

    return [
        s
        for s in symbols
        if bayat(s) and fails.get(s, 0) < MAX_ATTEMPTS and s not in yok
    ]


def records_on_disk(out_dir: Path) -> list[dict]:
    """Diskteki tüm sembol kayıtları. Bozuk dosya sessizce atlanır."""
    records: list[dict] = []
    for path in sorted(out_dir.glob("*.json")):
        if path.name in (SNAPSHOT_FILE, ALL_FILE, FAILURES_FILE, NOSTATEMENT_FILE, TANI_FILE):
            continue
        try:
            records.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return records


def write_snapshot(records: list[dict], out_dir: Path) -> None:
    """Anlık görüntüyü yaz — taramanın son TTM değerleri için okuduğu dosya."""
    if not records:
        return
    (out_dir / SNAPSHOT_FILE).write_text(
        json.dumps(build_snapshot(records), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def write_tani(records: list[dict], out_dir: Path) -> None:
    """
    ÜRETİM TANISI dosyası: hangi alan kaç sembolde dolu ve eksik olanlar için
    kaynakta hangi kalem adları görülüyor.

    Neden yayımlanıyor: yayındaki veriyle ölçtüm, üç alan 561 sembolün
    HİÇBİRİNDE yok — `currentAssets`, `operatingCashFlow`, `capex`. İlk ikisi
    ürüne doğrudan yansıyor: "Nakde dönüşüm" kartı her şirkette boş ve "Cari
    oran" süzgeci hiçbir sonuç veremez. Sebep muhtemelen ad eşleşmesi:
    `currentLiabilities` %96,3 dolu ama `currentAssets` %0 ve bilanço birini
    verip ötekini vermez.

    Doğru adı TAHMİN ETMEK yerine kaynağa sordurmak gerekiyor. Teşhis stderr'e
    basılıyordu ama iş kaydı dört yüz satır ve satır kaydın BAŞINDA: okumak
    için tüm kaydı indirmek gerekiyordu. Yayımlanan küçük bir dosya hem ucuz
    hem kalıcı.
    """
    kapsam: dict[str, int] = {f: 0 for f in FIELDS}
    for rec in records:
        for alan, seri in (rec.get("fields") or {}).items():
            if alan in kapsam and seri and any(v is not None for v in seri):
                kapsam[alan] += 1
    (out_dir / TANI_FILE).write_text(
        json.dumps(
            {
                "generated": int(time.time()),
                "sembol": len(records),
                "kapsam": kapsam,
                "aday_adlar": _aday_adlar,
                "kolonlar": _kolon_ornegi,
                "nakit_satirlari": [{"kod": k, "ad": a} for k, a in _nakit_satirlari],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def write_all(records: list[dict], out_dir: Path) -> None:
    """
    Tüm sembollerin tam tablosu TEK dosyada.

    Neden gerekli: anlık görüntü yalnızca SON dönemin TTM değerlerini taşıyor.
    Büyüme ve karne ise dönem dizisi ister (geçen yılın aynı dönemi, önceki
    yıl sonu bilançosu). Tarayıcı bu diziyi hiç yükleyemediği için "Kalite
    skoru", "Ciro büyümesi" ve "Kâr büyümesi" filtreleri HER eşikte sıfır
    sonuç veriyordu — filtre ekrandaydı, verisi yoktu.

    Neden sembol başına istek değil: 562 dosya = 562 istek. Tek dosya ölçüldü,
    ham 3,1 MB ve yalnızca bu metrikler kullanıldığında indiriliyor.

    Neden türetilmiş sayılar (skor, büyüme) burada HESAPLANMIYOR: o mantık
    TypeScript'te (`core/fundamentals/metrics.ts`) ve tek kaynak olarak
    kalmalı. Python'da ikinci bir kopya, iki yerin sessizce ayrışması demek.
    """
    if not records:
        return
    (out_dir / ALL_FILE).write_text(
        json.dumps(
            {
                "version": 1,
                "generated": int(time.time()),
                "symbols": {r["symbol"]: r for r in records if r.get("symbol")},
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def _fetch_stream(pending: list[str], fetch, workers: int, should_stop):
    """
    (sembol, kayıt) çiftlerini üretir; `workers > 1` ise TAMAMLANMA sırasında.

    Neden paralel: sembol başına maliyet ağ bekleme, işlem değil. Kaynak her
    sembol için yıl yıl istek alıyor (2015–2026 için 12 istek) ve üç tablo
    şablonunu sırayla deniyor; ölçülen süre sembol başına 15–30 sn. Sırayla
    420 sembol 2–3,5 saat demek — hiçbir CI işine sığmaz ve her turda birkaç
    sembol ilerleyen bir liste kullanıcıya ASLA tamamlanmış görünmez.

    Neden altı: kaynak tek bir kurumun sunucusu, sınırsız eşzamanlılık
    kabalık ve engellenme riski. Altı işçi bekleme süresini örtüştürmeye
    yetiyor, saniyedeki istek sayısını insani tutuyor.

    `workers == 1` yolu tek satırlık ve SIRALI: mevcut testler (kesilme
    tatbikatı, süre bütçesi) bu yolu sınıyor ve davranışı değişmedi.
    """
    if workers <= 1:
        for symbol in pending:
            if should_stop():
                return
            yield symbol, fetch(symbol)
        return

    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    executor = ThreadPoolExecutor(max_workers=workers)
    try:
        queue = list(reversed(pending))
        running: dict = {}
        while queue or running:
            # Süre dolduysa YENİ iş verilmiyor; uçuştakiler toplanıp çıkılıyor.
            while queue and len(running) < workers and not should_stop():
                symbol = queue.pop()
                running[executor.submit(fetch, symbol)] = symbol
            if not running:
                return
            done, _ = wait(running, return_when=FIRST_COMPLETED)
            for future in done:
                symbol = running.pop(future)
                try:
                    yield symbol, future.result()
                except Exception as e:  # noqa: BLE001
                    # fetch_one kendi hatalarını yutuyor; buraya düşen bir şey
                    # beklenmedik demektir — sembolü düşürüp devam ediyoruz.
                    print(f"[fund] {symbol}: beklenmedik hata ({e})", file=sys.stderr)
                    yield symbol, None
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def build_all(
    pending: list[str],
    out_dir: Path,
    fetch,
    every: int = 25,
    max_seconds: float | None = None,
    now=time.monotonic,
    workers: int = 1,
    canary=None,
) -> tuple[list[dict], int, int]:
    # `fetch` sözleşmesi: sembol → (kayıt | None, "ok" | "tablosuz" | "hata").
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
    nostatement = read_nostatement(out_dir)
    fetched = 0
    failed = 0
    tablosuz = 0
    started = now()
    deadline_reported = False

    def should_stop() -> bool:
        nonlocal deadline_reported
        if max_seconds is None or now() - started < max_seconds:
            return False
        if not deadline_reported:
            deadline_reported = True
            print(
                f"[fund] süre doldu ({max_seconds:.0f} sn) — {fetched + failed}/{len(pending)} "
                "işlendi, kalanlar bir sonraki çalıştırmaya"
            )
        return True

    # AĞIN ÇALIŞTIĞININ KANITI.
    #
    # İlk denemem "bu turda en az bir sembol indiyse ağ iyidir" idi ve
    # çalışmadı: kalan listede YALNIZCA tablosuz semboller kalınca tur
    # boyunca hiçbir şey inmiyor, dolayısıyla hiçbir yargı verilemiyor.
    # Ölçüldü — 96 sembollük tur başarıyla bitti ve tek bir sembolü bile
    # işaretleyemedi. Tavuk-yumurta.
    #
    # Kanıt artık bir KONTROL SEMBOLÜ: tablosu kesin olan bir sembol
    # çekiliyor. Geldiyse ağ çalışıyor, "veri yok" kaynağın cevabıdır.
    # Gelmediyse suçlu ağdır ve hiçbir sembol kalıcı işaretlenmez.
    # Bir kez çekiliyor, sonucu saklanıyor.
    ag = {"soruldu": False, "iyi": False}

    def ag_iyi() -> bool:
        if fetched > 0:
            return True
        if canary is None:
            return False
        if not ag["soruldu"]:
            ag["soruldu"] = True
            kayit, _ = canary()
            ag["iyi"] = kayit is not None
            print(
                "[fund] kontrol sembolü: "
                + ("geldi, ağ çalışıyor" if ag["iyi"] else "GELMEDİ — ağ şüpheli")
            )
        return ag["iyi"]

    i = 0
    for symbol, (record, sonuc) in _fetch_stream(pending, fetch, workers, should_stop):
        i += 1
        if not record:
            # "Kaynakta veri yok" kalıcı bir yargı: sembol bir daha hiç
            # denenmiyor. Arayüz bu listeyi okuyor ama TEK BAŞINA "tablo
            # yayımlamıyor" demiyor — o cümleyi yalnızca endeks/fon olduğu
            # AYRICA bilinen semboller için kuruyor. Sebebi: bu listede
            # Garanti Faktoring gibi gerçek şirketler de var ve onlara "tablo
            # yayımlamıyor" demek yanlıştı. Bu yüzden KANIT isteniyor — kütüphane ağ hatasını da
            # aynı "veri yok" hatasına çeviriyor (ölçüldü). Aynı turda başka
            # semboller indiyse ağ çalışıyor demektir; hiçbiri inmediyse
            # suçlu büyük olasılıkla ağ ve sembol sıradan bir başarısızlık.
            # Kanıt: bu turda inen bir sembol, ya da kontrol sembolü.
            if sonuc == "veriyok" and ag_iyi():
                tablosuz += 1
                nostatement.add(symbol)
                write_nostatement(nostatement, out_dir)
                continue
            failed += 1
            # Başarısızlık HEMEN kaydediliyor: süre dolup kesilirsek de
            # bir sonraki tur aynı sembole aynı süreyi harcamasın.
            failures[symbol] = failures.get(symbol, 0) + 1
            write_failures(failures, out_dir)
            continue
        # Tablo geldiyse önceki "tablosuz" kaydı yanlıştı (kaynak düzelmiş
        # ya da şablon eklenmiş olabilir).
        if symbol in nostatement:
            nostatement.discard(symbol)
            write_nostatement(nostatement, out_dir)
        # Başarı sayacı sıfırlar VE diske yazar: yoksa kaynak düzeldikten
        # sonra bile eski sayaç sembolü gereksiz yere listeden düşürürdü.
        if failures.pop(symbol, None) is not None:
            write_failures(failures, out_dir)
        # AYIKLAMA SÜRÜMÜ, diske yazan TEK noktada veriliyor. Ayıklayıcının
        # içinde damgalamak yetmiyordu: kaydı üreten her yol oradan geçmiyor
        # ve damgasız dosya artımlı turda "güncel" sayılırdı.
        #
        # Bunsuz artımlı tur, kaydı HANGİ kuralın yazdığını bilemiyordu: tek
        # ölçüt "dosya var mı" olduğu için eski kuralla yazılmış kayıt bir
        # daha hiç ziyaret edilmiyordu. Ölçüldü — v5'e geçerken 09:33-10:20
        # arasında yazılan 72 sembolün %0'ında nakit akışı vardı, 11:20
        # sonrasının %93-100'ünde vardı; fark kaynakta değil, kaydın eski
        # kuralla yazılmış olmasındaydı.
        (out_dir / f"{symbol}.json").write_text(
            json.dumps(
                {**record, "v": EXTRACT_VERSION}, ensure_ascii=False, separators=(",", ":")
            ),
            encoding="utf-8",
        )
        records.append(record)
        fetched += 1
        if i % every == 0:
            write_snapshot(records, out_dir)
            write_all(records, out_dir)
            print(
                f"[fund] {i}/{len(pending)} · başarılı {fetched} · tablosuz {tablosuz} "
                f"· başarısız {failed}"
            )
    write_snapshot(records, out_dir)
    write_all(records, out_dir)
    write_tani(records_on_disk(out_dir), out_dir)
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
    ap.add_argument(
        "--workers",
        type=int,
        default=int(os.environ.get("FUND_WORKERS", 1)),
        help="eşzamanlı indirme sayısı (ağ beklemesi örtüşsün diye; kaynağa saygılı tutun)",
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
    nostatement = read_nostatement(OUT)

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
        pending = pending_symbols(symbols, OUT, force_all, failures, nostatement)
        atlanan = sorted(s for s, c in failures.items() if c >= MAX_ATTEMPTS)
        if atlanan:
            # Adları da basılıyor: bu liste bir kör nokta. İki kez ısırdı —
            # atlama listesindeki sembol, onu AÇIKLAYACAK yeni koda da hiç
            # ulaşmıyor. Ayıklama ya da sınıflandırma kuralı değiştiğinde
            # EXTRACT_VERSION artırılmalı, yoksa düzeltme bu sembollere
            # hiç denenmez ve tur yeşil bitip hiçbir şey değiştirmez.
            print(
                f"[fund] {len(atlanan)} sembol {MAX_ATTEMPTS} denemede alınamadı, atlanıyor "
                f"(kural değiştiyse EXTRACT_VERSION artırılmalı): {', '.join(atlanan[:40])}"
            )
        if nostatement:
            print(
                f"[fund] {len(nostatement)} sembolde kaynakta finansal tablo yok "
                "(endeks/fon/varant), atlanıyor"
            )
    if not pending:
        print(f"[fund] {len(symbols)} sembolün hepsi zaten var (FORCE_ALL ile tazelenir)")
    else:
        print(
            f"[fund] {len(pending)}/{len(symbols)} sembol eksik, "
            f"{max(1, args.workers)} eşzamanlı indiriliyor"
        )

    records, fetched, failed = build_all(
        pending,
        OUT,
        lambda sym: fetch_one(sym, args.start_year, args.end_year),
        max_seconds=args.max_seconds,
        workers=max(1, args.workers),
        # Tablosu kesin olan, BIST'in en çok işlem gören sembollerinden biri.
        canary=lambda: fetch_one(CANARY_SYMBOL, args.start_year, args.end_year),
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
