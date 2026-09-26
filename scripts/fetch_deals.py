#!/usr/bin/env python3
"""Bulk and block deals from NSE's public daily files into data/deals/deals.json.

NSE publishes the day's bulk deals (a client trading over 0.5% of a company's shares) and
block deals (large trades in the block window) as CSV files. Each run merges the day's file
into a rolling store (last --days days, default 400), so the history builds up over time.

    python scripts/fetch_deals.py
"""
import argparse
import csv
import datetime as dt
import io
import json
import sys
from pathlib import Path

from exchange import fetch_text

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "deals" / "deals.json"
SOURCES = {
    "bulk": ["https://nsearchives.nseindia.com/content/equities/bulk.csv", "https://archives.nseindia.com/content/equities/bulk.csv"],
    "block": ["https://nsearchives.nseindia.com/content/equities/block.csv", "https://archives.nseindia.com/content/equities/block.csv"],
}


def num(s):
    try:
        return float(str(s).replace(",", "").strip())
    except ValueError:
        return None


def parse_date(s):
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%B-%Y"):
        try:
            return dt.datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_deals(text, kind):
    """Rows of NSE's bulk/block CSV -> deal dicts. Column names vary a little, so match loosely."""
    out = []
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    for r in reader:
        g = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        pick = lambda *keys: next((g[k] for k in g for want in keys if want in k), "")
        d = parse_date(pick("date"))
        sym = pick("symbol").upper()
        side = pick("buy/sell", "buy / sell", "buy")[:1].upper()
        qty = num(pick("quantity"))
        price = num(pick("price"))
        if not (d and sym and side in ("B", "S") and qty and price):
            continue
        out.append({"d": d, "s": sym, "n": pick("security name", "name"), "c": pick("client"), "side": side, "q": int(qty),
                    "p": round(price, 2), "v": round(qty * price / 1e7, 2), "t": kind})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=400, help="days of deals to keep (default 400)")
    args = ap.parse_args(argv)
    store = json.loads(OUT.read_text()) if OUT.exists() else {"deals": []}
    deals = store.get("deals", [])
    key = lambda x: (x["d"], x["s"], x["c"], x["side"], x["q"], x["p"], x["t"])
    have = {key(x) for x in deals}
    added = 0
    for kind, urls in SOURCES.items():
        for url in urls:
            try:
                rows = parse_deals(fetch_text(url), kind)
            except Exception as e:  # noqa: BLE001
                print(f"{kind} deals: {url} failed ({str(e)[:80]})", file=sys.stderr)
                continue
            new = [x for x in rows if key(x) not in have]
            for x in new:
                have.add(key(x))
            deals += new
            added += len(new)
            print(f"{kind} deals: {len(rows)} in today's file, {len(new)} new" + (f" (latest {rows[0]['d']})" if rows else ""))
            break
    cutoff = (dt.date.today() - dt.timedelta(days=args.days)).isoformat()
    deals = sorted((x for x in deals if x["d"] >= cutoff), key=lambda x: (x["d"], x["v"]), reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "deals": deals}, separators=(",", ":")))
    print(f"Deals store: {len(deals)} deals ({added} new) -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
