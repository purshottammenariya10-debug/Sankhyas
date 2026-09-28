#!/usr/bin/env python3
"""IPO research notes: a one-page digest of each open or upcoming mainboard IPO's red herring prospectus.

    data/yahoo/ipo_notes/<SYMBOL>.json   one note per issue (the site's #/ipo/<SYMBOL> page)
    data/yahoo/ipo.json                  issues with a note get "note": 1

Reads two documents NSE publishes with every issue (links stored by scripts/fetch_ipo.py):
  - the red herring prospectus (RHP zip): business, key performance indicators (revenue, EBITDA,
    profit, ROCE, debt), EPS and the industry P/E, listed peers, objects of the issue, contingent
    liabilities, auditor qualifications, risk factors
  - the price band advertisement (RATIOS zip): fresh issue vs offer for sale, what the selling
    shareholders paid per share, promoter holding before and after, the lead managers' past record,
    post-issue market cap

Rule-based text reading (pypdf); nothing is sent to an AI service. Every figure carries the RHP
page it was read from. Facts only: no view on whether to apply.

    python scripts/ipo_notes.py [--max 6] [--sym SYMBOL] [--debug]
"""
import argparse
import datetime as dt
import io
import json
import logging
import re
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
IPO = ROOT / "data" / "yahoo" / "ipo.json"
NOTES = ROOT / "data" / "yahoo" / "ipo_notes"
VERSION = 1
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Referer": "https://www.nseindia.com/"}
DEBUG = False
logging.getLogger("pypdf").setLevel(logging.ERROR)

WS = re.compile(r"[ \t ]+")
NUM = r"\(?-?[\d,]*\d(?:\.\d+)?\)?"


def dbg(*a):
    if DEBUG:
        print("   ·", *a, file=sys.stderr)


# ---------- documents ----------
def pdfs_in_zip(url, skip=r"GID|General.?Information|abridged"):
    """(name, bytes) of each PDF inside an NSE zip, largest first; the general information document is left out."""
    r = requests.get(url, headers=UA, timeout=240)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    files = [i for i in z.infolist() if i.filename.lower().endswith(".pdf") and not re.search(skip, Path(i.filename).name, re.I)]
    files.sort(key=lambda i: -i.file_size)
    return [(i.filename, z.read(i)) for i in files]


def pdf_pages(data, max_pages=None):
    from pypdf import PdfReader
    rd = PdfReader(io.BytesIO(data))
    out = []
    for i, p in enumerate(rd.pages):
        if max_pages and i >= max_pages:
            break
        try:
            out.append(clean(p.extract_text() or ""))
        except Exception:  # noqa: BLE001
            out.append("")
    return out


def clean(t):
    t = t.replace("`", "₹").replace("₹", "₹").replace("Rs.", "₹").replace("[•]", "[●]").replace("[ ●]", "[●]")
    return "\n".join(WS.sub(" ", l).strip() for l in t.split("\n"))


def flat(t):
    return re.sub(r"\s+", " ", t or "").strip()


def num(s):
    if s is None:
        return None
    s = str(s).strip()
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-")
    s = re.sub(r"[^\d.]", "", s)
    if not s or s == ".":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


UNIT_CR = {"million": 0.1, "mn": 0.1, "lakh": 0.01, "lakhs": 0.01, "lacs": 0.01, "crore": 1.0, "crores": 1.0, "cr": 1.0, "billion": 100.0}


def unit_of(text):
    """The unit a table is stated in, from its header: '₹ in million', '(₹ lakhs)', 'Amount in ₹ crore'."""
    m = re.search(r"(?:₹|INR|Rupees)\s*(?:in\s*)?(million|mn|lakhs?|lacs|crores?|billion)|(?:in|In)\s*(?:₹\s*)?(million|lakhs?|lacs|crores?)\b", text or "")
    if not m:
        return None
    return UNIT_CR[(m.group(1) or m.group(2)).lower()]


def doc_unit(pages):
    """The unit most of the prospectus uses (SME and smaller issues state lakhs, larger ones million)."""
    head = " ".join(pages[:60]).lower()
    c = {u: len(re.findall(r"(?:₹|inr)\s*(?:in\s*)?" + u, head)) for u in ("million", "lakh", "crore")}
    u = max(c, key=c.get)
    return UNIT_CR[u] if c[u] else 0.1


def cr(v, unit):
    return None if v is None or unit is None else round(v * unit, 2)


