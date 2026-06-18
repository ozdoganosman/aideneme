"""
PROBE v3 (CI) — KAP is an App-Router (RSC) Next.js app. Pull the RSC flight
payload from a fund-list page to see the fund-data shape + per-fund URLs, and
scan a JS chunk for any backend API host. Dumps to the workflow log.
"""
from __future__ import annotations

import json
import re
import sys

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9"})


def p(*a):
    print(*a)
    sys.stdout.flush()


def flight_blob(html: str) -> str:
    chunks = re.findall(r'__next_f=self\.__next_f\|\|\[\]\)\.push\(\[\d+,(".*?")\]\)', html, re.S)
    blob = ""
    for c in chunks:
        try:
            blob += json.loads(c)
        except Exception:  # noqa
            pass
    return blob


# 1) Fund-list page (RSC).
URL = "https://www.kap.org.tr/tr/YatirimFonlari/YF"
try:
    r = S.get(URL, timeout=30)
    p(f"\n##### GET {URL} -> {r.status_code} · {len(r.content)} bytes")
    blob = flight_blob(r.text)
    p("flight blob len:", len(blob))
    for kw in ["fonKodu", "fundCode", "fonKod", "Portf", "portf", "hisse", "Hisse",
               "disclosureIndex", "oid", "Oid", "fonGrup", "unvan", "title", "/tr/"]:
        i = blob.find(kw)
        p(f"  kw {kw!r}: {('@%d %r' % (i, blob[max(0,i-30):i+110])) if i>=0 else 'yok'}")
    p("blob head:\n", blob[:2200])
    p("fund-ish links:", sorted(set(re.findall(r'/tr/[A-Za-z0-9/_\-]+', blob)))[:60])
except Exception as e:  # noqa
    p("fund-list err:", repr(e))

# 2) A JS chunk → backend API host / paths (in case data is client-fetched).
try:
    chunk = re.search(r'/_next/static/chunks/[A-Za-z0-9_~.\-]+\.js', r.text)
    if chunk:
        jr = S.get("https://www.kap.org.tr" + chunk.group(0), timeout=30)
        p(f"\n##### JS {chunk.group(0)} -> {jr.status_code} · {len(jr.content)} bytes")
        p("hosts:", sorted(set(re.findall(r'https?://[A-Za-z0-9_.\-]+\.(?:gov|org|com)\.tr', jr.text)))[:40])
        p("api paths:", sorted(set(re.findall(r'["\'](/[A-Za-z0-9_\-/]*[Aa]pi[A-Za-z0-9_\-/]*)["\']', jr.text)))[:40])
        p("fetch-ish:", sorted(set(re.findall(r'fetch\(["\'`]([^"\'`]{3,80})', jr.text)))[:25])
except Exception as e:  # noqa
    p("js err:", repr(e))

# 3) Try fetching the page as pure RSC (flight) with the RSC header.
try:
    r2 = S.get(URL, timeout=30, headers={"RSC": "1"})
    p(f"\n##### GET {URL} [RSC:1] -> {r2.status_code} · {len(r2.content)} bytes · {r2.headers.get('content-type','')}")
    p("rsc head:\n", r2.text[:1200])
except Exception as e:  # noqa
    p("rsc err:", repr(e))

p("\n[probe3] done")
