#!/usr/bin/env python3
"""Free, rule-based concall summaries.

For every earnings-call transcript listed in data/filings/<SYMBOL>.json, download the PDF,
extract its text and write an extractive summary back into the same file under "notes":

    "notes": { "<transcript url>": { "d": date, "tone": "Positive", "sections": { "Guidance & outlook": [...], ... } } }

No AI service is used: sentences are scored by topic keywords, numbers and position (prepared
remarks before the Q&A), boilerplate is dropped, and the best sentences per topic are kept in
the order they were spoken. Only new transcripts are processed (--max per run).

    pip install pypdf requests
    python scripts/summarize_concalls.py --max 60
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


def pdf_text(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max", type=int, default=60, help="transcripts to process per run (default 60)")
    args = ap.parse_args(argv)
    import requests
    from exchange import UA

    todo = []
    for f in sorted(FILINGS.glob("*.json")):
        if f.name == "latest.json":
            continue
        doc = json.loads(f.read_text())
        notes = doc.get("notes") or {}
        for a in doc.get("announcements", []):
            n = notes.get(a["u"])
            if a.get("k") == "transcript" and (n is None or (n.get("failed") and n.get("tries", 0) < 3)):
                todo.append((a["d"], f, a))
    todo.sort(key=lambda t: t[0], reverse=True)   # newest calls first
    done = failed = 0
    for d, f, a in todo[:args.max]:
        try:
            r = requests.get(a["u"], headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=60)
            r.raise_for_status()
            text = pdf_text(r.content)
            if len(text.split()) < 300:
                raise ValueError("too little text (scanned PDF?)")
            note = summarize(text)
            note["d"] = a["d"]
            doc = json.loads(f.read_text())
            doc.setdefault("notes", {})[a["u"]] = note
            f.write_text(json.dumps(doc, separators=(",", ":")))
            done += 1
            print(f"{f.stem}: {a['d'][:10]} {note['tone']}, {sum(len(v) for v in note['sections'].values())} points")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"{f.stem}: {a['u']} failed ({e})", file=sys.stderr)
            doc = json.loads(f.read_text())
            prev = (doc.get("notes") or {}).get(a["u"]) or {}
            doc.setdefault("notes", {})[a["u"]] = {"failed": str(e)[:120], "tries": prev.get("tries", 0) + 1, "d": a["d"]}
            f.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"Concall summaries: {done} written, {failed} failed, {max(0, len(todo) - args.max)} left for later runs")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
