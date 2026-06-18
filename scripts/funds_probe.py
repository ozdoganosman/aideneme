"""
PROBE v14 (CI) — call fonturkey's portfolio-distribution endpoint
(/api/funds/dagilimSiraliGetirT, POST) for one equity fund and see whether the
response is STOCK-LEVEL (individual securities) — the make-or-break test.
"""
from __future__ import annotations

import json
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", "Accept": "application/json,*/*",
                  "Content-Type": "application/json", "Referer": "https://fonturkey.com.tr/"})
BASE = "https://fonturkey.com.tr"


def p(*a):
    print(*a)
    sys.stdout.flush()


def post(path, body):
    try:
        rr = S.post(BASE + path, data=json.dumps(body), timeout=20)
    except Exception as e:  # noqa
        p(f"  POST {path} {body} err {repr(e)[:40]}")
        return
    p(f"\n  POST {path}  body={json.dumps(body, ensure_ascii=False)}")
    p(f"    -> {rr.status_code} {len(rr.content)}B {rr.headers.get('content-type','')[:24]}")
    p(f"    {rr.text[:700]!r}")


bodies = [
    {},
    {"fonKod": "HFR", "dil": "TR"},
    {"sFonturKod": "HFR", "fonTip": "YAT", "dil": "TR"},
    {"fonKod": "HFR", "fonTip": "YAT", "dil": "TR", "sira": "", "yon": ""},
    {"fonKod": "HFR"},
    {"kurucuKod": None, "fonKod": "HFR", "fonTip": "YAT", "dil": "TR", "tarih": "2026-05-30"},
]
for ep in ["/api/funds/dagilimSiraliGetirT", "/api/funds/dagilimSiraliGetir"]:
    for b in bodies:
        post(ep, b)

# also a likely fund-list / general-info method to learn the schema
for ep in ["/api/funds/fonGetir", "/api/funds/genelBilgiGetir", "/api/funds/B8", "/api/funds/listGetir"]:
    post(ep, {"fonTip": "YAT", "dil": "TR"})

p("\n[probe14] done")
