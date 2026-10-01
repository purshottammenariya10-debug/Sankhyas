#!/usr/bin/env python3
"""Financials for NSE Emerge (SME) companies, read from their results filings on NSE.

SME companies report every half year, not every quarter, and NSE lists their filings under the
'sme' index, which the main fetchers (index 'equities') never see; Yahoo has statements for only a
few of them. This reads each SME's results XBRL (the integrated filings since 2025 and the older
results list before that). A half-year filing holds the half (six months); the March filing also
holds the full year, the balance sheet and the cash flow statement.

    data/sme/<SYMBOL>.json      {"halves": {end: {...}}, "years": {end: {...}}, "src": [...], "checked"}   (Rs crore)

and then, for every SME (no network):
    data/results/<SYMBOL>.json  the half-years as "quarters" with "h": 1 (results page, verdict cards)
    data/yahoo/<SYMBOL>.json    when Yahoo has no statements: the annual table (profit and loss, balance
                                sheet, cash flow) and the half-years as the "quarterly" table, with
                                quarterly["half"] = true

    python scripts/sme_financials.py [--max 120] [SYMBOL ...]
    python scripts/sme_financials.py --merge-only
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exchange import NSE_HOME, UA, nse_session  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SME = ROOT / "data" / "sme"
RES = ROOT / "data" / "results"
YAHOO = ROOT / "data" / "yahoo"
FILINGS = ROOT / "data" / "filings"
HEADERS = {"User-Agent": UA, "Referer": "https://www.nseindia.com/"}
FACT = re.compile(r"<([A-Za-z\-]+):([A-Za-z0-9]+)\b[^>]*?contextRef=\"([^\"]+)\"[^>]*>([^<]*)<")
KEEP_YEARS, KEEP_HALVES = 12, 10
VERSION = 1

# profit and loss (duration contexts), Ind AS and the older (non-Ind AS) taxonomy alike
PL = {
    "sales": ["RevenueFromOperations"],
    "otherIncome": ["OtherIncome"],
    "income": ["Income", "TotalIncome"],
    "expensesAll": ["Expenses", "TotalExpenses"],
    "interest": ["FinanceCosts"],
    "depreciation": ["DepreciationDepletionAndAmortisationExpense", "DepreciationAndAmortisationExpense"],
    "exceptional": ["ExceptionalItems", "ExceptionalItemsBeforeTax"],
    "pbt": ["ProfitBeforeTax", "ProfitLossBeforeTax"],
    "taxAll": ["TaxExpense"],
    "currentTax": ["CurrentTax"],
    "deferredTax": ["DeferredTax"],
    "np": ["ProfitLossForPeriod", "ProfitLossForThePeriod"],
    "eps": ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems"],
    "paidUp": ["PaidUpValueOfEquityShareCapital"],
    "faceValue": ["FaceValueOfEquityShareCapital"],
}
# balance sheet (instant context at the period end)
BS = {
    "equity": ["ShareCapital", "EquityShareCapital"],
    "reserves": ["ReservesAndSurplus", "OtherEquity"],
    "ltBorrow": ["LongTermBorrowings", "BorrowingsNoncurrent", "NoncurrentBorrowings"],
    "stBorrow": ["ShortTermBorrowings", "BorrowingsCurrent", "CurrentBorrowings"],
    "total": ["Assets", "EquityAndLiabilities"],
    "fixed": ["FixedAssets", "PropertyPlantAndEquipment", "TangibleAssets"],
    "intang": ["IntangibleAssets", "OtherIntangibleAssets"],
    "cwip": ["CapitalWorkInProgress"],
    "ncInv": ["NoncurrentInvestments"],
    "cInv": ["CurrentInvestments"],
    "receivables": ["TradeReceivables", "TradeReceivablesCurrent", "CurrentTradeReceivables"],
    "inventory": ["Inventories"],
    "payables": ["TradePayables", "TradePayablesCurrent", "CurrentTradePayables"],
}
CF = {
    "cfo": ["CashFlowsFromUsedInOperatingActivities"],
    "cfi": ["CashFlowsFromUsedInInvestingActivities"],
    "cff": ["CashFlowsFromUsedInFinancingActivities"],
    "net": ["IncreaseDecreaseInCashAndCashEquivalents"],
    "dividendsPaid": ["DividendsPaidClassifiedAsFinancingActivities"],
}


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def iso(s):
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%d-%b-%Y %H:%M:%S"):
        try:
            return dt.datetime.strptime(str(s).strip().title(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def load(p):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def cr(v):
    return None if v is None else round(v / 1e7, 2)


def parse_xbrl(text):
    """{'halves': {end: row}, 'years': {end: row}} from one results XBRL file (values in Rs crore)."""
    facts = {}
    for _, name, ctx, val in FACT.findall(text):
        facts.setdefault((name, ctx), val.strip())
    get = lambda names, ctx: next((num(facts[(n, ctx)]) for n in names if (n, ctx) in facts and num(facts[(n, ctx)]) is not None), None)
    # duration contexts and the period each covers
    spans = {}
    for (name, ctx), v in facts.items():
        if name == "DateOfStartOfReportingPeriod":
            spans.setdefault(ctx, {})["s"] = v
        elif name == "DateOfEndOfReportingPeriod":
            spans.setdefault(ctx, {})["e"] = v
    out = {"halves": {}, "years": {}}
    for ctx, se in spans.items():
        try:
            s, e = dt.date.fromisoformat(se["s"]), dt.date.fromisoformat(se["e"])
        except (KeyError, ValueError):
            continue
        days = (e - s).days
        kind = "halves" if 150 <= days <= 200 else "years" if 330 <= days <= 400 else None
        if not kind:
            continue
        raw = {k: get(v, ctx) for k, v in PL.items()}
        sales = raw["sales"] if raw["sales"] is not None else (raw["income"] - (raw["otherIncome"] or 0) if raw["income"] is not None else None)
        if sales is None or raw["np"] is None:
            continue
        row = {"sales": cr(sales), "otherIncome": cr(raw["otherIncome"]), "interest": cr(raw["interest"]), "depreciation": cr(raw["depreciation"]),
               "pbt": cr(raw["pbt"]), "np": cr(raw["np"]), "eps": raw["eps"], "exceptional": cr(raw["exceptional"])}
        if raw["expensesAll"] is not None:
            # operating profit (EBITDA): revenue less operating costs (expenses without finance cost and depreciation)
            row["op"] = cr(sales - (raw["expensesAll"] - (raw["interest"] or 0) - (raw["depreciation"] or 0)))
        tax = raw["taxAll"] if raw["taxAll"] is not None else (None if raw["currentTax"] is None and raw["deferredTax"] is None else (raw["currentTax"] or 0) + (raw["deferredTax"] or 0))
        row["tax"] = round(tax / raw["pbt"] * 100, 2) if tax is not None and raw["pbt"] else None
        if raw["faceValue"]:
            row["faceValue"] = raw["faceValue"]
            # share count (crore): from the share capital, else the paid-up value; some filers state the
            # paid-up value in the wrong unit, so take the one that agrees with profit / EPS
            implied = raw["np"] / raw["eps"] if raw["eps"] else None
            cands = [v / raw["faceValue"] for v in (get(BS["equity"], "OneI"), raw["paidUp"]) if v]
            if implied and implied > 0:
                cands = [c for c in cands if 0.5 <= c / implied <= 2] or [implied]
            if cands:
                row["sharesOut"] = round(cands[0] / 1e7, 4)
        if kind == "years":
            for k, names in CF.items():
                row[k] = cr(get(names, ctx))
        out[kind][e.isoformat()] = row
    # the balance sheet at the filing's period end goes with the full year ending then
    inst = next((c for c in ("OneI",) if any(k[1] == c for k in facts)), None)
    if inst and out["years"]:
        end = max(out["years"])
        b = {k: get(v, inst) for k, v in BS.items()}
        y = out["years"][end]
        y["equity"], y["reserves"], y["total"] = cr(b["equity"]), cr(b["reserves"]), cr(b["total"])
        y["borrowings"] = cr((b["ltBorrow"] or 0) + (b["stBorrow"] or 0)) if b["ltBorrow"] is not None or b["stBorrow"] is not None else None
        fixed = None if b["fixed"] is None else b["fixed"] + (b["intang"] or 0)
        inv = None if b["ncInv"] is None and b["cInv"] is None else (b["ncInv"] or 0) + (b["cInv"] or 0)
        y["fixedAssets"], y["cwip"], y["investments"] = cr(fixed), cr(b["cwip"]), cr(inv)
        y["receivables"], y["inventory"], y["payables"] = cr(b["receivables"]), cr(b["inventory"]), cr(b["payables"])
        if y["total"] is not None:
            nw = (y["equity"] or 0) + (y["reserves"] or 0)
            y["otherLiab"] = round(y["total"] - nw - (y["borrowings"] or 0), 2) if y["equity"] is not None else None
            y["otherAssets"] = round(y["total"] - (y["fixedAssets"] or 0) - (y["cwip"] or 0) - (y["investments"] or 0), 2)
    return out


def listings(nse, sym):
    """Results filings on NSE for one SME: [(end, consolidated, broadcast, xbrl url)]."""
    out = []
    data = nse.get(NSE_HOME + "/api/integrated-filing-results",
                   params={"index": "sme", "symbol": sym, "type": "Integrated Filing- Financials", "period_ended": "all"})
    for r in ((data or {}).get("data") if isinstance(data, dict) else data) or []:
        end, url = iso(r.get("qe_Date") or ""), r.get("xbrl") or ""
        if end and url.endswith(".xml"):
            out.append((end, (r.get("consolidated") or "").lower().startswith("consolidated"), r.get("broadcast_Date") or r.get("revised_Date") or "", url))
    for period in ("Half-Yearly", "Annual"):
        rows = nse.get(NSE_HOME + "/api/corporates-financial-results", params={"index": "sme", "symbol": sym, "period": period}) or []
        for r in rows if isinstance(rows, list) else []:
            end, url = iso(r.get("toDate") or ""), r.get("xbrl") or ""
            if end and url.endswith(".xml"):
                out.append((end, (r.get("consolidated") or "").lower().startswith("consolidated"), r.get("filingDate") or "", url))
    return out


def fetch(nse, sym, doc):
    """Read the filings not read before; keep consolidated over standalone, the latest revision first."""
    rows = listings(nse, sym)
    seen = set(doc.get("src") or [])
    halves, years = doc.setdefault("halves", {}), doc.setdefault("years", {})
    got = 0
    # oldest first, so a later filing (or revision) of the same period wins
    for end, cons, _, url in sorted(rows, key=lambda r: (r[0], r[2])):
        if url in seen:
            continue
        try:
            text = requests.get(url, headers=HEADERS, timeout=60).text
            parsed = parse_xbrl(text)
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {end}: XBRL failed ({str(e)[:60]})", file=sys.stderr)
            continue
        seen.add(url)
        got += 1
        for kind, store in (("halves", halves), ("years", years)):
            for e, row in parsed[kind].items():
                old = store.get(e)
                if old and old.get("cons") and not cons:
                    continue                     # a consolidated period is not replaced by standalone
                row["cons"] = cons
                if old and kind == "years" and row.get("total") is None:
                    # an older-format filing without the balance sheet keeps the one already read
                    row.update({k: old[k] for k in old if k not in row or row[k] is None})
                store[e] = row
    for store, keep in ((halves, KEEP_HALVES), (years, KEEP_YEARS)):
        for e in sorted(store)[:-keep]:
            del store[e]
    doc["src"] = sorted(seen)[-60:]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    doc["v"] = VERSION
    return got


ANNUAL_KEYS = ["sales", "expenses", "op", "otherIncome", "interest", "depreciation", "pbt", "tax", "np", "eps",
               "equity", "reserves", "borrowings", "otherLiab", "total", "fixedAssets", "cwip", "investments", "otherAssets",
               "receivables", "inventory", "payables", "sharesOut", "cfo", "cfi", "cff", "net", "dividendsPaid"]
HALF_KEYS = ["sales", "expenses", "op", "otherIncome", "interest", "depreciation", "pbt", "tax", "np", "eps"]


def label(end):
    return dt.date.fromisoformat(end).strftime("%b %Y")


def table(store, keys):
    ends = sorted(e for e in store if store[e].get("sales") is not None)
    t = {"periods": [label(e) for e in ends]}
    for k in keys:
        if k == "expenses":
            t[k] = [round(store[e]["sales"] - store[e]["op"], 2) if store[e].get("op") is not None else None for e in ends]
        else:
            t[k] = [store[e].get(k) for e in ends]
    return t


def has_values(block):
    return bool(block and block.get("periods") and any(v is not None for v in block.get("sales") or []))


def merge(sym, doc):
    """Write the results file and fill Yahoo's empty statement tables. No network."""
    halves, years = doc.get("halves") or {}, doc.get("years") or {}
    if not halves and not years:
        return False
    # results page and verdict cards: half-years, newest first
    rp = RES / f"{sym}.json"
    rdoc = load(rp) or {"symbol": sym}
    rdoc["quarters"] = [dict({k: v for k, v in halves[e].items() if k in HALF_KEYS + ["cons", "exceptional"]}, qe=e, h=1)
                        for e in sorted(halves, reverse=True)[:6] if halves[e].get("sales") is not None]
    rdoc["half"] = True
    rdoc["checked"] = doc.get("checked")
    rp.write_text(json.dumps(rdoc, separators=(",", ":")))
    yp = YAHOO / f"{sym}.json"
    ydoc = load(yp)
    if not ydoc:
        return True
    changed = False
    if years:
        # the years NSE has, over Yahoo's (often stale or blank for SMEs); Yahoo keeps the older years
        a0, nse = ydoc.get("annual") or {}, table(years, ANNUAL_KEYS)
        if has_values(a0):
            when = lambda p: dt.datetime.strptime(p, "%b %Y")
            periods = sorted(set(a0["periods"]) | set(nse["periods"]), key=when)[-KEEP_YEARS:]
            col = lambda t, k, p: (t.get(k) or [None] * len(t["periods"]))[t["periods"].index(p)] if p in t["periods"] else None
            a = {"periods": periods}
            for k in ANNUAL_KEYS:
                a[k] = [col(nse, k, p) if col(nse, k, p) is not None else col(a0, k, p) for p in periods]
            a["src"] = "nse+yahoo"
        else:
            a = dict(nse, src="nse")
        a["histN"] = 0
        a["cons"] = bool(years[max(years)].get("cons"))
        if a != a0:
            ydoc["annual"] = a
            changed = True
    if halves and (not has_values(ydoc.get("quarterly")) or (ydoc.get("quarterly") or {}).get("half")):
        q = table(halves, HALF_KEYS)
        q["half"] = True
        ydoc["quarterly"] = q
        changed = True
    if changed:
        yp.write_text(json.dumps(ydoc, separators=(",", ":")))
    return changed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*")
    ap.add_argument("--max", type=int, default=120, help="SME companies whose filings are read this run")
    ap.add_argument("--merge-only", action="store_true")
    args = ap.parse_args(argv)
    SME.mkdir(parents=True, exist_ok=True)
    RES.mkdir(parents=True, exist_ok=True)
    up = ROOT / "data" / "universe.json"
    universe = (load(up) or {}).get("companies") or []
    smes = [c["symbol"] for c in universe if c.get("sme") and c.get("yahoo", "").endswith(".NS")]
    if args.symbols:
        smes = [s.upper() for s in args.symbols]
    t0 = time.time()
    fetched = files = 0
    if not args.merge_only:
        nse = nse_session()
        if nse is None:
            print("NSE not reachable; SME filings not read", file=sys.stderr)
        else:
            # filed results in the last few days first, then never read, then the stalest (every 20 days)
            since = (dt.datetime.now() - dt.timedelta(days=4)).isoformat()
            fresh = {a["s"] for a in (load(FILINGS / "latest.json") or {}).get("items", []) if a.get("k") == "results" and a.get("d", "") >= since}
            docs = {s: load(SME / f"{s}.json") for s in smes}
            age = lambda d: (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(d["checked"])).days if d and d.get("checked") else 9999
            queue = sorted(smes, key=lambda s: (s not in fresh, docs[s] is not None and docs[s].get("v") == VERSION, -age(docs[s])))
            queue = [s for s in queue if s in fresh or age(docs[s]) > 20 or not docs[s] or docs[s].get("v") != VERSION][:args.max]
            for s in queue:
                doc = docs[s] or {"symbol": s}
                try:
                    files += fetch(nse, s, doc)
                    fetched += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  {s}: SME filings failed ({str(e)[:80]})", file=sys.stderr)
                    continue
                (SME / f"{s}.json").write_text(json.dumps(doc, separators=(",", ":")))
    merged = 0
    for p in SME.glob("*.json"):
        d = load(p)
        if d and merge(p.stem, d):
            merged += 1
    have = sum(1 for p in SME.glob("*.json") if (load(p) or {}).get("years"))
    print(f"SME financials: {fetched} companies read ({files} filings) in {time.time() - t0:.0f}s; "
          f"{have} with annual figures, {merged} merged into results and statements")
    return 0


if __name__ == "__main__":
    sys.exit(main())
