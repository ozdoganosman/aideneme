#!/usr/bin/env python3
"""
USD/TRY kur serisi üreticisi.

    public/data/bist/fx.json   {"source", "generated", "currency", "days", "rates"}

Neden veri hattından: kur tablosunu koda gömmek, yanlış olduğunda sessizce
yanlış bir getiri göstermek demek. Dosya yoksa arayüz "kur serisi yok" diyor —
döviz bazlı getiri tahminle doldurulmuyor.

Kaynak: TCMB EVDS günlük döviz kuru serisi (USD satış). Erişim anahtarı
gerektiği için CI'da `EVDS_API_KEY` ortam değişkeni okunur; yoksa dosya
YAZILMAZ ve derleme kırılmaz.

Çalıştırma:
    EVDS_API_KEY=... python scripts/build_fx.py [--self-test]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "fx.json"
SERIES = "TP.DK.USD.S.YTL"  # USD satış, günlük
SOURCE_NAME = "TCMB EVDS (USD satış)"
EPOCH = date(1970, 1, 1)


def to_day(d: date) -> int:
    return (d - EPOCH).days


def parse_items(items: list[dict]) -> tuple[list[int], list[float]]:
    """
    EVDS yanıtını (gün, kur) çiftlerine çevirir.

    Ağ ERİŞİMİ YOK — saf dönüşüm, `--self-test` ile çevrimdışı doğrulanıyor.
    Tatil günleri kaynakta boş gelir; o günler ATLANIR (sıfır yazmak kuru
    çökmüş gibi gösterirdi).
    """
    days: list[int] = []
    rates: list[float] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_date = item.get("Tarih") or item.get("tarih")
        value = item.get(SERIES.replace(".", "_")) or item.get("value")
        if not raw_date or value in (None, "", "null"):
            continue
        try:
            parsed = datetime.strptime(raw_date.strip(), "%d-%m-%Y").date()
            rate = float(value)
        except (ValueError, TypeError):
            continue
        if rate <= 0:
            continue
        days.append(to_day(parsed))
        rates.append(round(rate, 4))

    # Artan sıra ve tekilleştirme: istemci ikili arama yapıyor, sıra şart.
    pairs = sorted(dict(zip(days, rates)).items())
    return [d for d, _ in pairs], [r for _, r in pairs]


def fetch_items(api_key: str, start: date, end: date) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "series": SERIES,
            "startDate": start.strftime("%d-%m-%Y"),
            "endDate": end.strftime("%d-%m-%Y"),
            "type": "json",
            "key": api_key,
        }
    )
    url = f"https://evds2.tcmb.gov.tr/service/evds/?{query}"
    request = urllib.request.Request(url, headers={"key": api_key, "User-Agent": "aideneme-fx/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("items", []) if isinstance(payload, dict) else []


def self_test() -> int:
    sample = [
        {"Tarih": "02-01-2024", "TP_DK_USD_S_YTL": "29.4381"},
        {"Tarih": "03-01-2024", "TP_DK_USD_S_YTL": None},      # tatil → atlanır
        {"Tarih": "04-01-2024", "TP_DK_USD_S_YTL": "29.5012"},
        {"Tarih": "bozuk", "TP_DK_USD_S_YTL": "30"},           # tarih okunamaz
        {"Tarih": "05-01-2024", "TP_DK_USD_S_YTL": "-1"},      # negatif kur yok
        "bozuk kayıt",
    ]
    days, rates = parse_items(sample)
    assert len(days) == 2, days
    assert rates == [29.4381, 29.5012], rates
    assert days == sorted(days), "sıralı olmalı"
    assert days[0] == to_day(date(2024, 1, 2)), days[0]

    # Aynı gün iki kez gelirse tekilleşmeli.
    dup = [
        {"Tarih": "02-01-2024", "TP_DK_USD_S_YTL": "29.4"},
        {"Tarih": "02-01-2024", "TP_DK_USD_S_YTL": "29.5"},
    ]
    assert len(parse_items(dup)[0]) == 1

    # BEKLENEN YOKLUK 0, GERÇEK HATA 1. İkisi aynı kodu verdiği sürece
    # kayıtta "kaynak çöktü" ile "anahtar konmamış" ayırt edilemiyordu.
    eski_anahtar = os.environ.get("EVDS_API_KEY")
    eski_argv = sys.argv
    try:
        os.environ.pop("EVDS_API_KEY", None)
        sys.argv = ["build_fx.py"]
        assert main() == 0, "anahtar yokluğu beklenen durum: çıkış kodu 0 olmalı"
    finally:
        sys.argv = eski_argv
        if eski_anahtar is not None:
            os.environ["EVDS_API_KEY"] = eski_anahtar

    print("build_fx self-test: tamam")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--years", type=int, default=15)
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    api_key = os.environ.get("EVDS_API_KEY", "").strip()
    if not api_key:
        # BEKLENEN YOKLUK, HATA DEĞİL — çıkış kodu 0.
        #
        # Buraya `1` dönülüyordu ve iş akışı adımı `continue-on-error` ile
        # ayakta kalıyordu, ama sinyal kayboluyordu: kaynağın ÇÖKMESİ ile
        # anahtarın YAPILANDIRILMAMASI aynı kodu veriyordu, yani gerçek bir
        # kesinti kayıtta beklenen durumdan ayırt edilemiyordu. Projenin
        # finansal tablolarda yaptığı ayrımın (veriyok / hata) aynısı.
        #
        # Anahtar koymamak bir tercih: arayüz "kur serisi yok" diyor ve
        # portföy TL bazında çalışmaya devam ediyor. Kırmızı bir adım bunu
        # anlatmıyor, yalnızca gürültü üretiyor.
        print("EVDS_API_KEY yok; fx.json YAZILMADI (arayüz 'kur serisi yok' diyecek).",
              file=sys.stderr)
        return 0

    end = date.today()
    start = end - timedelta(days=365 * args.years)
    try:
        items = fetch_items(api_key, start, end)
    except Exception as err:  # noqa: BLE001 — kaynak hatası ölümcül değil
        print(f"kur kaynağına erişilemedi: {err}", file=sys.stderr)
        return 1

    days, rates = parse_items(items)
    if not days:
        print("kaynaktan kur okunamadı; dosya yazılmadı.", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": SOURCE_NAME,
                "generated": int(time.time()),
                "currency": "USD",
                "days": days,
                "rates": rates,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"{len(days)} gün kur → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
