#!/usr/bin/env python3
"""Free, rule-based AI summaries of concall transcripts, investor presentations (PPT) and annual reports.

For every earnings-call transcript and investor presentation listed in data/filings/<SYMBOL>.json,
and the latest annual report, download the PDF, extract its text and write an extractive summary
back into the same file under "notes" (keyed by the document URL, with "kind": transcript|ppt|ar):

    "notes": { "<transcript url>": { "d": date, "tone": "Positive", "sections": { "Guidance & outlook": [...], ... } } }

No AI service is used: sentences are scored by topic keywords, numbers and position (prepared
remarks before the Q&A), boilerplate is dropped, and the best sentences per topic are kept in
the order they were spoken. Only new transcripts are processed (--max per run).

    pip install pypdf requests
    python scripts/summarize_concalls.py --max 60 --max-ar 15
"""
import argparse
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILINGS = ROOT / "data" / "filings"

TOPICS = [
    ("Guidance & outlook", r"guidance|outlook|going forward|expect|anticipat|visibility|target|aim to|next (year|quarter|fiscal)|fy ?2\d|medium term|long term|confident"),
    ("Growth & demand", r"growth|grew|demand|volume|order ?book|order inflow|pipeline|market share|new (customers?|clients?|products?)|deal wins?|revenue (was|grew|increased|rose)|launch"),
    ("Margins & costs", r"margin|ebitda|operating profit|cost|pricing|price (hike|increase)|raw material|input|inflation|realisation|realization|wage|utili[sz]ation"),
    ("Capex & expansion", r"capex|capacity|expansion|plant|commission|greenfield|brownfield|acquisition|acquire|invest(ment|ing)? in|new facility|capital expenditure"),
    ("Balance sheet & cash", r"\bdebt\b|net cash|cash flow|free cash|working capital|receivable|inventory days|dividend|buyback|borrowing|leverage|deleverag"),
    ("Risks & challenges", r"challeng|headwind|pressure|declin|slowdown|uncertain|\brisk|weak|subdued|delay|disruption|volatil|competition|soft"),
]
BOILERPLATE = re.compile(
    r"forward[- ]looking|safe harbo|ladies and gentlemen|thank you|thanks|good (morning|afternoon|evening)|welcome to|"
    r"question[- ]and[- ]answer|press (star|\*)|touch[- ]tone|next question|line of|moderator|operator|"
    r"conference call|this call|disclaimer|transcript|recording|please go ahead|hand over|over to you|"
    r"i would like to|let me|may i|can you|could you|you mentioned|joining us|introduc", re.I)
POSITIVE = re.compile(r"strong|robust|healthy|record|improv|grow|increase|higher|momentum|confident|optimis|upbeat|best|expand", re.I)
NEGATIVE = re.compile(r"weak|declin|lower|pressure|challeng|headwind|slow|subdued|soft|decrease|loss|uncertain|cautious|muted", re.I)
NUMBER = re.compile(r"\d+(\.\d+)?\s*(%|percent|per cent|bps|basis points|crore|cr\b|billion|million|lakh|mw|mtpa|x\b)|(rs\.?|inr|₹)\s*\d", re.I)
SPEAKER = re.compile(r"^\s*([A-Z][A-Za-z.\-' ]{1,40}|Moderator|Management|Analyst|Participant)\s*:\s*")


def pdf_text(data, max_pages=None, max_chars=None):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    out, n = [], 0
    for i, page in enumerate(reader.pages):
        if max_pages and i >= max_pages:
            break
        t = page.extract_text() or ""
        out.append(t)
        n += len(t)
        if max_chars and n >= max_chars:
            break
    return "\n".join(out)


KEY_METRIC = re.compile(r"revenue|sales|income|ebitda|\bpat\b|profit|margin|order ?book|order inflow|volume|\baum\b|deposits|advances|loan book|disbursement|\bnim\b|gnpa|nnpa|\beps\b|roce|roe|capacity|market share|guidance|dividend", re.I)
PPT_NOISE = re.compile(r"safe harbo|disclaimer|forward[- ]looking|thank you|agenda|contents|www\.|@|investor relations|this presentation|not an offer|confidential", re.I)


