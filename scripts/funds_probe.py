"""
PROBE v6 (CI) — for one equity fund (HFR), dump the KAP summary page RSC and try
disclosure-list subpages, to locate the monthly portfolio disclosure + its index.
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


def grab(url: str):
    r = S.get(url, timeout=25)
    ct = r.headers.get("content-type", "")
    b = flight_blob(r.text) if "html" in ct else r.text
    return r.status_code, len(r.content), b


OID = "4028328c998ee9d50199c2d5b15b6fd9"  # HFR – A1 Capital Hisse Senedi (TL) Fonu
MOID = "8acae2c494bafc93019566721bf70ddf"

st, n, b = grab(f"https://www.kap.org.tr/tr/sirket-bilgileri/ozet/{OID}")
p(f"OZET -> {st} · {n}B · blob {len(b)}")
p("disclosureIndex:", re.findall(r'"disclosureIndex":\s*"?(\d+)', b)[:20])
p("Bildirim hrefs:", sorted(set(re.findall(r'/tr/Bildirim[A-Za-z]*/\d+', b)))[:20])
for kw in ["Portföy Dağılım", "Fon Portföy", "Portföy Dağıtım", "PORTFÖY", "Bildirim"]:
    m = re.search(kw, b)
    p(f"  {kw!r}: {(m.start() if m else 'yok')}")
p("=== OZET BLOB[0:5500] ===")
p(b[:5500])

for sub in ["bildirimler", "fon-portfoy-bilgileri", "portfoy-bilgileri", "fon-bilgileri", "mali-tablolar", "genel"]:
    try:
        st, n, b = grab(f"https://www.kap.org.tr/tr/sirket-bilgileri/{sub}/{OID}")
        idx = re.findall(r'"disclosureIndex":\s*"?(\d+)', b)[:12]
        p(f"\n[{sub}] {st} · {n}B · blob {len(b)} · idx {idx} · 'Portföy Dağ' {'Portföy Dağ' in b} · hisse {'hisse' in b.lower()} · ISIN {'ISIN' in b}")
    except Exception as e:  # noqa
        p(f"[{sub}] err:", repr(e))

p("\n[probe6] done")
