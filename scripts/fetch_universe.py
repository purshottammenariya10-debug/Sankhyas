#!/usr/bin/env python3
"""Build data/universe.json: every listed Indian equity with its NSE symbol, BSE code and Yahoo ticker.

Sources:
  - NSE equity list (EQUITY_L.csv): symbol, name, ISIN for every NSE-listed company.
  - BSE active scrip list: BSE code, name, ISIN, industry for every BSE-listed equity.
Companies are matched on ISIN. NSE-listed companies use SYMBOL.NS on Yahoo; BSE-only
companies use CODE.BO and their BSE code as the Sankhyas symbol.

If a source fails, the previous universe.json is kept for that exchange's entries.
"""
import argparse
import csv
import io
import json
import sys
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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nse-only", action="store_true", help="skip BSE-only companies")
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
