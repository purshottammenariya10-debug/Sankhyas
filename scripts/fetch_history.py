#!/usr/bin/env python3
"""Ten-plus years of annual financials from NSE, merged in front of Yahoo's last four years.

Yahoo Finance only gives four years of annual statements. NSE keeps every company's audited annual
results since about 2005, each readable as data (corporates-financial-results-data, values in Rs lakh).
This script stores those years once per company (old years never change) and then prepends the
years Yahoo does not have to each company's annual table, so the site's tables, charts and 5/10-year
growth figures cover the full history.

    data/history/<SYMBOL>.json   {"symbol", "checked", "years": {"2016-03-31": {"cons": true, "sales": ..., ...}}}   (Rs crore)
    data/yahoo/<SYMBOL>.json     annual block gets the older years; annual["histN"] = how many were added

Only the profit and loss (and share capital, reserves) exist for old years; balance sheet and cash
flow rows stay blank for them. Before merging, the history must agree with Yahoo on a year both
have (revenue within 15%): that catches a different unit or a consolidated/standalone mismatch.

    python scripts/fetch_history.py [--max 40] [SYMBOL ...]      fetch for the companies most in need, then merge
    python scripts/fetch_history.py --merge-only
"""
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exchange import NSE_HOME, nse_session  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "data" / "history"
YAHOO = ROOT / "data" / "yahoo"
KEEP_YEARS = 12
LAKH_PER_CR = 100.0
PL_KEYS = ("sales", "expenses", "op", "otherIncome", "interest", "depreciation", "pbt", "tax", "np", "eps", "equity", "reserves")


def num(v):
    try:
        f = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f


