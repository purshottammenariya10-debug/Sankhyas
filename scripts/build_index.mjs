#!/usr/bin/env node
// Build data/yahoo/metrics.json: one compact row per company with every screen metric.
//
// The site loads this single file at startup (for search, screens, sectors, peers and the
// AI) instead of thousands of company files. Metrics are computed by the site's own code
// (js/data.js), one company at a time, so the index always matches the company pages.
//
//   node scripts/build_index.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'yahoo');

// load js/data.js and js/screener.js in a sandbox that looks like a browser window
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/screener.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/insights.js'), 'utf8'), ctx);
const { Data, Screener, Insights } = ctx.window;
const filingsDir = path.join(root, 'data', 'filings');

const KEYS = Screener.RATIOS.map(r => r.key).concat(['change', 'changePct', 'qtrOp', 'qtrOpm', 'qtrEps', 'avgVolume']);
const round = v => (v == null || !Number.isFinite(v) ? null : Number(v.toPrecision(6)));

const index = fs.existsSync(path.join(dir, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) : {};
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'metrics.json', 'metrics.v2.json', 'calendar.json', 'activity.json', 'results.json', 'ratings.json', 'ipo.json', 'ipo_leads.json', 'indices.json', 'corporate_actions.json'].includes(f));
const companies = [];
let skipped = 0;
const latestResults = [];
const ratingEvents = [];
const readJSON = f => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (e) { return null; } };

// bulk and block deals (scripts/fetch_deals.py)
const dealsFile = path.join(root, 'data', 'deals', 'deals.json');
let deals = [];
try { if (fs.existsSync(dealsFile)) deals = JSON.parse(fs.readFileSync(dealsFile, 'utf8')).deals || []; } catch (e) { deals = []; }
const dealsBy = {};
const salesBy = {};
// an order value read from a filing PDF is dropped when it is implausible for the company's size
// (usually an order-book total or another figure picked up by mistake)
function plausibleOrder(amt, sales) {
  if (amt == null || !Number.isFinite(amt) || amt <= 0) return null;
  if (Number.isFinite(sales) && sales > 0 && amt > 2.5 * sales) return null;
  return amt;
}
deals.forEach(x => { (dealsBy[x.s] = dealsBy[x.s] || []).push(x); });