# ---------- sections ----------
def heading_pages(pages, rx, after=6):
    """Pages that open a section: the heading within the first lines of the page (page numbers and
    running heads come first). The table of contents mentions every heading, so it is skipped."""
    out = []
    for i, p in enumerate(pages):
        if i < after:
            continue
        top = "\n".join([l for l in p.split("\n") if l.strip()][:6])
        if re.search(rx, top, re.M) and not re.search(r"TABLE OF CONTENTS|SECTION [IVX]+\s*[:–-]", top):
            out.append(i)
    return out


def section(pages, rx, n=6, after=6):
    """(start page index, text of n pages from there) of the first section opening with the heading."""
    hits = heading_pages(pages, rx, after)
    if not hits:
        return None, ""
    s = hits[0]
    return s, "\n".join(pages[s:s + n])


def page_of(pages, start, snippet):
    """1-based page of the text snippet, looked for from the section start."""
    if start is None:
        return None
    key = flat(snippet)[:40]
    for i in range(start, min(len(pages), start + 15)):
        if key and key in flat(pages[i]):
            return i + 1
    return start + 1


# ---------- the price band advertisement ----------
def advert(pages):
    t = "\n".join(pages)
    f = flat(t)
    out = {}
    m = re.search(r"PRICE BAND\s*:?\s*₹\s*([\d,.]+)\s*TO\s*₹\s*([\d,.]+)", f, re.I)
    if m:
        out["band"] = [num(m.group(1)), num(m.group(2))]
    m = re.search(r"P/?E\)?[^.]{0,120}?UPPER END OF THE PRICE BAND IS\s*([\d.]+)\s*TIMES.{0,160}?INDUSTRY PEER GROUP P/?E RATIO OF\s*([\d.]+)", f, re.I)
    if m:
        out["pe_upper"], out["ind_pe"] = num(m.group(1)), num(m.group(2))
    m = re.search(r"WEIGHTED AVERAGE RETURN ON NET ?WORTH[^.]{0,80}?IS\s*([\d.]+)\s*%", f, re.I)
    if m:
        out["ronw_w"] = num(m.group(1))
    m = re.search(r"Post[- ]Offer market capitali[sz]ation of the Company\s*(" + NUM + r")\s+(" + NUM + ")", f, re.I)
    if m:
        out["mcap"] = num(m.group(2))            # at the cap price, in the unit of the table
        out["mcap_unit"] = unit_of(f[max(0, m.start() - 900):m.start()]) or 0.1
    # lead managers' record: "handled 90 public issues in the past three years, out of which 26 issue closed below the offer price on listing date"
    m = re.search(r"handled\s*(\d+)\s*public issues? in the past three years,? out of which\s*(\d+)\s*issues? closed below", f, re.I)
    if m:
        out["brlm_all"] = [int(m.group(1)), int(m.group(2))]
        seg = t[m.end():m.end() + 2500]
        rows = []
        for mm in re.finditer(r"([A-Z][A-Za-z&.,()' -]{3,}?(?:Limited|LLP|Ltd\.?|Private Limited|\)))\s*(?:\([^)]*\)\s*)?(\d{1,3})\s+(\d{1,3})\b", flat(seg)):
            name = re.sub(r"^(?:Name of the BRLMs?|Total Issues|Issues closed below IPO price on listing date|\s)+", "", mm.group(1)).strip(" ,")
            if 3 < len(name) < 90:
                rows.append({"n": name, "total": int(mm.group(2)), "below": int(mm.group(3))})
        if rows:
            out["brlm"] = rows[:6]
    # selling shareholders and their average cost: "Vipul Nagpal Promoter Selling Shareholder Up to [●] ... aggregating up to ₹672.00 million 0.01"
    sellers = []
    for mm in re.finditer(r"(?m)^(.{3,80}?)\s+((?:Promoter|Investor|Other|Individual|Corporate)[A-Za-z ]{0,30}Selling Shareholders?)\s+Up to\s+(.{0,120}?)(?:aggregating up to\s*₹\s*([\d,.]+)\s*(million|lakhs?|crores?))?\s+(" + NUM + r")\s*$", t, re.I):
        amt = num(mm.group(4))
        sellers.append({"n": mm.group(1).strip(), "type": re.sub(r"\s*Selling Shareholders?", "", mm.group(2)).strip(),
                        "cr": cr(amt, UNIT_CR.get((mm.group(5) or "").lower())) if amt else None, "waca": num(mm.group(6))})
    if sellers:
        out["sellers"] = sellers[:15]
    # risk headings: "1) Brand and Reputation risk: ..."
    m = re.search(r"RISKS? TO INVESTORS", t)
    if m:
        heads = []
        for mm in re.finditer(r"(?:^|\s)(\d{1,2})\)\s*([A-Z][^:]{3,170}?)\s*:", flat(t[m.end():m.end() + 60000])):
            if len(heads) < int(mm.group(1)) <= len(heads) + 2:
                heads.append(mm.group(2).strip())
        if heads:
            out["risks"] = heads[:12]
    # fresh issue and offer for sale at the cap price: "Fresh Issue 1,24,03,100 3,200.00 1,17,64,705 3,200.00"
    for key, rx in (("fresh", r"Fresh Issue"), ("ofs", r"Offer for Sale")):
        m = re.search(r"(?m)^" + rx + r"\s+([\d,]+)\s+([\d,.]+)\s+([\d,]+)\s+([\d,.]+)\s*$", t)
        if m:
            out[key + "_cr"] = cr(num(m.group(4)), unit_of(t[max(0, m.start() - 600):m.start()]) or 0.1)
    terms = offer_terms([t])
    for k, v in terms.items():
        out.setdefault(k, v)
    # one-line business description printed in the advertisement
    m = re.search(r"\b(We are (?:a|an|one of|India)[^.]{20,400}\.)", f)
    if m:
        out["about"] = m.group(1)
    return out


