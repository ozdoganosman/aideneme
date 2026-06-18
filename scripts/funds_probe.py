"""
PROBE v4 (CI) — KAP fund list via the RSC flight payload (fixed extractor).
Goal: discover the fund-record shape (code, name, KAP oid/route) so we can then
walk each fund -> monthly portfolio disclosure -> stock-level holdings.
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
    # App-Router flight: many <script>self.__next_f.push([N,"<json-string>"])</script>
    parts = re.findall(r'self\.__next_f\.push\(\[\d+,("(?:[^"\\]|\\.)*")\]\)', html)
    blob = ""
    for s in parts:
        try:
            blob += json.loads(s)
        except Exception:  # noqa
            pass
    return blob, len(parts)


URL = "https://www.kap.org.tr/tr/YatirimFonlari/YF"
r = S.get(URL, timeout=30)
blob, nparts = flight_blob(r.text)
p(f"\n##### {URL} -> {r.status_code} · html {len(r.text)} · flight parts {nparts} · blob {len(blob)}")

for kw in ["fonKodu", "fonKod", "fundCode", "unvan", "Unvan", "oid", "Oid", "mkkMemberOid",
           "stockCode", "Portf", "portf", "yatirimFon", "KAYDA", "fonTur", "title", "name"]:
    m = re.search(re.escape(kw), blob)
    if m:
        i = m.start()
        p(f"  {kw} @ {i}: {blob[max(0,i-40):i+160]!r}")
    else:
        p(f"  {kw}: yok")

p("\n=== blob[0:1600] ===")
p(blob[:1600])
j = blob.lower().find("fon")
p("\n=== around first 'fon' ===")
p(blob[max(0, j - 60):j + 500] if j >= 0 else "no 'fon'")
p("\nlinks /tr/YatirimFonlari/X:", sorted(set(re.findall(r'/tr/YatirimFonlari/[A-Za-z0-9_\-]+', blob)))[:50])
p("short codes:", re.findall(r'"([A-Z0-9]{2,6})"', blob)[:60])
p("\n[probe4] done")
