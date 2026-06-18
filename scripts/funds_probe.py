"""
PROBE v17 (CI) — fix the date format (ISO) and call the distribution / fund-detail
endpoints; inspect whether the result is STOCK-LEVEL (individual BIST securities)
or asset-CATEGORY level. This settles whether "which stocks" is obtainable.
"""
from __future__ import annotations

import json
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})
BASE = "https://fonturkey.com.tr"


def p(*a):
    print(*a)
    sys.stdout.flush()


def post(ep, body, n=900):
    try:
        rr = S.post(BASE + ep, data=json.dumps(body),
                    headers={"Content-Type": "application/json", "Referer": BASE + "/"}, timeout=25)
    except Exception as e:  # noqa
        p(f"  POST {ep} err {repr(e)[:40]}"); return
    txt = rr.text
    flags = "".join(f" <{k}>" for k in ["ISIN", "hisse", "Hisse", "menkul", "Menkul", "AKBNK",
                                        "THYAO", "ASELS", "GARAN", "kiymet", "Kiymet", "BIST"] if k in txt)
    p(f"\n  POST {ep} {json.dumps(body, ensure_ascii=False)[:90]} -> {rr.status_code} {len(rr.content)}B{flags}")
    p(f"    {txt[:n]!r}")


# 1) distribution with ISO dates
for d in ["2026-06-16", "2026-06-15"]:
    post("/api/funds/dagilimSiraliGetirT", {
        "dil": "TR", "fonTipi": "YAT", "kurucuKodu": None, "fonTurKod": None, "fonGrubu": None,
        "fonTurAciklama": None, "islem": None, "fonKodu": "HFR", "ilkKayit": 0, "kayitSayisi": 50,
        "calismaTipi": "1", "basTarih": d, "bitTarih": d})

# 2) fund detail / profile with ISO date (weekday) variants
for ep in ["/api/funds/fonDetayGetir", "/api/funds/fonProfilDtyGetir"]:
    for body in [
        {"fonKodu": "HFR", "dil": "TR", "tarih": "2026-06-16"},
        {"fonKodu": "HFR", "dil": "TR", "fonTip": "YAT", "tarih": "2026-06-16"},
        {"fonKodu": "HFR", "dil": "TR", "basTarih": "2026-06-01", "bitTarih": "2026-06-16"},
        {"fonKodu": "HFR", "dil": "TR", "calismaTipi": "1", "tarih": "2026-06-16"},
    ]:
        post(ep, body, 700)

p("\n[probe17] done")