# ---------- the prospectus ----------
def offer_terms(pages):
    """Fresh issue and offer for sale amounts, from the cover page or 'The Offer'."""
    f = flat(" ".join(pages[:4]))
    out = {}
    m = re.search(r"FRESH ISSUE OF (?:UP TO )?([\d,]+|\[●\]) EQUITY SHARES.{0,300}?AGGREGATING (?:UP ?TO )?₹\s*([\d,.]+)\s*(MILLION|LAKHS?|LACS|CRORES?)", f, re.I)
    if m:
        out["fresh_cr"] = cr(num(m.group(2)), UNIT_CR[m.group(3).lower()])
        if m.group(1) != "[●]":
            out["fresh_sh"] = int(num(m.group(1)))
    elif re.search(r"FRESH ISSUE OF (?:UP TO )?([\d,]+) EQUITY SHARES", f, re.I):
        out["fresh_sh"] = int(num(re.search(r"FRESH ISSUE OF (?:UP TO )?([\d,]+) EQUITY SHARES", f, re.I).group(1)))
    m = re.search(r"OFFER FOR SALE OF (?:UP TO )?([\d,]+|\[●\]) EQUITY SHARES.{0,300}?AGGREGATING (?:UP ?TO )?₹\s*([\d,.]+)\s*(MILLION|LAKHS?|LACS|CRORES?)", f, re.I)
    if m:
        out["ofs_cr"] = cr(num(m.group(2)), UNIT_CR[m.group(3).lower()])
        if m.group(1) != "[●]":
            out["ofs_sh"] = int(num(m.group(1)))
    else:
        m = re.search(r"OFFER FOR SALE OF (?:UP TO )?([\d,]+) EQUITY SHARES", f, re.I)
        if m:
            out["ofs_sh"] = int(num(m.group(1)))
        elif re.search(r"FRESH ISSUE", f, re.I) and not re.search(r"OFFER FOR SALE", f, re.I):
            out["ofs_cr"] = 0
    promoters = re.search(r"OUR PROMOTERS?\s*:\s*(.{3,300}?)(?=\s*(?:DETAILS OF|INITIAL PUBLIC|PUBLIC OFFER|OFFER OF|$))", f)
    if promoters:
        out["promoters"] = promoters.group(1).strip(" .")
    return out


PERIOD = re.compile(r"(?:(?:three|six|nine|3|6|9)[- ]months?(?: period)? ended\s*\w+\s*\d{1,2},?\s*(\d{4}))|(?:(?:Fiscal|FY|Financial Year)\s*(?:20)?(\d{2,4}))|(?:March\s*31,?\s*(\d{4}))", re.I)


def _periods(header):
    """Period labels in a table header, in order: 'Q1 FY27' for a stub period, 'FY26' for a year."""
    out = []
    for m in PERIOD.finditer(header):
        if m.group(1):
            mon = re.search(r"ended\s*(\w+)", m.group(0), re.I).group(1)[:3].title()
            out.append(mon + " " + m.group(1))
        else:
            y = m.group(2) or m.group(3)
            y = y[-2:]
            out.append("FY" + y)
    return out


