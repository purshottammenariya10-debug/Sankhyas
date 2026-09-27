#!/usr/bin/env python3
"""Quarterly shareholding pattern and quarterly results from NSE, for the shareholding history and
the results-day verdict cards.

NSE's lists are fetched through the Sankhyas relay (NSE refuses GitHub's servers); the XBRL files
themselves come straight from nsearchives.nseindia.com, which answers everywhere.

    data/shp/<SYMBOL>.json      {"quarters": [{"q": "2026-06-30", "promoter": 71.77, "fii": 9.06, "dii": 13.47,
                                               "gov": 0.0, "public": 5.7, "holders": 2605182, "pledge": 0.0}, ...]}
    data/results/<SYMBOL>.json  {"quarters": [{"qe": "2026-06-30", "cons": true, "filed": "...", "sales": 72275.0,
                                               "op": 18630.0, "np": 13420.0, "eps": 36.9, ...}, ...]}   (Rs crore)

Each run spends a budget on the companies that need it most: companies that filed results in the
last few days first, then those never fetched, then the stalest.

    python scripts/fetch_nse_extra.py --max-results 150 --max-shp 150
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import requests

from exchange import NSE_HOME, UA, nse_session

ROOT = Path(__file__).resolve().parent.parent
SHP_DIR = ROOT / "data" / "shp"
RES_DIR = ROOT / "data" / "results"
FILINGS = ROOT / "data" / "filings"
KEEP_SHP = 12       # quarters of shareholding history
KEEP_RES = 6        # quarters of results (enough for YoY and QoQ)
HEADERS = {"User-Agent": UA, "Referer": "https://www.nseindia.com/"}
FACT = re.compile(r"<([A-Za-z\-]+):([A-Za-z0-9]+)\b[^>]*?contextRef=\"([^\"]+)\"[^>]*>([^<]*)<")


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def iso_date(s):
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d-%b-%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s.strip().title(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            continue
    return None


def facts(text):
    """{(element, context): value} for every simple fact in an XBRL instance."""
    out = {}
    for _, name, ctx, val in FACT.findall(text):
        out.setdefault((name, ctx), val.strip())
    return out


# ---------- shareholding pattern ----------
SHP_ROWS = {"promoter": "ShareholdingOfPromoterAndPromoterGroup_ContextI", "fii": "InstitutionsForeign_ContextI",
            "dii": "InstitutionsDomestic_ContextI", "gov": "Governments_ContextI", "public_all": "PublicShareholding_ContextI"}


def read_shp_xbrl(url, limit=1_600_000):
    """Only the start of a shareholding XBRL is needed: the category totals come before the long
    list of individual holders, so stop reading once the grand total has been seen."""
    buf = ""
    with requests.get(url, headers=HEADERS, timeout=60, stream=True) as r:
        r.raise_for_status()
        for chunk in r.iter_content(65536, decode_unicode=True):
            buf += chunk if isinstance(chunk, str) else chunk.decode("utf-8", "ignore")
            i = buf.find('contextRef="ShareholdingPattern_ContextI"')
            if (i >= 0 and len(buf) > i + 40000) or len(buf) > limit:
                break
    return buf


def parse_shp(text):
    f = facts(text)
    pct = lambda ctx: (lambda v: round(v * 100, 2) if v is not None else None)(num(f.get(("ShareholdingAsAPercentageOfTotalNumberOfShares", ctx))))
    row = {k: pct(ctx) for k, ctx in SHP_ROWS.items()}
    if row["promoter"] is None:
        return None
    row["holders"] = num(f.get(("NumberOfShareholders", "ShareholdingPattern_ContextI")))
    if row["holders"] is not None:
        row["holders"] = int(row["holders"])
    # pledged / encumbered promoter shares as a % of the promoter holding
    prom_ctx = SHP_ROWS["promoter"]
    prom_shares = num(f.get(("NumberOfShares", prom_ctx)))
    pledged = [num(v) for (name, ctx), v in f.items() if ctx == prom_ctx and re.search(r"Pledged|Encumbered", name) and name.startswith("NumberOf")]
    pledged = [p for p in pledged if p is not None]
    row["pledge"] = round(max(pledged) / prom_shares * 100, 2) if pledged and prom_shares else 0.0
    inst = sum(v or 0 for v in (row["fii"], row["dii"], row["gov"]))
    row["public"] = round(max(0.0, 100 - (row["promoter"] or 0) - inst), 2)
    row.pop("public_all", None)
    return row


# ---------- quarterly results (Integrated Filing - Financials) ----------
RES_TAGS = {
    "sales": ["RevenueFromOperations", "InterestEarned"],
    "other_income": ["OtherIncome"],
    "income": ["Income", "TotalIncome"],
    "expenses": ["Expenses", "TotalExpenditure"],
    "interest": ["FinanceCosts", "InterestExpended"],
    "dep": ["DepreciationDepletionAndAmortisationExpense"],
    "exceptional": ["ExceptionalItemsBeforeTax", "ExceptionalItems"],
    "pbt": ["ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax"],
    "tax": ["TaxExpense"],
    "np": ["ProfitLossForPeriod", "ProfitLossForThePeriod"],
    "np_owners": ["ProfitOrLossAttributableToOwnersOfParent"],
    "eps": ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems"],
}


def parse_results(text):
    """The quarter's figures are the facts in context OneD (in a Q4 filing FourD is the full year)."""
    f = facts(text)
    get = lambda names: next((num(f[(n, "OneD")]) for n in names if (n, "OneD") in f and num(f[(n, "OneD")]) is not None), None)
    raw = {k: get(v) for k, v in RES_TAGS.items()}
    if raw["sales"] is None and raw["income"] is not None:
        raw["sales"] = raw["income"] - (raw["other_income"] or 0)
    if raw["sales"] is None or raw["np"] is None:
        return None
    cr = lambda v: None if v is None else round(v / 1e7, 2)
    out = {k: (raw[k] if k == "eps" else cr(raw[k])) for k in raw if k != "income"}
    # operating profit (EBITDA): revenue less operating costs (expenses without finance cost and depreciation)
    if raw["expenses"] is not None:
        out["op"] = cr(raw["sales"] - (raw["expenses"] - (raw["interest"] or 0) - (raw["dep"] or 0)))
    out["bank"] = ("InterestEarned", "OneD") in f
    return out


