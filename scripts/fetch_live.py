"""Latest prices for every company (Yahoo's spark feed), for the site's 30-minute updates during market hours.

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


SPARK = "https://query1.finance.yahoo.com/v7/finance/spark"


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
    ap.add_argument("--chunk", type=int, default=20, help="companies a request (Yahoo allows 20)")
    ap.add_argument("--delay", type=float, default=0.3, help="seconds between requests")
    args = ap.parse_args(argv)

    tickers = tickers_from(args)
    if not tickers:
        print("No company list", file=sys.stderr)
        return 1
    by_yahoo = {}
    for sym, y in tickers.items():
        by_yahoo.setdefault(y, sym)
    names = list(by_yahoo)
    # Yahoo's spark feed: 20 companies a request (about 290 requests for every listed company),
    # through the browser-like session yfinance uses, so Yahoo does not rate-limit us
    from curl_cffi import requests as creq
    session = creq.Session(impersonate="chrome")
    ist = dt.timezone(dt.timedelta(hours=5, minutes=30))
    day_of = lambda ts: dt.datetime.fromtimestamp(ts, ist).strftime("%Y-%m-%d")
    rows, failed = {}, 0
    started = time.time()
    for i in range(0, len(names), args.chunk):
        batch = names[i:i + args.chunk]
        res = None
        for attempt in range(3):
            try:
                r = session.get(SPARK, params={"symbols": ",".join(batch), "range": "5d", "interval": "1d"}, timeout=20)
                if r.status_code == 200:
                    res = r.json().get("spark", {}).get("result") or []
                    break
                print("spark", r.status_code, "for batch", i // args.chunk, file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                print("spark failed:", e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
        if res is None:
            failed += 1
            continue
        for item in res:
            try:
                resp = (item.get("response") or [{}])[0]
                meta = resp.get("meta") or {}
                price = num(meta.get("regularMarketPrice"))
                when = meta.get("regularMarketTime")
                if not price or price <= 0 or not when:
                    continue
                day = day_of(when)
                ts = resp.get("timestamp") or []
                closes = ((resp.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
                prev = None
                for t, c in zip(ts, closes):
                    if c is not None and day_of(t) < day:
                        prev = num(c)
                if prev is None:
                    prev = num(meta.get("previousClose") or meta.get("chartPreviousClose"))
                vol = meta.get("regularMarketVolume")
                rows[by_yahoo[item["symbol"]]] = (day, [price, prev, None, num(meta.get("regularMarketDayHigh")),
                                                        num(meta.get("regularMarketDayLow")), int(vol) if vol else 0])
            except Exception:  # noqa: BLE001
                continue
        time.sleep(args.delay)
    print(f"{len(rows)} prices from {len(names)} tickers, {failed} requests failed")

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