KPI_ROWS = [("rev", r"Revenue from (?:operations|contracts)|Total revenue from operations|Revenue\b"), ("ebitda", r"^EBITDA\b|Adjusted EBITDA\b|Operating EBITDA"),
            ("ebitda_m", r"EBITDA Margin"), ("pat", r"Profit(?:/\(loss\))? after tax|Restated profit|^PAT\b|Net profit|Profit for the (?:year|period)"),
            ("pat_m", r"PAT Margin|Net profit margin|Profit after tax margin"), ("roce", r"^RoCE|^ROCE|Return on capital employed"),
            ("roe", r"^RoE|^ROE|Return on (?:average )?equity|RoNW|Return on net ?worth"), ("de", r"(?:Net )?Debt[- /]*(?:to[- ])?Equity"),
            ("nwc", r"Net Working Capital Days|Working capital days")]


def kpis(pages, unit):
    """The key performance indicator table in 'Basis for Offer Price' (or the financial summary):
    {periods: [...], rev: [...], ...}; money in ₹ crore, ratios as stated."""
    starts = heading_pages(pages, r"BASIS FOR (?:THE )?(?:OFFER|ISSUE) PRICE")
    if not starts:
        return None, None
    s = starts[0]
    text = "\n".join(pages[s:s + 12])
    m = re.search(r"Key Performance Indicators|KEY PERFORMANCE INDICATORS|financial KPIs|Financial KPIs", text)
    if not m:
        return None, s + 1
    seg = text[m.end():m.end() + 9000]
    rv = re.search(r"(?m)^.*Revenue from (?:operations|contracts)", seg, re.I)
    if not rv:
        return None, s + 1
    header = seg[max(0, rv.start() - 900):rv.start()]
    per = _periods(header)
    # the header can carry the same years twice (amount and growth columns): keep the first run
    seen, ordered = set(), []
    for p in per:
        if p in seen:
            break
        seen.add(p)
        ordered.append(p)
    per = ordered
    if not per:
        return None, s + 1
    u = unit_of(header) or unit
    out = {"periods": per}
    body = seg[rv.start():rv.start() + 5000]
    # join wrapped labels: a line without numbers belongs to the next one
    lines, buf = [], ""
    for l in body.split("\n"):
        if re.search(r"(?:" + NUM + r"|NA|N\.A\.|-)\s*%?\s*$", l) and re.search(r"\d", l):
            lines.append((buf + " " + l).strip())
            buf = ""
        else:
            buf = (buf + " " + l).strip()
            if len(buf) > 200:
                buf = ""
    for l in lines:
        label = re.split(r"\s(?=[₹%(]|\d|NA\b|Days\b|Times\b|times\b|x\b)", l, 1)[0]
        vals = re.findall(r"(?<![\w.])(\(?-?[\d,]*\d(?:\.\d+)?\)?%?|NA|N\.A\.|-(?=\s|$))(?![\w])", l[len(label):])
        vals = [v for v in vals if not re.fullmatch(r"\(\d{1,2}\)", v)]      # footnote markers (1) (2)
        if len(vals) < len(per):
            continue
        vals = vals[-len(per):]
        for key, rx in KPI_ROWS:
            if key in out or not re.search(rx, label, re.I):
                continue
            if key == "rev" and re.search(r"growth|CAGR|%", label, re.I):
                continue
            if key in ("ebitda", "pat") and re.search(r"margin|growth|%|CAGR", label, re.I):
                continue
            pct = key in ("ebitda_m", "pat_m", "roce", "roe")
            nums = [num(v) if v not in ("NA", "N.A.", "-") else None for v in vals]
            out[key] = [None if v is None else (round(v, 2) if pct or key in ("de", "nwc") else cr(v, u)) for v in nums]
            break
    dbg("kpi periods", per, "unit", u, "rows", [k for k in out if k != "periods"])
    return (out if "rev" in out else None), s + 1