# ---------- runner ----------
def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def age_days(doc):
    try:
        return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(doc["checked"])).total_seconds() / 86400
    except (TypeError, KeyError, ValueError):
        return 1e9


def fresh_results_symbols(days=4):
    """Companies that filed financial results on the exchange in the last few days."""
    since = (dt.datetime.now() - dt.timedelta(days=days)).isoformat()
    out = []
    latest = load(FILINGS / "latest.json") or {}
    for a in latest.get("items", []):
        if a.get("k") == "results" and a.get("d", "") >= since:
            out.append(a["s"])
    return list(dict.fromkeys(out))


def update_results(nse, sym, stats):
    path = RES_DIR / f"{sym}.json"
    doc = load(path) or {"symbol": sym, "quarters": []}
    data = nse.get(NSE_HOME + "/api/integrated-filing-results",
                   params={"index": "equities", "symbol": sym, "type": "Integrated Filing- Financials", "period_ended": "all"})
    rows = (data or {}).get("data") if isinstance(data, dict) else data
    have = {q["qe"]: q for q in doc["quarters"]}
    by_q = {}
    for r in rows or []:
        qe = iso_date(r.get("qe_Date") or "")
        if not qe or not r.get("xbrl") or not r["xbrl"].endswith(".xml"):
            continue
        cons = (r.get("consolidated") or "").lower().startswith("consolidated")
        cur = by_q.get(qe)
        # prefer consolidated, then the latest revision
        if not cur or (cons and not cur[0]) or (cons == cur[0] and (r.get("broadcast_Date") or "") > (cur[1].get("broadcast_Date") or "")):
            by_q[qe] = (cons, r)
    for qe in sorted(by_q, reverse=True)[:KEEP_RES]:
        cons, r = by_q[qe]
        old = have.get(qe)
        if old and old.get("cons") == cons and old.get("src") == r["xbrl"]:
            continue
        try:
            text = requests.get(r["xbrl"], headers=HEADERS, timeout=60).text
            res = parse_results(text)
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {qe}: results XBRL failed ({str(e)[:60]})", file=sys.stderr)
            continue
        if not res:
            continue
        res.update({"qe": qe, "cons": cons, "filed": r.get("broadcast_Date"), "src": r["xbrl"]})
        have[qe] = res
        stats["res_q"] += 1
    doc["quarters"] = sorted(have.values(), key=lambda q: q["qe"], reverse=True)[:KEEP_RES]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    path.write_text(json.dumps(doc, separators=(",", ":")))


