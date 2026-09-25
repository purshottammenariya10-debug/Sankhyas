#!/usr/bin/env python3
"""Fetch exchange filings (announcements, annual reports, concall transcripts, investor
presentations, recordings, credit ratings) from BSE and NSE into data/filings/.

Two passes each run:
  1. Daily sweep: every BSE announcement (all companies) filed in the last --days days,
     plus NSE's latest announcements when NSE lets us in.
  2. Backfill: for up to --max-backfill companies that have no history yet (or whose
     history is over 30 days old), fetch 3 years of announcements and all annual reports.
Output:
  data/filings/<SYMBOL>.json   per company (links point to the exchange's own PDF files)
  data/filings/latest.json     the most recent announcements across the market (for the feed)

Exchange endpoints are unofficial website APIs: they can change or refuse requests. Every
call is best-effort and previously fetched filings are always kept.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

from exchange import BSE_API, bse_session, nse_session

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "filings"
KEEP_ANNOUNCEMENTS = 400
BSE_ATTACH = {0: "https://www.bseindia.com/xml-data/corpfiling/AttachLive/",
              1: "https://www.bseindia.com/xml-data/corpfiling/AttachHis/"}

IMPORTANT = re.compile(r"financial result|outcome of board|dividend|bonus|split|sub-division|buy ?back|acquisition|"
                       r"amalgamation|merger|demerger|scheme of arrangement|resignation|appointment of (managing|chief|ceo|cfo|md)|"
                       r"credit rating|rights issue|preferential|qip|fund ?rais", re.I)


def classify(text):
    """Return the filing kind used by the site."""
    t = text.lower()
    if "transcript" in t:
        return "transcript"
    if re.search(r"audio|recording|webcast|video", t) and re.search(r"call|meet|earnings|conference", t):
        return "audio"
    if re.search(r"investor presentation|earnings presentation|analyst presentation|\bppt\b|presentation", t):
        return "ppt"
    if re.search(r"credit rating|\brating", t) and not re.search(r"rating agenc(y|ies)'? ?meet", t):
        return "rating"
    if re.search(r"con\.? ?call|conference call|earnings call|analysts?[ /]+institutional investor meet|investor meet", t):
        return "concall"
    if re.search(r"financial result|outcome of board", t):
        return "results"
    return "other"


def iso(d):
    return d if isinstance(d, str) else d.isoformat(timespec="seconds")


def parse_date(s):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d-%b-%Y %H:%M:%S", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s[:26], fmt)
        except ValueError:
            continue
    return None


def ann(date, title, category, url, source):
    return {"d": iso(date), "t": re.sub(r"\s+", " ", title).strip()[:300], "c": (category or "").strip()[:80],
            "u": url, "x": source, "k": classify(title + " " + (category or ""))}


# ---------- BSE ----------
def bse_announcements(bse, scrip="", start=None, end=None, max_pages=200):
    end = end or dt.date.today()
    start = start or end - dt.timedelta(days=3)
    out = []
    for page in range(1, max_pages + 1):
        data = bse.get(f"{BSE_API}/AnnSubCategoryGetData/w", params={
            "pageno": page, "strCat": "-1", "strPrevDate": start.strftime("%Y%m%d"), "strScrip": scrip,
            "strSearch": "P", "strToDate": end.strftime("%Y%m%d"), "strType": "C", "subcategory": "-1"})
        rows = (data or {}).get("Table") or []
        if not rows:
            break
        for r in rows:
            out.append(parse_bse_row(r))
        total = ((data.get("Table1") or [{}])[0] or {}).get("ROWCNT")
        if total and page * len(rows) >= int(total):
            break
    return [a for a in out if a]


def parse_bse_row(r):
    name = (r.get("ATTACHMENTNAME") or "").strip()
    d = parse_date(r.get("NEWS_DT") or r.get("DT_TM") or "")
    if not name or not d:
        return None
    try:
        flag = int(r.get("PDFFLAG") or 0)
    except (TypeError, ValueError):
        flag = 0
    title = r.get("NEWSSUB") or r.get("HEADLINE") or r.get("SUBCATNAME") or "Announcement"
    category = " / ".join(x for x in (r.get("CATEGORYNAME"), r.get("SUBCATNAME")) if x and x.strip() and x.strip() != "-")
    a = ann(d, title, category, BSE_ATTACH.get(flag, BSE_ATTACH[0]) + name, "bse")
    a["bse"] = str(r.get("SCRIP_CD") or "").strip()
    return a


def bse_annual_reports(bse, code):
    data = bse.get(f"{BSE_API}/AnnualReport_New/w", params={"scripcode": code})
    rows = data if isinstance(data, list) else (data or {}).get("Table") or []
    out = []
    for r in rows:
        vals = {k.lower(): v for k, v in r.items()}
        year = next((str(v) for k, v in vals.items() if "year" in k and v), "")
        url = next((str(v) for v in vals.values() if isinstance(v, str) and v.lower().endswith(".pdf")), "")
        if url and not url.startswith("http"):
            url = f"https://www.bseindia.com/bseplus/AnnualReport/{code}/{url}"
        if url:
            out.append({"y": year, "u": url, "x": "bse"})
    return out


# ---------- NSE ----------
def parse_nse_items(items):
    out = []
    for r in items or []:
        url = r.get("attchmntFile") or ""
        d = parse_date(r.get("sort_date") or r.get("an_dt") or "")
        if not url or not d:
            continue
        a = ann(d, r.get("attchmntText") or r.get("desc") or "Announcement", r.get("desc") or "", url, "nse")
        a["nse"] = (r.get("symbol") or "").strip()
        out.append(a)
    return out


def nse_announcements(nse, symbol=None, start=None, end=None):
    params = {"index": "equities"}
    if symbol:
        params["symbol"] = symbol
    if start and end:
        params.update({"from_date": start.strftime("%d-%m-%Y"), "to_date": end.strftime("%d-%m-%Y")})
    data = nse.get("https://www.nseindia.com/api/corporate-announcements", params=params)
    return parse_nse_items(data if isinstance(data, list) else (data or {}).get("data"))


def nse_annual_reports(nse, symbol):
    data = nse.get("https://www.nseindia.com/api/annual-reports", params={"index": "equities", "symbol": symbol})
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    out = []
    for r in rows:
        url = r.get("fileName") or ""
        if url:
            y = "-".join(x for x in (str(r.get("fromYr") or ""), str(r.get("toYr") or "")[-2:]) if x)
            out.append({"y": y, "u": url, "x": "nse"})
    return out


# ---------- storage ----------
def fiscal_label(y):
    """Normalise '2025-2026', '2025-26' or '2026' to '2025-26' so NSE and BSE copies of a report match."""
    nums = re.findall(r"\d{4}|\d{2}", str(y))
    if len(nums) >= 2 and len(nums[0]) == 4:
        return f"{nums[0]}-{nums[1][-2:]}"
    if len(nums) == 1 and len(nums[0]) == 4:
        return f"{int(nums[0]) - 1}-{nums[0][-2:]}"
    return str(y)


def load(sym):
    f = OUT / f"{sym}.json"
    if f.exists():
        try:
            return json.loads(f.read_text())
        except ValueError:
            pass
    return {"symbol": sym, "announcements": [], "annualReports": []}


def merge_into(doc, anns=(), reports=()):
    seen = {a["u"] for a in doc["announcements"]} | {(a["d"][:10], a["t"].lower()) for a in doc["announcements"]}
    for a in anns:
        key2 = (a["d"][:10], a["t"].lower())
        if a["u"] in seen or key2 in seen:
            continue
        seen.add(a["u"]); seen.add(key2)
        doc["announcements"].append({k: a[k] for k in ("d", "t", "c", "u", "x", "k")})
    doc["announcements"].sort(key=lambda a: a["d"], reverse=True)
    doc["announcements"] = doc["announcements"][:KEEP_ANNOUNCEMENTS]
    have = {r["u"] for r in doc["annualReports"]} | {r.get("y") for r in doc["annualReports"] if r.get("y")}
    for r in reports:
        r = dict(r, y=fiscal_label(r.get("y", "")))
        if r["u"] in have or (r["y"] and r["y"] in have):
            continue
        doc["annualReports"].append(r)
        have.update({r["u"], r["y"]})
    doc["annualReports"].sort(key=lambda r: r.get("y", ""), reverse=True)


def save(doc):
    doc["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    (OUT / f"{doc['symbol']}.json").write_text(json.dumps(doc, separators=(",", ":")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*", help="limit to these Sankhyas symbols")
    ap.add_argument("--days", type=int, default=3, help="daily sweep window (default 3 days)")
    ap.add_argument("--max-backfill", type=int, default=150, help="companies to backfill per run (default 150)")
    ap.add_argument("--years", type=int, default=3, help="history to backfill (default 3 years)")
    ap.add_argument("--no-nse", action="store_true", help="skip NSE (BSE only)")
    args = ap.parse_args(argv)

    universe = json.loads((ROOT / "data" / "universe.json").read_text())["companies"]
    if args.symbols:
        wanted = {s.upper() for s in args.symbols}
        universe = [c for c in universe if c["symbol"].upper() in wanted]
    by_bse = {c["bse"]: c for c in universe if c.get("bse")}
    by_nse = {c["symbol"]: c for c in universe if c["yahoo"].endswith(".NS")}
    OUT.mkdir(parents=True, exist_ok=True)

    bse = bse_session()
    nse = None if args.no_nse else nse_session()
    print("NSE:", "connected" if nse else "unavailable (BSE only this run)")

    # 1. daily sweep across the market
    today = dt.date.today()
    start = today - dt.timedelta(days=args.days)
    touched, latest = {}, []
    sweep = []
    try:
        sweep += bse_announcements(bse, "", start, today)
    except Exception as e:  # noqa: BLE001
        print("BSE sweep failed:", e, file=sys.stderr)
    if nse:
        try:
            sweep += nse_announcements(nse, None, start, today)
        except Exception as e:  # noqa: BLE001
            print("NSE sweep failed:", e, file=sys.stderr)
    for a in sweep:
        c = by_bse.get(a.get("bse")) or by_nse.get(a.get("nse"))
        if not c:
            continue
        doc = touched.get(c["symbol"]) or load(c["symbol"])
        merge_into(doc, [a])
        touched[c["symbol"]] = doc
        latest.append({"s": c["symbol"], "n": c["name"], **{k: a[k] for k in ("d", "t", "u", "k")}})
    print(f"Sweep: {len(sweep)} announcements, {len(touched)} companies")

    # 2. backfill history, stalest first
    def backfill_age(c):
        f = OUT / f"{c['symbol']}.json"
        if not f.exists():
            return float("inf")
        b = json.loads(f.read_text()).get("backfilled")
        return float("inf") if not b else (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(b)).days
    # biggest companies first (by market cap from the Yahoo index when available), NSE before BSE-only
    mcap = {}
    mf = ROOT / "data" / "yahoo" / "metrics.json"
    if mf.exists():
        try:
            mcap = {r["s"]: r["m"].get("marketCap") or 0 for r in json.loads(mf.read_text())["companies"]}
        except (ValueError, KeyError):
            mcap = {}
    queue = [c for c in universe if backfill_age(c) > 30]
    queue.sort(key=lambda c: (-backfill_age(c), not c["yahoo"].endswith(".NS"), -mcap.get(c["symbol"], 0), c["symbol"]))
    queue = queue[:args.max_backfill]
    hist_start = today - dt.timedelta(days=365 * args.years)
    for i, c in enumerate(queue):
        doc = touched.get(c["symbol"]) or load(c["symbol"])
        got = 0
        if c.get("bse"):
            try:
                a = bse_announcements(bse, c["bse"], hist_start, today, max_pages=25)
                r = bse_annual_reports(bse, c["bse"])
                merge_into(doc, a, r)
                got += len(a) + len(r)
            except Exception as e:  # noqa: BLE001
                print(f"  {c['symbol']}: BSE backfill failed ({e})", file=sys.stderr)
        if nse and c["yahoo"].endswith(".NS"):
            try:
                a = nse_announcements(nse, c["symbol"], hist_start, today)
                r = nse_annual_reports(nse, c["symbol"])
                merge_into(doc, a, r)
                got += len(a) + len(r)
            except Exception as e:  # noqa: BLE001
                print(f"  {c['symbol']}: NSE backfill failed ({e})", file=sys.stderr)
        if got:
            doc["backfilled"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        touched[c["symbol"]] = doc
        print(f"[{i + 1}/{len(queue)}] {c['symbol']}: {len(doc['announcements'])} announcements, {len(doc['annualReports'])} annual reports")

    for doc in touched.values():
        save(doc)

    # market-wide latest feed, merged with the previous one
    lf = OUT / "latest.json"
    prev = json.loads(lf.read_text()).get("items", []) if lf.exists() else []
    seen, items = set(), []
    for it in sorted(latest + prev, key=lambda a: a["d"], reverse=True):
        if it["u"] in seen:
            continue
        seen.add(it["u"])
        items.append(it)
    lf.write_text(json.dumps({"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "items": items[:500]},
                             separators=(",", ":")))
    print(f"Saved {len(touched)} company files, {len(items[:500])} items in latest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