def basis(pages):
    """EPS, industry P/E, RoNW and NAV from 'Basis for Offer Price'."""
    starts = heading_pages(pages, r"BASIS FOR (?:THE )?(?:OFFER|ISSUE) PRICE")
    if not starts:
        return {}, None
    s = starts[0]
    text = "\n".join(pages[s:s + 8])
    f = flat(text)
    out = {}
    # EPS rows: "March 31, 2026 5.27 5.27 3" / "Fiscal 2026 5.27 5.27 3" (basic, diluted, weight)
    eps = []
    for m in re.finditer(r"(?:(?:March 31,?|Fiscal|FY|Financial Year(?: ended)?(?: March 31,)?)\s*(20\d\d))\s+(" + NUM + r")\s+(" + NUM + r")\s+([123])\b", f):
        eps.append((int(m.group(1)), num(m.group(2)), num(m.group(3))))
    if eps:
        y, b, d = max(eps)
        out["eps"] = d if d is not None else b
        out["eps_year"] = "FY" + str(y)[-2:]
    m = re.search(r"Highest\s*(" + NUM + r")\s*Lowest\s*(" + NUM + r")\s*(?:Average|Industry Composite|Median)\s*(" + NUM + ")", f, re.I)
    if m:
        out["ind_pe"] = {"hi": num(m.group(1)), "lo": num(m.group(2)), "avg": num(m.group(3))}
    m = re.search(r"Return on Net ?Worth.{0,1500}?Weighted Average\s*(" + NUM + ")", f, re.I)
    if m:
        out["ronw_w"] = num(m.group(1))
    m = re.search(r"(?:NAV|Net Asset Value)[^.]{0,200}?As (?:on|at) (?:March 31, )?(?:\w+ \d+, )?20\d\d\S?\s*(" + NUM + ")", f, re.I)
    if m:
        out["nav"] = num(m.group(1))
    # listed peers, named in the comparison table
    m = re.search(r"(?:Comparison (?:of|with) (?:Accounting Ratios with )?listed industry peers|Comparison with listed industry peers|Listed Industry Peers|Peer Group Comparison)", text, re.I)
    peers = []
    if m and not re.search(r"no (?:listed )?(?:industry )?peers|not have any (?:listed )?(?:industry )?peers|no comparable", f[f.find(flat(text[m.start():m.start() + 80])):][:1500], re.I):
        seg = flat(text[m.start():m.start() + 6000])
        ident = re.search(r"identified as (.{10,800}?)\s*\(the “?(?:Industry )?Peers|peers? (?:of our Company )?(?:are|include)\s*(.{10,600}?)\.", seg, re.I)
        names = re.split(r",\s*|\s+and\s+", (ident.group(1) or ident.group(2))) if ident else []
        if not names:
            names = re.findall(r"([A-Z][\w&.'-]*(?:\s+[A-Z(&][\w&.'()-]*){0,6}\s+(?:Limited|Ltd\.?))\s*\*?\s*(?:Consolidated|Standalone)", seg)
        for n in names:
            n = re.sub(r"\s+", " ", n).strip(" .*")
            if re.search(r"(?:Limited|Ltd\.?|Inc\.?|PLC)$", n, re.I) and 4 < len(n) < 80 and n not in peers:
                peers.append(n)
    if peers:
        out["peers"] = peers[:12]
    dbg("basis", {k: v for k, v in out.items() if k != "peers"}, "peers", peers)
    return out, s + 1


def objects(pages, unit):
    """What the fresh issue money is for: [{t, cr}] from 'Objects of the Offer'."""
    s, text = section(pages, r"OBJECTS OF THE (?:OFFER|ISSUE)", 5)
    if s is None:
        return None, None
    m = re.search(r"(?:Utili[sz]ation of (?:the )?Net Proceeds|proposes? to utili[sz]e the Net Proceeds (?:towards|for) the following|Requirement of funds)[^\n]*\n", text, re.I)
    starts = [mm.end() for mm in re.finditer(r"(?:Utili[sz]ation of (?:the )?Net Proceeds|utili[sz]e the Net Proceeds (?:towards|for) the following)[^\n]*\n", text, re.I)]
    best = None
    for st in (starts or ([m.end()] if m else [])):
        seg = text[st:st + 2500]
        u = unit_of(text[max(0, st - 300):st + 400]) or unit
        items = []
        for part in re.split(r"\n\s*(?=\d{1,2}\.?\s+[A-Z])", seg)[1:]:
            mm = re.match(r"(\d{1,2})\.?\s+(.*)", part, re.S)
            if not mm:
                continue
            body = flat(mm.group(2))
            stop = re.search(r"\s(?:Net Proceeds|Total|\(\d\)\s*The amount|Notes?:)", body)
            if stop and stop.start() > 20:
                body = body[:stop.start()]
            amt = re.search(r"\s(\d[\d,]*\.\d{1,2}|\[●\])(?:\s*\(\d\))?\s*(?:\d[\d,]*\.\d{1,2}|-|\[●\]|\s)*$", body)
            if not amt:
                continue
            t = re.sub(r"\s*\(\d\)\s*$", "", body[:amt.start()]).strip(" .;:")
            t = re.sub(r"\(\d\)", "", t).strip()
            if len(t) < 8:
                continue
            items.append({"t": t[:220], "cr": cr(num(amt.group(1)), u) if amt.group(1) != "[●]" else None})
        if len(items) >= 1 and (best is None or len(items) > len(best)):
            best = items
    dbg("objects", best)
    return best, s + 1


