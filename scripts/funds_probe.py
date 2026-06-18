"""
PROBE v18 (CI) — crack the date format for dagilimSiraliGetirT (portfolio
distribution) and reveal whether resultList is STOCK-LEVEL or category-level.
Also try the export variant + fonDetayGetir with extra fields.
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


def post(ep, body, n=500):
    try:
        rr = S.post(BASE + ep, data=json.dumps(body),
                    headers={"Content-Type": "application/json", "Referer": BASE + "/"}, timeout=25)
    except Exception as e:  # noqa
        p(f"  err {repr(e)[:40]}"); return ""
    return rr.text


def base_body(date):
    return {"dil": "TR", "fonTipi": "YAT", "kurucuKodu": None, "fonTurKod": None, "fonGrubu": None,
            "fonTurAciklama": None, "islem": None, "fonKodu": "HFR", "ilkKayit": 0, "kayitSayisi": 50,
            "calismaTipi": "1", "basTarih": date, "bitTarih": date}


p("== dagilimSiraliGetirT date-format sweep ==")
for d in ["20260616", "16.06.2026", "16/06/2026", "2026/06/16", "06/16/2026",
          "2026-06-16T00:00:00", "1750032000000", "06-16-2026", "2026.06.16", "16-06-2026"]:
    t = post("/api/funds/dagilimSiraliGetirT", base_body(d))
    msg = ""
    try:
        j = json.loads(t)
        em = j.get("errorMessage")
        rl = j.get("resultList")
        msg = f"err={em!r} resultList={'[%d]' % len(rl) if isinstance(rl, list) else rl}"
        if isinstance(rl, list) and rl:
            msg += " | row0=" + json.dumps(rl[0], ensure_ascii=False)[:400]
    except Exception:  # noqa
        msg = t[:200]
    p(f"  date {d:22} -> {msg}")

p("\n== dagilimSiraliGetirDosya (export) ==")
p("  " + post("/api/funds/dagilimSiraliGetirDosya", base_body("20260616"))[:300])

p("\n== fonDetayGetir extra bodies ==")
for b in [{"fonKodu": "HFR", "dil": "TR", "kurucuKod": "A1Y"},
          {"fonKodu": "HFR", "dil": "TR", "tarih": "20260616"},
          {"fonKodu": "HFR", "dil": "TR", "fonTipi": "YAT", "calismaTipi": "1", "tarih": "20260616"}]:
    t = post("/api/funds/fonDetayGetir", b)
    p(f"  {json.dumps(b, ensure_ascii=False)[:70]} -> {t[:260]!r}")

p("\n[probe18] done")
