"""Read an Indian credit rating letter or disclosure: agency, rating, outlook, action, instrument, amount.

    rating_details(text, title="")  ->  {"ag": "CRISIL", "rt": "AA+", "ol": "Stable", "act": "upgrade",
                                         "from": "AA", "ins": "Long-term bank facilities", "ramt": 1500.0,
                                         "term": "long"}

Only the fields that could be read are returned. "act" is one of upgrade, downgrade, reaffirm,
assign, withdraw, outlook_up, outlook_down, watch. Ratings are returned without the agency prefix
("AA+", "A1+") so they compare across agencies; rank() orders them (lower is better).
"""
import re

AGENCIES = [
    ("CRISIL", r"\bcrisil\b"),
    ("ICRA", r"\bicra\b"),
    ("CARE", r"\bcare\s*(?:ratings|edge|limited|ltd|\b)"),
    ("India Ratings", r"india ratings|\bind[- ]?ra\b|\bfitch\b"),
    ("Acuite", r"acuit[eé]"),
    ("Brickwork", r"brickwork|\bbwr\b"),
    ("Infomerics", r"infomerics|\bivr\b"),
    ("Moody's", r"moody'?s"),
    ("S&P", r"s\s*&\s*p global|standard\s*&\s*poor"),
]
# prefixes each agency puts in front of the rating symbol
PREFIX = r"(?:crisil|\[icra\]|icra|care|ind|acuite|acuité|bwr|ivr|provisional\s+crisil|pp-mld\s*\[icra\]|crisil\s+pp-mld)"
LONG = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "C+", "C", "C-", "D"]
SHORT = ["A1+", "A1", "A2+", "A2", "A3+", "A3", "A4+", "A4", "D"]
SYM = r"(A1\+|A1|A2\+|A2|A3\+|A3|A4\+|A4|AAA|AA\+|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|B|C\+|C-|C|D)(?![A-Za-z0-9+\-])"
RATING = re.compile(PREFIX + r"\s*\]?\s*" + SYM + r"(?:\s*\((?:ce|so|cso)\))?\s*(?:[/;,(]\s*|\s+)?(stable|positive|negative|developing)?", re.I)
WATCH = re.compile(r"rating watch|credit watch|watch with (negative|positive|developing) implications", re.I)
ACTIONS = [
    ("upgrade", r"upgrad|revised upward|rating (?:has been |was )?raised|enhanced from"),
    ("downgrade", r"downgrad|revised downward|rating (?:has been |was )?lowered"),
    ("withdraw", r"(?:rating|ratings)\s+(?:has|have)\s+been\s+withdrawn|withdr[ae]wn? (?:its |the )?(?:credit )?ratings?|withdrawal of (?:the |its )?(?:credit )?ratings?|request for withdrawal|discontinu\w+ (?:of )?(?:the )?(?:credit )?rating"),
    ("outlook_up", r"outlook (?:has been )?revised (?:to|from \w+ to) positive|revised the outlook to positive"),
    ("outlook_down", r"outlook (?:has been )?revised (?:to|from \w+ to) negative|revised the outlook to negative"),
    ("assign", r"\bassign|\bnew rating|rated for the first time"),
    ("reaffirm", r"reaffirm|re-affirm|\baffirm|retain|continues? to be|maintained|unchanged|no change"),
]
INSTRUMENTS = [
    ("Commercial paper", r"commercial paper|\bcp\b"),
    ("NCDs / bonds", r"non[- ]convertible debenture|\bncds?\b|bonds?\b|debenture"),
    ("Fixed deposits", r"fixed deposit|\bfd\b"),
    ("Long-term bank facilities", r"long[- ]term bank|long[- ]term (?:loan|facilit)|term loan|fund[- ]based"),
    ("Short-term bank facilities", r"short[- ]term bank|short[- ]term facilit|non[- ]fund[- ]based"),
    ("Bank facilities", r"bank (?:loan )?facilit|bank loans?"),
    ("Issuer rating", r"issuer rating|corporate credit rating"),
]
AMT = re.compile(r"(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|million|mn\b|billion|bn\b)?", re.I)
NOT_CREDIT = re.compile(r"\besg\b|sustainability rating|monitoring agency|grading of|star rating|mutual fund|fund rating|green rating", re.I)


