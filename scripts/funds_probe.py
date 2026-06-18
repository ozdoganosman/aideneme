"""
PROBE v11 (CI) — /api/funds/info works (Spring Boot, Java 17). Try OpenAPI /
actuator discovery under /api/funds/ to dump the FULL endpoint list at once.
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


def hit(path, n=900):
    try:
        rr = S.get(BASE + path, timeout=12)
    except Exception as e:  # noqa
        p(f"  GET {path:40} err {repr(e)[:40]}")
        return
    low = rr.text[:400].lower()
    fault = ("err-002" in low) or ("err-006" in low) or ("__next_error__" in low) or ("apiproxy" in low)
    tag = "" if fault else "   <<<<<<"
    p(f"  GET {path:40} -> {rr.status_code} {len(rr.content):>8}B {rr.headers.get('content-type','')[:26]}{tag}")
    if not fault:
        p(f"      {rr.text[:n]!r}")


for d in [
    "/api/funds/v3/api-docs", "/api/funds/v2/api-docs", "/api/funds/api-docs",
    "/api/funds/openapi.json", "/api/funds/swagger-ui/index.html", "/api/funds/swagger-ui.html",
    "/api/funds/swagger-resources", "/api/funds/actuator", "/api/funds/actuator/mappings",
    "/api/funds/mappings", "/api/funds/health", "/api/funds/actuator/health",
    "/api/funds/actuator/info", "/api/funds/actuator/openapi",
    # maybe the docs live one level up (the "funds" segment is the service)
    "/api/funds", "/api/funds/", "/api/funds/index",
]:
    hit(d)

p("\n[probe11] done")
