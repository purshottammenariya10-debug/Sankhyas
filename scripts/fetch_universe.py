#!/usr/bin/env python3
"""Build data/universe.json: every listed Indian equity with its NSE symbol, BSE code and Yahoo ticker.

Sources:
  - NSE equity list (EQUITY_L.csv): symbol, name, ISIN for every NSE-listed company.
  - BSE active scrip list: BSE code, name, ISIN, industry for every BSE-listed equity.
  - Yahoo Finance equity screener (region India, exchanges NSI and BSE): every Indian company
    Yahoo covers. This fills in BSE-only companies when BSE's own list is blocked (it refuses
    cloud servers).
Companies are matched on ISIN (exchange lists) or on symbol/name (Yahoo). NSE-listed companies
use SYMBOL.NS on Yahoo; BSE-only companies use their Yahoo .BO ticker, and their BSE code or
BSE ticker is the Sankhyas symbol.

If a source fails, the previous universe.json is kept for that exchange's entries.
"""
import argparse
import csv
import io
import json
import re
import sys
import time
from pathlib import Path

from exchange import BSE_API, bse_session, fetch_text, nse_session

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "universe.json"
NSE_EQUITY_CSV = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"


def parse_nse_csv(text):
    rows = []
    reader = csv.DictReader(io.StringIO(text))
    for r in reader:
        r = {k.strip().upper(): (v or "").strip() for k, v in r.items() if k}
        sym = r.get("SYMBOL")
        if not sym or r.get("SERIES", "EQ") not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        rows.append({"symbol": sym, "name": r.get("NAME OF COMPANY") or sym, "isin": r.get("ISIN NUMBER", "")})
    return rows


def parse_bse_list(payload):
    items = payload if isinstance(payload, list) else (payload or {}).get("Table", [])
    out = []
    for it in items:
        g = {k.lower(): v for k, v in it.items()}
        code = str(g.get("scrip_cd") or g.get("scripcode") or g.get("security_code") or "").strip()
        if not code.isdigit():
            continue
        status = str(g.get("status", "Active"))
        if status and status.lower() not in ("active", "a"):
            continue
        out.append({
            "bse": code,
            "name": (g.get("scrip_name") or g.get("issuer_name") or g.get("security_name") or "").strip(),
            "bseId": (g.get("scrip_id") or g.get("security_id") or "").strip(),
            "isin": (g.get("isin_number") or g.get("isin_no") or "").strip(),
            "industry": (g.get("industry") or g.get("industry_new_name") or "").strip(),
        })
    return out


def merge(nse_rows, bse_rows, include_bse_only=True):
    by_isin = {b["isin"]: b for b in bse_rows if b["isin"]}
    out, seen_isin = [], set()
    for r in nse_rows:
        b = by_isin.get(r["isin"], {})
        out.append({"symbol": r["symbol"], "name": r["name"], "isin": r["isin"], "bse": b.get("bse", ""),
                    "industry": b.get("industry", ""), "yahoo": r["symbol"] + ".NS"})
        if r["isin"]:
            seen_isin.add(r["isin"])
    if include_bse_only:
        for b in bse_rows:
            if b["isin"] and b["isin"] in seen_isin:
                continue
            out.append({"symbol": b["bse"], "name": b["name"] or b["bseId"] or b["bse"], "isin": b["isin"], "bse": b["bse"],
                        "industry": b["industry"], "yahoo": b["bse"] + ".BO"})
    out.sort(key=lambda r: r["symbol"])
    return out


def norm_name(n):
    n = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower().replace("&", " and "))
    n = re.sub(r"\b(limited|ltd|the|india|co|company|corporation|corp|inc|pvt|private)\b", " ", n)
    return re.sub(r"\s+", "", n)


def yahoo_listing(max_rows=20000):
    """Every Indian equity on Yahoo's screener: [{ticker, name, exchange}] (exchange NSI or BSE)."""
    import yfinance as yf
    from yfinance import EquityQuery
    out = {}
    for ex in ("NSI", "BSE"):
        q = EquityQuery("and", [EquityQuery("eq", ["region", "in"]), EquityQuery("eq", ["exchange", ex])])
        offset, total = 0, None
        while offset < max_rows:
            r = None
            for attempt in range(3):
                try:
                    r = yf.screen(q, offset=offset, size=250, sortField="intradaymarketcap", sortAsc=False)
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"Yahoo screener {ex} offset {offset} failed ({e}); retrying", file=sys.stderr)
                    time.sleep(3 * (attempt + 1))
            quotes = (r or {}).get("quotes") or []
            total = (r or {}).get("total", total)
            for x in quotes:
                t = x.get("symbol") or ""
                if t.endswith((".NS", ".BO")):
                    out[t] = {"ticker": t, "name": x.get("longName") or x.get("shortName") or t[:-3], "exchange": ex}
            offset += len(quotes)
            if not quotes or (total is not None and offset >= total):
                break
            time.sleep(0.4)
        print(f"Yahoo screener {ex}: {sum(1 for v in out.values() if v['exchange'] == ex)} companies (Yahoo reports {total})")
    return list(out.values())


