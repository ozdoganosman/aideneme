#!/usr/bin/env python3
"""
BIST sektör sınıflandırması üreticisi.

    public/data/bist/sectors.json   {"source": ..., "generated": ..., "of": {SEMBOL: sektör}}

Neden ayrı bir dosya: nabız ekranındaki para akışı şimdiye kadar yalnızca
DAVRANIŞ kümelerine (birlikte hareket edenler) bakabiliyordu. Bu iyi bir
ölçüdür ama "endüstriden para akışı" sorusunun cevabı değildir; onun için
resmî sınıflandırma gerekir.

Dürüstlük sınırı: HİÇBİR kaynak sektör alanı döndürmezse dosya YAZILMAZ.
Eksik dosya, arayüzde "sektör sınıflandırması yok, davranış kümeleri
gösteriliyor" olarak görünür; tahmini bir sınıflandırma üretmek — örneğin
şirket unvanından sektör çıkarmak — olmayan bilgiyi varmış gibi göstermek
olur. Şirket adı sektör DEĞİLDİR.

Birden çok aday kaynak sırayla deneniyor ve her biri AYRI raporlanıyor:
"erişilemedi", "cevap boş" ve "geldi ama sektör alanı yok" üç farklı arıza;
tek satırlık bir hata kaydı bunları birbirine karıştırıyordu.

Çalıştırma:
    python scripts/build_sectors.py [--self-test]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "sectors.json"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"

# ADAY KAYNAKLAR — sırayla denenir, İLK dolu cevap kazanır.
#
# Neden liste: tek uç nokta 401 döndürüyordu ve tek satırlık "erişilemedi"
# kaydı hangi katmanın reddettiğini söylemiyordu (ölçüldü: iş akışı adımı
# `continue-on-error` olduğu için YEŞİL görünüyor, dosya ise aylarca
# yazılmıyordu). Artık her aday ayrı ayrı raporlanıyor.
#
# Sıra kasıtlı: `HisseYuzeysel` sembol başına özet satır döndürdüğü için
# sektör alanını da taşır; `IndexCompanies` yalnızca endeks üyeliğini verir.
KAYNAKLAR: tuple[tuple[str, str], ...] = (
    (
        "İş Yatırım — hisse yüzeysel",
        "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/"
        "HisseYuzeysel?hisse=&endeks=09&sektor=",
    ),
    (
        "İş Yatırım — endeks şirketleri",
        "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/"
        "IndexCompanies?endeks=09",
    ),
    (
        "İş Yatırım — sektör karşılaştırma",
        "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/"
        "SektorKarsilastirma?endeks=09",
    ),
)

# Tarayıcı başlıkları: kaynak, kütüphanesiz düz isteklere 401 döndürüyor
# (ölçüldü — GitHub koşucusunda `Python-urllib` ile 401 Unauthorized).
# Aynı uç noktalar tarayıcıdan açık; eksik olan kimlik değil, başlıklar.
BASLIKLAR = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Referer": "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/default.aspx",
    "X-Requested-With": "XMLHttpRequest",
}

SOURCE_URL = KAYNAKLAR[0][1]
SOURCE_NAME = KAYNAKLAR[0][0]

# Kaynakta sektör alanı sürüme göre farklı adlarla geliyor; ilk eşleşen alınır.
SECTOR_KEYS = (
    "SECTOR",
    "SEKTOR",
    "SEKTOR_ADI",
    "Sektor",
    "SektorAdi",
    "sector",
    "sektor",
    "IndustryName",
)
SYMBOL_KEYS = (
    "CODE",
    "HISSE_KODU",
    "SEMBOL",
    "Kod",
    "HisseKodu",
    "Sembol",
    "code",
    "symbol",
)


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
    request = urllib.request.Request(url, headers=BASLIKLAR)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload_kayitlari(payload)


def payload_kayitlari(payload: object) -> list[dict]:
    """
    Cevabı kayıt listesine indirger.

    Ağ ERİŞİMİ YOK — `--self-test` bunu çevrimdışı doğruluyor. Uç nokta
    sürümüne göre düz liste, `{"value": [...]}` ya da ASP.NET'in `{"d": ...}`
    sarmalıyla dönebiliyor; `d` bir kez daha sarmalanmış olabiliyor.
    """
    for _ in range(3):
        if isinstance(payload, list):
            return [r for r in payload if isinstance(r, dict)]
        if not isinstance(payload, dict):
            return []
        for key in ("value", "d", "data", "Data"):
            if key in payload:
                payload = payload[key]
                break
        else:
            return []
    return []


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

    # Kaynak sürümüne göre farklı alan adları: HisseYuzeysel `HISSE_KODU`
    # + `SEKTOR` kullanıyor, IndexCompanies `CODE` + `SECTOR`.
    yuzeysel = parse_records([{"HISSE_KODU": "thyao", "SEKTOR": "Ulaştırma"}])
    assert yuzeysel == {"THYAO": "Ulaştırma"}, yuzeysel

    # Sarmal çözümü: düz liste, {"value": [...]}, ASP.NET {"d": ...} ve
    # {"d": {"value": [...]}} — dördü de aynı kayıt listesine inmeli.
    kayit = [{"CODE": "GARAN", "SECTOR": "Bankacılık"}]
    for sarmal in (kayit, {"value": kayit}, {"d": kayit}, {"d": {"value": kayit}}):
        assert payload_kayitlari(sarmal) == kayit, sarmal
    # Tanınmayan sarmal sessizce boş liste: "kayıt yok" ile "biçim bilinmiyor"
    # ayrımını çağıran taraf (dene) ayrı satırlarla raporluyor.
    assert payload_kayitlari({"bilinmeyen": kayit}) == []
    assert payload_kayitlari("metin") == []
    # Sözlük olmayan öğeler AYIKLANIYOR: parse_records'a çöp girmesin.
    assert payload_kayitlari([*kayit, "bozuk", 7]) == kayit

    print("build_sectors self-test: tamam")
    return 0


def ozet_yaz(satir: str) -> None:
    """
    İş akışı özetine tek satır ekler.

    Neden: adım `continue-on-error` olduğu için eksik sınıflandırma koşu
    sayfasında YEŞİL görünüyordu ve fark edilmesi aylar aldı. Özet satırı
    koşu sayfasının en üstünde duruyor.
    """
    yol = os.environ.get("GITHUB_STEP_SUMMARY")
    if not yol:
        return
    try:
        with open(yol, "a", encoding="utf-8") as f:
            f.write(satir + "\n")
    except OSError:
        pass


def dene(adlar: tuple[tuple[str, str], ...], known: set[str] | None) -> tuple[str, dict[str, str]] | None:
    """
    Adayları sırayla dener; İLK dolu eşlemeyi döndürür.

    Her aday için AYRI bir tanı satırı basılıyor: "erişilemedi" ile
    "erişildi ama sektör alanı yok" bambaşka iki arıza ve tek satırlık
    kayıt bunları birbirine karıştırıyordu.
    """
    for ad, url in adlar:
        try:
            records = fetch_records(url)
        except Exception as err:  # noqa: BLE001 — kaynak hatası ölümcül değil
            print(f"  [{ad}] erişilemedi: {err}", file=sys.stderr)
            continue
        if not records:
            print(f"  [{ad}] cevap boş ya da beklenmeyen biçimde", file=sys.stderr)
            continue
        mapping = parse_records(records, known=known)
        if not mapping:
            alanlar = sorted(records[0]) if isinstance(records[0], dict) else []
            print(
                f"  [{ad}] {len(records)} kayıt geldi ama sektör okunamadı; "
                f"alanlar: {', '.join(alanlar[:12]) or 'yok'}",
                file=sys.stderr,
            )
            continue
        print(f"  [{ad}] {len(mapping)} sembol okundu", file=sys.stderr)
        return ad, mapping
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--url", help="Tek bir kaynağı zorlar (adaylar denenmez).")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    adaylar = ((SOURCE_NAME, args.url),) if args.url else KAYNAKLAR
    sonuc = dene(adaylar, known=known_symbols() or None)
    if sonuc is None:
        print("sectors.json YAZILMADI; arayüz davranış kümelerine düşecek.", file=sys.stderr)
        ozet_yaz(
            "⚠️ **Sektör sınıflandırması üretilemedi** — hiçbir kaynak sektör "
            "alanı döndürmedi. Nabız ekranı davranış kümelerine düşecek."
        )
        return 1

    ad, mapping = sonuc
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"source": ad, "generated": int(time.time()), "of": mapping},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    sektor_sayisi = len(set(mapping.values()))
    print(f"{len(mapping)} sembol · {sektor_sayisi} sektör → {OUT.relative_to(ROOT)}")
    ozet_yaz(f"Sektör sınıflandırması: {len(mapping)} sembol · {sektor_sayisi} sektör ({ad}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
