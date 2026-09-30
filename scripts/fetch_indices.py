#!/usr/bin/env python3
"""Index prices for the chart's Compare: Nifty 50, Sensex, Nifty Bank and Nifty IT, 10 years of daily closes.

Writes data/yahoo/indices.json: {"updated": ..., "indices": {"NIFTY50": {"name", "dates": [...], "close": [...]}}}.
An index that fails to download keeps its previous copy.

    python scripts/fetch_indices.py
"""
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "yahoo" / "indices.json"

# key used by the site, Yahoo symbol, name shown
INDICES = [
    ("NIFTY50", "^NSEI", "Nifty 50"),
    ("SENSEX", "^BSESN", "Sensex"),
    ("NIFTYBANK", "^NSEBANK", "Nifty Bank"),
    ("NIFTYIT", "^CNXIT", "Nifty IT"),
]


def main():
    import yfinance as yf
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text()).get("indices", {})
        except (ValueError, OSError):
            old = {}
    out = {}
    for key, sym, name in INDICES:
        try:
            hist = yf.Ticker(sym).history(period="10y", interval="1d", auto_adjust=False)
            dates, close = [], []
            for ts, v in hist["Close"].items():
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    continue
                dates.append(ts.strftime("%Y-%m-%d"))
                close.append(round(float(v), 2))
            if len(dates) < 200:
                raise ValueError(f"only {len(dates)} rows")
            out[key] = {"name": name, "dates": dates, "close": close}
            print(f"{name}: {len(dates)} days to {dates[-1]} ({close[-1]})")
        except Exception as e:  # keep the last good copy
            print(f"{name}: failed ({e}); keeping the previous copy" if key in old else f"{name}: failed ({e})")
            if key in old:
                out[key] = old[key]
    if out:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "indices": out}, separators=(",", ":")))


if __name__ == "__main__":
    main()
