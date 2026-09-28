"""Temporary: run scripts/ar_forensics.py and scripts/ratings.py on real filings and print the results."""
import io, json, re, sys, time
sys.path.insert(0, "scripts")
import requests
from pypdf import PdfReader
from ar_forensics import forensics
from ratings import rating_details
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
def pages(url, maxp=700):
    r = requests.get(url, headers=H, timeout=120); r.raise_for_status()
    out = []
    for p in PdfReader(io.BytesIO(r.content)).pages[:maxp]:
        try: out.append(p.extract_text() or "")
        except Exception: out.append("")
    return out
if sys.argv[1] == "ratings":
    for x in json.load(open(".github/probe/ratings.json"))["ratings"]:
        try:
            info = rating_details("\n".join(pages(x["u"], 4)), x["t"])
            print("RT", x["s"], x["u"], json.dumps(info, ensure_ascii=False))
        except Exception as e:
            print("RT", x["s"], "ERR", e)
    sys.exit()
for sym, url in [a.split("=", 1) for a in sys.argv[2:]]:
    t0 = time.time()
    try:
        pg = pages(url)
        res = forensics(pg)
        print("FX", sym, round(time.time() - t0), json.dumps(res, ensure_ascii=False))
    except Exception as e:
        print("FX", sym, "ERR", repr(e))