def rank(sym):
    """Position on the long- or short-term scale (0 is the best); None if unknown."""
    s = (sym or "").upper()
    if s in SHORT and s.startswith("A") and len(s) >= 2 and s[1].isdigit():
        return 100 + SHORT.index(s)
    return LONG.index(s) if s in LONG else None


def _agency(text):
    best = None
    for name, rx in AGENCIES:
        m = re.search(rx, text, re.I)
        if m and (best is None or m.start() < best[1]):
            best = (name, m.start())
    return best[0] if best else None


def _normalise(t):
    t = re.sub(r"\s+", " ", t)
    # PDF text often splits words and symbols: "upgrade d", "AA -/Stable", "Cris il"
    t = re.sub(r"\b(upgrade|downgrade|reaffirme|assigne|withdraw|revise)\s+d\b", r"\1d", t, flags=re.I)
    t = re.sub(r"\b(Cris)\s+(il)\b", r"\1\2", t, flags=re.I)
    t = re.sub("(" + PREFIX + r")\s*\]?\s*(AAA|AA|A|BBB|BB|B|C)\s+([+\-])(?=\s*[/;,(|\s])", r"\1 \2\3", t, flags=re.I)
    return t


OUTLOOK_ORDER = {"negative": 0, "developing": 1, "stable": 1, "positive": 2}


# rating rationales end with what could move the rating ("factors that could lead to an upgrade /
# downgrade"): those words are not the action taken, so the action is read from the text before them
SENSITIVITY = re.compile(r"rating sensitivit|factors that could (?:individually or collectively )?lead|could lead to (?:positive|negative) rating action|what could change the rating|positive factors|negative factors|key rating drivers|detailed rationale|analytical approach", re.I)