def summarize_ppt(text, per_topic=4):
    """Investor presentations are bullet points, not prose: rank lines instead of sentences."""
    lines, seen = [], set()
    for i, ln in enumerate(text.replace("\u2019", "'").splitlines()):
        ln = re.sub(r"\s+", " ", ln).strip(" •▪●○■-–·*>")
        key = re.sub(r"\W+", "", ln.lower())
        if not (25 <= len(ln) <= 240) or key in seen or PPT_NOISE.search(ln) or not re.search(r"[a-z]{3}", ln):
            continue
        seen.add(key)
        lines.append((i, ln))
    picked, used = {}, set()
    topics = [("Key numbers", None)] + TOPICS
    for topic, pat in topics:
        cands = []
        for i, ln in lines:
            if i in used:
                continue
            if pat is None:
                if NUMBER.search(ln) and KEY_METRIC.search(ln):
                    cands.append((len(KEY_METRIC.findall(ln)) + 2, i, ln))
            else:
                hits = len(re.findall(pat, ln, re.I))
                if hits:
                    cands.append((hits + (1 if NUMBER.search(ln) else 0), i, ln))
        best = sorted(cands, key=lambda c: (-c[0], c[1]))[:per_topic]
        for c in best:
            used.add(c[1])
        if best:
            picked[topic] = [c[2] for c in sorted(best, key=lambda c: c[1])]
    pos, neg = len(POSITIVE.findall(text)), len(NEGATIVE.findall(text))
    tone = "Positive" if pos > neg * 1.6 else "Cautious" if neg > pos else "Neutral"
    return {"tone": tone, "sections": picked, "words": len(text.split())}


def sentences(text):
    """Split transcript text into (sentence, is_question_section, is_question) tuples."""
    text = text.replace("’", "'").replace("–", "-").replace("—", "-")
    # drop page furniture: page numbers and short all-caps header lines
    lines = [ln for ln in text.splitlines() if ln.strip() and not re.fullmatch(r"\s*(page \d+( of \d+)?|\d+)\s*", ln, re.I)]
    joined = " ".join(SPEAKER.sub("", ln.strip()) for ln in lines)
    joined = re.sub(r"\s+", " ", joined)
    qa_at = None
    m = re.search(r"question[- ]and[- ]answer|first question|begin the question", joined, re.I)
    if m:
        qa_at = m.start()
    out, pos = [], 0
    for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9₹\"'(])", joined):
        start = joined.find(s, pos)
        pos = start + len(s) if start >= 0 else pos
        out.append((s.strip(), qa_at is not None and start > qa_at, s.strip().endswith("?")))
    return out


def summarize(text, per_topic=3):
    sents = sentences(text)
    picked, used = {}, set()
    scored = []
    for i, (s, in_qa, is_q) in enumerate(sents):
        if not (50 <= len(s) <= 420) or is_q or BOILERPLATE.search(s):
            continue
        base = (2 if NUMBER.search(s) else 0) + (0 if in_qa else 1)
        for topic, pat in TOPICS:
            hits = len(re.findall(pat, s, re.I))
            if hits:
                scored.append((base + hits, i, topic, s))
    seen_text = set()
    for topic, _ in TOPICS:
        cands = []
        for c in sorted((c for c in scored if c[2] == topic and c[1] not in used), key=lambda c: (-c[0], c[1])):
            key = re.sub(r"\W+", "", c[3].lower())
            if key in seen_text:
                continue
            seen_text.add(key)
            cands.append(c)
            if len(cands) == per_topic:
                break
        for c in cands:
            used.add(c[1])
        if cands:
            picked[topic] = [c[3][:360] + ("…" if len(c[3]) > 360 else "") for c in sorted(cands, key=lambda c: c[1])]
    body = " ".join(s for s, in_qa, is_q in sents if not in_qa)
    pos, neg = len(POSITIVE.findall(body)), len(NEGATIVE.findall(body))
    tone = "Positive" if pos > neg * 1.6 else "Cautious" if neg > pos else "Neutral"
    return {"tone": tone, "sections": picked, "words": len(text.split())}


