#!/usr/bin/env python3
"""Quarterly shareholding pattern and quarterly results from NSE, for the shareholding history and
the results-day verdict cards.

NSE's lists are fetched through the Sankhyas relay (NSE refuses GitHub's servers); the XBRL files
themselves come straight from nsearchives.nseindia.com, which answers everywhere.

    data/shp/<SYMBOL>.json      {"quarters": [{"q": "2026-06-30", "promoter": 71.77, "fii": 9.06, "dii": 13.47,
                                               "gov": 0.0, "public": 5.7, "holders": 2605182, "pledge": 0.0}, ...]}
    data/results/<SYMBOL>.json  {"quarters": [{"qe": "2026-06-30", "cons": true, "filed": "...", "sales": 72275.0,
                                               "op": 18630.0, "np": 13420.0, "eps": 36.9, ...,
                                               "seg": [{"n": "Retail", "rev": 90409.0, "ebit": 4529.0}, ...]}, ...]}   (Rs crore)

Each run spends a budget on the companies that need it most: companies that filed results in the
last few days first, then those never fetched, then the stalest.

    python scripts/fetch_nse_extra.py --max-results 150 --max-shp 150
"""
import argparse
import datetime as dt
import html
import json
import re
import sys
import time
from pathlib import Path

import requests

from exchange import NSE_HOME, UA, nse_session