def rating_details(text, title=""):
    flat = _normalise((title or "") + " . " + (text or ""))
    cut = SENSITIVITY.search(flat)
    body = flat[:cut.start()] if cut and cut.start() > 60 else flat
    out = {}
    first = RATING.search(flat)
    esg = re.search(r"\bESG\b|sustainability rating|environmental, social", flat, re.I)
    if (esg and (not first or esg.start() < first.start())) or (NOT_CREDIT.search(flat[:1500]) and not first):
        return {"skip": 1}
    # ratings of a subsidiary, disclosed by the listed parent
    subj = flat[:2500]
    if re.search(r"(?:of|to)\s+(?:its\s+|our\s+)?(?:material\s+|wholly[- ]owned\s+|step[- ]down\s+)*subsidiar|,\s*(?:a\s+)?(?:material\s+)?(?:wholly[- ]owned\s+)?subsidiary", subj, re.I):
        out["sub"] = 1
    ag = _agency(flat)
    if ag:
        out["ag"] = ag
    found = []
    for m in RATING.finditer(flat):
        sym = m.group(1).upper()
        ctx = flat[max(0, m.start() - 160):m.end() + 60].lower()
        found.append((m.start(), sym, (m.group(2) or "").title(), ctx))
    # prefer long-term ratings for the headline; keep the short-term one as well
    longs = [f for f in found if rank(f[1]) is not None and rank(f[1]) < 100]
    shorts = [f for f in found if rank(f[1]) is not None and rank(f[1]) >= 100]
    head = longs[0] if longs else shorts[0] if shorts else None
    # "upgraded to AA from AA-": the first symbol after "to", the one after "from" is the old rating
    m = re.search(r"(?:upgraded|downgraded|revised)\s+(?:to\s+)?" + r"(?:" + PREFIX + r")?\s*\]?\s*" + SYM + r".{0,80}?from\s+['\"‘“]?(?:" + PREFIX + r")?\s*\]?\s*" + SYM, flat, re.I)
    up_to = re.search(r"(upgraded|downgraded|revised)\s+to\s+['\"‘“]?(?:" + PREFIX + r")?\s*\]?\s*" + SYM, flat, re.I)
    if m:
        out["rt"], out["from"] = m.group(1).upper(), m.group(2).upper()
    elif up_to:
        out["rt"] = up_to.group(2).upper()
        prev = [f for f in found if f[0] < up_to.start() and up_to.start() - f[0] < 120]
        if prev and prev[-1][1] != out["rt"]:
            out["from"] = prev[-1][1]
    elif head:
        out["rt"] = head[1]
        m2 = re.search(r"from\s+['\"‘“]?(?:" + PREFIX + r")\s*\]?\s*" + SYM, flat[head[0]:head[0] + 300], re.I)
        if m2 and m2.group(1).upper() != head[1]:
            out["from"] = m2.group(1).upper()
    if head and head[2]:
        out["ol"] = head[2]
    if not out.get("rt"):
        # "Corporate Credit Rating (CCR) of the Company as AA-", "rated A+"
        m3 = re.search(r"(?:credit rating|\bccr\b|rating)[^.]{0,60}?\b(?:as|at|of)\s+['\"‘“]?" + SYM + r"['\"’”]?", flat, re.I)
        if m3:
            out["rt"] = m3.group(1).upper()
    if shorts and longs:
        out["st"] = shorts[0][1]
    if out.get("rt"):
        out["term"] = "short" if (rank(out["rt"]) or 0) >= 100 else "long"
    # action: explicit words first (title counts most), then infer from the old and new rating
    act = None
    for scope in ((title or "") + " " + body[:1500], body):
        for name, rx in ACTIONS:
            if re.search(rx, scope, re.I):
                act = name
                break
        if act:
            break
    if out.get("from") and out.get("rt") and (rank(out["from"]) is None or rank(out["rt"]) is None or (rank(out["from"]) >= 100) != (rank(out["rt"]) >= 100)):
        out.pop("from")
    if out.get("from") and out.get("rt") and rank(out["from"]) is not None and rank(out["rt"]) is not None:
        a, b = rank(out["from"]), rank(out["rt"])
        if (a >= 100) == (b >= 100) and a != b:
            act = "upgrade" if b < a else "downgrade"
    ol = re.search(r"outlook\s+(?:has been\s+)?revised\s+(?:to\s+['\"‘“]?(\w+)['\"’”]?\s+from\s+['\"‘“]?(\w+)|from\s+['\"‘“]?(\w+)['\"’”]?\s+to\s+['\"‘“]?(\w+))|revised (?:its |the |rating )?outlook\s+(?:on [^.]{0,60}?)?to\s+['\"‘“]?(\w+)['\"’”]?\s+from\s+['\"‘“]?(\w+)", flat, re.I)
    ol2 = None if ol else re.search(r"outlook\s+(?:has been\s+)?revised\s+from\s+['\"‘“]?(\w+)", flat, re.I)
    if ol2 and head and head[2]:
        a, b = OUTLOOK_ORDER.get(ol2.group(1).lower()), OUTLOOK_ORDER.get(head[2].lower())
        if a is not None and b is not None and a != b and not out.get("from"):
            act = "outlook_up" if b > a else "outlook_down"
    if ol and (act in (None, "reaffirm", "assign") or (act in ("upgrade", "downgrade") and not out.get("from"))):
        g = ol.groups()
        new, old = (g[0], g[1]) if g[0] else (g[3], g[2]) if g[2] else (g[4], g[5])
        a, b = OUTLOOK_ORDER.get((old or "").lower()), OUTLOOK_ORDER.get((new or "").lower())
        if a is not None and b is not None and a != b:
            act = "outlook_up" if b > a else "outlook_down"
            out["ol"] = new.title()
    if act in (None, "reaffirm", "assign") and WATCH.search(body):
        act = "watch"
    if act:
        out["act"] = act
    # a rating needs an agency; symbols without one are something else (a note, a grade, a table)
    if not out.get("ag"):
        out.pop("rt", None); out.pop("from", None); out.pop("st", None); out.pop("term", None)
        if out.get("act") != "withdraw":
            out.pop("act", None)
    hits = []
    for name, rx in INSTRUMENTS:
        for m in re.finditer(rx, flat, re.I):
            hits.append((m.start(), name))
    if hits:
        hp = head[0] if head else len(flat)
        before = [h for h in hits if h[0] <= hp]
        out["ins"] = (max(before) if before else min(hits))[1]
    best = None
    for m in AMT.finditer(flat):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        u = (m.group(2) or "").lower()
        cr = v if u.startswith("cr") else v / 100 if u.startswith(("lakh", "lac")) else v / 10 if u.startswith(("million", "mn")) else v * 100 if u.startswith(("billion", "bn")) else None
        if cr and 0.5 <= cr <= 500000 and (best is None or cr > best):
            best = cr
    if best:
        out["ramt"] = round(best, 2)
    return out
