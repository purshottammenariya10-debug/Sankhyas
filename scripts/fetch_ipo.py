#!/usr/bin/env python3
"""IPOs and rights issues from NSE -> data/yahoo/ipo.json (the site's IPO page).

    open      issues bidding now (mainboard and SME) with live subscription, category-wise
    upcoming  announced issues that have not opened yet
    closed    issues that closed in the last 10 days and have not listed yet (final subscription)
    past      every equity IPO since 2012 with its final issue price and listing date
    rights    rights issues with a record date from 30 days ago to 120 days ahead

Everything comes through scripts/exchange.py's NSE session (direct, or the Supabase relay when
NSE refuses the runner).

    python scripts/fetch_ipo.py
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exchange import NSE_HOME, nse_session  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "yahoo" / "ipo.json"
EQUITY_SERIES = {"EQ", "BE", "SME", "SM", "ST"}


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def iso(d):
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(str(d).strip().title(), fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def band(text):
    vals = [num(x) for x in re.findall(r"\d+(?:\.\d+)?", str(text or "").replace(",", ""))]
    vals = [v for v in vals if v]
    return [min(vals), max(vals)] if vals else None


def add_working_days(day, n):
    d = dt.date.fromisoformat(day)
    while n > 0:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


CATS = [("qib", r"^Qualified Institutional"), ("nii", r"^Non Institutional Investors$"), ("rii", r"^Retail Individual"),
        ("emp", r"^Employee"), ("sh", r"^Shareholder"), ("total", r"^Total$")]


def detail(nse, sym, series):
    """Lot size, face value, lead managers, registrar, documents and category-wise subscription."""
    d = nse.get(NSE_HOME + "/api/ipo-detail", params={"symbol": sym, "series": series}) or {}
    info = {}
    for row in ((d.get("issueInfo") or {}).get("dataList") or []):
        if row.get("title"):
            info[row["title"].strip()] = re.sub(r'^"+|"+$', "", str(row.get("value") or "")).strip()
    out = {}
    lot = re.search(r"([\d,]+)\s*Equity Shares", info.get("Bid Lot", "") or info.get("Minimum Order Quantity", ""), re.I)
    if lot:
        out["lot"] = int(lot.group(1).replace(",", ""))
    fv = re.search(r"(?:Rs\.?|Re\.?|₹)\s*([\d.]+)", info.get("Face Value", ""))
    if fv:
        out["fv"] = num(fv.group(1))
    for key, title in (("type", "Issue Type"), ("lead", "Book Running Lead Managers"), ("reg", "Name of the Registrar"), ("size_text", "Issue Size")):
        if info.get(title):
            out[key] = re.sub(r"\s+", " ", info[title])[:300]
    for key, title in (("rhp", "Red Herring Prospectus"), ("ratios", "Ratios / Basis of Issue Price"), ("anchor", "Anchor Allocation Report")):
        v = info.get(title, "")
        if v.startswith("http"):
            out[key] = v
    subs = {}
    for row in d.get("bidDetails") or []:
        cat = (row.get("category") or "").strip()
        for key, rx in CATS:
            if re.search(rx, cat) and key not in subs and num(row.get("noOfTime")) is not None:
                subs[key] = round(num(row.get("noOfTime")), 2)
    if subs:
        out["subs"] = subs
    return out


def main():
    nse = nse_session()
    if nse is None:
        print("NSE not reachable (direct or relay); IPO data not refreshed", file=sys.stderr)
        return 0
    today = dt.date.today().isoformat()
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}

    current = nse.get(NSE_HOME + "/api/ipo-current-issue") or []
    upcoming_raw = nse.get(NSE_HOME + "/api/all-upcoming-issues", params={"category": "ipo"}) or []
    past_raw = nse.get(NSE_HOME + "/api/public-past-issues") or []
    if not isinstance(current, list):
        current = []
    if not isinstance(upcoming_raw, list):
        upcoming_raw = []
    if not isinstance(past_raw, list):
        past_raw = []

    issues = {}
    for r in current + upcoming_raw:
        sym = (r.get("symbol") or "").strip()
        if not sym:
            continue
        it = issues.setdefault(sym, {"s": sym})
        it["n"] = (r.get("companyName") or it.get("n") or sym).strip()
        it["board"] = "SME" if (r.get("series") or "").upper() in ("SME", "SM", "ST") else it.get("board", "Main")
        it["series"] = r.get("series") or it.get("series") or "EQ"
        it["start"], it["end"] = iso(r.get("issueStartDate")) or it.get("start", ""), iso(r.get("issueEndDate")) or it.get("end", "")
        it["band"] = band(r.get("issuePrice")) or it.get("band")
        if str(r.get("isBse") or "") == "1":
            it["ex"] = "BSE"
        size = num(r.get("issueSize")) or num(r.get("noOfSharesOffered"))
        if size:
            it["shares"] = int(size)
        if num(r.get("noOfTime")) is not None:
            it["x"] = round(num(r["noOfTime"]), 2)

    # past issues: final price and listing date; recently closed ones not yet listed
    past, closed = [], []
    for r in past_raw:
        typ = (r.get("securityType") or "").upper()
        if typ not in EQUITY_SERIES:
            continue
        sym = (r.get("symbol") or "").strip()
        row = {"s": sym, "n": (r.get("company") or r.get("companyName") or sym).strip(), "board": "SME" if typ in ("SME", "SM", "ST") else "Main",
               "start": iso(r.get("ipoStartDate")), "end": iso(r.get("ipoEndDate")), "ip": num(r.get("issuePrice")), "ld": iso(r.get("listingDate")),
               "band": band(r.get("priceRange"))}
        if row["ld"] or row["ip"]:
            past.append(row)
        if not row["ld"] and row["end"] and (dt.date.fromisoformat(today) - dt.date.fromisoformat(row["end"])).days <= 10 and sym not in issues:
            closed.append(dict(row, series="SME" if row["board"] == "SME" else "EQ"))
    past.sort(key=lambda x: x["ld"] or x["end"], reverse=True)

    # details for open, upcoming and just-closed issues (keep what we had if NSE does not answer)
    old = {x["s"]: x for x in (prev.get("open", []) + prev.get("upcoming", []) + prev.get("closed", []))}
    for it in list(issues.values()) + closed:
        try:
            it.update(detail(nse, it["s"], it.get("series", "EQ")))
        except Exception as e:  # noqa: BLE001
            print(f"  {it['s']}: IPO detail failed ({str(e)[:60]})", file=sys.stderr)
            for k in ("lot", "fv", "lead", "reg", "rhp", "ratios", "type", "subs"):
                if k in old.get(it["s"], {}) and k not in it:
                    it[k] = old[it["s"]][k]
        if it.get("subs", {}).get("total") is not None:
            it["x"] = it["subs"]["total"]
        if it.get("end"):
            it["lst"] = add_working_days(it["end"], 3)        # T+3 listing
        if it.get("band") and it.get("shares"):
            it["size"] = round(it["band"][1] * it["shares"] / 1e7, 2)   # issue size, Rs crore at the upper band
        if it.get("band") and it.get("lot"):
            it["min"] = round(it["band"][1] * it["lot"])                 # minimum investment, Rs

    open_, upcoming = [], []
    for it in issues.values():
        (upcoming if it.get("start") and it["start"] > today else open_).append(it)
    open_.sort(key=lambda x: (x.get("end", ""), x.get("s")))
    upcoming.sort(key=lambda x: x.get("start", ""))

    # rights issues from corporate actions
    rights = []
    fr = (dt.date.today() - dt.timedelta(days=30)).strftime("%d-%m-%Y")
    to = (dt.date.today() + dt.timedelta(days=120)).strftime("%d-%m-%Y")
    ca = nse.get(NSE_HOME + "/api/corporates-corporateActions", params={"index": "equities", "from_date": fr, "to_date": to}) or []
    for r in ca if isinstance(ca, list) else []:
        subj = r.get("subject") or ""
        m = re.search(r"rights?\s*(\d+)\s*:\s*(\d+)", subj, re.I)
        if not m:
            continue
        prem = re.search(r"premium\s*(?:of\s*)?(?:rs\.?|₹)?\s*([\d.]+)", subj, re.I)
        at = re.search(r"@\s*(?:rs\.?|₹)?\s*([\d.]+)\b(?!\s*/?-?\s*premium)", subj, re.I)
        fv = num(r.get("faceVal"))
        price = (fv or 0) + num(prem.group(1)) if prem and fv is not None else (num(at.group(1)) if at and not prem else None)
        rights.append({"s": r.get("symbol"), "n": (r.get("comp") or "").strip(), "rec": iso(r.get("recDate")) or iso(r.get("exDate")), "ex": iso(r.get("exDate")),
                       "ratio": f"{m.group(1)}:{m.group(2)}", "fv": fv, "price": round(price, 2) if price else None, "subject": subj[:160]})
    rights.sort(key=lambda x: x["ex"] or x["rec"], reverse=False)

    cutoff = (dt.date.today() - dt.timedelta(days=3 * 366)).isoformat()
    doc = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "open": open_, "upcoming": upcoming, "closed": closed,
           "past": [p for p in past if (p["ld"] or p["end"]) >= cutoff], "rights": rights}
    if not (open_ or upcoming or past) and prev:
        print("NSE returned no IPO data; keeping the previous file", file=sys.stderr)
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"ipo.json: {len(open_)} open, {len(upcoming)} upcoming, {len(closed)} closed awaiting listing, {len(doc['past'])} past (3 years), {len(rights)} rights issues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
