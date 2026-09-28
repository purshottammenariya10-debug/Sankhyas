import io, logging, re, sys, zipfile
import requests
from pypdf import PdfReader
logging.disable(logging.CRITICAL)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
HEADS = [(r"SUMMARY OF (?:THE )?OFFER DOCUMENT", 8), (r"BASIS FOR (?:THE )?(?:OFFER|ISSUE) PRICE", 9), (r"OBJECTS OF THE (?:OFFER|ISSUE)", 4),
         (r"^\s*OUR BUSINESS\s*$", 3), (r"^\s*THE OFFER\s*$", 2), (r"^\s*RISK FACTORS\s*$", 3), (r"CAPITAL STRUCTURE", 6),
         (r"OUTSTANDING LITIGATION AND", 3), (r"CONTINGENT LIABILIT", 1), (r"INDUSTRY OVERVIEW", 1), (r"SELLING SHAREHOLDER", 1)]
def pages_of(data):
    rd = PdfReader(io.BytesIO(data)); out = []
    for p in rd.pages:
        try: out.append(p.extract_text() or "")
        except Exception: out.append("")
    return out
def dump(tag, i, t):
    print(f"@P {tag} {i+1} :: " + t.replace("\n", " ⏎ "))
sym = sys.argv[1]
for kind in ("RATIOS", "RHP"):
    url = f"https://nsearchives.nseindia.com/content/ipo/{kind}_{sym}.zip"
    r = requests.get(url, headers=UA, timeout=180)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    print("@I", kind, [(i.filename, i.file_size) for i in z.infolist()])
    for info in z.infolist():
        if not info.filename.lower().endswith(".pdf"): continue
        pg = pages_of(z.read(info)); print("@I pages", len(pg))
        if kind == "RATIOS":
            for i, t in enumerate(pg[:40]): dump("R", i, t)
            continue
        want = set(range(0, 4))
        for rx, n in HEADS:
            hits = [i for i, t in enumerate(pg) if re.search(rx, t, re.M) and i > 3]
            # headings appear in the table of contents too: use hits after the contents pages, first 2 section starts
            print("@I head", rx, hits[:25])
            starts = [i for i in hits if i > 8][:2 if n > 1 else 3]
            for s in starts: want.update(range(s, min(len(pg), s + n)))
        for i in sorted(want)[:140]: dump("H", i, pg[i])