# ---------- guidance extraction: numeric targets management gives on the call ----------
GUIDE_VERB = re.compile(r"guid|expect|target|aim|aspir|outlook|going forward|plan to|planning to|envisage|anticipat|confident|should (be|grow|see|reach|deliver)|"
                        r"will (be|grow|reach|deliver|cross|achieve)|would (be|grow)|looking at|trying to|estimate|project|budget|endeavou?r|on track", re.I)
GUIDE_METRICS = [
    ("margin", re.compile(r"\b(ebitda|ebit|operating|op(erating)? profit|gross)\s*margins?\b|\bmargins?\b", re.I)),
    ("pat_growth", re.compile(r"\b(pat|net profit|profit after tax|bottom ?line|earnings|eps)\b", re.I)),
    ("revenue_growth", re.compile(r"\b(revenue|revenues|sales|top ?line|turnover|income from operations|business)\b", re.I)),
    ("volume_growth", re.compile(r"\bvolumes?\b", re.I)),
    ("capex", re.compile(r"\bcapex|capital expenditure\b", re.I)),
    ("order_inflow", re.compile(r"\border (inflow|intake|book)\b", re.I)),
]
WORD_RANGE = [(r"high[- ]single[- ]digit", 7, 9), (r"mid[- ]single[- ]digit", 4, 6), (r"low[- ]single[- ]digit", 1, 3),
              (r"low[- ]double[- ]digit|low[- ]teens", 10, 13), (r"mid[- ]teens", 14, 16), (r"high[- ]teens", 17, 19),
              (r"double[- ]digit", 10, None), (r"low[- ]twenties", 20, 23), (r"mid[- ]twenties", 24, 26)]
NUM = r"(\d{1,3}(?:\.\d+)?)"
PCT = r"\s*(?:%|percent|per cent)"
RANGE_PCT = re.compile(NUM + r"\s*(?:%|percent|per cent)?\s*(?:-|–|to)\s*" + NUM + PCT, re.I)
ONE_PCT = re.compile(r"(?:(at least|over|more than|above|around|about|~|approximately|close to|upwards of)\s*)?" + NUM + PCT + r"(\s*(?:\+|plus|and above))?", re.I)
CRORE = re.compile(r"(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(crore|cr\b|billion|bn\b)", re.I)
PERIOD_FY = re.compile(r"\b(?:fy|financial year|fiscal)\s*'?(\d{2}|\d{4})(?:\s*[-/]\s*(\d{2}))?\b", re.I)


def call_fy(d):
    """Fiscal year (ending March) a call on date d falls in, as the ending year: a Jul 2026 call is FY2027."""
    y, m = int(d[:4]), int(d[5:7])
    return y + 1 if m >= 4 else y


def guidance_period(s, d):
    m = PERIOD_FY.search(s)
    if m:
        a, b = m.group(1), m.group(2)
        y = int(b) if b else int(a)
        y = y + 2000 if y < 100 else y
        return f"FY{y}"
    t = s.lower()
    fy = call_fy(d)
    if re.search(r"next (year|fiscal|financial year)|coming year", t):
        return f"FY{fy + 1}"
    if re.search(r"this (year|fiscal|financial year)|current (year|fiscal)|full[- ]year|for the year", t):
        return f"FY{fy}"
    if re.search(r"medium[- ]term|long[- ]term|next (two|three|four|five|2|3|4|5) years|over the (next|coming) (few|couple)|cagr", t):
        return "Medium term"
    return f"FY{fy}"


def guidance_value(s, metric):
    """(low, high, unit) of the target in sentence s, or None."""
    if metric in ("capex", "order_inflow"):
        m = CRORE.search(s)
        if not m:
            return None
        v = float(m.group(1).replace(",", ""))
        if m.group(2).lower().startswith("b"):
            v *= 100    # 1 billion rupees = 100 crore
        return v, v, "cr"
    m = RANGE_PCT.search(s)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        if lo <= hi <= 100:
            return lo, hi, "%"
    for pat, lo, hi in WORD_RANGE:
        if re.search(pat, s, re.I):
            return float(lo), (float(hi) if hi is not None else None), "%"
    m = ONE_PCT.search(s)
    if m:
        v = float(m.group(2))
        if 0 < v <= 100:
            open_up = bool(m.group(1) and re.match(r"at least|over|more than|above|upwards", m.group(1), re.I)) or bool(m.group(3))
            return v, (None if open_up else v), "%"
    return None