ROOT = Path(__file__).resolve().parent.parent
SHP_DIR = ROOT / "data" / "shp"
RES_DIR = ROOT / "data" / "results"
FILINGS = ROOT / "data" / "filings"
KEEP_SHP = 12       # quarters of shareholding history
KEEP_RES = 6        # quarters of results (enough for YoY and QoQ)
KEEP_RES_BANK = 12  # banks: three years, for the NPA trend
HEADERS = {"User-Agent": UA, "Referer": "https://www.nseindia.com/"}
FACT = re.compile(r"<([A-Za-z\-]+):([A-Za-z0-9]+)\b[^>]*?contextRef=\"([^\"]+)\"[^>]*>([^<]*)<")


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def iso_date(s):
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d-%b-%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s.strip().title(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            continue
    return None


def facts(text):
    """{(element, context): value} for every simple fact in an XBRL instance."""
    out = {}
    for _, name, ctx, val in FACT.findall(text):
        out.setdefault((name, ctx), val.strip())
    return out


# ---------- shareholding pattern ----------
SHP_ROWS = {"promoter": "ShareholdingOfPromoterAndPromoterGroup_ContextI", "fii": "InstitutionsForeign_ContextI",
            "dii": "InstitutionsDomestic_ContextI", "gov": "Governments_ContextI", "public_all": "PublicShareholding_ContextI"}


def read_shp_xbrl(url, limit=8_000_000):
    """The whole shareholding XBRL: the category totals come first, then the named holders (every
    promoter group entity, and public holders of more than 1%)."""
    buf = ""
    with requests.get(url, headers=HEADERS, timeout=90, stream=True) as r:
        r.raise_for_status()
        for chunk in r.iter_content(65536, decode_unicode=True):
            buf += chunk if isinstance(chunk, str) else chunk.decode("utf-8", "ignore")
            if len(buf) > limit:
                break
    return buf


# named holders: the XBRL category of each name (prefix "DetailsOfSharesHeldBy" removed) tells the group
HOLDER_V = 1
DII_CATS = ("MutualFundsOrUTI", "VentureCapitalFunds", "AlternativeInvestmentFunds", "Banks", "InsuranceCompanies", "ProvidentFundsOrPensionFunds",
            "AssetReconstructionCompanies", "SovereignWealthFundsDomestic", "NBFCsRegisteredWithRBI", "OtherFinancialInstitutions", "OtherInstitutionsDomestic")
PROMOTER_CATS = ("IndividualsOrHUF", "IndividualsOrHinduUndividedFamily", "OthersIndianShareholders", "OtherForeignShareholders",
                 "CentralGovernmentOrStateGovernment", "CentralGovernmentOrStateGovernments", "FinancialInstitutionsOrBanks",
                 "IndividualsNonResidentIndividualsOrForeignIndividuals")
GOV_CATS = ("CentralGovernmentOrPresidentOfIndia", "StateGovernmentsOrGovernors", "ShareholdingByCompaniesOrBodiesCorporateWhereCentralOrStateGovernmentIsPromoter")
SKIP_CATS = ("CustodianOrDRHolder", "EmployeeBenefitsTrusts")


def holder_group(cat):
    cat = re.sub(r"^DetailsOfSharesHeldBy", "", cat)
    if cat in SKIP_CATS:
        return None
    if cat in PROMOTER_CATS:
        return "promoter"
    if cat in DII_CATS:
        return "dii"
    if cat in GOV_CATS:
        return "gov"
    if "Foreign" in cat and cat not in ("ForeignNationals", "ForeignCompanies"):
        return "fii"
    return "public"


def parse_holders(text, mult):
    """{group: [[name, %], ...]} largest first; holders at 0% (dormant promoter group entities) left out."""
    f = facts(text)
    out = {}
    for (name, ctx), val in f.items():
        if name != "NameOfTheShareholder" or not ctx.startswith("D_"):
            continue
        c = ctx[2:]
        p = num(f.get(("ShareholdingAsAPercentageOfTotalNumberOfShares", c)))
        g = holder_group(re.sub(r"_Context\w+$", "", c))
        if g is None or p is None or p <= 0:
            continue
        nm = html.unescape(val).strip()
        if nm:
            out.setdefault(g, []).append([nm[:90], round(p * mult, 2)])
    for g in out:
        # one entry per name (some filers list a holder twice), largest first, at most 30 a group
        best = {}
        for nm, p in out[g]:
            best[nm] = max(p, best.get(nm, 0))
        out[g] = sorted(([k, v] for k, v in best.items()), key=lambda x: -x[1])[:30]
    return out


def parse_shp(text):
    f = facts(text)
    share = lambda ctx: num(f.get(("ShareholdingAsAPercentageOfTotalNumberOfShares", ctx)))
    # newer filings give fractions (0.7177), older ones percentages (71.77): the grand total tells which
    total = share("ShareholdingPattern_ContextI")
    vals = [share(ctx) for ctx in SHP_ROWS.values()]
    mult = 1 if (total or 0) > 1.5 or (total is None and any((v or 0) > 1 for v in vals)) else 100
    pct = lambda ctx: (lambda v: round(v * mult, 2) if v is not None else None)(share(ctx))
    row = {k: pct(ctx) for k, ctx in SHP_ROWS.items()}
    if row["promoter"] is None:
        # companies with no promoter group (HDFC Bank, ITC, L&T ...) file no promoter row at all
        if row["fii"] is None and row["dii"] is None and row["public_all"] is None:
            return None
        row["promoter"] = 0.0
    row["holders"] = num(f.get(("NumberOfShareholders", "ShareholdingPattern_ContextI")))
    if row["holders"] is not None:
        row["holders"] = int(row["holders"])
    # pledged / encumbered promoter shares as a % of the promoter holding
    prom_ctx = SHP_ROWS["promoter"]
    prom_shares = num(f.get(("NumberOfShares", prom_ctx)))
    pledged = [num(v) for (name, ctx), v in f.items() if ctx == prom_ctx and re.search(r"Pledged|Encumbered", name) and name.startswith("NumberOf")]
    pledged = [p for p in pledged if p is not None]
    row["pledge"] = round(max(pledged) / prom_shares * 100, 2) if pledged and prom_shares else 0.0
    inst = sum(v or 0 for v in (row["fii"], row["dii"], row["gov"]))
    row["public"] = round(max(0.0, 100 - (row["promoter"] or 0) - inst), 2)
    row.pop("public_all", None)
    row["h"] = parse_holders(text, mult)
    row["hv"] = HOLDER_V
    return row


# ---------- quarterly results (Integrated Filing - Financials) ----------
RES_TAGS = {
    "sales": ["RevenueFromOperations", "InterestEarned"],
    "other_income": ["OtherIncome"],
    "income": ["Income", "TotalIncome"],
    "expenses": ["Expenses", "TotalExpenditure"],
    "interest": ["FinanceCosts", "InterestExpended"],
    "dep": ["DepreciationDepletionAndAmortisationExpense"],
    "exceptional": ["ExceptionalItemsBeforeTax", "ExceptionalItems"],
    "pbt": ["ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax"],
    "tax": ["TaxExpense"],
    "np": ["ProfitLossForPeriod", "ProfitLossForThePeriod"],
    "np_owners": ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates"],
    "opex": ["OperatingExpenses"],                                  # banks
    "prov": ["ProvisionsOtherThanTaxAndContingencies"],             # banks
    "eps": ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsPerShareAfterExtraordinaryItems"],
}


def parse_results(text):
    """The quarter's figures are the facts in context OneD (in a Q4 filing FourD is the full year)."""
    f = facts(text)
    get = lambda names: next((num(f[(n, "OneD")]) for n in names if (n, "OneD") in f and num(f[(n, "OneD")]) is not None), None)
    raw = {k: get(v) for k, v in RES_TAGS.items()}
    if raw["sales"] is None and raw["income"] is not None:
        raw["sales"] = raw["income"] - (raw["other_income"] or 0)
    if raw["sales"] is None or raw["np"] is None:
        return None
    cr = lambda v: None if v is None else round(v / 1e7, 2)
    out = {k: (raw[k] if k == "eps" else cr(raw[k])) for k in raw if k != "income"}
    # operating profit (EBITDA): revenue less operating costs (expenses without finance cost and depreciation)
    if raw["expenses"] is not None:
        out["op"] = cr(raw["sales"] - (raw["expenses"] - (raw["interest"] or 0) - (raw["dep"] or 0)))
    if out.get("np_owners") == 0 and out.get("np"):
        out["np_owners"] = None  # left blank as 0 by some filers without minority interest
    out["bank"] = ("InterestEarned", "OneD") in f
    if out["bank"]:
        out.update(bank_ratios(f))
    else:
        out.pop("opex", None)
        out.pop("prov", None)
    seg = parse_segments(f)
    if seg:
        out["seg"] = seg
    out["sv"] = SEG_VERSION
    return out


BANK_VERSION = 1
BANK_RATIOS = {"gnpa": "PercentageOfGrossNpa", "nnpa": "PercentageOfNpa", "cet1": "CET1Ratio", "roa": "ReturnOnAssets"}


def bank_ratios(f):
    """Gross and net NPA %, CET1 and return on assets. Integrated filings state them as fractions
    (0.0117 = 1.17%); banks file them in the standalone results only (the consolidated file has 0)."""
    out = {}
    for k, tag in BANK_RATIOS.items():
        v = num(f.get((tag, "OneD")))
        if v:
            out[k] = round(v * 100 if abs(v) < 1 else v, 2)
    return out


# ---------- business segments (Ind AS 108 segment reporting in the same results file) ----------
SEG_VERSION = 2
SEG_SKIP = re.compile(r"^\s*(?:\(?add\)?|\(?less\)?|total|unallocable|unallocated|inter[- ]?segment|elimination|eliminations|reconcil)", re.I)


def parse_segments(f):
    """[{"n": "Retail", "rev": 90409.0, "ebit": 4529.0}, ...] for the quarter (Rs crore): revenue from
    contexts OneReportable<k>D, segment result (profit before interest and tax) from OneReportableFinance<k>D;
    each carries the segment's name in DescriptionOfReportableSegment. Single-segment companies file none."""
    if re.match(r"single", f.get(("IsCompanyReportingMultisegmentOrSingleSegment", "OneD"), ""), re.I):
        return None
    by = {}
    for (name, ctx), val in f.items():
        m = re.fullmatch(r"OneReportable(Finance)?(\d+)D", ctx)
        if not m:
            continue
        key = (bool(m.group(1)), int(m.group(2)))
        row = by.setdefault(key, {})
        if name == "DescriptionOfReportableSegment":
            row["n"] = re.sub(r"\s+", " ", html.unescape(val)).strip(" .:-")
        elif name == "SegmentRevenue" or (name == "SegmentRevenueFromOperations" and "v" not in row):
            row["v"] = num(val)
        elif name == "SegmentProfitLossBeforeTaxAndFinanceCosts":
            row["v"] = num(val)
            row["std"] = True
        elif key[0] and not row.get("std") and re.match(r"Segment\w*(?:Result|ProfitLoss)", name) and num(val) is not None:
            row["v"] = num(val)                        # banks and insurers file their segment result under other names
    revs = {r["n"]: r["v"] for (fin, k), r in sorted(by.items()) if not fin and r.get("n") and r.get("v") is not None}
    ebit = {r["n"]: r["v"] for (fin, k), r in sorted(by.items()) if fin and r.get("n") and r.get("v") is not None}
    out = []
    for n in list(dict.fromkeys(list(revs) + list(ebit))):
        if SEG_SKIP.match(n) or len(n) > 90:
            continue
        rv, eb = revs.get(n), ebit.get(n)
        if not rv and not eb:
            continue                                  # reconciliation rows filed as 0
        out.append({"n": n, "rev": None if rv is None else round(rv / 1e7, 2), "ebit": None if eb is None else round(eb / 1e7, 2)})
    return out if len(out) >= 2 else None


# ---------- runner ----------
def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def age_days(doc):
    try:
        return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(doc["checked"])).total_seconds() / 86400
    except (TypeError, KeyError, ValueError):
        return 1e9


