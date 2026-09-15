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
import zlib
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Bayt düzeni TEK KAYNAKTAN geliyor: burada yeniden yazmak, üretici ile örnek
# veri arasında sessizce ayrışabilecek ikinci bir format tanımı demek olurdu.
from pack_data import (  # noqa: E402
    VERSION as PACK_VERSION,
    encode_bundle,
    encode_series,
    endeks_kumesi,
    short_hash,
)

ROOT = Path(__file__).resolve().parent.parent
SECTORS = [
    "Bankacılık", "Holding", "Demir Çelik", "Perakende", "Gıda",
    "Enerji", "Kimya", "Ulaştırma", "Teknoloji", "İnşaat",
]



def tohum(s: str) -> int:
    """
    Sembolden KARARLI tohum.

    `hash()` KULLANILMAZ: CPython'da string hash'i süreç başına rastgele
    tuzlanır (PYTHONHASHSEED). Ölçüldü — `hash("X001") & 0xFFFF` üç ayrı
    süreçte 35214 / 26483 / 35268 döndü. Yani örnek veri her üretimde
    BAŞKAYDI: uçtan uca testler her koşuda farklı fiyat serisiyle çalışıyor,
    bir tarama kuralı bir koşuda sonuç veriyor ötekinde vermiyordu. "Ara
    sıra kırılan test" tam olarak buydu; kusur testte değil, veridedir.
    """
    return zlib.crc32(s.encode("utf-8")) & 0xFFFF

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

    # Örnek evrene GERÇEK bir endeks sembolü de giriyor (XU100). Sebep: yayında
    # 48 endeks serisi hisselerin arasında duruyordu ve tarayıcıda işlem değeri
    # 0 olan, alınamayacak satırlar olarak görünüyordu. Eleme artık var; örnek
    # veride hiç endeks olmazsa o eleme uçtan uca testte HİÇ çalışmaz.
    # XU100 ana endeks (elenmeyi sınar), diğer üçü SEKTÖR endeksi (sektör
    # endeksi panelini sınar). Üçü de gerçek BIST kodları; sektör paneli
    # kodları tanımasaydı liste boş kalır ve panel hiç sınanmazdı.
    symbols = [f"X{i:03d}" for i in range(args.symbols)] + [
        "XU100",
        "XBANK",
        "XGIDA",
        "XKMYA",
    ]
    start_day = 19000 - args.bars
    series = {s: synth(tohum(s), args.bars, start_day) for s in symbols}

    manifest = {
        "version": PACK_VERSION,
        "market": args.market,
        "generated": int(time.time()),
        "symbols": {},
    }

    endeksler = endeks_kumesi(args.market)
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
        if s.upper() in endeksler:
            manifest["symbols"][s]["e"] = 1

    # Paket = tarama evreni; endeksler dışarıda (pack_data ile aynı sözleşme).
    bundle = encode_bundle(
        {k: v for k, v in series.items() if k.upper() not in endeksler}, args.bundle_bars
    )
    # Endeks paketi (pack_data ile aynı sözleşme): sektör endeksi ekranı bunu
    # okuyor. Örnek veride üretilmezse o ekran uçtan uca testte hiç çalışmaz.
    endeks_serileri = {k: v for k, v in series.items() if k.upper() in endeksler}
    (pack / "latest-250.bin").write_bytes(bundle)
    if endeks_serileri:
        e_paket = encode_bundle(endeks_serileri, args.bundle_bars)
        (pack / f"endeks-{args.bundle_bars}.bin").write_bytes(e_paket)
        manifest["indices"] = {
            "file": f"endeks-{args.bundle_bars}.bin",
            "bars": min(args.bundle_bars, args.bars),
            "bytes": len(e_paket),
            "hash": short_hash(e_paket),
            "symbols": len(endeks_serileri),
        }

    manifest["bundle"] = {
        "file": "latest-250.bin",
        "bars": min(args.bundle_bars, args.bars),
        "bytes": len(bundle),
        "hash": short_hash(bundle),
    }
    (pack / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    hisseler_temel = [s for s in symbols if s.upper() not in endeks_kumesi(args.market)]

    # Finansallar: oran hesabına giren kalemler, sembole göre tutarlı.
    #
    # ÖRNEK VERİ GERÇEĞE BENZEMEK ZORUNDA. Burada dört ALTI AYLIK dönem
    # vardı; yayındaki BIST verisinde ise sembol başına 34'e varan ÇEYREKLİK
    # dönem var. Fark kozmetik değil, kusur gizliyordu: dört kısa etiket her
    # düzene sığdığı için "2025/12" gibi uzun etiketlerin ızgara kolonunu
    # genişletip çubuklardan kaydırdığı ve paneli taşırdığı ölçülemiyordu —
    # kusur ancak gerçek veriyle çalışınca görüldü.
    #
    # İkinci uyum: kaynak AKIŞ kalemlerini yıl başından bugüne KÜMÜLATİF
    # veriyor. Örnek veri kümülatif olmadığı sürece `quarterlySeries`in
    # arındırma adımı uçtan uca yolda hiç çalışmıyordu.
    YIL_SAYISI = 5
    CEYREK = (3, 6, 9, 12)
    periods = [f"{2021 + y}/{c}" for y in range(YIL_SAYISI) for c in CEYREK]
    N = len(periods)
    # Mevsimsellik: toplamı tam 4,0 — yıllık toplam bozulmadan çubuklar
    # birbirinden ayrışıyor. Düz seride "mevsimsellik kayboldu" kusuru
    # görünmez olurdu.
    MEVSIM = (0.85, 0.95, 1.05, 1.15)

    def yil_carpani(y: int) -> float:
        """Son yıl 1,1 — eski serinin son değeriyle AYNI, TTM'ler kaymasın."""
        return 0.7 + 0.1 * y

    def akis(yillik: float) -> list[float]:
        """Yıl başından bugüne kümülatif akış serisi (kaynakla aynı biçim)."""
        out: list[float] = []
        for y in range(YIL_SAYISI):
            toplam = 0.0
            for q in range(4):
                toplam += yillik * yil_carpani(y) / 4 * MEVSIM[q]
                out.append(round(toplam, 1))
        return out

    def akis_sabit(yillik: float) -> list[float]:
        """Yıldan yıla değişmeyen akış — son 12 ayın toplamı `yillik`."""
        out: list[float] = []
        for _ in range(YIL_SAYISI):
            toplam = 0.0
            for q in range(4):
                toplam += yillik / 4 * MEVSIM[q]
                out.append(round(toplam, 1))
        return out

    def stok(son: float, bas_oran: float = 1.0) -> list[float]:
        """Bilanço kalemi: o ANIN fotoğrafı, kümülatif değil."""
        if N == 1:
            return [round(son, 1)]
        return [round(son * (bas_oran + (1 - bas_oran) * i / (N - 1)), 1) for i in range(N)]

    snapshot = {
        "version": 1,
        "generated": int(time.time()),
        "note": "Sentetik (yerel) veri; yayım tarihi bilgisi yok, backtest girdisi yapılmamalıdır.",
        "symbols": {},
    }
    hepsi = {"version": 1, "generated": snapshot["generated"], "symbols": {}}
    # ENDEKSİN BİLANÇOSU YOKTUR. Yayında bu ayrım `tablosuz.json` ile yapılıyor
    # ("eksik veri" ile "böyle bir tablo yok" farklı şeyler); örnek veride her
    # sembole tablo üretmek o ayrımı görünmez kılıyordu.
    for s in hisseler_temel:
        rnd = random.Random(tohum(s))
        revenue = rnd.uniform(500, 5000)
        margin = rnd.uniform(-0.05, 0.25)
        equity = revenue * rnd.uniform(0.4, 1.5)
        # Akış kalemleri kümülatif, bilanço kalemleri anlık. Son 12 ayın
        # toplamları eski serinin son değerleriyle AYNI kalacak biçimde
        # ölçeklendi: anlık görüntü (snapshot) değişmesin, yalnızca dönem
        # dizisi gerçeğe benzesin.
        fields = {
            "revenue": akis(revenue),
            "netIncome": akis(revenue * margin),
            "equity": stok(equity * 1.05, 0.9 / 1.05),
            "assets": [round(equity * 2.4, 1)] * N,
            "operatingCashFlow": akis_sabit(revenue * margin * 1.2),
            "grossProfit": akis_sabit(revenue * 0.3),
            "currentAssets": [round(equity * 0.8, 1)] * N,
            "currentLiabilities": [round(equity * 0.5, 1)] * N,
            "longLiabilities": [round(equity * 0.7, 1)] * N,
            "paidCapital": [round(revenue * 0.1, 1)] * N,
            "inventory": [round(equity * 0.2, 1)] * N,
            "cash": [round(equity * 0.15, 1)] * N,
            "operatingProfit": akis_sabit(revenue * margin * 1.4),
            "capex": [None] * N,
        }
        kayit = {"symbol": s, "periods": periods, "fields": fields, "missing": ["capex"]}
        (fund / f"{s}.json").write_text(json.dumps(kayit, separators=(",", ":")), encoding="utf-8")
        # Birleşik dosya: tarama ekranı büyüme ve karne ölçütlerini bundan
        # hesaplıyor (anlık görüntüde yalnızca son TTM var). Üretilmezse o
        # ölçütler yerelde ve uçtan uca testlerde sessizce boş kalır.
        hepsi["symbols"][s] = kayit
        # Son dönem 4. çeyrek olduğu için KÜMÜLATİF değer = yılın toplamı =
        # son 12 ay. Seri Q4'te bitmeseydi bu eşitlik bozulurdu.
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
    (fund / "hepsi.json").write_text(json.dumps(hepsi, separators=(",", ":")), encoding="utf-8")
    # "Tablosu olmayan" listesi: arayüz bunu "veri eksik" değil "bu aracın
    # bilançosu yok" diye okuyor. Yayındaki dosyanın karşılığı.
    tablosuz = sorted(set(symbols) - set(hisseler_temel))
    (fund / "tablosuz.json").write_text(
        json.dumps({"version": 1, "symbols": tablosuz}, separators=(",", ":")),
        encoding="utf-8",
    )

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
    # Endeksin sektörü YOKTUR: XU100'e "Kimya" demek uydurma bir sınıflandırma
    # olurdu ve sektör para akışını da kirletirdi.
    rnd = random.Random(7)
    hisseler = [s for s in symbols if s.upper() not in endeksler]
    mapping = {s: rnd.choice(SECTORS) for s in hisseler if rnd.random() > 0.1}
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
