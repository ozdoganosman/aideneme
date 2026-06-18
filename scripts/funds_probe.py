"""
PROBE v16 (CI) — call the single-fund detail endpoints with corrected field
names (fonKodu/dil/fonTipi/tarih) and check whether any returns STOCK-LEVEL
holdings (individual BIST securities). Also dump chunk context for their bodies.
"""
from __future__ import annotations

import json
import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})
BASE = "https://fonturkey.com.tr"


def p(*a):
    print(*a)
    sys.stdout.flush()


shell = S.get(BASE + "/api/fund", timeout=20).text
common = next(c for c in re.findall(r'/_next/static/[\w./\-]+\.js', shell) if "common" in c)
t = S.get(BASE + common, timeout=20).text
for needle in ["fetchFonDetay", "fonProfilDty", "fetchFonProfil", "DetayGetir", "fonBilgi/"]:
    m = re.search(needle, t)
    if m:
        i = m.start()
        p(f"\n--- {needle} --- …{t[max(0,i-40):i+360]}…".replace("\n", " "))


def post(ep, body):
    try:
        rr = S.post(BASE + ep, data=json.dumps(body),
                    headers={"Content-Type": "application/json", "Referer": BASE + "/"}, timeout=20)
    except Exception as e:  # noqa
        p(f"  POST {ep} err {repr(e)[:40]}"); return
    txt = rr.text
    flags = "".join(f" <{k}>" for k in ["ISIN", "hisseKod", "menkulKiymet", "varlik", "BIST",
                                        "nominal", "AKBNK", "THYAO", "ASELS", "kiymetTuru", "yuzde"] if k in txt)
    p(f"\n  POST {ep} {json.dumps(body, ensure_ascii=False)} -> {rr.status_code} {len(rr.content)}B{flags}")
    p(f"    {txt[:600]!r}")


for ep in ["/api/funds/fonDetayGetir", "/api/funds/fonProfilDtyGetir", "/api/funds/fonBilgiGetir"]:
    for body in [
        {"fonKodu": "HFR", "dil": "TR"},
        {"fonKodu": "HFR", "dil": "TR", "fonTipi": "YAT"},
        {"fonKodu": "HFR", "dil": "TR", "tarih": "30.05.2026"},
        {"fonKodu": "HFR", "dil": "TR", "basTarih": "01.05.2026", "bitTarih": "30.05.2026"},
    ]:
        post(ep, body)

# distribution with the schema seen in the chunk
post("/api/funds/dagilimSiraliGetirT", {
    "dil": "TR", "fonTipi": "YAT", "kurucuKodu": None, "fonTurKod": None, "fonGrubu": None,
    "fonTurAciklama": None, "islem": None, "fonKodu": "HFR", "ilkKayit": 0, "kayitSayisi": 50,
    "calismaTipi": "1", "basTarih": "01.05.2026", "bitTarih": "30.05.2026"})

p("\n[probe16] done")
