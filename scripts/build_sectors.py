#!/usr/bin/env python3
"""
BIST sektör sınıflandırması üreticisi.

    public/data/bist/sectors.json   {"source": ..., "generated": ..., "of": {SEMBOL: sektör}}

KAYNAK: Borsa İstanbul'un KENDİ yayımladığı endeks bileşen dosyası —
`https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv`. Her satır bir
(endeks, bileşen hisse) çifti. Bir hissenin BIST'in alt sektör endekslerinden
hangisinde olduğu, o hissenin sektörüdür; tahmin değil, borsanın kendi
listesi.

BU DOSYAYI NASIL BULDUM — önceki üç deneme TAHMİNDİ ve üçü de `HTTP 401`
döndürdü (İş Yatırım'da `HisseYuzeysel`, `IndexCompanies`,
`SektorKarsilastirma`; koşu 34922818979). Uç nokta adı uydurmak mühendislik
değil. Doğru hamle, fiyat verimizi ZATEN çeken kütüphanenin (borsapy)
kaynağını okumaktı: `borsapy/_providers/bist_index.py` bu CSV'yi indiriyor.
Yani çalıştığı kanıtlı bir yol vardı ve ben onu aramak yerine ad tahmin
ediyordum.

Kütüphane BAĞIMLILIK OLARAK EKLENMEDİ: `onizleme` işinde borsapy kurulu değil
ve tek bir CSV için kurmak 30 saniyelik bir adımı dakikalara çıkarırdı. URL ve
kolon adları buraya alındı; `--self-test` kolon sözleşmesini çevrimdışı
koruyor.

SEKTÖR LİSTESİ TEK YERDE: 23 alt sektör endeksinin kodu ve Türkçe adı
`src/core/screen/sectorIndices.ts` içinde yaşıyor ve bu betik ONU okuyor.
İkinci bir liste tutmak, bu oturumda beş kez yaptığım "listelerden biri
güncellenmedi" kusurunun aynısı olurdu. `--self-test` listenin okunabildiğini
ve beklenen omurgayı taşıdığını doğruluyor; TS tarafı değişip burası
okuyamaz hâle gelirse `verify` işi kırılıyor.

DIŞLANANLAR: XU100/XU030 gibi ANA endeksler ve XUSIN/XUMAL gibi ÜST kümeler
listede yok. Aynı şirket hem XBANK'ta hem XUMAL'da; ikisini de sektör saymak
şirketi iki kez saymak olurdu.

Çalıştırma:
    python scripts/build_sectors.py [--self-test] [--csv DOSYA]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "bist" / "sectors.json"
SYMBOLS_FILE = Path(__file__).resolve().parent / "bist_symbols.json"
SEKTOR_TS = ROOT / "src" / "core" / "screen" / "sectorIndices.ts"

KAYNAK_URL = "https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv"
KAYNAK_ADI = "Borsa İstanbul — endeks bileşenleri (hisse_endeks_ds.csv)"

# Tarayıcı başlığı: kütüphanesiz düz `Python-urllib` isteklerini reddeden
# kaynaklar gördük (İş Yatırım 401 verdi). Bu kaynakta gerekip gerekmediği
# ölçülmedi; göndermenin bedeli yok.
BASLIKLAR = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
    "Accept-Language": "tr-TR,tr;q=0.9",
}

# CSV kolon adları (borsapy'nin okuduğu sözleşme).
KOLON_ENDEKS = "ENDEKS KODU"
KOLON_BILESEN = "BILESEN KODU"

# Endeks kodu deseni. İkinci başlık satırını (İngilizce kolon adları) ve boş
# satırları AYIKLAR: "INDEX CODE" bu desene uymuyor. Ayrı bir "kaçıncı satırı
# atla" kuralından daha sağlam — dosyaya bir satır eklenirse bozulmuyor.
ENDEKS_DESENI = re.compile(r"^X[A-Z0-9]{3,5}$")


def sektor_listesi(ts_path: Path = SEKTOR_TS) -> dict[str, str]:
    """
    `sectorIndices.ts` içindeki `BIST_SEKTOR_ENDEKSLERI` → {KOD: ad}.

    TS'i okumak kırılgan görünüyor ama ALTERNATİFİ daha kötü: 23 kodu ve
    Türkçe adı ikinci bir dosyada tutmak. Bu oturumda beş kez aynı kusuru
    yaptım — iki liste vardı, biri güncellendi, öteki unutuldu. Tek liste
    kalsın; okunamazsa `--self-test` bağırıyor.
    """
    metin = ts_path.read_text(encoding="utf-8")
    govde = re.search(
        r"BIST_SEKTOR_ENDEKSLERI[^=]*=\s*\[(.*?)\];", metin, re.S
    )
    if not govde:
        raise RuntimeError(f"{ts_path.name}: BIST_SEKTOR_ENDEKSLERI listesi bulunamadı")
    ciftler = re.findall(r"\{\s*kod:\s*'([^']+)'\s*,\s*ad:\s*'([^']+)'\s*\}", govde.group(1))
    if not ciftler:
        raise RuntimeError(f"{ts_path.name}: liste okundu ama kod/ad çifti çıkmadı")
    return {kod: ad for kod, ad in ciftler}


def csv_satirlari(metin: str) -> list[dict[str, str]]:
    """
    Noktalı virgülle ayrılmış CSV → kayıt listesi.

    Ağ ERİŞİMİ YOK; `--self-test` bunu çevrimdışı doğruluyor.
    """
    okuyucu = csv.DictReader(io.StringIO(metin), delimiter=";")
    return [{(k or "").strip(): (v or "").strip() for k, v in satir.items()} for satir in okuyucu]


def eslesmeler(
    kayitlar: list[dict[str, str]],
    sektorler: dict[str, str],
    bilinen: set[str] | None = None,
) -> tuple[dict[str, str], dict[str, list[str]]]:
    """
    Kayıtlar → ({SEMBOL: sektör adı}, {SEMBOL: çakışan endeks kodları}).

    ÇAKIŞMA GERÇEK BİR OLASILIK: bir hisse birden çok alt sektör endeksinde
    görünebilir. O sembol sektörsüz bırakılıyor ve ayrıca raporlanıyor —
    ikisinden birini seçmek, veri söylemediği hâlde bir tercih uydurmak
    olurdu. Kaç tane çıktığı özet satırında yazıyor.
    """
    uyeler: dict[str, list[str]] = {}
    for kayit in kayitlar:
        kod = kayit.get(KOLON_ENDEKS, "").upper()
        if not ENDEKS_DESENI.match(kod) or kod not in sektorler:
            continue
        sembol = kayit.get(KOLON_BILESEN, "").upper()
        # ".E" (Pay Piyasası) son eki kaynakta var, sembol listemizde yok.
        sembol = re.sub(r"\.[A-Z]$", "", sembol)
        if not sembol:
            continue
        if bilinen is not None and sembol not in bilinen:
            continue
        kodlar = uyeler.setdefault(sembol, [])
        if kod not in kodlar:
            kodlar.append(kod)

    harita: dict[str, str] = {}
    cakismalar: dict[str, list[str]] = {}
    for sembol, kodlar in uyeler.items():
        if len(kodlar) == 1:
            harita[sembol] = sektorler[kodlar[0]]
        else:
            cakismalar[sembol] = sorted(kodlar)
    return harita, cakismalar


def indir(url: str = KAYNAK_URL, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers=BASLIKLAR)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        ham = response.read()
    # Kaynak Türkçe metni Windows-1254 ile yayımlayabiliyor. Kod ve sembol
    # kolonları ASCII olduğu için çözüm hatası SONUCU etkilemiyor; yine de
    # doğru çözüp tanı çıktısını okunur tutuyoruz.
    for kodlama in ("utf-8-sig", "cp1254", "latin-1"):
        try:
            return ham.decode(kodlama)
        except UnicodeDecodeError:
            continue
    return ham.decode("utf-8", errors="replace")


def known_symbols() -> set[str]:
    if not SYMBOLS_FILE.exists():
        return set()
    data = json.loads(SYMBOLS_FILE.read_text(encoding="utf-8"))
    return {s["name"].upper() for s in data.get("stocks", []) if s.get("name")}


def ozet_yaz(satir: str) -> None:
    """
    İş akışı özetine tek satır ekler.

    Neden: adım `continue-on-error` olduğu için eksik sınıflandırma koşu
    sayfasında YEŞİL görünüyordu ve fark edilmesi aylar aldı.
    """
    yol = os.environ.get("GITHUB_STEP_SUMMARY")
    if not yol:
        return
    try:
        with open(yol, "a", encoding="utf-8") as f:
            f.write(satir + "\n")
    except OSError:
        pass


ORNEK_CSV = """ENDEKS KODU;ENDEKS ADI;BILESEN KODU;BULTEN_ADI
INDEX CODE;INDEX NAME;COMPONENT CODE;BULLETIN NAME
XBANK;BIST BANKA;GARAN.E;GARANTI BANKASI
XBANK;BIST BANKA;AKBNK.E;AKBANK
XU100;BIST 100;GARAN.E;GARANTI BANKASI
XUMAL;BIST MALI;GARAN.E;GARANTI BANKASI
XGIDA;BIST GIDA, ICECEK;ULKER.E;ULKER BISKUVI
XULAS;BIST ULASTIRMA;THYAO.E;TURK HAVA YOLLARI
XTCRT;BIST TICARET;THYAO.E;TURK HAVA YOLLARI
XBLSM;BIST BILISIM;YOKBU.E;LISTEMIZDE OLMAYAN
;;;
"""


def self_test() -> int:
    sektorler = sektor_listesi()
    # Omurga: liste TS'ten okunabiliyor ve bilinen çekirdek orada.
    assert len(sektorler) >= 20, len(sektorler)
    assert sektorler.get("XBANK") == "Banka", sektorler.get("XBANK")
    assert sektorler.get("XGIDA") == "Gıda, İçecek", sektorler.get("XGIDA")
    # ANA endeksler ve ÜST kümeler sektör sayılmamalı.
    for disarida in ("XU100", "XU030", "XUSIN", "XUMAL", "XUTUM"):
        assert disarida not in sektorler, disarida

    kayitlar = csv_satirlari(ORNEK_CSV)
    harita, cakismalar = eslesmeler(
        kayitlar, sektorler, bilinen={"GARAN", "AKBNK", "ULKER", "THYAO"}
    )

    # ".E" son eki düşüyor, sektör adı TS listesinden geliyor.
    assert harita["GARAN"] == "Banka", harita
    assert harita["AKBNK"] == "Banka", harita
    assert harita["ULKER"] == "Gıda, İçecek", harita

    # XU100/XUMAL üyeliği GARAN'ı çakışma yapmamalı: ikisi de sektör değil.
    assert "GARAN" not in cakismalar, cakismalar

    # İki ALT sektörde birden görünen sembol sektörsüz kalıyor ve raporlanıyor.
    assert "THYAO" not in harita, harita
    assert cakismalar["THYAO"] == ["XTCRT", "XULAS"], cakismalar

    # Sembol listemizde olmayan bileşen yazılmıyor.
    assert "YOKBU" not in harita, harita

    # İkinci başlık satırı (İngilizce) ve boş satır ayıklanıyor: endeks kodu
    # desene uymuyor.
    assert "INDEX CODE" not in {k for k in harita}, harita
    assert all(s for s in harita), harita

    # Bilinen sembol listesi verilmezse filtre yok.
    hepsi, _ = eslesmeler(kayitlar, sektorler)
    assert "YOKBU" in hepsi, hepsi

    print("build_sectors self-test: tamam")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--csv", help="Ağ yerine yerel bir CSV dosyası okur.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    try:
        sektorler = sektor_listesi()
    except Exception as err:  # noqa: BLE001
        print(f"sektör listesi okunamadı: {err}", file=sys.stderr)
        ozet_yaz(f"⚠️ **Sektör sınıflandırması üretilemedi** — sektör listesi okunamadı: {err}")
        return 1

    try:
        metin = Path(args.csv).read_text(encoding="utf-8") if args.csv else indir()
    except Exception as err:  # noqa: BLE001 — kaynak hatası ölümcül değil
        print(f"[{KAYNAK_ADI}] erişilemedi: {err}", file=sys.stderr)
        ozet_yaz(
            f"⚠️ **Sektör sınıflandırması üretilemedi** — kaynağa erişilemedi: {err}. "
            "Arayüz sektör filtresini gizleyecek."
        )
        return 1

    kayitlar = csv_satirlari(metin)
    harita, cakismalar = eslesmeler(kayitlar, sektorler, bilinen=known_symbols() or None)
    if not harita:
        basliklar = ", ".join(sorted(kayitlar[0])[:8]) if kayitlar else "yok"
        print(
            f"[{KAYNAK_ADI}] {len(kayitlar)} satır geldi ama eşleşme çıkmadı; "
            f"kolonlar: {basliklar}",
            file=sys.stderr,
        )
        ozet_yaz(
            f"⚠️ **Sektör sınıflandırması üretilemedi** — {len(kayitlar)} satır okundu, "
            f"eşleşme çıkmadı. Kolonlar: {basliklar}"
        )
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"source": KAYNAK_ADI, "generated": int(time.time()), "of": harita},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    sektor_sayisi = len(set(harita.values()))
    not_cakisma = (
        f" · {len(cakismalar)} sembol birden çok sektör endeksinde olduğu için yazılmadı"
        if cakismalar
        else ""
    )
    print(f"{len(harita)} sembol · {sektor_sayisi} sektör{not_cakisma} → {OUT.relative_to(ROOT)}")
    if cakismalar:
        ornek = ", ".join(f"{s} ({'+'.join(k)})" for s, k in sorted(cakismalar.items())[:8])
        print(f"  çakışanlar: {ornek}", file=sys.stderr)
    ozet_yaz(
        f"Sektör sınıflandırması: {len(harita)} sembol · {sektor_sayisi} sektör{not_cakisma}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
