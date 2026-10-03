#!/usr/bin/env python3
"""Data health check after each update: counts what the site has, compares them with the last run,
and flags sharp drops and stale data, so a broken source is caught within hours.

    data/yahoo/health.json  {"at", "status": "ok" | "alert", "warnings": [...], "metrics": {...},
                             "history": [{"at", "status", "metrics"}, ...]}   (last 60 runs)

Published with the site: the owners' dashboard (#/admin) shows it, and dispatch-alerts sends a
phone notification to the site's admins when the status is "alert".

    python scripts/health_check.py
"""
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "yahoo" / "health.json"
DROP = 0.85          # a count falling below 85% of the last run's is flagged
MIN_BASE = 50        # ...when it was at least this big
LABELS = {
    "companies": "companies on the site", "with_sales": "companies with sales figures", "smes": "SME companies on the site",
    "nse_results": "companies with NSE results (13 quarters)", "holder_names": "companies with named shareholders",
    "investors": "investors", "logos": "company logos", "results_list": "companies in the latest results list",
    "fo": "F&O stocks",
}


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def metrics():
    m = {}
    idx = load(DATA / "yahoo" / "metrics.json") or {}
    comps = idx.get("companies") or []
    m["companies"] = len(comps)
    m["with_sales"] = sum(1 for c in comps if (c.get("m") or {}).get("sales") is not None)
    universe = {c["symbol"]: c for c in (load(DATA / "universe.json") or {}).get("companies") or []}
    on_site = {c["s"] for c in comps}
    m["smes"] = sum(1 for s, c in universe.items() if c.get("sme") and s in on_site)
    m["fo"] = sum(1 for c in comps if c.get("fo"))
    m["nse_results"] = 0
    for p in (DATA / "fin").glob("*.json"):
        d = load(p) or {}
        if (d.get("c") or {}).get("q") or (d.get("s") or {}).get("q"):
            m["nse_results"] += 1
    m["holder_names"] = 0
    for p in (DATA / "shp").glob("*.json"):
        q = sorted(((load(p) or {}).get("quarters") or []), key=lambda x: x.get("q", ""))
        if q and q[-1].get("h"):
            m["holder_names"] += 1
    m["investors"] = len((load(DATA / "yahoo" / "investors.json") or {}).get("inv") or [])
    m["logos"] = len(list((DATA / "logos").glob("*.png")))
    m["results_list"] = len((load(DATA / "yahoo" / "results.json") or {}).get("results") or [])
    # how fresh: the latest trading day in the largest companies' prices, and the newest filing
    days = []
    for s in ("RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK"):
        d = load(DATA / "yahoo" / f"{s}.json")
        if d and (d.get("prices") or {}).get("dates"):
            days.append(d["prices"]["dates"][-1])
    m["price_day"] = max(days) if days else None
    items = (load(DATA / "filings" / "latest.json") or {}).get("items") or []
    m["filing_day"] = max((a.get("d") or "")[:10] for a in items) if items else None
    return m


def business_days_since(day, today):
    if not day:
        return 99
    d = dt.date.fromisoformat(day)
    n = 0
    while d < today:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def main():
    now = dt.datetime.now(dt.timezone.utc)
    prev = load(OUT) or {}
    hist = prev.get("history") or []
    before = (hist[-1] if hist else {}).get("metrics") or {}
    m = metrics()
    warn = []
    for k, label in LABELS.items():
        a, b = before.get(k), m.get(k)
        if isinstance(a, int) and isinstance(b, int) and a >= MIN_BASE and b < a * DROP:
            warn.append(f"{label[0].upper() + label[1:]} fell from {a:,} to {b:,} ({(b / a - 1) * 100:.0f}%)")
    # prices: the last trading day should be at most one business day old after the evening update
    lag = business_days_since(m["price_day"], (now + dt.timedelta(hours=5, minutes=30)).date())
    if lag > 2:
        warn.append(f"Prices are {lag} trading days old (last {m['price_day']}); the daily update may not be running")
    if business_days_since(m["filing_day"], now.date()) > 2:
        warn.append(f"No new exchange filings since {m['filing_day']}")
    status = "alert" if warn else "ok"
    hist = (hist + [{"at": now.isoformat(timespec="seconds"), "status": status, "metrics": m}])[-60:]
    OUT.write_text(json.dumps({"at": now.isoformat(timespec="seconds"), "status": status, "warnings": warn, "metrics": m, "history": hist},
                              separators=(",", ":")))
    print(f"Data health: {status}. " + ", ".join(f"{k} {v}" for k, v in m.items()))
    for w in warn:
        print("WARNING:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
