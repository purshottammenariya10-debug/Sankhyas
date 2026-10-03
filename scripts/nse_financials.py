#!/usr/bin/env python3
"""Quarterly and annual financials for every main-board company, read from its results filings on NSE.

Yahoo gives four or five quarters and four years, consolidated only. NSE keeps every results filing
as XBRL since 2018, consolidated and standalone: each quarter's filing holds the quarter, and the
March filing also holds the full year, the balance sheet and the cash flow statement. This reads
them (the results list before 2025 and the integrated filings since) and keeps, for each basis,

    data/fin/<SYMBOL>.json   {"c": {"q": {end: row}, "y": {end: row}}, "s": {...}, "src": [urls read], "checked", "v"}
                             c = consolidated, s = standalone (Rs crore)

and then, for every company read (no network), fills its Yahoo file:
    quarterly   the last 13 quarters from NSE (consolidated when the company files it)
    annual      NSE's years over Yahoo's (Yahoo and the older NSE history keep the years NSE lacks)
    standalone  {"annual", "quarterly"} from the standalone filings, when the company files both,
                for the site's "View Standalone"

Banks and insurers file a different format (interest earned, premiums): they keep Yahoo's tables.

    python scripts/nse_financials.py [--max 300] [--files 4000] [SYMBOL ...]
    python scripts/nse_financials.py --merge-only
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exchange import NSE_HOME, nse_session  # noqa: E402
from sme_financials import ANNUAL_KEYS, HALF_KEYS, HEADERS, KEEP_YEARS, has_values, iso, label, load, parse_xbrl, table  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FIN = ROOT / "data" / "fin"
YAHOO = ROOT / "data" / "yahoo"
FILINGS = ROOT / "data" / "filings"
KEEP_Q = 13          # quarters shown, like Screener
VERSION = 1
RECHECK_DAYS = 30    # companies with nothing new filed are listed again after this


def listings(nse, sym):
    """Results filings on NSE: [(end, consolidated, broadcast, xbrl url, financial company)]."""
    out = []
    data = nse.get(NSE_HOME + "/api/integrated-filing-results",
                   params={"index": "equities", "symbol": sym, "type": "Integrated Filing- Financials", "period_ended": "all"})
    for r in ((data or {}).get("data") if isinstance(data, dict) else data) or []:
        end, url = iso(r.get("qe_Date") or ""), r.get("xbrl") or ""
        if end and url.endswith(".xml"):
            out.append((end, (r.get("consolidated") or "").lower().startswith("consolidated"), r.get("broadcast_Date") or "", url,
                        "BANKING" in url.upper() or "INSURANCE" in url.upper()))
    rows = nse.get(NSE_HOME + "/api/corporates-financial-results", params={"index": "equities", "symbol": sym, "period": "Quarterly"}) or []
    for r in rows if isinstance(rows, list) else []:
        end, url = iso(r.get("toDate") or ""), r.get("xbrl") or ""
        if end and url.endswith(".xml"):
            out.append((end, (r.get("consolidated") or "").lower().startswith("consolidated"), r.get("broadCastDate") or r.get("filingDate") or "", url,
                        (r.get("bank") or "N").upper() == "Y" or "BANKING" in url.upper() or "INSURANCE" in url.upper()))
    return out


def needed(rows):
    """The filings worth reading: the latest of each (period end, basis) among the last 13 quarter ends,
    and every March (full year) for the last 10 years."""
    best = {}
    for end, cons, when, url, fin in rows:
        k = (end, cons)
        if k not in best or when > best[k][2]:
            best[k] = (end, cons, when, url, fin)
    ends = sorted({e for e, _ in best}, reverse=True)
    recent = set(ends[:KEEP_Q + 1])
    cutoff = (dt.date.today() - dt.timedelta(days=365 * 10 + 120)).isoformat()
    return [v for (e, _), v in best.items() if e in recent or (e.endswith("-03-31") and e >= cutoff)]


def fetch(nse, sym, doc, budget):
    """Read the needed filings not read before (newest first, at most `budget`). Returns files read,
    or -1 for a bank or insurer."""
    rows = listings(nse, sym)
    if any(r[4] for r in rows):
        doc["skip"] = "financial"
        return -1
    seen = set(doc.get("src") or [])
    todo = sorted((r for r in needed(rows) if r[3] not in seen), key=lambda r: r[0], reverse=True)[:budget]

    def get(r):
        return r, parse_xbrl(requests.get(r[3], headers=HEADERS, timeout=60).text)

    got = 0
    with cf.ThreadPoolExecutor(6) as ex:
        futs = [ex.submit(get, r) for r in todo]
        results = []
        for fu in cf.as_completed(futs):
            try:
                results.append(fu.result())
            except Exception as e:  # noqa: BLE001
                print(f"  {sym}: XBRL failed ({str(e)[:60]})", file=sys.stderr)
    # oldest filing first, so a later filing of the same period wins
    for (end, cons, when, url, _), parsed in sorted(results, key=lambda x: (x[0][0], x[0][2])):
        basis = doc.setdefault("c" if cons else "s", {"q": {}, "y": {}})
        for kind, key in (("quarters", "q"), ("years", "y")):
            for e, row in parsed.get(kind, {}).items():
                old = basis[key].get(e)
                if old and kind == "years" and row.get("total") is None:
                    # a filing without the balance sheet keeps the one already read
                    row.update({k: old[k] for k in old if k not in row or row[k] is None})
                basis[key][e] = row
        seen.add(url)
        got += 1
    for b in ("c", "s"):
        if b in doc:
            for key, keep in (("q", KEEP_Q + 1), ("y", KEEP_YEARS)):
                for e in sorted(doc[b][key])[:-keep]:
                    del doc[b][key][e]
    doc["src"] = sorted(seen)[-80:]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    doc["v"] = VERSION
    doc["done"] = len(todo) < budget or got == len(needed(rows))
    doc.pop("skip", None)
    return got


SPLITS = (1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 20, 25, 50, 100)


def adjusted(store):
    """A copy with EPS on today's share base: EPS filed before a bonus issue or split is divided by its
    ratio (the share count, from the share capital and face value, jumps by a clean multiple)."""
    out = {e: dict(r) for e, r in store.items()}
    ends = sorted(e for e in out if out[e].get("sharesOut"))
    if not ends:
        return out
    now = out[ends[-1]]["sharesOut"]
    for e in out:
        sh, eps = out[e].get("sharesOut"), out[e].get("eps")
        if not sh or eps is None:
            continue
        ratio = now / sh
        m = next((x for x in SPLITS if abs(ratio / x - 1) < 0.04), None)
        if m:
            out[e]["eps"] = round(eps / m, 2)
    return out


def quarters_table(store):
    t = table(adjusted({e: store[e] for e in sorted(store)[-KEEP_Q:]}), HALF_KEYS)
    return t if len(t["periods"]) >= 4 else None


def merge(sym, doc):
    """Fill the company's Yahoo file from the NSE figures. No network. Returns True when changed."""
    yp = YAHOO / f"{sym}.json"
    ydoc = load(yp)
    if not ydoc or doc.get("skip"):
        return False
    c, s = doc.get("c") or {}, doc.get("s") or {}
    main, cons = (c, True) if (c.get("q") or c.get("y")) else (s, False)
    if not (main.get("q") or main.get("y")):
        return False
    before = json.dumps([ydoc.get("quarterly"), ydoc.get("annual"), ydoc.get("standalone")], sort_keys=True)
    q = quarters_table(main.get("q") or {})
    if q and not (ydoc.get("quarterly") or {}).get("half"):
        q.update(src="nse", cons=cons)
        ydoc["quarterly"] = q
    if main.get("y"):
        a0, nse = ydoc.get("annual") or {}, table(adjusted(main["y"]), ANNUAL_KEYS)
        if has_values(nse):
            if has_values(a0):
                when = lambda p: dt.datetime.strptime(p, "%b %Y")
                periods = sorted(set(a0["periods"]) | set(nse["periods"]), key=when)[-KEEP_YEARS:]
                col = lambda t, k, p: (t.get(k) or [None] * len(t["periods"]))[t["periods"].index(p)] if p in t["periods"] else None
                a = {"periods": periods}
                for k in set(ANNUAL_KEYS) | {k for k, v in a0.items() if isinstance(v, list) and len(v) == len(a0["periods"]) and k != "periods"}:
                    a[k] = [col(nse, k, p) if col(nse, k, p) is not None else col(a0, k, p) for p in periods]
                for k in ("cur", "histN"):
                    if k in a0:
                        a[k] = a0[k]
                # the older NSE history (fetch_history.py) stays the first histN years
                if a0.get("histN"):
                    first = a0["periods"][a0["histN"] - 1]
                    a["histN"] = sum(1 for p in periods if when(p) <= when(first))
                a["src"] = "nse+yahoo"
            else:
                a = dict(nse, src="nse")
            a["cons"] = cons
            ydoc["annual"] = a
    # standalone figures, when the company files both
    if cons and (s.get("q") or s.get("y")):
        st = {}
        sq = quarters_table(s.get("q") or {})
        if sq:
            st["quarterly"] = dict(sq, src="nse", cons=False)
        if s.get("y"):
            sa = table(adjusted(s["y"]), ANNUAL_KEYS)
            if has_values(sa):
                st["annual"] = dict(sa, src="nse", cons=False)
        if st:
            ydoc["standalone"] = st
    else:
        ydoc.pop("standalone", None)
    after = json.dumps([ydoc.get("quarterly"), ydoc.get("annual"), ydoc.get("standalone")], sort_keys=True)
    if after != before:
        yp.write_text(json.dumps(ydoc, separators=(",", ":")))
        return True
    return False


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*")
    ap.add_argument("--max", type=int, default=300, help="companies whose filings are listed this run")
    ap.add_argument("--files", type=int, default=4000, help="XBRL files read this run")
    ap.add_argument("--minutes", type=float, default=35, help="stop listing new companies after this")
    ap.add_argument("--merge-only", action="store_true")
    args = ap.parse_args(argv)
    FIN.mkdir(parents=True, exist_ok=True)
    universe = (load(ROOT / "data" / "universe.json") or {}).get("companies") or []
    syms = [c["symbol"] for c in universe if not c.get("sme") and c.get("yahoo", "").endswith(".NS") and (YAHOO / f"{c['symbol']}.json").exists()]
    if args.symbols:
        syms = [s.upper() for s in args.symbols]
    t0 = time.time()
    listed = files = 0
    if not args.merge_only:
        nse = nse_session()
        if nse is None:
            print("NSE not reachable; results filings not read", file=sys.stderr)
        else:
            mcap = {}
            for c in (load(YAHOO / "metrics.json") or {}).get("companies", []):
                mcap[c["s"]] = (c.get("m") or {}).get("marketCap") or 0
            since = (dt.datetime.now() - dt.timedelta(days=4)).isoformat()
            fresh = {a["s"] for a in (load(FILINGS / "latest.json") or {}).get("items", []) if a.get("k") == "results" and a.get("d", "") >= since}
            docs = {s: load(FIN / f"{s}.json") for s in syms}
            age = lambda d: (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(d["checked"])).days if d and d.get("checked") else 9999
            # just filed results first, then unfinished backfills and never read (largest companies first), then the stalest
            want = lambda s: s in fresh or not docs[s] or docs[s].get("v") != VERSION or not docs[s].get("done") or age(docs[s]) > RECHECK_DAYS
            queue = sorted((s for s in syms if want(s)), key=lambda s: (s not in fresh, bool(docs[s] and docs[s].get("done")), -mcap.get(s, 0)))[:args.max]
            for s in queue:
                if files >= args.files or time.time() - t0 > args.minutes * 60:
                    break
                doc = docs[s] or {"symbol": s}
                if doc.get("skip") and s not in fresh and age(doc) <= RECHECK_DAYS * 3:
                    continue
                try:
                    n = fetch(nse, s, doc, min(60, args.files - files))
                except Exception as e:  # noqa: BLE001
                    print(f"  {s}: results filings failed ({str(e)[:80]})", file=sys.stderr)
                    continue
                if n < 0:
                    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
                listed += 1
                files += max(0, n)
                (FIN / f"{s}.json").write_text(json.dumps(doc, separators=(",", ":")))
    merged = 0
    for p in FIN.glob("*.json"):
        d = load(p)
        if d and merge(p.stem, d):
            merged += 1
    have = sum(1 for p in FIN.glob("*.json") if (load(p) or {}).get("c") or (load(p) or {}).get("s"))
    print(f"NSE financials: {listed} companies listed, {files} filings read in {time.time() - t0:.0f}s; "
          f"{have} companies with NSE figures, {merged} company files updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