// listing dates (NSE equity and SME lists) for the IPO & new listings hub
const universeFile = path.join(root, 'data', 'universe.json');
const universe = {};
if (fs.existsSync(universeFile)) {
  try { for (const u of JSON.parse(fs.readFileSync(universeFile, 'utf8')).companies || []) universe[u.symbol] = u; } catch (e) { /* optional */ }
}
const LISTING_WINDOW_DAYS = 5 * 365;
function listingInfo(sym, j) {
  // listing date: NSE's lists, else the first day of Yahoo's price history when that history is
  // shorter than the 10 years we download (newly listed, SME and BSE-only companies)
  const first = j.prices.dates[0];
  const young = first && Date.now() - Date.parse(first) < 9.8 * 365 * 864e5 ? first : '';
  const listed = (universe[sym] && universe[sym].listed) || j.listed || young;
  if (!listed || Date.now() - Date.parse(listed) > LISTING_WINDOW_DAYS * 864e5) return {};
  const dates = j.prices.dates, close = j.prices.close;
  const i = dates.findIndex(d => d >= listed);
  // only when the price history starts at (or within 10 days of) the listing
  if (i < 0 || Date.parse(dates[i]) - Date.parse(listed) > 10 * 864e5 || (i === 0 && Date.parse(dates[0]) < Date.parse(listed) - 864e5)) return { lst: listed };
  return { lst: listed, lp: round(close[i]), lpd: dates[i] };
}
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!j.prices || !j.prices.close || j.prices.close.length < 2) { skipped++; continue; }
    const c = Data._buildLive(j);
    // NSE's dummy test symbols and mutual-fund segregated portfolios are not companies
    if (/NSETEST$/.test(c.symbol) || /mutual fund|segregated portfolio/i.test(c.name || '')) { skipped++; continue; }
    const ff = path.join(filingsDir, c.symbol + '.json');
    const dl = dealsBy[c.symbol];
    if (dl) {
      const since = new Date(Date.now() - 92 * 864e5).toISOString().slice(0, 10);
      const net = dl.filter(x => x.d >= since).reduce((a, x) => a + (x.side === 'B' ? x.v : -x.v), 0);
      if (net) c.metrics.dealsNet3m = net;
    }
    if (fs.existsSync(ff)) {
      try {
        const filings = JSON.parse(fs.readFileSync(ff, 'utf8'));
        const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
        const wins = (filings.announcements || []).filter(a => a.k === 'order' && a.d >= yearAgo);
        if (wins.length) {
          c.metrics.orderWins12m = wins.length;
          const amt = wins.reduce((t, a) => t + (plausibleOrder(a.amt, c.metrics.sales) || 0), 0);
          if (amt) c.metrics.orders12m = amt;
        }
        c.metrics.riskScore = Insights.redFlags(c, filings).score;
        // credit ratings read from rating letters (scripts/ratings.py)
        const cr = Insights.creditRatings(filings);
        if (cr && cr.rank >= 0) {
          c.metrics.ratingScore = 20 - cr.rank;
          c.metrics.ratingChg = cr.down ? -1 : cr.up ? 1 : 0;
        }
        const ratingSince = new Date(Date.now() - 548 * 864e5).toISOString();
        (filings.announcements || []).filter(a => a.k === 'rating' && a.rt && a.d >= ratingSince).forEach(a =>
          ratingEvents.push({ s: c.symbol, n: c.name, d: a.d, ag: a.ag || '', rt: a.rt, ol: a.ol || '', act: a.act || '', from: a.from || '', ins: a.ins || '', ramt: a.ramt || null, st: a.st || '', term: a.term || '', sub: a.sub ? 1 : undefined, u: a.u, mc: Math.round(c.metrics.marketCap || 0) }));
        // annual report forensic check (scripts/ar_forensics.py)
        const arc = Insights.annualReportCheck(filings);
        if (arc) c.metrics.arIssues = (arc.flags || []).filter(x => x.sev !== 'low').length;
        const g = Insights.guidance(c, filings);
        if (g.score != null) c.metrics.guidanceScore = g.score;
      } catch (e) { /* keep the numbers-only score */ }
    }
    // NSE shareholding pattern and quarterly results (scripts/fetch_nse_extra.py)
    const shp = readJSON(path.join(root, 'data', 'shp', c.symbol + '.json'));
    const hs = shp && Insights.holdingStats(shp);
    if (hs) {
      Object.assign(c.metrics, { promoter: hs.promoter, fii: hs.fii, dii: hs.dii, pledged: hs.pledge, promoterChg1q: hs.promoterChg1q, fiiChg1q: hs.fiiChg1q,
        diiChg1q: hs.diiChg1q, fiiChg4q: hs.fiiChg4q, fiiUpQtrs: hs.fiiUpQtrs, holdersChg1q: hs.holdersChg1q });
    }
    const res = readJSON(path.join(root, 'data', 'results', c.symbol + '.json'));
    const rv = res && Insights.resultsVerdict(res);
    if (rv) {
      c.metrics.resVerdict = rv.verdict === 'Strong' ? 1 : rv.verdict === 'Weak' ? -1 : rv.verdict === 'New' ? null : 0;
      latestResults.push({ s: c.symbol, n: c.name, qe: rv.qe, q: rv.label, f: rv.filed, v: rv.verdict, cons: rv.cons ? 1 : 0, sales: rv.cur.sales, op: rv.cur.op, opm: rv.cur.opm, np: rv.cur.np, eps: rv.cur.eps,
        sy: rv.yoy.sales, py: rv.yoy.np, sq: rv.qoq.sales, pq: rv.qoq.np, mc: c.metrics.marketCap || 0 });
    }
    salesBy[c.symbol] = c.metrics.sales;
    const m = {};
    for (const k of KEYS) { const v = round(c.metrics[k]); if (v != null) m[k] = v; }
    companies.push(Object.assign({ s: c.symbol, n: c.name, sec: c.sector, ind: c.industry, bse: c.bseCode || undefined, ex: c.exchange === 'BSE' ? 'BSE' : undefined, isin: c.isin || undefined, q: c.lastQuarter || undefined, m },
      listingInfo(c.symbol, j)));
  } catch (e) {
    skipped++;
    console.error('skip', f, e.message);
  }
}
if (!companies.length) {
  // no usable data yet: leave no index so the site falls back to sample data
  fs.rmSync(path.join(dir, 'metrics.json'), { force: true });
  fs.rmSync(path.join(dir, 'metrics.v2.json'), { force: true });
  console.log(`metrics.json: no companies (${skipped} skipped); index not written`);
  process.exit(0);
}
companies.sort((a, b) => (b.m.marketCap || 0) - (a.m.marketCap || 0));
// Sankhyas Score for every company, worked out once here (it ranks each company against all the others)
// so phones read it from the index instead of computing it on every visit; `scored` tells the site so
const SCORE_KEYS = ['sankhyasScore', 'scoreQuality', 'scoreGrowth', 'scoreValue', 'scoreMomentum', 'scoreSafety'];
Insights.computeScores(companies.map(e => ({ symbol: e.s, sector: e.sec, industry: e.ind, metrics: e.m })));
companies.forEach(e => SCORE_KEYS.forEach(k => { if (e.m[k] == null) delete e.m[k]; }));
const out = { source: 'Yahoo Finance', updated: index.updated || new Date().toISOString(), liveOnly: index.liveOnly !== false, scored: 1, companies };
fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(out));
console.log(`metrics.json: ${companies.length} companies (${skipped} skipped), ${(fs.statSync(path.join(dir, 'metrics.json')).size / 1e6).toFixed(2)} MB`);