def add_yahoo(companies, listing):
    """Add Yahoo-listed companies the exchange lists missed (mostly BSE-only ones)."""
    have_sym = {c["symbol"] for c in companies}
    have_yahoo = {c["yahoo"] for c in companies}
    have_name = {norm_name(c["name"]) for c in companies if c.get("name")}
    added = 0
    for y in sorted(listing, key=lambda y: (not y["ticker"].endswith(".NS"), y["ticker"])):
        t, base = y["ticker"], y["ticker"][:-3]
        if t in have_yahoo:
            continue
        if t.endswith(".NS"):
            if base in have_sym:
                continue
        elif base in have_sym or (norm_name(y["name"]) and norm_name(y["name"]) in have_name):
            continue   # listed on NSE too: keep the NSE entry
        companies.append({"symbol": base, "name": y["name"], "isin": "", "bse": base if base.isdigit() else "",
                          "industry": "", "yahoo": t})
        have_sym.add(base); have_yahoo.add(t); have_name.add(norm_name(y["name"]))
        added += 1
    companies.sort(key=lambda r: r["symbol"])
    return added


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nse-only", action="store_true", help="skip BSE-only companies")
    ap.add_argument("--no-yahoo", action="store_true", help="skip the Yahoo screener listing")
    args = ap.parse_args(argv)

    previous = json.loads(OUT.read_text()) if OUT.exists() else {"companies": []}
    prev = previous.get("companies", [])

    nse_rows = []
    # the archive server usually answers without website cookies; try it first, then via a primed session
    try:
        nse_rows = parse_nse_csv(fetch_text(NSE_EQUITY_CSV))
        print(f"NSE equity list: {len(nse_rows)} companies")
    except Exception as e:  # noqa: BLE001
        print("NSE equity list (direct) failed:", e, file=sys.stderr)
        nse = nse_session()
        if not nse:
            print("NSE refused a session (its website often blocks cloud servers)", file=sys.stderr)
        else:
            try:
                nse_rows = parse_nse_csv(nse.get(NSE_EQUITY_CSV, expect_json=False).text)
                print(f"NSE equity list: {len(nse_rows)} companies")
            except Exception as e2:  # noqa: BLE001
                print("NSE equity list failed:", e2, file=sys.stderr)
    if not nse_rows:
        nse_rows = [{"symbol": c["symbol"], "name": c["name"], "isin": c.get("isin", "")} for c in prev if c["yahoo"].endswith(".NS")]
        print(f"Using previous NSE list ({len(nse_rows)} companies)")

    bse_rows = []
    try:
        payload = bse_session().get(f"{BSE_API}/ListofScripData/w",
                                    params={"Group": "", "Scripcode": "", "industry": "", "segment": "Equity", "status": "Active"})
        bse_rows = parse_bse_list(payload)
    except Exception as e:  # noqa: BLE001
        print("BSE scrip list failed:", e, file=sys.stderr)
    if not bse_rows:
        bse_rows = [{"bse": c["bse"], "name": c["name"], "bseId": "", "isin": c.get("isin", ""), "industry": c.get("industry", "")}
                    for c in prev if c.get("bse")]
        print(f"Using previous BSE list ({len(bse_rows)} companies)")

    companies = merge(nse_rows, bse_rows, include_bse_only=not args.nse_only)
    if not args.no_yahoo:
        try:
            listing = yahoo_listing()
            if args.nse_only:
                listing = [y for y in listing if y["ticker"].endswith(".NS")]
            print(f"Yahoo listing added {add_yahoo(companies, listing)} companies missing from the exchange lists")
        except Exception as e:  # noqa: BLE001
            print("Yahoo screener listing failed:", e, file=sys.stderr)
            # keep BSE-only companies found by an earlier run
            known = {c["yahoo"] for c in companies}
            kept = [c for c in prev if c.get("yahoo", "").endswith(".BO") and c["yahoo"] not in known and not args.nse_only]
            companies.extend(kept)
            if kept:
                print(f"Kept {len(kept)} Yahoo-listed companies from the previous universe")
    if not companies:
        # both exchanges refused and there is no earlier list: start from the built-in symbols so
        # the rest of the pipeline (Yahoo data) still runs; the full list is picked up once reachable
        builtin = [s.strip().upper() for s in (ROOT / "scripts" / "symbols.txt").read_text().split() if s.strip()]
        companies = [{"symbol": s, "name": s, "isin": "", "bse": "", "industry": "", "yahoo": s + ".NS"} for s in builtin]
        print(f"WARNING: NSE and BSE lists unavailable; using {len(companies)} built-in symbols", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"companies": companies}, separators=(",", ":")))
    nse_n = sum(1 for c in companies if c["yahoo"].endswith(".NS"))
    print(f"Universe: {len(companies)} companies ({nse_n} on NSE, {len(companies) - nse_n} BSE-only) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
