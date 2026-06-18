"""
PROBE v13 (CI) — grep fonturkey's shared JS chunks for endpoint strings around
fund/portfolio keywords, to recover the real /api/.../<method> paths.
"""
from __future__ import annotations

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


r = S.get(BASE + "/api/fund", timeout=20)
chunks = list(dict.fromkeys(re.findall(r'/_next/static/[A-Za-z0-9_~./\-]+\.js', r.text)))
p(f"chunks: {len(chunks)} -> {[c.split('/')[-1] for c in chunks]}")

apis = set()
frags = set()
KWS = ["/api/", "funds/", "fund-", "portf", "dagilim", "distribution", "holding", "varlik", "fonbilgilendirme"]
for c in chunks:
    try:
        t = S.get(BASE + c, timeout=18).text
    except Exception:  # noqa
        continue
    for m in re.findall(r'/api/[A-Za-z0-9_\-/.]{3,60}', t):
        apis.add(m)
    for kw in KWS:
        for mt in re.finditer(re.escape(kw), t):
            i = mt.start()
            seg = t[max(0, i - 36):i + 44]
            if re.search(r'[A-Za-z]', seg):
                frags.add(f"[{c.split('/')[-1][:14]}] …{seg}…")

p(f"\n=== /api/* literals ({len(apis)}) ===")
for a in sorted(apis):
    p("   ", a)

p(f"\n=== keyword fragments ({len(frags)}, capped 120) ===")
for f in sorted(frags)[:120]:
    p("  ", f)

p("\n[probe13] done")
