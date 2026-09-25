#!/usr/bin/env python3
"""Fetch market data from Yahoo Finance into data/yahoo/*.json for the Sankhyas site.

Browsers cannot call Yahoo Finance directly (it blocks cross-origin requests), so this
script runs server-side (locally or in GitHub Actions) and writes static JSON that
the site loads on startup. Money values are converted to Rs. crores; EPS and prices stay in Rs.

Usage:
    pip install yfinance
    python scripts/fetch_yahoo.py                 # all symbols in scripts/symbols.txt
    python scripts/fetch_yahoo.py TCS INFY        # only these NSE symbols
    python scripts/fetch_yahoo.py --live-only     # site hides companies without Yahoo data
"""
import argparse
import datetime as dt
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "yahoo"
CRORE = 1e7


def clean(v, scale=1.0, nd=2):
    """Convert a pandas/numpy scalar to a rounded float, or None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f / scale, nd)


def period_label(ts):
    return ts.strftime("%b %Y")


def statement(df):
    """Return (columns sorted oldest->newest, getter(row_names) -> list)."""
    if df is None or getattr(df, "empty", True):
        return [], lambda *names, **kw: []
    cols = sorted(df.columns)

    def get(*names, scale=CRORE):
        for name in names:
            if name in df.index:
                row = df.loc[name]
                return [clean(row[c], scale) for c in cols]
        return [None] * len(cols)

    return cols, get


def add(*vals):
    if any(v is None for v in vals):
        return None
    return round(sum(vals), 2)


def income_block(df):
    cols, get = statement(df)
    if not cols:
        return {"periods": []}
    sales = get("Total Revenue", "Operating Revenue")
    op_income = get("Operating Income", "Total Operating Income As Reported")
    dep = get("Reconciled Depreciation", "Depreciation And Amortization In Income Statement", "Depreciation Amortization Depletion")
    interest = get("Interest Expense", "Interest Expense Non Operating")
    pbt = get("Pretax Income")
    tax = get("Tax Provision")
    np_ = get("Net Income Common Stockholders", "Net Income", "Net Income Including Noncontrolling Interests")
    eps = get("Basic EPS", "Diluted EPS", scale=1)
    ebitda = get("EBITDA", "Normalized EBITDA")

    op, other, expenses, tax_pct = [], [], [], []
    for i in range(len(cols)):
        o = add(op_income[i], dep[i] or 0) if op_income[i] is not None else None
        if o is None and ebitda[i] is not None:
            o = ebitda[i]
        if o is None and pbt[i] is not None:
            o = add(pbt[i], interest[i] or 0, dep[i] or 0)
        op.append(o)
        expenses.append(round(sales[i] - o, 2) if sales[i] is not None and o is not None else None)
        # other income is whatever reconciles operating profit to profit before tax
        if pbt[i] is not None and o is not None:
            other.append(round(pbt[i] - (o - (dep[i] or 0) - (interest[i] or 0)), 2))
        else:
            other.append(None)
        tax_pct.append(round(tax[i] / pbt[i] * 100, 2) if tax[i] is not None and pbt[i] else None)
    return {
        "periods": [period_label(c) for c in cols],
        "sales": sales, "expenses": expenses, "op": op, "otherIncome": other,
        "interest": interest, "depreciation": dep, "pbt": pbt, "tax": tax_pct, "np": np_, "eps": eps,
    }


def annual_block(t):
    inc = income_block(t.income_stmt)
    periods = inc["periods"]
    if not periods:
        return inc
    bcols, bget = statement(t.balance_sheet)
    ccols, cget = statement(t.cashflow)

    def align(cols, values):
        m = {period_label(c): v for c, v in zip(cols, values)}
        return [m.get(p) for p in periods]

    equity = align(bcols, bget("Common Stock", "Capital Stock"))
    total_eq = align(bcols, bget("Stockholders Equity", "Common Stock Equity"))
    borrowings = align(bcols, bget("Total Debt"))
    total = align(bcols, bget("Total Assets"))
    ppe = align(bcols, bget("Net PPE"))
    intang = align(bcols, bget("Goodwill And Other Intangible Assets"))
    cwip = align(bcols, bget("Construction In Progress"))
    invest = align(bcols, bget("Investments And Advances", "Long Term Equity Investment"))
    reserves, other_liab, fixed, other_assets = [], [], [], []
    for i in range(len(periods)):
        reserves.append(round(total_eq[i] - equity[i], 2) if total_eq[i] is not None and equity[i] is not None else None)
        other_liab.append(round(total[i] - total_eq[i] - (borrowings[i] or 0), 2) if total[i] is not None and total_eq[i] is not None else None)
        fa = add(ppe[i], intang[i] or 0) if ppe[i] is not None else None
        fixed.append(fa)
        other_assets.append(round(total[i] - (fa or 0) - (cwip[i] or 0) - (invest[i] or 0), 2) if total[i] is not None else None)
    cfo = align(ccols, cget("Operating Cash Flow", "Cash Flow From Continuing Operating Activities"))
    cfi = align(ccols, cget("Investing Cash Flow", "Cash Flow From Continuing Investing Activities"))
    cff = align(ccols, cget("Financing Cash Flow", "Cash Flow From Continuing Financing Activities"))
    net = align(ccols, cget("Changes In Cash"))
    net = [n if n is not None else add(a, b, c) for n, a, b, c in zip(net, cfo, cfi, cff)]
    inc.update({
        "equity": equity, "reserves": reserves, "borrowings": borrowings, "otherLiab": other_liab, "total": total,
        "fixedAssets": fixed, "cwip": cwip, "investments": invest, "otherAssets": other_assets,
        "receivables": align(bcols, bget("Accounts Receivable", "Receivables")),
        "inventory": align(bcols, bget("Inventory")),
        "payables": align(bcols, bget("Accounts Payable", "Payables")),
        "cfo": cfo, "cfi": cfi, "cff": cff, "net": net,
        "dividendsPaid": align(ccols, cget("Cash Dividends Paid", "Common Stock Dividend Paid")),
    })
    return inc


def quote_block(info):
    g = info.get
    pct = lambda v: clean(v * 100) if v is not None else None
    return {
        "price": clean(g("currentPrice") or g("regularMarketPrice")),
        "prevClose": clean(g("previousClose") or g("regularMarketPreviousClose")),
        "marketCap": clean(g("marketCap"), CRORE),
        "high52": clean(g("fiftyTwoWeekHigh")),
        "low52": clean(g("fiftyTwoWeekLow")),
        "pe": clean(g("trailingPE")),
        "bookValue": clean(g("bookValue")),
        "dividendRate": clean(g("dividendRate") if g("dividendRate") is not None else g("trailingAnnualDividendRate")),
        "roe": pct(g("returnOnEquity")),
        "shares": clean(g("sharesOutstanding"), CRORE, 4),
        "insiders": pct(g("heldPercentInsiders")),
        "institutions": pct(g("heldPercentInstitutions")),
    }


def build_company(symbol, t):
    """Build the JSON document for one NSE symbol from a yfinance Ticker-like object."""
    hist = t.history(period="10y", interval="1d", auto_adjust=False)
    if hist is None or hist.empty:
        raise ValueError("no price history")
    hist = hist.dropna(subset=["Close"])
    try:
        info = t.info or {}
    except Exception:  # info endpoint is flaky; statements and prices still work
        info = {}
    return {
        "symbol": symbol,
        "yahoo": symbol + ".NS",
        "name": info.get("longName") or info.get("shortName") or symbol,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "website": info.get("website"),
        "about": info.get("longBusinessSummary"),
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "quote": quote_block(info),
        "prices": {
            "dates": [d.strftime("%Y-%m-%d") for d in hist.index],
            "close": [clean(v) for v in hist["Close"]],
            "volume": [int(v) if v == v else 0 for v in hist["Volume"]],
        },
        "annual": annual_block(t),
        "quarterly": income_block(t.quarterly_income_stmt),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*", help="NSE symbols (default: scripts/symbols.txt)")
    ap.add_argument("--live-only", action="store_true", help="site shows only companies with Yahoo data")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds to wait between symbols")
    args = ap.parse_args(argv)

    import yfinance as yf

    symbols = args.symbols or [s.strip() for s in (ROOT / "scripts" / "symbols.txt").read_text().split() if s.strip()]
    symbols = [s.upper() for s in symbols]
    OUT.mkdir(parents=True, exist_ok=True)
    ok, failed = [], []
    for i, sym in enumerate(symbols):
        for attempt in range(3):
            try:
                doc = build_company(sym, yf.Ticker(sym + ".NS"))
                (OUT / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":")))
                ok.append(sym)
                print(f"[{i + 1}/{len(symbols)}] {sym}: {len(doc['prices']['close'])} prices, "
                      f"{len(doc['annual']['periods'])} years, {len(doc['quarterly']['periods'])} quarters")
                break
            except Exception as e:  # network errors, delisted symbols, rate limits
                if attempt == 2:
                    failed.append(sym)
                    print(f"[{i + 1}/{len(symbols)}] {sym}: FAILED ({e})", file=sys.stderr)
                else:
                    time.sleep(2 ** (attempt + 1))
        time.sleep(args.delay)

    # keep previously fetched files for symbols that failed this run
    existing = sorted(p.stem for p in OUT.glob("*.json") if p.stem != "index")
    index = {
        "source": "Yahoo Finance",
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "liveOnly": args.live_only,
        "symbols": sorted(set(existing) | set(ok)),
        "failed": failed,
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    print(f"Done: {len(ok)} ok, {len(failed)} failed -> {OUT}")
    return 0 if ok or not symbols else 1


if __name__ == "__main__":
    sys.exit(main())
