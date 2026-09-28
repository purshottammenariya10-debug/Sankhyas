"""Forensic read of an annual report: what a CA looks at before trusting the numbers.

    forensics(pages)  ->  {"auditor": "B S R & Co. LLP", "opinion": "Unmodified" | "Qualified" | "Adverse" | "Disclaimer",
                           "opinion_on": "consolidated", "flags": [{"sev", "t", "x", "p"}], "facts": [{"t", "v", "p"}]}

pages is the list of page texts (page 1 first). Every finding carries the page it was read from, so
the site can link straight to it (PDF #page=N). Rule-based: nothing is sent to an AI service.

What is checked:
  - the independent auditor's report: qualified / adverse opinion or disclaimer, material uncertainty
    about going concern, emphasis-of-matter paragraphs
  - the CARO annexure (Companies (Auditor's Report) Order): defaults to lenders, fraud, delays in
    paying statutory dues, cash losses, short-term funds used long-term, auditor resignation
  - the directors' report: resignation of the statutory auditor, the audit firm
  - notes: contingent liabilities (total), changes in accounting policy
  - Rule 5(1) disclosure: highest pay as a multiple of the median employee
"""
import re

WS = re.compile(r"\s+")
NEG = re.compile(r"\b(?:no|not|nil|none|neither|nor|never|without)\b|n\.a\.|not applicable", re.I)


def _flat(p):
    return WS.sub(" ", p or "")


def _clip(s, n=320):
    s = s.strip(" .;:-")
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def _sentences(text):
    return re.split(r"(?<=[.;])\s+(?=[A-Z(\[])|\s(?=\((?:[a-z]|[ivx]+)\)\s)", text)


# ---------- independent auditor's report ----------
AUDIT_PAGE = re.compile(r"Basis for (?:Qualified |Adverse )?Opinion|Basis for Disclaimer|Independent Auditor.{0,3}s Report|Report on the Audit of the", re.I)


def _audit_pages(pages):
    """Pages of the auditor's reports: a page with a report heading and the four pages after it."""
    marks = set()
    for i, p in enumerate(pages):
        if AUDIT_PAGE.search(p) and not re.search(r"assurance engagement|ISAE 3000|BRSR|reasonable assurance on the", p, re.I):
            marks.update(range(i, min(len(pages), i + 5)))
    return sorted(marks)


def _which(f, pos):
    """Standalone or consolidated report, from the words before the heading."""
    before = f[max(0, pos - 600):pos + 400].lower()
    return "consolidated" if "consolidated" in before else "standalone"


def _key(txt):
    t = re.sub(r"\b(standalone|consolidated|ind as|note(s)? no\.?\s*[\d.()a-z]+)\b", "", txt.lower())
    return re.sub(r"[^a-z]", "", t)[:90]