def fresh_results_symbols(days=4):
    """Companies that filed financial results on the exchange in the last few days."""
    since = (dt.datetime.now() - dt.timedelta(days=days)).isoformat()
    out = []
    latest = load(FILINGS / "latest.json") or {}
    for a in latest.get("items", []):
        if a.get("k") == "results" and a.get("d", "") >= since:
            out.append(a["s"])
    return list(dict.fromkeys(out))


def update_results(nse, sym, stats):
    path = RES_DIR / f"{sym}.json"
    doc = load(path) or {"symbol": sym, "quarters": []}
    data = nse.get(NSE_HOME + "/api/integrated-filing-results",
                   params={"index": "equities", "symbol": sym, "type": "Integrated Filing- Financials", "period_ended": "all"})
    rows = (data or {}).get("data") if isinstance(data, dict) else data
    have = {q["qe"]: q for q in doc["quarters"]}
    by_q, alone = {}, {}
    for r in rows or []:
        qe = iso_date(r.get("qe_Date") or "")
        if not qe or not r.get("xbrl") or not r["xbrl"].endswith(".xml"):
            continue
        cons = (r.get("consolidated") or "").lower().startswith("consolidated")
        if not cons and (r.get("broadcast_Date") or "") >= (alone.get(qe, {}).get("broadcast_Date") or ""):
            alone[qe] = r
        cur = by_q.get(qe)
        # prefer consolidated, then the latest revision
        if not cur or (cons and not cur[0]) or (cons == cur[0] and (r.get("broadcast_Date") or "") > (cur[1].get("broadcast_Date") or "")):
            by_q[qe] = (cons, r)
    keep = KEEP_RES_BANK if any("BANKING" in (r.get("xbrl") or "") for _, r in by_q.values()) else KEEP_RES
    for qe in sorted(by_q, reverse=True)[:keep]:
        cons, r = by_q[qe]
        old = have.get(qe)
        if old and old.get("cons") == cons and old.get("src") == r["xbrl"] and old.get("sv") == SEG_VERSION and (not old.get("bank") or old.get("bv") == BANK_VERSION):
            continue
        try:
            text = requests.get(r["xbrl"], headers=HEADERS, timeout=60).text
            res = parse_results(text)
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {qe}: results XBRL failed ({str(e)[:60]})", file=sys.stderr)
            continue
        if not res:
            continue
        if res.get("bank"):
            # NPA ratios are in the standalone filing only
            if "gnpa" not in res and qe in alone and alone[qe].get("xbrl") != r["xbrl"]:
                try:
                    res.update({k: v for k, v in bank_ratios(facts(requests.get(alone[qe]["xbrl"], headers=HEADERS, timeout=60).text)).items() if k not in res})
                except Exception as e:  # noqa: BLE001
                    print(f"  {sym} {qe}: standalone results for NPA failed ({str(e)[:60]})", file=sys.stderr)
            res["bv"] = BANK_VERSION
        res.update({"qe": qe, "cons": cons, "filed": r.get("broadcast_Date"), "src": r["xbrl"]})
        have[qe] = res
        stats["res_q"] += 1
    doc["quarters"] = sorted(have.values(), key=lambda q: q["qe"], reverse=True)[:keep]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    path.write_text(json.dumps(doc, separators=(",", ":")))


