"""
PROBE v8 (CI) — investigate fonturkey.com.tr (surfaced from KAP's own JS). Is it
a clean fund-data source (ideally stock-level portfolio)? Dump homepage + hunt
for an API / fund list / portfolio with holdings.
"""
from __future__ import annotations

import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})


def p(*a):
    print(*a)
    sys.stdout.flush()


BASE = "https://fonturkey.com.tr"
try:
    r = S.get(BASE, timeout=25)
except Exception as e:  # noqa
    p("HOME err:", repr(e))
    p("\n[probe8] done")
    sys.exit(0)

t = r.text
p(f"##### GET / -> {r.status_code} · {len(r.content)}B · {r.headers.get('content-type','')}")
p("head:\n", t[:1000])
p("\napi paths:", sorted(set(re.findall(r'["\'`](/(?:api|v1|data|rest)/[A-Za-z0-9_\-/]{2,50})', t)))[:50])
p("hosts:", sorted(set(re.findall(r'https?://[A-Za-z0-9_.\-]+\.(?:com|org|gov|io|net)(?:\.tr)?', t)))[:30])
p("fetch:", sorted(set(re.findall(r'fetch\(\s*["\'`]([^"\'`]{4,90})', t)))[:30])
p("nextdata:", bool(re.search(r'__NEXT_DATA__', t)), "buildId:", re.findall(r'"buildId":"([^"]+)"', t)[:1])
p("links:", sorted(set(re.findall(r'href=["\']([^"\']{2,60})["\']', t)))[:45])
p("kw:", {k: (k in t) for k in ["portföy", "Portföy", "hisse", "Hisse", "ISIN", "nominal", "fonKod", "fund"]})

for path in ["/api/funds", "/api/fund", "/api/fon", "/api/fonlar", "/api/portfolio",
             "/api/portfoy", "/api/v1/funds", "/api/fund/list", "/api/funds/list",
             "/api/fundlist", "/api/allfunds", "/sitemap.xml", "/robots.txt", "/fonlar"]:
    try:
        rr = S.get(BASE + path, timeout=15)
        p(f"  GET {path} -> {rr.status_code} {len(rr.content)}B {rr.headers.get('content-type','')[:25]} | {rr.text[:130]!r}")
    except Exception as e:  # noqa
        p(f"  GET {path} err {repr(e)[:45]}")

p("\n[probe8] done")