def auditor_report(pages):
    out = {"opinion": None, "opinion_on": None, "flags": []}
    seen = set()
    for i in _audit_pages(pages):
        f = _flat(pages[i])
        for m in re.finditer(r"\b(Qualified|Adverse) Opinion\b|\bDisclaimer of Opinion\b", f):
            kind = "Disclaimer" if m.group(0).startswith("Disclaimer") else m.group(1)
            # "basis for qualified opinion" in the reporting paragraphs repeats the heading: take the first
            if re.search(r"except for the (?:matters?|effects?) described in the basis for", f[max(0, m.start() - 120):m.start()], re.I):
                continue
            on = _which(f, m.start())
            if out["opinion"] in (None, "Unmodified") or (out["opinion"] == "Qualified" and kind != "Qualified"):
                out["opinion"], out["opinion_on"] = kind, on
            key = "op" + on
            if key in seen:
                continue
            seen.add(key)
            basis = re.search(r"Basis for (?:Qualified |Adverse )?(?:Opinion|Disclaimer of Opinion)\s*(?:\d+\.\s*)?(.{40,700})", f)
            title = ("Auditor could not give an opinion (disclaimer)" if kind == "Disclaimer" else "Auditor gave a " + kind.lower() + " opinion") + " on the " + on + " accounts"
            out["flags"].append({"sev": "high", "t": title, "x": _clip(basis.group(1) if basis else f[m.end():m.end() + 500]), "p": i + 1})
        if out["opinion"] is None and re.search(r"\bOpinion\b.{0,600}true and fair view", f):
            out["opinion"] = "Unmodified"
        gc = re.search(r"Material Uncertainty (?:Related|Relating) to Going Concern\s*(.{40,600})", f, re.I) or \
            re.search(r"((?:[^.]{0,300})material uncertainty exists that may cast significant doubt on the (?:Company|Group|Bank).{0,5}s ability to continue as a going concern[^.]{0,200})", f, re.I)
        if gc and "gc" not in seen:
            seen.add("gc")
            out["flags"].append({"sev": "high", "t": "Doubt over its ability to continue as a going concern", "x": _clip(gc.group(1)), "p": i + 1})
        for em in re.finditer(r"Emphasis of Matters?(?: Paragraph)?\s*(?:\d+\.\s*)?(.{60,700}?)(?=Our (?:opinion|conclusion) is not (?:modified|qualified)|Key Audit Matters?|Other Matters?|Information Other than|$)", f, re.I):
            txt = re.sub(r"^(?:Without qualifying our (?:opinion|report),?\s*)?", "", em.group(1).strip(), flags=re.I)
            k = _key(txt)
            if not k or k[:60] in seen or len([x for x in out["flags"] if x["t"].startswith("Auditor drew attention")]) >= 3:
                continue
            seen.add(k[:60])
            out["flags"].append({"sev": "medium", "t": "Auditor drew attention to a matter (emphasis of matter)", "x": _clip(txt, 300), "p": i + 1})
    return out


def audit_firm(pages):
    """The statutory audit firm(s): from the auditor's report signature, else the directors' report."""
    rx = re.compile(r"((?:M/s\.?\s*)?[A-Z][A-Za-z&.,'’\- ]{2,70}?)\s*,?\s*Chartered Accountants\s*,?\s*(?:[A-Z][a-z]+\s*,?\s*)?\(?\s*(?:ICAI\s+)?Firm.{0,3}s?\s*Reg", re.S)
    def clean(n):
        n = re.split(r"\bM/s\.?\s*|\b(?:of|by|namely|appointment|re-appointment|approved|that)\s+(?=[A-Z])", n)[-1]
        n = re.sub(r"^(?:For|and on behalf of|For and on behalf of)\s+", "", n.strip(" ,.("), flags=re.I)
        return WS.sub(" ", n).strip(" ,.")
    for want in (_audit_pages(pages), range(len(pages))):
        for i in want:
            f = _flat(pages[i])
            if want is not None and not re.search(r"statutory auditor|independent auditor|auditor.{0,3}s report|joint auditor", f, re.I):
                continue
            firms = []
            for m in rx.finditer(f):
                n = clean(m.group(1))
                if 3 <= len(n) <= 60 and n not in firms and not re.search(r"cost|secretar", n, re.I):
                    firms.append(n)
            if firms:
                joint = len(firms) > 1 and re.search(r"joint (?:statutory )?auditors", f, re.I)
                return (" and ".join(firms[:2]) if joint else firms[0]), i + 1
    return None, None


# ---------- CARO annexure ----------
CARO_RULES = [
    ("high", "Defaulted on loans or interest (CARO)", r"(?:has|have) defaulted in (?:the )?repayment|wilful defaulter"),
    ("high", "Fraud noticed or reported (CARO)", r"fraud (?:by|on) the company (?:has|have) been noticed|fraud .{0,60}(?:has been|was|were|have been) (?:noticed|reported)"),
    ("medium", "Delays in paying statutory dues (CARO)", r"there (?:are|were|have been) (?:significant |serious |considerable )?delays in (?:depositing|amounts deposited|deposit)|(?:not|has not been|have not been) regular in depositing|arrears of (?:undisputed )?statutory dues .{0,80}(?:outstanding|more than six months)"),
    ("low", "Some delays in paying statutory dues (CARO)", r"except for (?:slight |minor |some )?delays"),
    ("medium", "Short-term funds used for long-term purposes (CARO)", r"funds raised on short[- ]term basis (?:have|has) been (?:utili[sz]ed|used) for long[- ]term"),
    ("medium", "Cash losses (CARO)", r"(?:has|have) incurred (?:a )?cash loss(?:es)? (?:of|amounting)"),
]


