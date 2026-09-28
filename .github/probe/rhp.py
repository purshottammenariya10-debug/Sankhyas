import base64, gzip, io, sys, time, zipfile
import requests
from pypdf import PdfReader
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
for sym in sys.argv[1:]:
    for kind in ("RHP", "RATIOS"):
        url = f"https://nsearchives.nseindia.com/content/ipo/{kind}_{sym}.zip"
        t = time.time()
        try:
            r = requests.get(url, headers=UA, timeout=180)
            print(kind, sym, r.status_code, len(r.content), r.headers.get("content-type"))
            z = zipfile.ZipFile(io.BytesIO(r.content))
            print("  files:", [(i.filename, i.file_size) for i in z.infolist()])
            for info in z.infolist():
                if not info.filename.lower().endswith(".pdf"):
                    continue
                rd = PdfReader(io.BytesIO(z.read(info)))
                pages = []
                for i, p in enumerate(rd.pages):
                    try:
                        pages.append(p.extract_text() or "")
                    except Exception as e:
                        pages.append("")
                txt = "\n".join(f"<<<PAGE {i+1}>>>\n{x}" for i, x in enumerate(pages))
                blob = base64.b64encode(gzip.compress(txt.encode(), 9)).decode()
                print(f"  {info.filename}: {len(pages)} pages, {len(txt)} chars, {time.time()-t:.0f}s")
                print(f"@@BEGIN {kind}_{sym}")
                for i in range(0, len(blob), 4000):
                    print("@@" + blob[i:i+4000])
                print(f"@@END {kind}_{sym}")
        except Exception as e:
            print("  failed", kind, sym, e)
