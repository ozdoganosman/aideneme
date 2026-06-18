"""
One-off PROBE (runs in CI, which has open internet) to discover what fund
portfolio data TEFAS/KAP actually expose — so we can build a real fetcher for a
"Fonlar" view (monthly holdings + buy/sell diffs). Prints truncated responses to
the workflow log. Safe to delete once the real fetcher exists.
"""
from __future__ import annotations

import sys

import requests

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept-Language": "tr,en;q=0.8"})


def show(name: str, r: requests.Response, n: int = 1800) -> None:
    ct = r.headers.get("content-type", "")
    print(f"\n===== {name} -> HTTP {r.status_code} · {len(r.content)} bytes · {ct} =====")
    print(r.text[:n])
    sys.stdout.flush()


API = "https://www.tefas.gov.tr/api/DB/"
HDR = {
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": "https://www.tefas.gov.tr/FonAnaliz.aspx",
    "Origin": "https://www.tefas.gov.tr",
}
SAMPLE = "TTE"  # placeholder; the universe call below reveals valid codes

# 0) Warm up cookies on the analysis page + peek at the HTML (any embedded data?).
try:
    r = S.get(f"https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod={SAMPLE}", timeout=40,
              headers={"Referer": "https://www.tefas.gov.tr/"})
    show(f"GET FonAnaliz {SAMPLE} (html head)", r, 900)
except Exception as e:  # noqa
    print("FonAnaliz error:", repr(e))

# 1) Asset-class allocation (known endpoint) — confirms reachability + shape.
for code in [SAMPLE, "AFA", "GAF", "TGE", "IPV"]:
    try:
        r = S.post(API + "BindHistoryAllocation",
                   data={"fontip": "YAT", "fonkod": code, "bastarih": "01.04.2026", "bittarih": "18.06.2026"},
                   headers=HDR, timeout=40)
        show(f"POST BindHistoryAllocation {code}", r, 1400)
    except Exception as e:  # noqa
        print(f"alloc {code} error:", repr(e))

# 2) Fund universe (valid codes + available fields).
try:
    r = S.post(API + "BindComparisonFundReturns",
               data={"calismatipi": "2", "fontip": "YAT", "sfontur": "", "kurucukod": "",
                     "fongrup": "", "bastarih": "01.06.2026", "bittarih": "18.06.2026",
                     "fonturkod": "", "fonunvantip": "", "strperiod": "1,1,1,1,1,1,1", "islemdurum": "1"},
               headers=HDR, timeout=80)
    show("POST BindComparisonFundReturns (universe)", r, 1400)
except Exception as e:  # noqa
    print("universe error:", repr(e))

# 3) Guess detailed-portfolio endpoints (stock-level holdings is the goal).
guesses = [
    ("BindHistoryInfo", {"fontip": "YAT", "sfontur": "", "fonkod": SAMPLE, "fongrup": "",
                          "bastarih": "01.06.2026", "bittarih": "18.06.2026", "fonturkod": "", "fonunvantip": ""}),
    ("GetAllFundAnalyzeData", {"dil": "TR", "fonkod": SAMPLE}),
    ("BindFundPortfolio", {"fonkod": SAMPLE}),
    ("BindGetFundPortfolioDetail", {"fonkod": SAMPLE}),
]
for ep, payload in guesses:
    try:
        r = S.post(API + ep, data=payload, headers=HDR, timeout=40)
        show(f"POST {ep} {SAMPLE}", r, 1100)
    except Exception as e:  # noqa
        print(f"{ep} error:", repr(e))

# 4) KAP — does it expose fund portfolio disclosures programmatically?
for url in [
    "https://www.kap.org.tr/tr/api/memberDisclosureQuery",
    "https://www.kap.org.tr/tr/bist-sirketler",
]:
    try:
        r = S.get(url, timeout=40, headers={"Referer": "https://www.kap.org.tr/"})
        show(f"GET {url}", r, 700)
    except Exception as e:  # noqa
        print(f"kap {url} error:", repr(e))

print("\n[probe] done")
