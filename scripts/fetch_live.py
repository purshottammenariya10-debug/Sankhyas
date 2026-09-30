"""Latest prices for every company, for the site's 30-minute updates during market hours.

Reads the company list (Sankhyas symbol -> Yahoo ticker) and writes one small file,
data/yahoo/live.json:

    {"t": fetch time (UTC ISO), "d": trading day (YYYY-MM-DD),
     "p": {SYMBOL: [price, previous close, open, high, low, volume]}}

Only companies that traded on the latest day are listed. The site applies these prices over the
daily data when they are newer than it (js/data.js), so lists, screens, watchlists, company pages
and the chart's last candle move during the day. The daily update (deploy.yml) stays the source
of everything else.

Usage: python scripts/fetch_live.py --tickers tickers.json [--metrics metrics.v2.json] --out live.json
"""
import argparse
import collections
import datetime as dt
import json
import sys
import time


def tickers_from(args):
    """{symbol: yahoo ticker} from tickers.json, else worked out from the compact index."""
    if args.tickers:
        try:
            t = json.load(open(args.tickers))
            if isinstance(t, dict) and t:
                return t
        except (OSError, ValueError):
            pass
    if args.metrics:
        v2 = json.load(open(args.metrics))
        out = {}
        for r in v2.get("c", []):
            x = r[5] if len(r) > 5 and isinstance(r[5], dict) else {}
            out[r[0]] = (str(x["bse"]) + ".BO") if x.get("ex") == "BSE" and x.get("bse") else r[0] + ".NS"
        return out
    return {}


def num(v, nd=2):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if v == v and v not in (float("inf"), float("-inf")) else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", help="JSON {symbol: yahoo ticker} (data/yahoo/tickers.json)")
    ap.add_argument("--metrics", help="compact index (metrics.v2.json), used when tickers.json is missing")
    ap.add_argument("--out", required=True)
    ap.add_argument("--chunk", type=int, default=200)
    args = ap.parse_args(argv)

    import yfinance as yf

    tickers = tickers_from(args)
    if not tickers:
        print("No company list", file=sys.stderr)
        return 1
    by_yahoo = {}
    for sym, y in tickers.items():
        by_yahoo.setdefault(y, sym)
    names = list(by_yahoo)
    rows = {}
    started = time.time()
    for i in range(0, len(names), args.chunk):
        batch = names[i:i + args.chunk]
        for attempt in range(2):
            try:
                df = yf.download(batch, period="5d", interval="1d", auto_adjust=False, group_by="ticker",
                                 progress=False, threads=True)
                break
            except Exception as e:  # noqa: BLE001
                print("batch", i // args.chunk, "failed:", e, file=sys.stderr)
                df = None
                time.sleep(5)
        if df is None or df.empty:
            continue
        for tk in batch:
            try:
                sub = (df[tk] if len(batch) > 1 else df).dropna(subset=["Close"])
            except Exception:  # noqa: BLE001
                continue
            if sub.empty:
                continue
            # one row per day (during market hours Yahoo can send today's row twice)
            days = collections.OrderedDict()
            for d, row in sub.iterrows():
                days[d.strftime("%Y-%m-%d")] = row
            ds = list(days)
            row = days[ds[-1]]
            price = num(row["Close"])
            if not price or price <= 0:
                continue
            prev = num(days[ds[-2]]["Close"]) if len(ds) > 1 else None
            vol = row["Volume"]
            rows[by_yahoo[tk]] = (ds[-1], [price, prev, num(row["Open"]), num(row["High"]), num(row["Low"]),
                                           int(vol) if vol == vol else 0])

    if len(rows) < 0.3 * len(tickers):
        print(f"Only {len(rows)} of {len(tickers)} companies came back; keeping the last prices.", file=sys.stderr)
        return 1
    # the latest trading day: the newest date at least 100 companies report (early in the session
    # thinly traded companies still show the day before; their daily data already has that close)
    counts = collections.Counter(d for d, _ in rows.values())
    day = max((d for d, n in counts.items() if n >= 100), default=counts.most_common(1)[0][0])
    out = {"t": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "d": day,
           "p": {s: v for s, (d, v) in sorted(rows.items()) if d == day}}
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"live.json: {len(out['p'])} of {len(tickers)} companies traded on {day}, "
          f"fetched in {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
