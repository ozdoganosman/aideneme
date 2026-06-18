"""
PROBE v15 (CI) — dump the common chunk around the portfolio API calls to recover
the exact request body for dagilimSiraliGetirT, and probe single-fund detail
("...Getir") endpoints for STOCK-LEVEL holdings.
"""
from __future__ import annotations

import json
import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", "Accept": "application/json,*/*"})
BASE = "https://fonturkey.com.tr"


def p(*a):
    print(*a)
    sys.stdout.flush()


# 1) Common chunk: context around the API client calls.
shell = S.get(BASE + "/api/fund", timeout=20).text
common = next(c for c in re.findall(r'/_next/static/[\w./\-]+\.js', shell) if "common" in c)
t = S.get(BASE + common, timeout=20).text
for needle in ["dagilimSiraliGetirT", "SB.post(", ".post(\"/", "fonGetir"]:
    occ = list(re.finditer(re.escape(needle), t))
    p(f"\n===== {needle} ({len(occ)} occ) =====")
    for m in occ[:3]:
        i = m.start()
        p("…" + t[max(0, i - 260):i + 320].replace("\n", " ") + "…")

# 2) Probe single-fund detail / holdings endpoints (POST), look for stock-level.
def post(ep, body):
    try:
        rr = S.post(BASE + ep, data=json.dumps(body),
                    headers={"Content-Type": "application/json", "Referer": BASE + "/"}, timeout=20)
        txt = rr.text
        flag = ""
        for k in ["ISIN", "hisseKod", "menkulKiymet", "varlikAdi", "BIST", "nominal", "AKBNK", "THYAO"]:
            if k in txt:
                flag += f" <{k}>"
        p(f"\n  POST {ep} {json.dumps(body,ensure_ascii=False)} -> {rr.status_code} {len(rr.content)}B{flag}")
        p(f"    {txt[:500]!r}")
    except Exception as e:  # noqa
        p(f"  POST {ep} err {repr(e)[:40]}")


for ep in ["fonDetayGetir", "fonPortfoyGetir", "portfoyGetir", "portfoyDagilimGetir",
           "varlikDagilimGetir", "fonDagilimGetir", "dagilimGetir", "enYuksekGetir", "fonVarlikGetir"]:
    post("/api/funds/" + ep, {"fonKod": "HFR", "fonKodu": "HFR", "dil": "TR", "fonTip": "YAT"})

# richer body for the known distribution endpoint
for b in [
    {"fonKodu": "HFR", "fonTip": "YAT", "dil": "TR", "ilkKayit": 0, "kayitSayisi": 100, "siraKolon": "fonKodu", "siraYon": "ASC"},
    {"fonKodu": "HFR", "fonTip": "YAT", "dil": "TR", "baslangicTarih": "30.05.2026", "bitisTarih": "30.05.2026"},
    {"fonKodu": ["HFR"], "fonTip": "YAT", "dil": "TR"},
]:
    post("/api/funds/dagilimSiraliGetirT", b)

p("\n[probe15] done")