QUARTER_ENDS = ("03-31", "06-30", "09-30", "12-31")


def repair_shp_scale(doc):
    """Rows read before the percentage-scale fix hold values 100x too large; bring them back."""
    changed = False
    for q in doc.get("quarters", []):
        if any((q.get(k) or 0) > 100.5 for k in ("promoter", "fii", "dii", "gov")):
            for k in ("promoter", "fii", "dii", "gov"):
                if q.get(k) is not None:
                    q[k] = round(q[k] / 100, 2)
            inst = sum(q.get(k) or 0 for k in ("fii", "dii", "gov"))
            q["public"] = round(max(0.0, 100 - (q.get("promoter") or 0) - inst), 2)
            changed = True
    return changed


def update_shp(nse, sym, stats, xbrl_budget, index="equities"):
    path = SHP_DIR / f"{sym}.json"
    doc = load(path) or {"symbol": sym, "quarters": []}
    # SME companies (NSE Emerge) are listed under the 'sme' index and file every half year
    data = nse.get(NSE_HOME + "/api/corporate-share-holdings-master", params={"index": index, "symbol": sym})
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    # off-cycle filings (e.g. after a scheme or a preferential allotment) carry odd dates; keep quarter-ends only
    have = {q["q"]: q for q in doc["quarters"] if q["q"][5:] in QUARTER_ENDS}
    by_q = {}
    for r in rows:
        q = iso_date(r.get("date") or "")
        if q and q[5:] in QUARTER_ENDS and (q not in by_q or (r.get("broadcastDate") or "") > (by_q[q].get("broadcastDate") or "")):
            by_q[q] = r
    names_read = 0
    for q in sorted(by_q, reverse=True)[:KEEP_SHP]:
        r = by_q[q]
        cur = have.get(q) or {"q": q}
        cur["promoter"] = num(r.get("pr_and_prgrp")) if cur.get("fii") is None else cur.get("promoter")
        have[q] = cur
        if cur.get("fii") is not None and cur.get("src") == r.get("xbrl"):
            if cur.get("hv") == HOLDER_V or names_read >= 4:
                continue
            names_read += 1                       # read again for the named holders (newest quarters first)
        if not r.get("xbrl") or stats["shp_x"] >= xbrl_budget:
            continue
        try:
            row = parse_shp(read_shp_xbrl(r["xbrl"]))
        except Exception as e:  # noqa: BLE001
            print(f"  {sym} {q}: shareholding XBRL failed ({str(e)[:60]})", file=sys.stderr)
            continue
        stats["shp_x"] += 1
        if row:
            cur.update(row)
            cur["src"] = r["xbrl"]
    doc["quarters"] = sorted(have.values(), key=lambda x: x["q"], reverse=True)[:KEEP_SHP]
    doc["checked"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    doc["idx"] = index
    path.write_text(json.dumps(doc, separators=(",", ":")))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("symbols", nargs="*", help="limit to these symbols")
    ap.add_argument("--max-results", type=int, default=150, help="companies whose results are refreshed per run")
    ap.add_argument("--max-shp", type=int, default=150, help="companies whose shareholding is refreshed per run")
    ap.add_argument("--max-shp-xbrl", type=int, default=400, help="shareholding XBRL files read per run")
    args = ap.parse_args(argv)

    upath = ROOT / "data" / "universe.json"
    universe = json.loads(upath.read_text())["companies"] if upath.exists() else [{"symbol": s, "yahoo": s + ".NS"} for s in (ROOT / "scripts" / "symbols.txt").read_text().split()]
    nse_syms = [c["symbol"] for c in universe if c.get("yahoo", "").endswith(".NS")]
    sme = {c["symbol"] for c in universe if c.get("sme")}
    if args.symbols:
        nse_syms = [s for s in nse_syms if s in {x.upper() for x in args.symbols}]
    nse = nse_session()
    if not nse:
        print("NSE unavailable (no direct access and no relay); skipped")
        return 0
    SHP_DIR.mkdir(parents=True, exist_ok=True)
    RES_DIR.mkdir(parents=True, exist_ok=True)
    mcap = {}
    mf = ROOT / "data" / "yahoo" / "metrics.json"
    if mf.exists():
        try:
            mcap = {r["s"]: (r.get("m") or {}).get("marketCap") or 0 for r in json.loads(mf.read_text())["companies"]}
        except (ValueError, KeyError):
            pass
    stats = {"res": 0, "res_q": 0, "shp": 0, "shp_x": 0}
    t0 = time.time()

    # results: fresh filers first, then never fetched (largest first), then the stalest (refresh every 20 days)
    fresh = [s for s in fresh_results_symbols() if s in set(nse_syms)]
    docs = {s: load(RES_DIR / f"{s}.json") for s in nse_syms}
    never = sorted([s for s in nse_syms if not docs[s]], key=lambda s: -mcap.get(s, 0))
    stale = sorted([s for s in nse_syms if docs[s] and age_days(docs[s]) > 20], key=lambda s: -age_days(docs[s]))
    # quarters read before business segments were parsed are read again, largest companies first
    no_seg = sorted([s for s in nse_syms if docs[s] and docs[s].get("quarters") and (docs[s]["quarters"][0].get("sv") != SEG_VERSION
                     or (docs[s]["quarters"][0].get("bank") and docs[s]["quarters"][0].get("bv") != BANK_VERSION))], key=lambda s: -mcap.get(s, 0))
    queue = list(dict.fromkeys([s for s in fresh if not docs[s] or age_days(docs[s]) > 0.25] + no_seg[:120] + never + stale))
    # SME results (half-yearly, 'sme' index) are read by scripts/sme_financials.py
    queue = [s for s in queue if s not in sme][:args.max_results]
    for sym in queue:
        try:
            update_results(nse, sym, stats)
            stats["res"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"  {sym}: results list failed ({str(e)[:80]})", file=sys.stderr)
    print(f"Results: {stats['res']} companies checked ({len(fresh)} filed in the last days), {stats['res_q']} quarters read")

    # shareholding: never fetched (largest first), then due for the next quarter (every 15 days)
    docs = {s: load(SHP_DIR / f"{s}.json") for s in nse_syms}
    for s, d in docs.items():
        if d and repair_shp_scale(d):
            (SHP_DIR / f"{s}.json").write_text(json.dumps(d, separators=(",", ":")))
    never = sorted([s for s in nse_syms if not docs[s]], key=lambda s: -mcap.get(s, 0))
    # SME files read before the 'sme' index was used are empty: read them again
    never += [s for s in nse_syms if s in sme and docs[s] and not docs[s].get("quarters") and not docs[s].get("idx")]
    # latest quarter missing first (largest companies first), then gaps in older quarters
    latest_missing = sorted([s for s in nse_syms if docs[s] and docs[s]["quarters"] and docs[s]["quarters"][0].get("fii") is None], key=lambda s: -mcap.get(s, 0))
    incomplete = latest_missing + [s for s in nse_syms if docs[s] and any(q.get("fii") is None for q in docs[s]["quarters"])]
    # files read before the named holders were kept: largest companies first
    no_names = sorted([s for s in nse_syms if docs[s] and docs[s]["quarters"] and docs[s]["quarters"][0].get("hv") != HOLDER_V], key=lambda s: -mcap.get(s, 0))
    stale = sorted([s for s in nse_syms if docs[s] and age_days(docs[s]) > 15], key=lambda s: -age_days(docs[s]))
    # a company showing a blank latest quarter goes before the backlog of never-fetched ones
    queue = list(dict.fromkeys(latest_missing[:60] + never + no_names[:150] + incomplete + stale))[:args.max_shp]
    for sym in queue:
        if stats["shp_x"] >= args.max_shp_xbrl and docs.get(sym):
            continue
        try:
            update_shp(nse, sym, stats, args.max_shp_xbrl, "sme" if sym in sme else "equities")
            stats["shp"] += 1
        except Exception as e:  # noqa: BLE001
            print(f"  {sym}: shareholding list failed ({str(e)[:80]})", file=sys.stderr)
    print(f"Shareholding: {stats['shp']} companies checked, {stats['shp_x']} quarterly files read ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
