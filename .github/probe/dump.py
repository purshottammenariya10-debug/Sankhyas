import re, sys
sys.path.insert(0, "scripts")
import ipo_notes as N
sym = sys.argv[1]
docs = N.pdfs_in_zip(f"https://nsearchives.nseindia.com/content/ipo/RHP_{sym}.zip")
pages = N.pdf_pages(docs[0][1], 900)
print("@@ pages", len(pages), [d[0] for d in docs])
for i, p in enumerate(pages[:260]):
    top = [l for l in p.split("\n") if l.strip()][:3]
    print(f"@@T {i+1}: " + " | ".join(t[:90] for t in top))
def show(tag, text, n=3500):
    print(f"@@S {tag}: " + N.flat(text)[:n])
show("cover1", pages[0]); show("cover2", pages[1] if len(pages) > 1 else "")
for rx in [r"RISK FACTORS", r"SUMMARY OF", r"OUR BUSINESS", r"BASIS FOR"]:
    hits = [i for i, p in enumerate(pages) if re.search(rx, "\n".join([l for l in p.split("\n") if l.strip()][:6]))]
    print("@@H", rx, [h + 1 for h in hits[:30]])
f = "\n".join(pages)
for tag, rx, n in [("peers", r"(?i)comparison (?:of|with)[^\n]{0,60}peers|listed (?:industry )?peers", 3000), ("objects", r"(?i)utili[sz](?:e|ation of) (?:the )?net proceeds", 2500),
                   ("riskbody", r"(?m)^\s*1\.\s+[A-Z]", 2500), ("primary", r"(?i)primary business", 1500), ("kpi", r"(?i)key performance indicators", 3000)]:
    for k, m in enumerate(list(re.finditer(rx, f))[:3]):
        show(f"{tag}{k}", f[m.start():m.start() + n], n)
