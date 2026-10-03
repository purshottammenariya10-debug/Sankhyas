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
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'metrics.json', 'metrics.v2.json', 'calendar.json', 'activity.json', 'results.json', 'ratings.json', 'ipo.json', 'ipo_leads.json', 'indices.json', 'corporate_actions.json', 'live.json', 'tickers.json', 'investors.json'].includes(f));
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
const shpBy = {};   // shareholding files, for the investor pages
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
const tickers = {};   // symbol -> Yahoo ticker, for the 30-minute price updates (scripts/fetch_live.py)
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    // SME companies Yahoo has only just started listing may have a single day of prices so far
    if (!j.prices || !j.prices.close || j.prices.close.length < (j.sme ? 1 : 2)) { skipped++; continue; }
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
    if (shp) shpBy[c.symbol] = shp;
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
    if (j.yahoo) tickers[c.symbol] = j.yahoo;
    const m = {};
    for (const k of KEYS) { const v = round(c.metrics[k]); if (v != null) m[k] = v; }
    companies.push(Object.assign({ s: c.symbol, n: c.name, sec: c.sector, ind: c.industry, bse: c.bseCode || undefined, ex: c.exchange === 'BSE' ? 'BSE' : undefined, isin: c.isin || undefined, q: c.lastQuarter || undefined,
      fo: (universe[c.symbol] && universe[c.symbol].fo) || undefined, m },
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
fs.writeFileSync(path.join(dir, 'tickers.json'), JSON.stringify(tickers));
console.log(`metrics.json: ${companies.length} companies (${skipped} skipped), ${(fs.statSync(path.join(dir, 'metrics.json')).size / 1e6).toFixed(2)} MB`);

// The site loads a compact copy (metrics.v2.json, about half the size to download and to read on a
// phone): one row per company, metric values in the order of `keys`, sector/industry names stored
// once in `dict`, and numbers kept to 2 decimals (whole numbers from 10,000 up). metrics.json stays
// as it is for the data scripts. Row: [symbol, name (0 when it is the symbol), sector #, industry #,
// [values], {bse, ex, isin, q, lst, lp, lpd, fo (F&O lot size)} when any are set].
{
  const cv = v => (typeof v !== 'number' || !Number.isFinite(v) ? null : Math.abs(v) >= 1e4 ? Math.round(v) : Math.abs(v) < 0.1 ? Number(v.toPrecision(2)) : Math.round(v * 100) / 100);
  const keys = [...new Set(companies.flatMap(e => Object.keys(e.m)))];
  const dict = [], at = {};
  const ref = s => (!s ? -1 : s in at ? at[s] : (dict.push(s), (at[s] = dict.length - 1)));
  const EXTRA = ['bse', 'ex', 'isin', 'q', 'lst', 'lp', 'lpd', 'fo'];
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


// ---------- investors: every named shareholder's portfolio, and who came onto, left, added to or trimmed ----------
// the shareholder lists (the investor pages, "Who bought and who sold"). From each company's two latest
// quarters with named holders (NSE shareholding patterns: holders of 1% or more, and all promoters).
// investors.json: { updated, inv: [[slug, name, group, companies, value ₹ Cr, family 1|0]],
//   chg: [[symbol, slug, kind (new | exit | up | down), %, previous %, quarter, value of the change ₹ Cr]] }
// inv/<first letter>.json: {slug: [[symbol, %, previous % (null: no earlier quarter), quarter]]}
{
  const mcapOf = {};
  companies.forEach(c => { mcapOf[c.s] = c.m.marketCap || 0; });
  const per = {};   // symbol -> { q, prevQ, cur: {key: {name, g, pct}}, prev, items }
  for (const [sym, doc] of Object.entries(shpBy)) {
    const Q = (doc.quarters || []).filter(q => q && q.q).sort((a, b) => (a.q < b.q ? 1 : -1));
    if (!Q[0] || !Q[0].h || Date.now() - Date.parse(Q[0].q) > 400 * 864e5) continue;
    // scheme by scheme for the investor pages; fund houses as one for the list of changes
    per[sym] = { q: Q[0].q, cur: Insights.holderMap(Q[0]), ch: Insights.holderChanges(doc), chf: Insights.holderChanges(doc, { family: true }) };
  }
  // names cut off at the filing's length limit: the one full spelling they start
  const allKeys = new Set();
  Object.values(per).forEach(p => { Object.keys(p.cur).forEach(k => allKeys.add(k)); (p.ch ? p.ch.items : []).forEach(x => allKeys.add(x.key)); });
  const sorted = [...allKeys].sort(), full = {};
  sorted.forEach((k, i) => {
    if (k.length < 40) return;
    const l = [];
    for (let j = i + 1; j < sorted.length && sorted[j].startsWith(k); j++) l.push(sorted[j]);
    const top = l.reduce((a, x) => (x.length > a.length ? x : a), '');
    if (l.length && l.every(x => top.startsWith(x))) full[k] = top;
  });
  const K = k => full[k] || k;
  const inv = {};   // key -> { names: {spelling: n}, g, hold: {sym: [pct, prev, q]} }
  const at = k => inv[k] || (inv[k] = { names: {}, g: {}, hold: {} });
  for (const [sym, p] of Object.entries(per)) {
    const prevOf = {};
    if (p.ch) p.ch.items.forEach(x => { prevOf[K(x.key)] = x.prev; });
    for (const [k0, x] of Object.entries(p.cur)) {
      const k = K(k0), e = at(k), h = e.hold[sym];
      e.names[x.name] = (e.names[x.name] || 0) + 1;
      e.g[x.g] = (e.g[x.g] || 0) + 1;
      // previous %: from the changes when it moved, else unchanged; none without an earlier quarter
      const prev = !p.ch ? null : k in prevOf ? prevOf[k] : Math.round(x.pct * 100) / 100;
      if (h) { h[0] += x.pct; if (h[1] != null && prev != null) h[1] += prev; } else e.hold[sym] = [x.pct, prev, p.q];
    }
    if (p.ch) p.ch.items.filter(x => x.kind === 'exit').forEach(x => {
      const k = K(x.key), e = at(k);
      e.names[x.name] = (e.names[x.name] || 0) + 1;
      e.g[x.g] = (e.g[x.g] || 0) + 1;
      if (!e.hold[sym]) e.hold[sym] = [0, x.prev, p.q];
    });
  }
  // the name shown: the commonest spelling, preferring one not in capitals, else capitals made readable
  const KEEP = /^(lic|sbi|hdfc|icici|uti|dsp|hsbc|etf|llp|pcc|nps|idfc|idbi|bnp|ii|iii|iv|lp|plc|ag|sa|nv|bv|gic|ifc|huf|kfin|ubs|jp|bnpp|msci|ftse|nifty50|mf|fpi|a\/c|uk|usa|us|bse|nse|psu|cpse|esop|esps|aif|iepf)$/i;
  const readable = s => s.toLowerCase().replace(/[a-z0-9/&.'-]+/g, w => KEEP.test(w.replace(/[.']/g, '')) || !/[aeiou]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
    .replace(/\b(Of|And|The|For|In|On|To)\b/g, (w, _, i) => (i ? w.toLowerCase() : w));
  const nameOf = e => {
    const l = Object.entries(e.names).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(x => x[0]);
    const mixed = l.find(n => n !== n.toUpperCase());
    return (mixed || readable(l[0])).replace(/[A-Za-z]+/g, w => (w.length <= 5 && KEEP.test(w) ? w.toUpperCase() : w)).replace(/\s+/g, ' ').trim();
  };
  const slugOf = Insights.holderSlug;
  const groupOf = e => Object.entries(e.g).sort((a, b) => b[1] - a[1])[0][0];
  // mutual fund houses: every scheme of the house together ("SBI Mutual Fund, all schemes")
  const fam = {};
  for (const [k, e] of Object.entries(inv)) {
    const f = Insights.holderFamily(k, groupOf(e));
    if (!f) continue;
    const x = fam[f] || (fam[f] = { hold: {}, n: 0 });
    x.n++;
    for (const [sym, [pct, prev, q]] of Object.entries(e.hold)) {
      const h = x.hold[sym];
      if (h) { h[0] += pct; h[1] = h[1] == null || prev == null ? null : h[1] + prev; } else x.hold[sym] = [pct, prev, q];
    }
  }
  const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
  const rows = [], hold = {}, slugOfKey = {};
  const add = (slug, name, g, hl, isFam) => {
    const list = Object.entries(hl).map(([sym, [pct, prev, q]]) => [sym, r2(pct), r2(prev), q])
      .sort((a, b) => b[1] * (mcapOf[b[0]] || 0) - a[1] * (mcapOf[a[0]] || 0) || b[2] - a[2]);
    const held = list.filter(x => x[1] > 0);
    if (!held.length && !list.length) return;
    const value = held.reduce((t, x) => t + x[1] / 100 * (mcapOf[x[0]] || 0), 0);
    rows.push([slug, name, g, held.length, Math.round(value), isFam ? 1 : 0]);
    hold[slug] = list;
  };
  const used = new Set();
  for (const [k, e] of Object.entries(inv)) {
    let slug = slugOf(k) || 'holder';
    while (used.has(slug)) slug += '-x';
    used.add(slug);
    slugOfKey[k] = slug;
    add(slug, nameOf(e), groupOf(e), e.hold, false);
  }
  const famSlug = {};
  for (const [f, x] of Object.entries(fam)) { famSlug[f] = 'amc-' + slugOf(f.toLowerCase()); add(famSlug[f], f + ' (all schemes)', 'mf', x.hold, true); }
  rows.sort((a, b) => b[4] - a[4] || b[3] - a[3]);
  // changes market-wide, the biggest by value first
  const chg = [];
  for (const [sym, p] of Object.entries(per)) {
    if (!p.chf) continue;
    for (const x of p.chf.items) {
      const slug = x.g === 'mf' ? famSlug[x.name] : slugOfKey[K(x.key)];
      if (slug) chg.push([sym, slug, x.kind, x.pct, x.prev, p.q, Math.round(Math.abs(x.pct - x.prev) / 100 * (mcapOf[sym] || 0) * 10) / 10]);
    }
  }
  chg.sort((a, b) => b[6] - a[6]);
  fs.writeFileSync(path.join(dir, 'investors.json'), JSON.stringify({ updated: new Date().toISOString(), inv: rows, chg: chg.slice(0, 6000) }));
  // each investor's holdings, in files by the first letter of the investor's page name (data/yahoo/inv/a.json)
  const invDir = path.join(dir, 'inv'), shards = {};
  fs.rmSync(invDir, { recursive: true, force: true });
  fs.mkdirSync(invDir, { recursive: true });
  for (const [slug, list] of Object.entries(hold)) (shards[slug[0]] = shards[slug[0]] || {})[slug] = list;
  for (const [k, v] of Object.entries(shards)) fs.writeFileSync(path.join(invDir, k + '.json'), JSON.stringify(v));
  console.log(`investors.json: ${rows.length} investors in ${Object.keys(per).length} companies, ${chg.length} changes, ${(fs.statSync(path.join(dir, 'investors.json')).size / 1e6).toFixed(2)} MB`);
}