// The site loads a compact copy (metrics.v2.json, about half the size to download and to read on a
// phone): one row per company, metric values in the order of `keys`, sector/industry names stored
// once in `dict`, and numbers kept to 2 decimals (whole numbers from 10,000 up). metrics.json stays
// as it is for the data scripts. Row: [symbol, name (0 when it is the symbol), sector #, industry #,
// [values], {bse, ex, isin, q, lst, lp, lpd} when any are set].
{
  const cv = v => (typeof v !== 'number' || !Number.isFinite(v) ? null : Math.abs(v) >= 1e4 ? Math.round(v) : Math.abs(v) < 0.1 ? Number(v.toPrecision(2)) : Math.round(v * 100) / 100);
  const keys = [...new Set(companies.flatMap(e => Object.keys(e.m)))];
  const dict = [], at = {};
  const ref = s => (!s ? -1 : s in at ? at[s] : (dict.push(s), (at[s] = dict.length - 1)));
  const EXTRA = ['bse', 'ex', 'isin', 'q', 'lst', 'lp', 'lpd'];
  const c = companies.map(e => {
    const vals = keys.map(k => cv(e.m[k]));
    while (vals.length && vals[vals.length - 1] === null) vals.pop();
    const x = {};
    EXTRA.forEach(f => { if (e[f] != null) x[f] = e[f]; });
    const row = [e.s, e.n === e.s ? 0 : e.n, ref(e.sec), ref(e.ind), vals];
    if (Object.keys(x).length) row.push(x);
    return row;
  });
  const v2 = path.join(dir, 'metrics.v2.json');
  fs.writeFileSync(v2, JSON.stringify({ v: 2, source: out.source, updated: out.updated, liveOnly: out.liveOnly, scored: 1, keys, dict, c }));
  console.log(`metrics.v2.json: ${(fs.statSync(v2).size / 1e6).toFixed(2)} MB`);
}

