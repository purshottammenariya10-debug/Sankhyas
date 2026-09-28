import json, re, sys, requests
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Referer": "https://www.nseindia.com/"}
FACT = re.compile(r"<([A-Za-z\-]+):([A-Za-z0-9]+)\b[^>]*?contextRef=\"([^\"]+)\"[^>]*>([^<]*)<")
for sym in sys.argv[1:]:
    d = requests.get(f"https://raw.githubusercontent.com/purshottammenariya10-debug/Sankhyas/gh-pages/data/results/{sym}.json", timeout=30).json()
    q = d["quarters"][0]
    t = requests.get(q["src"], headers=UA, timeout=60).text
    print("=====", sym, q["qe"], q["cons"], len(t))
    facts = FACT.findall(t)
    seg = [(n, c, v.strip()[:80]) for _, n, c, v in facts if re.search(r"egment", n)]
    ctxs = sorted({c for _, c, _ in seg})
    print("segment facts", len(seg), "contexts", ctxs[:40])
    for n, c, v in seg[:120]:
        print("  F", n, c, v)
    for c in ctxs[:30]:
        m = re.search(r"<xbrli:context[^>]*id=\"" + re.escape(c) + r"\"[^>]*>(.*?)</xbrli:context>", t, re.S)
        if m:
            print("  C", c, re.sub(r"\s+", " ", m.group(1))[:400])
    names = sorted({n for _, n, c, v in facts})
    print("all element names", len(names), [n for n in names if re.search(r"egment|Reportable|Unallocable|Intersegment", n, re.I)])