def extract_guidance(text, d, limit=12):
    """Numeric targets from a transcript: [{m: metric, lo, hi, u: unit, p: period, t: sentence}]."""
    out, seen = [], set()
    for s, in_qa, is_q in sentences(text):
        if is_q or not (40 <= len(s) <= 400) or not GUIDE_VERB.search(s) or BOILERPLATE.search(s) and not re.search(r"guid", s, re.I):
            continue
        if re.search(r"\b(last|previous|during the|in the) (year|quarter)\b.*\b(was|were|grew|stood|reported)\b", s, re.I) and not re.search(r"expect|guid|target", s, re.I):
            continue    # a reported number, not a target
        metric = None
        for name, pat in GUIDE_METRICS:
            if pat.search(s):
                metric = name
                break
        if not metric:
            continue
        if metric in ("revenue_growth", "pat_growth", "volume_growth") and not re.search(r"grow|growth|increase|cagr|expand|double[- ]digit|teens", s, re.I):
            continue
        val = guidance_value(s, metric)
        if not val:
            continue
        lo, hi, unit = val
        if unit == "%" and metric != "margin" and lo > 80:
            continue
        per = guidance_period(s, d)
        key = (metric, per)
        if key in seen:
            continue
        seen.add(key)
        out.append({"m": metric, "lo": lo, "hi": hi, "u": unit, "p": per, "t": s[:300]})
        if len(out) >= limit:
            break
    return out


NOTE_VERSION = 2


def fiscal_year(d):
    """An annual report filed Jul 2026 covers the year ending Mar 2026, labelled '2025-26' like fetch_filings."""
    y, m = int(d[:4]), int(d[5:7])
    end = y if m >= 4 else y - 1
    return f"{end - 1}-{str(end)[-2:]}"


# ---------- order wins and insider / promoter disclosures ----------
FX = {"usd": 84.0, "us$": 84.0, "$": 84.0, "eur": 92.0, "€": 92.0}
AMOUNT = re.compile(r"(rs\.?|inr|₹|usd|us\$|\$|eur|€)\s*([\d,]+(?:\.\d+)?)\s*(/-)?\s*(crores?|cr\b\.?|lakhs?|lacs?|millions?|mn\b|billions?|bn\b)?", re.I)
ORDER_WORDS = re.compile(r"order|contract|award|\bloa\b|worth|valued|value of|amounting|aggregating|consideration", re.I)


def to_crore(cur, value, unit):
    v = float(value.replace(",", ""))
    unit = (unit or "").lower().rstrip(".")
    mult = 1 / 1e7                        # plain rupees
    if unit.startswith("cr"):
        mult = 1
    elif unit.startswith("la"):
        mult = 1 / 100
    elif unit in ("million", "millions", "mn"):
        mult = 1 / 10
    elif unit in ("billion", "billions", "bn"):
        mult = 100
    fx = FX.get(cur.lower().rstrip("."), 1.0)
    if fx != 1.0 and not unit:            # "$ 1,200,000" style: plain dollars
        mult = 1 / 1e7
    return round(v * mult * fx, 2)