// latest quarterly results with the Sankhyas verdict, newest filing first (results page, alerts, cards)
{
  const when = r => { const t = Date.parse((r.f || '').replace(/-/g, ' ')); return Number.isFinite(t) ? t : Date.parse(r.qe); };
  const recent = latestResults.filter(r => Date.now() - Date.parse(r.qe) < 200 * 864e5).sort((a, b) => when(b) - when(a) || b.mc - a.mc).slice(0, 1500);
  recent.forEach(r => { for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = round(r[k]); });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ updated: new Date().toISOString(), results: recent }));
  ratingEvents.sort((a, b) => (a.d < b.d ? 1 : -1));
  fs.writeFileSync(path.join(dir, 'ratings.json'), JSON.stringify({ updated: new Date().toISOString(), ratings: ratingEvents.slice(0, 4000) }));
  console.log(`ratings.json: ${ratingEvents.length} rating actions (${ratingEvents.filter(r => r.act === 'upgrade').length} upgrades, ${ratingEvents.filter(r => r.act === 'downgrade').length} downgrades)`);
  console.log(`results.json: ${recent.length} companies with NSE quarterly results (${recent.filter(r => r.v === 'Strong').length} strong, ${recent.filter(r => r.v === 'Weak').length} weak)`);
}

// ---------- results calendar: upcoming board meetings from exchange filings ----------
const MON = /(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]{3,9})[-,\s]+(\d{4})|([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i;
function parseDate(s) {
  const d = String(s).match(MON);
  if (!d) return null;
  const iso = d[1] ? Date.parse(d[1] + ' ' + d[2] + ' ' + d[3] + ' UTC') : Date.parse(d[5] + ' ' + d[4] + ' ' + d[6] + ' UTC');
  return Number.isFinite(iso) ? new Date(iso).toISOString().slice(0, 10) : null;
}
function meetingDate(text) {
  const t = String(text);
  const m = t.match(/meeting date:?\s*([^|]+)/i) || t.match(/board meeting (?:is )?(?:scheduled |proposed )?to be held on\s+([^|]+)/i) || t.match(/board meeting on\s+([^|]+)/i);
  if (!m) return null;
  return parseDate(m[1]);
}
function meetingPurpose(text) {
  const t = String(text).toLowerCase(), p = [];
  if (/financial result|quarterly result|results/.test(t)) p.push('Results');
  if (/dividend/.test(t)) p.push('Dividend');
  if (/bonus/.test(t)) p.push('Bonus');
  if (/split|sub-division/.test(t)) p.push('Stock split');
  if (/buy ?back/.test(t)) p.push('Buyback');
  if (/fund ?rais|preferential|qip|rights issue|warrants|ncd|debenture/.test(t)) p.push('Fund raising');
  return p.length ? p : ['Board meeting'];
}
const events = {};
const names = {};
companies.forEach(c => { names[c.s] = c.n; });
if (fs.existsSync(filingsDir)) {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(filingsDir)) {
    if (!f.endsWith('.json') || f === 'latest.json') continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(filingsDir, f), 'utf8')); } catch (e) { continue; }
    const sym = doc.symbol || f.replace(/\.json$/, '');
    // meetings the company later cancelled
    const cancelled = {};
    for (const a of doc.announcements || []) {
      const text = a.t + ' | ' + (a.c || '');
      if (/cancel/i.test(text) && /meeting/i.test(text) && !/reschedul/i.test(text)) { const d = parseDate(text); if (d) cancelled[d] = a.d; }
    }
    for (const a of doc.announcements || []) {
      const text = a.t + ' | ' + (a.c || '');
      if (!/board meeting|meeting date/i.test(text) || /general meeting|\bagm\b|postal ballot|outcome of|cancel|postpone|defer/i.test(text)) continue;
      const d = meetingDate(text);
      if (!d || d < from || d > to || (cancelled[d] && cancelled[d] >= a.d)) continue;
      const key = sym + '|' + d;
      const e = events[key] || (events[key] = { s: sym, n: names[sym] || doc.name || sym, d, p: [], u: a.u, filed: a.d });
      meetingPurpose(text).forEach(x => { if (e.p.indexOf(x) < 0) e.p.push(x); });
      if (e.p.length > 1) e.p = e.p.filter(x => x !== 'Board meeting');
    }
  }
  const list = Object.values(events).sort((a, b) => a.d.localeCompare(b.d) || a.n.localeCompare(b.n));
  fs.writeFileSync(path.join(dir, 'calendar.json'), JSON.stringify({ updated: new Date().toISOString(), today, events: list }));
  console.log(`calendar.json: ${list.length} board meetings between ${from} and ${to}`);
}