def caro(pages):
    idx = set()
    for i, p in enumerate(pages):
        if re.search(r"\(Auditor.{0,3}s Report\) Order|clause 3\s*\(|paragraph 3\s*\(", p):
            idx.update((i, i + 1))
    flags = []
    for i in sorted(x for x in idx if x < len(pages)):
        f = _flat(pages[i])
        for sent in _sentences(f):
            for sev, title, rx in CARO_RULES:
                if any(x["t"] == title for x in flags):
                    continue
                m = re.search(rx, sent, re.I)
                if not m:
                    continue
                window = sent[max(0, m.start() - 70):m.end()]
                if not title.startswith(("Delays", "Some delays")) and NEG.search(window):
                    continue
                if title == "Cash losses (CARO)" and re.search(r"not incurred", sent, re.I) and not re.search(r"(?:has|have) incurred (?:a )?cash loss(?:es)? (?:of|amounting)[^.]{0,40}(?:current|during the year)", sent, re.I):
                    continue
                flags.append({"sev": sev, "t": title, "x": _clip(sent, 300), "p": i + 1})
    if any(x["t"].startswith("Delays") for x in flags):
        flags = [x for x in flags if not x["t"].startswith("Some delays")]
    return flags


# ---------- directors' report ----------
def auditor_resignation(pages):
    for i, p in enumerate(pages):
        f = _flat(p)
        for sent in _sentences(f):
            if re.search(r"statutory auditor", sent, re.I) and re.search(r"tendered (?:their|his|its) resignation|have resigned|has resigned|resigned as", sent, re.I) \
                    and not re.search(r"\bno resignation\b|has been no|there (?:was|were|has been) no", sent, re.I) and len(sent) < 600:
                return [{"sev": "medium", "t": "Statutory auditor resigned", "x": _clip(sent, 300), "p": i + 1}]
    return []


# ---------- notes ----------
UNIT = re.compile(r"(?:`|₹|rs\.?|inr)\s*(?:in\s*)?(crores?|lakhs?|lacs?|millions?)\b|\(\s*(?:`|₹|rs\.?|inr)?\s*in\s*(crores?|lakhs?|lacs?|millions?)\s*\)|(?:all )?amounts? (?:are )?in\s*(?:`|₹|rs\.?|inr)?\s*(crores?|lakhs?|lacs?|millions?)", re.I)


def _to_cr(v, unit):
    u = (unit or "").lower()
    return v if u.startswith("cr") else v / 100 if u.startswith(("lakh", "lac")) else v / 10 if u.startswith("million") else None


def contingent(pages):
    """Total contingent liabilities from the notes; the last one found is the consolidated note."""
    best = None
    for i, p in enumerate(pages):
        f = _flat(p)
        for m in re.finditer(r"Contingent liabilit(?:y|ies)(?: and commitments)?(?: \(to the extent not provided for\))?|contingently liable", f, re.I):
            seg = f[m.start():m.start() + 1800]
            if not re.search(r"not acknowledged as debts?|guarantees?|disputed|demands?", seg[:900], re.I):
                continue
            tot = re.search(r"\bTotal\b\s*(?:\(\s*[A-Z](?:\s*\+\s*[A-Z])*\s*\))?\s*([\d,]+\.\d{1,2}|[\d,]{2,})", seg)
            if not tot:
                continue
            um = UNIT.search(f[max(0, m.start() - 1500):m.start() + 400]) or UNIT.search(f)
            if not um:
                continue
            try:
                v = _to_cr(float(tot.group(1).replace(",", "")), next(g for g in um.groups() if g))
            except (ValueError, StopIteration):
                continue
            if v and v > 0:
                best = {"t": "Contingent liabilities", "v": round(v, 2), "p": i + 1}
            break
    return best


