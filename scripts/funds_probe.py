"""
PROBE v10 (CI) — fonturkey API: the gateway lives at /api/funds/<method> (returns
ERR-006 for unknown methods). Sweep a broad TR+EN method-name list to find a real
one. Flag any response that is NOT a generic gateway fault.
"""
from __future__ import annotations

import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", "Accept": "application/json,*/*"})
BASE = "https://fonturkey.com.tr"


def p(*a):
    print(*a)
    sys.stdout.flush()


def hit(path, method="get", body=None):
    try:
        rr = S.post(BASE + path, json=body or {}, timeout=10) if method == "post" else S.get(BASE + path, timeout=10)
    except Exception as e:  # noqa
        p(f"  {method.upper():4} {path:34} err {repr(e)[:34]}")
        return
    low = rr.text[:500].lower()
    fault = ("err-002" in low) or ("err-006" in low) or ("__next_error__" in low) or ("apiproxy" in low)
    if not fault:  # only print the interesting ones (+ a small marker line)
        p(f"  *** {method.upper()} {path} -> {rr.status_code} {len(rr.content)}B {rr.headers.get('content-type','')[:24]} | {rr.text[:240]!r}")
    return not fault


methods = [
    "list", "all", "getAll", "getList", "search", "query", "getFunds", "fundList", "getFundList",
    "profile", "detail", "portfolio", "getPortfolio", "distribution", "allocation", "prices",
    "returns", "info", "data", "summary", "overview", "getFundInfo", "fundInfo", "getFund",
    "fonlar", "tumFonlar", "fonListesi", "fonGetir", "fonAra", "fonSorgu", "fonBilgi",
    "fonBilgileri", "fonDetay", "fonProfil", "portfoy", "portfoyDagilimi", "portfoyGetir",
    "varlikDagilimi", "getiriler", "fiyatlar", "ozet", "tumFonGetir", "fonKodlari", "menu",
]
p("== /api/funds/<method> (GET) ==")
nonfault = 0
for m in methods:
    if hit(f"/api/funds/{m}"):
        nonfault += 1
p(f"(GET non-fault: {nonfault})")

p("\n== /api/funds/<method> (POST) ==")
for m in ["list", "search", "query", "getFunds", "fonlar", "fonListesi", "portfoyDagilimi", "all"]:
    hit(f"/api/funds/{m}", "post", {})

p("\n== a few /api/fund/<method> + /api/fon/<method> ==")
for pre in ["fund", "fon", "portal", "service", "common"]:
    for m in ["list", "all", "fonlar", "getList"]:
        hit(f"/api/{pre}/{m}")

p("\n[probe10] done")
