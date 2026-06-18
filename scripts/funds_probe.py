"""
PROBE v5 (CI) — parse the KAP fund universe from the RSC flight, then for ONE
equity (HS) fund try candidate detail/disclosure URLs and dump what comes back,
hunting for the monthly portfolio (stock-level holdings) disclosure.
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
    parts = re.findall(r'self\.__next_f\.push\(\[\d+,("(?:[^"\\]|\\.)*")\]\)', html)
    blob = ""
    for s in parts:
        try:
            blob += json.loads(s)
        except Exception:  # noqa
            pass
    return blob


# 1) Fund universe.
r = S.get("https://www.kap.org.tr/tr/YatirimFonlari/YF", timeout=30)
blob = flight_blob(r.text)
funds = re.findall(
    r'"fundOid":"([^"]*)","fundId":"([^"]*)","fundCode":"([^"]*)","fundName":"([^"]*)",'
    r'"fundType":"([^"]*)","fundClass":"([^"]*)"[^}]*?"fundMemberOid":"([^"]*)"', blob)
p(f"funds parsed: {len(funds)}")
classes = {}
for f in funds:
    classes[f[5]] = classes.get(f[5], 0) + 1
p("fundClass counts:", classes)
perma = dict((m[4], (m[1], m[2])) for m in re.findall(
    r'"mkkMemberOid":(?:"([^"]*)"|null),"kapMemberOid":"([^"]*)","permaLink":"([^"]*)","title":"[^"]*","fundCode":"([^"]*)"', blob))
p("permalinks parsed:", len(perma))

hs = [f for f in funds if f[5] == "HS"][:6]
p("\nsample HS (equity) funds [oid,id,code,name,type,class,memberOid]:")
for f in hs:
    p("  ", f[2], "|", f[3][:40], "| memberOid", f[6], "| perma", perma.get(f[2]))

if not hs:
    p("no HS funds; abort"); sys.exit(0)
oid, fid, code, name, _, _, moid = hs[0]
pl = perma.get(code)
p(f"\n>>> probing fund {code} ({name[:40]}) oid={oid} memberOid={moid} perma={pl}")

cands = [
    f"https://www.kap.org.tr/tr/{pl[1]}" if pl else None,
    f"https://www.kap.org.tr/tr/sirket-bilgileri/ozet/{oid}",
    f"https://www.kap.org.tr/tr/sirket-bilgileri/genel/{moid}",
    f"https://www.kap.org.tr/tr/YatirimFonlari/{code}",
    f"https://www.kap.org.tr/tr/bildirimler/{oid}",
    f"https://www.kap.org.tr/tr/api/disclosures/{moid}",
]
for url in [c for c in cands if c]:
    try:
        rr = S.get(url, timeout=25)
        b2 = flight_blob(rr.text) if "text/html" in rr.headers.get("content-type", "") else rr.text
        hits = {k: (k in b2) for k in ["Portf", "portf", "Bildirim", "disclosure", "Hisse", "hisse", "ISIN", "nominal"]}
        p(f"\n##### {url} -> {rr.status_code} · {len(rr.content)}B · blob {len(b2)} · hits {hits}")
        idx = sorted(set(re.findall(r'/tr/Bildirim[a-z]*/\d+', b2)))[:8]
        p("  bildirim links:", idx)
        for kw in ["Portföy", "Portfoy", "Dağılım"]:
            m = re.search(kw, b2)
            if m:
                p(f"  '{kw}' @ {m.start()}: {b2[m.start()-20:m.start()+120]!r}")
    except Exception as e:  # noqa
        p(f"{url} err:", repr(e))

p("\n[probe5] done")
