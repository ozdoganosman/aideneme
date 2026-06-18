"""
PROBE v7 (CI, final backend attempt) — grep KAP's JS chunks for the real backend
API (paths/hosts), then call the disclosure/portfolio-looking endpoints right
away and dump responses. Also retries memberDisclosureQuery properly.
"""
from __future__ import annotations

import collections
import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})


def p(*a):
    print(*a)
    sys.stdout.flush()


BASE = "https://www.kap.org.tr"
r = S.get(BASE + "/tr/YatirimFonlari/YF", timeout=30)
chunks = list(dict.fromkeys(re.findall(r'/_next/static/chunks/[A-Za-z0-9_~.\-]+\.js', r.text)))
p(f"chunks referenced: {len(chunks)}")

api, hosts, fetches, kw = set(), set(), set(), collections.Counter()
for c in chunks[:28]:
    try:
        t = S.get(BASE + c, timeout=20).text
    except Exception:  # noqa
        continue
    for m in re.findall(r'["\'`](/(?:tr/)?api/[A-Za-z0-9_\-/]{2,60})', t):
        api.add(m)
    for m in re.findall(r'https?://[A-Za-z0-9_.\-]+\.(?:gov|org|com)\.tr', t):
        hosts.add(m)
    for m in re.findall(r'fetch\(\s*["\'`]([^"\'`]{4,90})', t):
        fetches.add(m)
    for k in ["memberDisclosure", "disclosureQuery", "Portfoy", "portfoy", "Portföy", "Bildirim",
              "fonPortfoy", "Distribution", "portfolio", "getDisclosure", "disclosureList"]:
        if k in t:
            kw[k] += 1

p("\napi paths:", sorted(api)[:80])
p("hosts:", sorted(hosts))
p("fetch literals:", sorted(fetches)[:60])
p("keywords in chunks:", dict(kw))

# Call the disclosure/portfolio-looking endpoints discovered above.
cand = [a for a in api if any(k in a.lower() for k in ["disclosure", "portfoy", "fon", "member", "bildirim", "portfolio"])]
p("\ncandidate data endpoints:", cand)
OID = "8acae2c494bafc93019566721bf70ddf"  # A1 Capital member oid
for a in cand[:10]:
    url = BASE + a
    for method in ("get", "post"):
        try:
            rr = S.post(url, json={"memberOid": OID}, timeout=18) if method == "post" else S.get(url, timeout=18)
            p(f"  {method.upper()} {a} -> {rr.status_code} {len(rr.content)}B {rr.headers.get('content-type','')[:25]} | {rr.text[:160]!r}")
        except Exception as e:  # noqa
            p(f"  {method.upper()} {a} err {repr(e)[:50]}")

# Direct retry of the classic disclosure-query endpoint.
for ep in ["/tr/api/memberDisclosureQuery", "/api/memberDisclosureQuery"]:
    try:
        rr = S.post(BASE + ep, json={"fromDate": "2026-05-01", "toDate": "2026-06-18", "memberType": "", "mkkMemberOidList": [OID]},
                    timeout=45, headers={"Content-Type": "application/json", "Referer": BASE + "/tr/bildirim-sorgu"})
        p(f"\nPOST {ep} -> {rr.status_code} {len(rr.content)}B | {rr.text[:300]!r}")
    except Exception as e:  # noqa
        p(f"\nPOST {ep} err {repr(e)[:60]}")

p("\n[probe7] done")