def summary_bits(pages, unit):
    """From the 'Summary of the Offer Document': primary business, auditor qualifications, promoter holding."""
    s, text = section(pages, r"SUMMARY OF (?:THE )?OFFER DOCUMENT|OFFER DOCUMENT SUMMARY", 14)
    out = {}
    if s is None:
        return out, None
    f = flat(text)
    m = re.search(r"(?:Summary of (?:the )?primary business[^.]{0,60}?|Primary business of our Company|Overview of (?:our )?(?:the )?business)\s*:?\s*(.{120,1600}?)(?=\s(?:Summary of (?:the )?Industry|Summary of industry|Industry in which|Name of (?:the )?Promoters?|Our Promoters?\b|Offer size|Summary of the Offer)\b)", f, re.I)
    if m:
        out["about"] = m.group(1).strip()
    m = re.search(r"(?:Summary of|Details of)?\s*(?:qualifications|reservations|adverse remarks)[^.]{0,160}?(?:auditors?|Statutory Auditors?)[^.]{0,200}?(?:Restated|not been given effect)[^.]{0,200}?\.?\s*(.{0,500}?)(?=\s(?:Summary of|Outstanding litigation|Summary table|Risk Factors|Contingent)\b)", f, re.I)
    if m:
        body = m.group(1).strip()
        nil = re.search(r"\b(?:no|nil|not applicable|none)\b|there (?:are|were) no|has not (?:included|made)|not included any", (m.group(0)[:600]), re.I)
        out["quals"] = None if nil else body[:500]
        out["quals_seen"] = True
    # promoters' shareholding before and after the offer: "Total ... 93.73 ... [●]" or percentages in the pre-offer table
    m = re.search(r"(?:Aggregate )?(?:pre-?\s*Offer|pre-? ?Issue)[^.]{0,200}?shareholding of (?:our )?(?:the )?Promoters?(.{0,4000}?)(?=Summary of|Financial information|Summary of Restated)", f, re.I)
    if m:
        seg = m.group(1)
        tot = re.findall(r"Total\s*\(?[A-Z]?\)?\s*[^%]{0,80}?([\d.]+)\s*%?", seg)
        pcts = [num(x) for x in re.findall(r"(\d{1,3}\.\d{1,2})\s*%?", seg) if num(x) is not None and 0 < num(x) <= 100]
        dbg("promoter seg", seg[:300])
        if pcts:
            out["prom_pre_all"] = pcts[:40]
    return out, s + 1


def business(pages):
    """First paragraphs of 'Our Business' after its 'Overview' heading."""
    for s in heading_pages(pages, r"^\s*OUR BUSINESS\s*$")[:2]:
        text = "\n".join(pages[s:s + 3])
        m = re.search(r"\n\s*Overview\s*\n(.{200,3000})", text, re.S)
        if m:
            paras = [flat(p) for p in re.split(r"\n\s*\n|\.\s*\n(?=[A-Z])", m.group(1)) if len(flat(p)) > 60]
            t = ". ".join(p.rstrip(".") for p in paras[:2]) + "."
            t = re.sub(r"(?<=[.;:])\s\d{1,3}\s(?=[•A-Z])", " ", t)
            return t, s + 1
    return None, None


def contingent(pages, unit):
    s, text = section(pages, r"SUMMARY OF CONTINGENT LIABILITIES|CONTINGENT LIABILITIES", 1)
    if s is None:
        return None
    f = flat(text)
    if re.search(r"(?:no|nil|not have any) contingent liabilities", f, re.I):
        return {"cr": 0, "p": s + 1}
    u = unit_of(f) or unit
    tot = re.search(r"\bTotal\b[^\d(]{0,40}(" + NUM + ")", f)
    if tot:
        return {"cr": cr(num(tot.group(1)), u), "p": s + 1}
    # no total row: add up the amounts at the end of each line (first column is the latest date)
    vals = []
    tbl = re.search(r"Particulars", text)
    for l in text[tbl.start() if tbl else 0:].split("\n"):
        if re.search(r"For details|see “|Risk Factors", l):
            break
        mm = re.search(r"(?:^|[A-Za-z)]\s+)(\d[\d,]*\.\d{2})(?:\s+\d[\d,]*\.\d{2})*\s*$", l)
        if mm and not re.search(r"₹|million|lakh|crore|20\d\d\s*$|Note|page", l, re.I):
            vals.append(num(mm.group(1)))
    return {"cr": cr(sum(vals), u), "p": s + 1} if vals else None