def order_details(text):
    """Largest amount mentioned next to order words, the customer, and a one-line description."""
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\b(M/s|Rs|No|Ltd|Pvt|Co|Inc|approx)\.", r"\1", text, flags=re.I)   # abbreviations are not sentence ends
    best = None
    for sent in re.split(r"(?<=[.;])\s+(?=[A-Z])", text):
        if not ORDER_WORDS.search(sent):
            continue
        for m in AMOUNT.finditer(sent):
            try:
                cr = to_crore(m.group(1), m.group(2), m.group(4))
            except ValueError:
                continue
            if 0.01 <= cr <= 500000 and (best is None or cr > best[0]):
                best = (cr, sent)
    cust = re.search(r"\bfrom\s+(?:[Mm]/[Ss]\.?\s*)?([A-Z][A-Za-z0-9&.,()' -]{3,80}?)(?=\s+(?:for|worth|valued|amounting|aggregating|of\s+(?:rs|inr|₹)|towards|to\s+(?:supply|execute|design))|[,.(])", text)
    desc = next((x for x in re.split(r"(?<=[.])\s+(?=[A-Z])", text) if re.search(r"order|contract|award", x, re.I) and 40 < len(x) < 400), "")
    return {"amt": best[0] if best else None, "cust": cust.group(1).strip()[:80] if cust else "", "desc": desc[:280]}


def disclosure_direction(text):
    t = text.lower()
    if re.search(r"(creation|invocation) of (pledge|encumbrance)|pledge created", t):
        return "pledge"
    if re.search(r"release of (pledge|encumbrance)|pledge released", t):
        return "release"
    buy = len(re.findall(r"acqui|purchase|bought|\bbuy", t))
    sell = len(re.findall(r"dispos|\bsale\b|\bsold\b|\bsell", t))
    return "buy" if buy > sell * 1.3 else "sell" if sell > buy * 1.3 else ""


def filing_details(requests, UA, limit=150):
    """Read order-win and insider/promoter disclosure PDFs once and store what they say on the filing."""
    todo = []
    for f in sorted(FILINGS.glob("*.json")):
        if f.name == "latest.json":
            continue
        doc = json.loads(f.read_text())
        for i, a in enumerate(doc.get("announcements", [])):
            if a.get("k") in ("order", "insider", "sast") and not a.get("det") and a["u"].lower().endswith(".pdf"):
                todo.append((a["d"], f, i))
    todo.sort(key=lambda t: t[0], reverse=True)
    done = found = 0
    by_file = {}
    for d, f, i in todo[:limit]:
        doc = by_file.get(f) or json.loads(f.read_text())
        by_file[f] = doc
        a = doc["announcements"][i]
        a["det"] = 1
        done += 1
        try:
            r = requests.get(a["u"], headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=60)
            r.raise_for_status()
            text = pdf_text(r.content, max_pages=4)
            if a["k"] == "order":
                info = order_details(text)
                for k2, v in info.items():
                    if v:
                        a[k2] = v
                found += 1 if info["amt"] else 0
            else:
                direction = disclosure_direction(text)
                if direction:
                    a["dir"] = direction
                    found += 1
        except Exception as e:  # noqa: BLE001
            print(f"{f.stem}: {a['k']} details not read ({str(e)[:60]})", file=sys.stderr)
    for f, doc in by_file.items():
        f.write_text(json.dumps(doc, separators=(",", ":")))
    if done:
        print(f"Order/insider details: {found} extracted from {done} filings, {max(0, len(todo) - limit)} left for later runs")