def policy_changes(pages):
    for i, p in enumerate(pages):
        f = _flat(p)
        for sent in _sentences(f):
            if re.search(r"(?:voluntary |has )?change(?:d)? (?:in|its) (?:the )?(?:accounting polic(?:y|ies) (?:for|in respect of|relating to)|method of (?:depreciation|inventory valuation|revenue recognition))", sent, re.I) \
                    and not re.search(r"\bno\b|\bnot\b|there (?:were|was|has been|have been) no|ind as 8|changes in accounting estimates and errors", sent, re.I) and 40 < len(sent) < 450:
                return [{"sev": "low", "t": "Changed an accounting policy", "x": _clip(sent, 280), "p": i + 1}]
    return []


# ---------- Rule 5(1): pay vs the median employee ----------
TITLES = r"(?:Chairman|Chairperson|Managing Director|Executive Director|Director|Whole[- ]time Director|Vice Chairman|CEO|CFO|Chief Executive Officer|Chief Financial Officer|Company Secretary|Non[- ]Executive|Independent|and|&|-|–|,|\(|\))"


def _name_before(seg, pos):
    """The person named just before a figure: the last run of capitalised words, titles removed."""
    back = seg[max(0, pos - 110):pos]
    back = re.split(r"\d(?:\.\d+)?\s*:\s*1\b|\d+\.\d+|%", back)[-1]
    back = re.sub(r"\b" + TITLES + r"\b|\bMr\.?|\bMs\.?|\bMrs\.?|\bShri\b|\bSh\.|\bSmt\.?|\bDr\.?", " ", back)
    words = re.findall(r"[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3}", back)
    name = words[-1] if words else ""
    name = re.sub(r"\d+$", "", name).strip(" .")
    return name if 3 <= len(name) <= 40 and not re.search(r"^(Name|Designation|Ratio|Executive|Directors?|Non|Sr|No)$", name) else ""


def remuneration(pages):
    for i, p in enumerate(pages):
        f = _flat(p)
        m = re.search(r"ratio of (?:the )?remuneration of each (?:director|director\s*/\s*kmp)[^.]{0,40}?(?:to|with) the (?:employee.{0,3}s )?median", f, re.I)
        if not m:
            continue
        seg = f[m.end():m.end() + 2200]
        stop = re.search(r"percentage increase in the median|\(ii\)|\bii\)|2\s*\.?\s*The percentage", seg, re.I)
        if stop and stop.start() > 200:
            seg = seg[:stop.start()]
        ratios = [(float(r.group(1)), r.start()) for r in re.finditer(r"(?<![\d.])(\d{1,4}(?:\.\d{1,2})?)\s*:\s*1\b", seg)]
        if not ratios and not re.search(r"\(in lacs\)|\(in lakhs\)|amount in|remuneration of directors?/? ?kmp for|\(₹|\(`|\(rs", seg, re.I):
            # "Name  Ratio  % increase" tables: the first number after each name is the ratio
            ratios = [(float(r.group(2)), r.start(2)) for r in re.finditer(r"([A-Za-z)])\s+(\d{1,4}(?:\.\d{1,2})?)\b(?!\s*%)", seg)]
        ratios = [x for x in ratios if 1 <= x[0] <= 3000]
        if not ratios:
            continue
        v, pos = max(ratios)
        name = _name_before(seg, pos)
        return {"t": "Highest pay vs median employee", "v": f"{v:g}x" + (f" ({name})" if name else ""), "n": v, "p": i + 1}
    return None


def forensics(pages):
    a = auditor_report(pages)
    flags = a["flags"] + caro(pages) + auditor_resignation(pages) + policy_changes(pages)
    facts = []
    firm, fp = audit_firm(pages)
    if firm:
        facts.append({"t": "Statutory auditor", "v": firm, "p": fp})
    if a["opinion"]:
        facts.append({"t": "Audit opinion", "v": a["opinion"] + (" (" + a["opinion_on"] + ")" if a["opinion_on"] else "")})
    r = remuneration(pages)
    if r:
        facts.append(r)
    c = contingent(pages)
    if c:
        facts.append(c)
    order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda x: order[x["sev"]])
    return {"auditor": firm, "opinion": a["opinion"], "opinion_on": a["opinion_on"], "flags": flags[:10], "facts": facts, "pages": len(pages)}
