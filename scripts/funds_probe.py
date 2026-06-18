"""
PROBE v12 (CI) — the fonturkey Next.js 404 page is served WITHOUT the bot
challenge and references the app's JS chunks. Fetch those chunks (static, open)
and grep for the real /api/funds/<method> calls.
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


r = S.get(BASE + "/api/fund", timeout=20)  # -> Next.js __next_error__ shell
p(f"shell {r.status_code} {len(r.text)}B")
chunks = list(dict.fromkeys(re.findall(r'/_next/static/[A-Za-z0-9_~./\-]+\.js', r.text)))
p(f"chunks referenced: {len(chunks)}")
p("sample:", chunks[:8])

api = set()
funds_api = set()
for c in chunks[:40]:
    try:
        t = S.get(BASE + c, timeout=15).text
    except Exception:  # noqa
        continue
    for m in re.findall(r'/api/funds/[A-Za-z0-9_\-/.]{2,45}', t):
        funds_api.add(m)
    for m in re.findall(r'["\'`](/api/[A-Za-z0-9_\-/.]{3,55})["\'`]', t):
        api.add(m)
    for m in re.findall(r'["\'`/](funds/[A-Za-z0-9_\-/.]{2,45})["\'`]', t):
        api.add("~" + m)

p("\n/api/funds/* calls found:")
for a in sorted(funds_api):
    p("   ", a)
p("\nother /api/* (literal) found:")
for a in sorted(api)[:80]:
    p("   ", a)

p("\n[probe12] done")