def update_shp(nse, sym, stats, xbrl_budget):
    path = SHP_DIR / f"{sym}.json"
    doc = load(path) or {"symbol": sym, "quarters": []}
    data = nse.get(NSE_HOME + "/api/corporate-share-holdings-master", params={"index": "equities", "symbol": sym})
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    have = {q["q"]: q for q in doc["quarters"]}
    by_q = {}
    for r in rows:
        q = iso_date(r.get("date") or "")
        if q and (q not in by_q or (r.get("broadcastDate") or "") > (by_q[q].get("broadcastDate") or "")):
            by_q[q] = r
    for q in sorted(by_q, reverse=True)[:KEEP_SHP]:
        r = by_q[q]
        cur = have.get(q) or {"q": q}
        cur["promoter"] = num(r.get("pr_and_prgrp")) if cur.get("fii") is None else cur.get("promoter")
        have[q] = cur
        if cur.get("fii") is not None and cur.get("src") == r.get("xbrl"):
            continue
        if not r.get("xbrl") or stats["shp_x"] >= xbrl_budget:
            continue
        try:
            row = parse_shp(read_shp_xbrl(r["xbrl"]))
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {q}: shareholding XBRL failed ({str(e)[:60]})", file=sys.stderr)
            continue
        stats["shp_x"] += 1
        if row:
            cur.update(row)
            cur["src"] = r["xbrl"]
    doc["quarters"] = sorted(have.values(), key=lambda x: x["q"], reverse=True)[:KEEP_SHP]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    path.write_text(json.dumps(doc, separators=(",", ":")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*", help="limit to these symbols")
    ap.add_argument("--max-results", type=int, default=150, help="companies whose results are refreshed per run")
    ap.add_argument("--max-shp", type=int, default=150, help="companies whose shareholding is refreshed per run")
    ap.add_argument("--max-shp-xbrl", type=int, default=400, help="shareholding XBRL files read per run")
    args = ap.parse_args(argv)

    upath = ROOT / "data" / "universe.json"
    universe = json.loads(upath.read_text())["companies"] if upath.exists() else [{"symbol": s, "yahoo": s + ".NS"} for s in (ROOT / "scripts" / "symbols.txt").read_text().split()]
    nse_syms = [c["symbol"] for c in universe if c.get("yahoo", "").endswith(".NS")]
    if args.symbols:
        nse_syms = [s for s in nse_syms if s in {x.upper() for x in args.symbols}]
    nse = nse_session()
    if not nse:
        print("NSE unavailable (no direct access and no relay); skipped")
        return 0
    SHP_DIR.mkdir(parents=True, exist_ok=True)
    RES_DIR.mkdir(parents=True, exist_ok=True)
    mcap = {}
    mf = ROOT / "data" / "yahoo" / "metrics.json"
    if mf.exists():
        try:
            mcap = {r["s"]: (r.get("m") or {}).get("marketCap") or 0 for r in json.loads(mf.read_text())["companies"]}
        except (ValueError, KeyError):
            pass
    stats = {"res": 0, "res_q": 0, "shp": 0, "shp_x": 0}
    t0 = time.time()

    # results: fresh filers first, then never fetched (largest first), then the stalest (refresh every 20 days)
    fresh = [s for s in fresh_results_symbols() if s in set(nse_syms)]
    docs = {s: load(RES_DIR / f"{s}.json") for s in nse_syms}
    never = sorted([s for s in nse_syms if not docs[s]], key=lambda s: -mcap.get(s, 0))
    stale = sorted([s for s in nse_syms if docs[s] and age_days(docs[s]) > 20], key=lambda s: -age_days(docs[s]))
    queue = list(dict.fromkeys([s for s in fresh if not docs[s] or age_days(docs[s]) > 0.25] + never + stale))[:args.max_results]
    for sym in queue:
        try:
            update_results(nse, sym, stats)
            stats["res"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"  {sym}: results list failed ({str(e)[:80]})", file=sys.stderr)
    print(f"Results: {stats['res']} companies checked ({len(fresh)} filed in the last days), {stats['res_q']} quarters read")

    # shareholding: never fetched (largest first), then due for the next quarter (every 15 days)
    docs = {s: load(SHP_DIR / f"{s}.json") for s in nse_syms}
    never = sorted([s for s in nse_syms if not docs[s]], key=lambda s: -mcap.get(s, 0))
    incomplete = [s for s in nse_syms if docs[s] and any(q.get("fii") is None for q in docs[s]["quarters"])]
    stale = sorted([s for s in nse_syms if docs[s] and age_days(docs[s]) > 15], key=lambda s: -age_days(docs[s]))
    queue = list(dict.fromkeys(never + incomplete + stale))[:args.max_shp]
    for sym in queue:
        if stats["shp_x"] >= args.max_shp_xbrl and docs.get(sym):
            continue
        try:
            update_shp(nse, sym, stats, args.max_shp_xbrl)
            stats["shp"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"  {sym}: shareholding list failed ({str(e)[:80]})", file=sys.stderr)
    print(f"Shareholding: {stats['shp']} companies checked, {stats['shp_x']} quarterly files read ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
