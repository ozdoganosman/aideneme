"""
PROBE v9 (CI) — fonturkey.com.tr has an open JSON API gateway at /api/<method>
(proxies to /uga/fonbilgilendirme/portal/service/<method>). Discover the real
method names (swagger + a broad candidate sweep); flag anything returning data.
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


def hit(path: str, method: str = "get", body=None):
    url = BASE + path
    try:
        rr = S.post(url, json=body or {}, timeout=12) if method == "post" else S.get(url, timeout=12)
        ct = rr.headers.get("content-type", "")[:22]
        body_preview = rr.text[:150].replace("\n", " ")
        # interesting = JSON that is NOT a generic gateway fault
        flag = ""
        low = rr.text[:400].lower()
        if rr.status_code == 200 and ("json" in ct) and ("err-00" not in low) and ("apiproxy" not in low):
            flag = "  <<< DATA?"
        if any(w in low for w in ["fonkod", "fund", "portf", "umv", "unvan", "hisse"]):
            flag += "  <<< KEYWORDS"
        p(f"  {method.upper():4} {path:48} -> {rr.status_code} {len(rr.content):>7}B {ct:22} | {body_preview!r}{flag}")
    except Exception as e:  # noqa
        p(f"  {method.upper():4} {path:48} err {repr(e)[:40]}")


p("== discovery ==")
for d in ["/api/swagger", "/api/swagger-ui.html", "/api/v2/api-docs", "/api/v3/api-docs",
          "/api/openapi.json", "/uga/fonbilgilendirme/portal/service/",
          "/uga/fonbilgilendirme/portal/service/swagger-ui.html"]:
    hit(d)

p("\n== candidate fund-list / portfolio methods (GET) ==")
for m in ["/api/fund", "/api/funds", "/api/fon", "/api/fundList", "/api/getFundList",
          "/api/fund/all", "/api/funds/all", "/api/fund/getFunds", "/api/fundProfile",
          "/api/fund/getFundProfile", "/api/portfolio", "/api/portfoy", "/api/fundPortfolio",
          "/api/fund/getFundPortfolio", "/api/portfolioDistribution", "/api/fonDagilim",
          "/api/fund/list", "/api/fundprices", "/api/price", "/api/fundReturn",
          "/api/fundAllocation", "/api/asset", "/api/instrument", "/api/fund/portfolio"]:
    hit(m)

p("\n== same names directly on the backend base (no /api) ==")
for m in ["fund", "funds", "fundList", "getFundList", "portfolio", "fonDagilim"]:
    hit("/uga/fonbilgilendirme/portal/service/" + m)

p("\n== a couple POSTs ==")
for m in ["/api/fundList", "/api/funds", "/api/fund/search", "/api/search"]:
    hit(m, "post", {})

p("\n[probe9] done")
