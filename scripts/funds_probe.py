"""
PROBE v2 (runs in CI) — find KAP's internal API for investment-fund portfolio
disclosures (stock-level monthly holdings). Dumps responses to the workflow log.
Temporary; deleted once the real fetcher exists.
"""
from __future__ import annotations

import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
})


def show(name: str, r: requests.Response, n: int = 1600) -> None:
    print(f"\n===== {name} -> HTTP {r.status_code} · {len(r.content)} bytes · {r.headers.get('content-type','')} =====")
    print(r.text[:n])
    sys.stdout.flush()


# 1) KAP disclosure-query API (POST JSON). The classic backend endpoint.
body = {
    "fromDate": "2026-05-01", "toDate": "2026-06-18", "year": "", "prd": "", "term": "",
    "ruleType": "", "bdkReview": "", "disclosureClass": "", "index": "", "market": "",
    "isLate": "", "subjectList": [], "mkkMemberOidList": [], "inactiveMkkMemberOidList": [],
    "bdkMemberOidList": [], "mainSector": "", "sector": "", "subSector": "",
    "memberType": "", "fromSrc": "N", "srcCategory": "", "discType": "", "keywords": "",
}
for path in ["/tr/api/memberDisclosureQuery", "/api/memberDisclosureQuery",
             "/tr/api/disclosures/query", "/tr/api/disclosure/query"]:
    for method in ("post", "get"):
        try:
            url = "https://www.kap.org.tr" + path
            kw = dict(timeout=35, headers={"Content-Type": "application/json",
                                           "Referer": "https://www.kap.org.tr/tr/bildirim-sorgu"})
            r = S.post(url, json=body, **kw) if method == "post" else S.get(url, timeout=35)
            show(f"{method.upper()} {path}", r, 1200)
        except Exception as e:  # noqa
            print(f"{method} {path} err:", repr(e))

# 2) KAP pages → harvest real /api/ paths + buildId from the SPA HTML.
for url in ["https://www.kap.org.tr/tr/bildirim-sorgu",
            "https://www.kap.org.tr/tr/Fonlar",
            "https://www.kap.org.tr/tr/yatirim-fonlari"]:
    try:
        r = S.get(url, timeout=35)
        print(f"\n##### GET {url} -> {r.status_code} · {len(r.content)} bytes")
        apis = sorted(set(re.findall(r'["\'](/[a-zA-Z0-9_\-/]*[Aa]pi[a-zA-Z0-9_\-/]*)["\']', r.text)))
        print("api-ish paths:", apis[:50])
        ep = sorted(set(re.findall(r'(https?://[a-zA-Z0-9_.\-]*kap[a-zA-Z0-9_.\-/]*api[a-zA-Z0-9_.\-/]*)', r.text)))
        print("kap api urls:", ep[:30])
        print("buildId:", re.findall(r'"buildId":"([^"]+)"', r.text)[:2])
        print("next routes:", sorted(set(re.findall(r'/tr/[a-zA-Z0-9\-]+/[a-zA-Z0-9\-]+', r.text)))[:30])
    except Exception as e:  # noqa
        print(url, "err:", repr(e))

print("\n[probe2] done")