REC_LINK = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def find_recordings(requests, UA, limit=40):
    """Recording notices are PDFs that give a link to the audio/video of the call. Read the link
    out of the PDF and store it on the filing as 'rec', so the REC button opens the recording."""
    done = found = 0
    for f in sorted(FILINGS.glob("*.json")):
        if f.name == "latest.json" or done >= limit:
            continue
        doc = json.loads(f.read_text())
        dirty = False
        for a in doc.get("announcements", []):
            if done >= limit or a.get("k") != "audio" or a.get("rec") or a.get("rec_tried") or not a["u"].lower().endswith(".pdf"):
                continue
            done += 1
            a["rec_tried"] = True
            dirty = True
            try:
                r = requests.get(a["u"], headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=60)
                r.raise_for_status()
                text = pdf_text(r.content, max_pages=4).replace("\n", " ")
                links = [l.rstrip(".,;") for l in REC_LINK.findall(text) if not re.search(r"nseindia|bseindia|sebi\.gov|mailto", l, re.I)]
                links.sort(key=lambda l: 0 if re.search(r"youtu|\.mp3|\.m4a|\.mp4|audio|recording|webcast|chorus|vimeo", l, re.I) else 1)
                if links:
                    a["rec"] = links[0]
                    found += 1
            except Exception as e:  # noqa: BLE001
                print(f"{f.stem}: recording link not read ({str(e)[:60]})", file=sys.stderr)
        if dirty:
            f.write_text(json.dumps(doc, separators=(",", ":")))
    if done:
        print(f"Recording links: {found} found in {done} notices")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max", type=int, default=60, help="transcripts and presentations to process per run (default 60)")
    ap.add_argument("--max-ar", type=int, default=15, help="annual reports to process per run (default 15)")
    args = ap.parse_args(argv)
    import requests
    from exchange import UA

    def pending(notes, u, kind=None):
        n = notes.get(u)
        if n is None or (n.get("failed") and n.get("tries", 0) < 3):
            return True
        # transcripts summarised before guidance tracking existed are processed again once
        return kind == "transcript" and not n.get("failed") and n.get("v", 1) < NOTE_VERSION

    todo, ars = [], []
    for f in sorted(FILINGS.glob("*.json")):
        if f.name == "latest.json":
            continue
        doc = json.loads(f.read_text())
        notes = doc.get("notes") or {}
        for a in doc.get("announcements", []):
            if a.get("k") in ("transcript", "ppt") and not a["u"].lower().endswith(".xml") and pending(notes, a["u"], a.get("k")):
                todo.append((a["d"], f, a["u"], a["k"]))
        # latest annual report only: from the annual-report list, else a Reg. 34 announcement
        reps = sorted(doc.get("annualReports", []), key=lambda r: r.get("y", ""), reverse=True)
        cand = [(r.get("y", ""), r["u"]) for r in reps[:1]]
        for a in doc.get("announcements", []):
            if re.search(r"annual report", a.get("t", "") + " " + a.get("c", ""), re.I) and a["u"].lower().endswith(".pdf"):
                cand.append((fiscal_year(a["d"]), a["u"]))
                break
        cand.sort(reverse=True)
        if cand and pending(notes, cand[0][1]):
            ars.append((cand[0][0], f, cand[0][1], "ar"))
    todo.sort(key=lambda t: t[0], reverse=True)   # newest first
    find_recordings(requests, UA)
    filing_details(requests, UA)
    ars.sort(key=lambda t: t[0], reverse=True)
    work = todo[:args.max] + ars[:args.max_ar]
    done = failed = 0
    for d, f, url, kind in work:
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=90)
            r.raise_for_status()
            if kind == "ar":
                text = pdf_text(r.content, max_pages=80, max_chars=400000)
                note = summarize(text, per_topic=3)
            elif kind == "ppt":
                text = pdf_text(r.content)
                note = summarize_ppt(text)
            else:
                text = pdf_text(r.content)
                note = summarize(text)
                note["guidance"] = extract_guidance(text, d)
            if len(text.split()) < (80 if kind == "ppt" else 300):
                raise ValueError("too little text (scanned PDF?)")
            if not note["sections"]:
                raise ValueError("nothing to summarise")
            note["d"], note["kind"], note["v"] = d, kind, NOTE_VERSION
            doc = json.loads(f.read_text())
            doc.setdefault("notes", {})[url] = note
            f.write_text(json.dumps(doc, separators=(",", ":")))
            done += 1
            print(f"{f.stem}: {kind} {d[:10]} {note['tone']}, {sum(len(v) for v in note['sections'].values())} points")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"{f.stem}: {kind} {url} failed ({e})", file=sys.stderr)
            doc = json.loads(f.read_text())
            prev = (doc.get("notes") or {}).get(url) or {}
            doc.setdefault("notes", {})[url] = {"failed": str(e)[:120], "tries": prev.get("tries", 0) + 1, "d": d, "kind": kind}
            f.write_text(json.dumps(doc, separators=(",", ":")))
    left = max(0, len(todo) - args.max) + max(0, len(ars) - args.max_ar)
    print(f"AI summaries: {done} written, {failed} failed, {left} left for later runs")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