// ---------- market activity: order wins, insider/promoter disclosures, bulk & block deals ----------
{
  const orders = [], disclosures = [];
  const since = new Date(Date.now() - 400 * 864e5).toISOString(), since2 = new Date(Date.now() - 400 * 864e5).toISOString();
  if (fs.existsSync(filingsDir)) {
    for (const f of fs.readdirSync(filingsDir)) {
      if (!f.endsWith('.json') || f === 'latest.json') continue;
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(filingsDir, f), 'utf8')); } catch (e) { continue; }
      const sym = doc.symbol || f.replace(/\.json$/, '');
      for (const a of doc.announcements || []) {
        if (a.k === 'order' && a.d >= since) orders.push({ s: sym, n: names[sym] || sym, d: a.d, amt: plausibleOrder(a.amt, salesBy[sym]), cust: a.cust || '', desc: a.desc || '', u: a.u });
        else if ((a.k === 'insider' || a.k === 'sast') && a.d >= since2) {
          const x = { s: sym, n: names[sym] || sym, d: a.d, k: a.k, dir: a.dir || '', t: String(a.t).slice(0, 200), u: a.u };
          // person, category, mode, quantity, average price and value (Rs Cr) read from the filing
          for (const f2 of ['who', 'cat', 'mode', 'q', 'pr', 'v']) if (a[f2] != null && a[f2] !== '') x[f2] = a[f2];
          disclosures.push(x);
        }
      }
    }
  }
  orders.sort((a, b) => b.d.localeCompare(a.d));
  disclosures.sort((a, b) => b.d.localeCompare(a.d));
  const recentDeals = deals.filter(x => x.d >= since.slice(0, 10)).map(x => Object.assign({}, x, { n: names[x.s] || x.n }));
  fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify({ updated: new Date().toISOString(), orders, disclosures, deals: recentDeals }));
  console.log(`activity.json: ${orders.length} order wins (${orders.filter(o => o.amt).length} with value), ${disclosures.length} insider/promoter disclosures, ${recentDeals.length} bulk/block deals`);
}

// dividends, bonus issues and splits by record date (the Dividends page and search-engine page):
// the last 45 days and the next 150, with the amount a share and what it yields at today's price
{
  const from = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 150 * 864e5).toISOString().slice(0, 10);
  const priceOf = {}, mcapOf = {};
  companies.forEach(c => { priceOf[c.s] = c.m.price; mcapOf[c.s] = c.m.marketCap; });
  const items = [];
  if (fs.existsSync(filingsDir)) {
    for (const f of fs.readdirSync(filingsDir)) {
      if (!f.endsWith('.json') || f === 'latest.json') continue;
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(filingsDir, f), 'utf8')); } catch (e) { continue; }
      const sym = doc.symbol || f.replace(/\.json$/, '');
      if (!names[sym]) continue;   // companies the site covers
      for (const x of Insights.corporateActions(doc)) {
        if (x.rd < from || x.rd > to) continue;
        const p = priceOf[sym];
        items.push({ s: sym, n: names[sym], k: x.k, rd: x.rd, label: x.label, amt: x.amt, y: x.amt && p > 0 ? Math.round(x.amt / p * 10000) / 100 : null, mc: mcapOf[sym] || 0, on: x.on, u: x.url });
      }
    }
  }
  items.sort((a, b) => (a.rd < b.rd ? -1 : a.rd > b.rd ? 1 : b.mc - a.mc));
  fs.writeFileSync(path.join(dir, 'corporate_actions.json'), JSON.stringify({ updated: new Date().toISOString(), items }));
  console.log(`corporate_actions.json: ${items.length} record dates (${items.filter(x => x.k === 'div').length} dividends)`);
}

