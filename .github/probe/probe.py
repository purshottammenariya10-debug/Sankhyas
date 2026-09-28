"""Temporary: print passages from real annual reports and rating letters for parser development."""
import io, json, re, sys, time
import requests
from pypdf import PdfReader
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
H = {"User-Agent": UA, "Referer": "https://www.nseindia.com/"}
def pages(url, maxp=600):
    r = requests.get(url, headers=H, timeout=120); r.raise_for_status()
    rd = PdfReader(io.BytesIO(r.content))
    out = []
    for i, p in enumerate(rd.pages[:maxp]):
        try: out.append(p.extract_text() or "")
        except Exception: out.append("")
    return out, len(r.content)
mode = sys.argv[1]
if mode == "ratings":
    for x in json.load(open(".github/probe/ratings.json"))["ratings"]:
        try:
            pg, n = pages(x["u"], 4)
            t = re.sub(r"\s+", " ", " ".join(pg))[:1800]
            print("RATING", x["s"], "|", t)
        except Exception as e:
            print("RATING", x["s"], "ERR", e)
    sys.exit()
PAT = [("OPIN", r"Qualified Opinion|Adverse Opinion|Disclaimer of Opinion|Basis for (Qualified )?Opinion"),
       ("EOM", r"Emphasis of Matter"), ("GC", r"Material Uncertainty Related to Going Concern"),
       ("FIRM", r"Firm.{0,3}s? Registration N"), ("RATIO", r"ratio of the remuneration of each director"),
       ("CONT", r"Contingent liabilit"), ("RPT", r"Related Party (Disclosures|Transactions)"), ("AOC2", r"AOC ?- ?2"),
       ("CARO", r"defaulted in (the )?repayment|fraud (by|on) the Company|undisputed statutory dues|cash loss|resignation of the statutory auditor"),
       ("POL", r"change(s)? in (the )?accounting polic")]
for sym, url in [a.split("=", 1) for a in sys.argv[2:]]:
    t0 = time.time()
    try:
        pg, n = pages(url)
    except Exception as e:
        print("AR", sym, "ERR", e); continue
    print("AR", sym, "pages", len(pg), "bytes", n, "secs", round(time.time() - t0), "chars", sum(map(len, pg)))
    for tag, rx in PAT:
        k = 0
        for i, p in enumerate(pg):
            flat = re.sub(r"\s+", " ", p)
            for m in re.finditer(rx, flat, re.I):
                print(f"AR {sym} {tag} p{i+1} | {flat[max(0, m.start()-250):m.start()+650]}")
                k += 1
                break
            if k >= (6 if tag in ("CARO", "CONT", "EOM") else 3): break