def risk_heads(pages):
    """First few risk factor headings from the RHP (used when the advertisement has none)."""
    s, text = section(pages, r"^\s*(?:SECTION [IVX]+\s*[:–-]\s*)?RISK FACTORS\s*$", 8)
    if s is None:
        return []
    out = []
    for m in re.finditer(r"(?m)^\s*(\d{1,2})\.\s+([A-Z][^\n]{15,}(?:\n(?!\s*\d{1,2}\.\s)[^\n]{0,200}){0,3})", text):
        if int(m.group(1)) != len(out) + 1:
            continue
        head = flat(m.group(2))
        head = re.split(r"(?<=[a-z)])\.\s", head, 1)[0]
        out.append(head[:220])
        if len(out) >= 8:
            break
    return out


def pre_offer_shares(pages):
    s, text = section(pages, r"CAPITAL STRUCTURE", 3)
    if s is None:
        return None
    f = flat(text)
    m = re.search(r"ISSUED, SUBSCRIBED AND PAID[- ]UP (?:EQUITY )?SHARE CAPITAL BEFORE THE (?:OFFER|ISSUE).{0,40}?([\d,]{6,}) Equity Shares", f, re.I)
    return int(num(m.group(1))) if m else None


# ---------- note ----------
def build_note(it, rhp_pages, ad_pages):
    unit = doc_unit(rhp_pages)
    ad = advert(ad_pages) if ad_pages else {}
    note = {"v": VERSION, "s": it["s"], "n": it.get("n"), "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "rhp": it.get("rhp"), "ratios": it.get("ratios"), "pages": len(rhp_pages)}
    band = it.get("band") or ad.get("band")
    note["band"] = band
    terms = offer_terms(rhp_pages)
    for k in ("fresh_cr", "ofs_cr", "fresh_sh", "ofs_sh", "promoters"):
        if terms.get(k) is None and ad.get(k) is not None:
            terms[k] = ad[k]
    about_s, ps = summary_bits(rhp_pages, unit)
    biz, pb = business(rhp_pages)
    note["about"] = {"t": ad.get("about") or about_s.get("about") or biz, "long": biz if biz and biz != (ad.get("about") or about_s.get("about")) else None, "p": pb or ps}
    note["promoters"] = terms.get("promoters")
    # the offer: fresh issue (money to the company) vs offer for sale (money to the sellers)
    upper = band[1] if band else None
    fresh, ofs = terms.get("fresh_cr"), terms.get("ofs_cr")
    if fresh is None and terms.get("fresh_sh") and upper:
        fresh = round(terms["fresh_sh"] * upper / 1e7, 2)
    if ofs is None and terms.get("ofs_sh") and upper:
        ofs = round(terms["ofs_sh"] * upper / 1e7, 2)
    note["offer"] = {"fresh": fresh, "ofs": ofs, "total": round((fresh or 0) + (ofs or 0), 2) if fresh is not None or ofs is not None else None}
    if ad.get("sellers"):
        note["sellers"] = ad["sellers"]
    k, pk = kpis(rhp_pages, unit)
    if k:
        note["kpi"] = dict(k, p=pk)
    b, pbasis = basis(rhp_pages)
    val = {"p": pbasis}
    if b.get("eps") is not None:
        val["eps"], val["eps_year"] = b["eps"], b["eps_year"]
        if upper and b["eps"] > 0:
            val["pe"] = round(upper / b["eps"], 1)
    if ad.get("pe_upper"):
        val["pe"] = ad["pe_upper"]
    if b.get("ind_pe"):
        val["ind_pe"] = b["ind_pe"]
    elif ad.get("ind_pe"):
        val["ind_pe"] = {"avg": ad["ind_pe"]}
    for key in ("ronw_w", "nav"):
        if b.get(key) is not None or ad.get(key) is not None:
            val[key] = b.get(key) if b.get(key) is not None else ad.get(key)
    shares = pre_offer_shares(rhp_pages)
    if ad.get("mcap"):
        val["mcap"] = cr(ad["mcap"], ad["mcap_unit"])
    elif shares and upper:
        post = shares + (int(fresh * 1e7 / upper) if fresh else 0)
        val["mcap"] = round(post * upper / 1e7, 2)
    if val["mcap"] if "mcap" in val else None:
        rev = (note.get("kpi") or {}).get("rev")
        if rev:
            fy = [v for p, v in zip(note["kpi"]["periods"], rev) if p.startswith("FY") and v]
            if fy:
                val["ps"] = round(val["mcap"] / fy[0], 2)
    note["val"] = val
    if b.get("peers"):
        note["peers"] = b["peers"]
    o, po = objects(rhp_pages, unit)
    if o:
        note["objects"] = {"list": o, "p": po}
    c = contingent(rhp_pages, unit)
    if c:
        note["contingent"] = c
    if about_s.get("quals_seen"):
        note["quals"] = {"t": about_s.get("quals"), "p": ps}
    note["risks"] = ad.get("risks") or risk_heads(rhp_pages)
    if ad.get("brlm_all"):
        note["brlm"] = {"all": ad["brlm_all"], "rows": ad.get("brlm", [])}
    if about_s.get("prom_pre_all"):
        note["_prom_debug"] = about_s["prom_pre_all"][:12]
    return note


def main():
    global DEBUG
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=6, help="prospectuses read per run (each is 300-700 pages)")
    ap.add_argument("--sym", action="append", help="only these symbols (repeatable); ignores the saved notes")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--ipo", help="read the issue list from this file instead of data/yahoo/ipo.json")
    ap.add_argument("--print", action="store_true", help="print each note")
    args = ap.parse_args()
    DEBUG = args.debug
    if not IPO.exists() and not args.ipo:
        print("no ipo.json; run scripts/fetch_ipo.py first", file=sys.stderr)
        return 0
    ipo = json.loads(Path(args.ipo).read_text()) if args.ipo else json.loads(IPO.read_text())
    NOTES.mkdir(parents=True, exist_ok=True)
    issues = ipo.get("open", []) + ipo.get("upcoming", []) + ipo.get("closed", [])
    todo = []
    for it in issues:
        if not it.get("rhp"):
            continue
        if args.sym and it["s"] not in args.sym:
            continue
        path = NOTES / (it["s"] + ".json")
        if not args.sym and path.exists():
            old = json.loads(path.read_text())
            if old.get("v") == VERSION and old.get("rhp") == it.get("rhp"):
                continue
        todo.append(it)
    # issues bidding now first, then the ones opening soon, then the closed ones
    todo = todo[:args.max]
    done = 0
    for it in todo:
        try:
            ad_pages = []
            if it.get("ratios"):
                try:
                    for _, data in pdfs_in_zip(it["ratios"], skip=r"hindi|marathi|gujarati|jansatta|navshakti|tamil|telugu|kannada|bengali|punjabi|regional")[:1]:
                        ad_pages = pdf_pages(data, 12)
                except Exception as e:  # noqa: BLE001
                    print(f"  {it['s']}: price band advertisement not read ({str(e)[:80]})", file=sys.stderr)
            docs = pdfs_in_zip(it["rhp"])
            if not docs:
                print(f"  {it['s']}: no prospectus PDF in the zip", file=sys.stderr)
                continue
            pages = pdf_pages(docs[0][1], 900)
            note = build_note(it, pages, ad_pages)
            (NOTES / (it["s"] + ".json")).write_text(json.dumps(note, ensure_ascii=False, separators=(",", ":")))
            done += 1
            filled = [k for k in ("about", "offer", "kpi", "val", "peers", "objects", "contingent", "quals", "risks", "brlm", "sellers") if note.get(k)]
            print(f"  {it['s']}: {len(pages)} pages; {', '.join(filled)}")
            if args.print:
                print(json.dumps(note, ensure_ascii=False, indent=1))
        except Exception as e:  # noqa: BLE001
            print(f"  {it['s']}: research note failed ({type(e).__name__}: {str(e)[:120]})", file=sys.stderr)
    # mark issues that have a note
    have = {p.stem for p in NOTES.glob("*.json")}
    for k in ("open", "upcoming", "closed"):
        for it in ipo.get(k, []):
            if it["s"] in have:
                it["note"] = 1
    if not args.ipo:
        IPO.write_text(json.dumps(ipo, separators=(",", ":")))
    print(f"IPO research notes: {done} written this run, {len(have)} in all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