def iso(d):
    try:
        return dt.datetime.strptime(str(d).strip().title(), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def first(d, *keys, allow_zero=False):
    for k in keys:
        v = num(d.get(k))
        if v is not None and (allow_zero or v != 0):
            return v
    return None


def parse_year(d):
    """One year's figures (Rs crore) from NSE's result data (Rs lakh), old and new formats alike."""
    r = d.get("resultsData2") or d.get("resultsData") or {}
    if isinstance(r, list):
        r = r[0] if r else {}
    cr = lambda v: None if v is None else round(v / LAKH_PER_CR, 2)
    bank = first(r, "re_int_earned") is not None
    if bank:
        sales = first(r, "re_int_earned")
        other = first(r, "re_oth_inc", "re_oth_inc_new", allow_zero=True)
        interest = first(r, "re_int_expd", allow_zero=True)
    else:
        gross = first(r, "re_gro_inc")
        sales = gross if gross is not None else (lambda a, b: None if a is None else a + (b or 0))(first(r, "re_net_sale"), first(r, "re_oth_opr_inc", allow_zero=True))
        other = first(r, "re_oth_inc_new", "re_oth_inc", allow_zero=True)
        interest = first(r, "re_int_new", "re_int", allow_zero=True)
    dep = first(r, "re_depr_und_exp", allow_zero=True)
    pbt = first(r, "re_pro_loss_bef_tax", allow_zero=True)
    tax = first(r, "re_tax", allow_zero=True)
    exc = first(r, "re_excepn_items_new", "re_excepn_items", "re_extraord_items", allow_zero=True) or 0
    np_ = first(r, "re_pl_own_par", "re_con_pro_loss", "re_net_profit", "re_proloss_ord_act", allow_zero=True)
    eps = first(r, "re_basic_eps_for_cont_dic_opr", "re_bsc_eps_bfr_exi", "re_basic_eps")
    if sales is None or pbt is None or np_ is None:
        return None
    # operating profit (EBITDA) the way the site computes it from Yahoo: before interest, depreciation, other income and one-offs
    op = None if bank else pbt + (interest or 0) + (dep or 0) - (other or 0) - exc
    out = {
        "sales": cr(sales), "op": cr(op), "expenses": cr(sales - op) if op is not None else None, "otherIncome": cr(other),
        "interest": cr(interest), "depreciation": cr(dep), "pbt": cr(pbt), "tax": round(tax / pbt * 100, 2) if tax is not None and pbt else None,
        "np": cr(np_), "eps": round(eps, 2) if eps is not None else None,
        "equity": cr(first(r, "re_pdup")), "reserves": cr(first(r, "re_res_reval", allow_zero=True)),
    }
    if bank:
        out["bank"] = True
    return out


def fetch(nse, sym, doc):
    rows = nse.get(NSE_HOME + "/api/corporates-financial-results", params={"index": "equities", "symbol": sym, "period": "Annual"}) or []
    if not isinstance(rows, list):
        return 0
    by = {}
    for r in rows:
        end = iso(r.get("toDate"))
        if not end or (r.get("relatingTo") or r.get("period")) != "Annual":
            continue
        cons = (r.get("consolidated") or "").lower().startswith("consolidated")
        # consolidated first, then the newer format (Ind AS), then the latest filing
        score = (cons, (r.get("format") or "") == "New" or "Ind-AS" in (r.get("indAs") or ""), r.get("broadCastDate") or "")
        if end not in by or score > by[end][0]:
            by[end] = (score, r, cons)
    years = doc.setdefault("years", {})
    got = 0
    for end in sorted(by, reverse=True)[:KEEP_YEARS]:
        score, r, cons = by[end]
        old = years.get(end)
        if old and (old.get("cons") or not cons):
            continue                              # have it (a consolidated year is not replaced by standalone)
        params = {"index": "equities", "params": r.get("params"), "seq_id": r.get("seqNumber"), "industry": r.get("industry") or "-",
                  "frOldNewFlag": r.get("oldNewFlag") or "N", "ind": r.get("reInd") or "N", "format": r.get("format") or "New"}
        try:
            data = nse.get(NSE_HOME + "/api/corporates-financial-results-data", params=params)
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {end}: {str(e)[:70]}", file=sys.stderr)
            continue
        y = parse_year(data or {})
        if y:
            y["cons"] = cons
            years[end] = y
            got += 1
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    return got


def label(end):
    return dt.date.fromisoformat(end).strftime("%b %Y")


def merge(sym):
    """Prepend the history years Yahoo lacks to data/yahoo/<sym>.json's annual block. Idempotent."""
    yp, hp = YAHOO / f"{sym}.json", HIST / f"{sym}.json"
    if not yp.exists() or not hp.exists():
        return False
    ydoc, hdoc = json.loads(yp.read_text()), json.loads(hp.read_text())
    a = ydoc.get("annual") or {}
    periods = a.get("periods") or []
    if not periods:
        return False
    keys = [k for k, v in a.items() if isinstance(v, list) and len(v) == len(periods) and k != "periods"]
    n = a.get("histN") or 0
    if n:                                          # take out what an earlier merge added
        for k in keys + ["periods"]:
            a[k] = a[k][n:]
        periods = a["periods"]
    years = hdoc.get("years") or {}
    # the history must agree with Yahoo where both have the year (same unit, same consolidation)
    ok = False
    for end, y in years.items():
        if label(end) in periods and y.get("sales"):
            ys = a["sales"][periods.index(label(end))]
            if ys:
                ok = 0.85 <= ys / y["sales"] <= 1.15
                break
    start = dt.datetime.strptime(periods[0], "%b %Y").date()       # Yahoo's oldest year
    room = max(0, KEEP_YEARS - len(periods))
    add = sorted(e for e in years if dt.date.fromisoformat(e) < start and years[e].get("sales"))[-room:] if ok and room else []
    if not add:
        a["histN"] = 0
        changed = n > 0
    else:
        for k in keys:
            a[k] = [years[e].get(k) if k in PL_KEYS else None for e in add] + a[k]
        a["periods"] = [label(e) for e in add] + periods
        a["histN"] = len(add)
        changed = True
    if changed:
        ydoc["annual"] = a
        yp.write_text(json.dumps(ydoc, separators=(",", ":")))
    return bool(add)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols", nargs="*")
    ap.add_argument("--max", type=int, default=40, help="companies whose history is fetched this run")
    ap.add_argument("--merge-only", action="store_true")
    args = ap.parse_args()
    HIST.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    fetched = years = 0
    if not args.merge_only:
        nse = nse_session()
        if nse is None:
            print("NSE not reachable; history not fetched", file=sys.stderr)
        else:
            mf = YAHOO / "metrics.json"
            mcap = {}
            if mf.exists():
                try:
                    mcap = {r["s"]: (r.get("m") or {}).get("marketCap") or 0 for r in json.loads(mf.read_text())["companies"]}
                except (ValueError, KeyError):
                    pass
            syms = [s.upper() for s in args.symbols] or [p.stem for p in YAHOO.glob("*.json") if p.stem.isupper() and (p.stem in mcap)]
            # never fetched first (largest companies first); refreshed yearly for the newest year
            def due(s):
                p = HIST / f"{s}.json"
                if not p.exists():
                    return True
                try:
                    c = json.loads(p.read_text()).get("checked", "")
                    return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(c)).days > 90
                except (ValueError, TypeError):
                    return True
            if args.symbols:
                queue = syms
            else:
                queue = sorted([s for s in syms if due(s)], key=lambda s: ((HIST / f"{s}.json").exists(), -mcap.get(s, 0)))[:args.max]
            for s in queue:
                p = HIST / f"{s}.json"
                doc = json.loads(p.read_text()) if p.exists() else {"symbol": s, "years": {}}
                try:
                    years += fetch(nse, s, doc)
                    fetched += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  {s}: history failed ({str(e)[:80]})", file=sys.stderr)
                    continue
                p.write_text(json.dumps(doc, separators=(",", ":")))
    merged = sum(1 for p in HIST.glob("*.json") if merge(p.stem))
    have = len(list(HIST.glob("*.json")))
    print(f"History: {fetched} companies fetched ({years} years read) in {time.time() - t0:.0f}s; {have} companies have history, {merged} merged into the annual tables")
    return 0


if __name__ == "__main__":
    sys.exit(main())
