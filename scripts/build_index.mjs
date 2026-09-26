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
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'metrics.json', 'calendar.json', 'activity.json'].includes(f));
const companies = [];
let skipped = 0;

// bulk and block deals (scripts/fetch_deals.py)
const dealsFile = path.join(root, 'data', 'deals', 'deals.json');
let deals = [];
try { if (fs.existsSync(dealsFile)) deals = JSON.parse(fs.readFileSync(dealsFile, 'utf8')).deals || []; } catch (e) { deals = []; }
const dealsBy = {};
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
          const amt = wins.reduce((t, a) => t + (a.amt || 0), 0);
          if (amt) c.metrics.orders12m = amt;
        }
        c.metrics.riskScore = Insights.redFlags(c, filings).score;
        const g = Insights.guidance(c, filings);
        if (g.score != null) c.metrics.guidanceScore = g.score;
      } catch (e) { /* keep the numbers-only score */ }
    }
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
  console.log(`metrics.json: no companies (${skipped} skipped); index not written`);
  process.exit(0);
}
companies.sort((a, b) => (b.m.marketCap || 0) - (a.m.marketCap || 0));
const out = { source: 'Yahoo Finance', updated: index.updated || new Date().toISOString(), liveOnly: index.liveOnly !== false, companies };
fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(out));
console.log(`metrics.json: ${companies.length} companies (${skipped} skipped), ${(fs.statSync(path.join(dir, 'metrics.json')).size / 1e6).toFixed(2)} MB`);

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
  const since = new Date(Date.now() - 400 * 864e5).toISOString(), since2 = new Date(Date.now() - 200 * 864e5).toISOString();
  if (fs.existsSync(filingsDir)) {
    for (const f of fs.readdirSync(filingsDir)) {
      if (!f.endsWith('.json') || f === 'latest.json') continue;
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(filingsDir, f), 'utf8')); } catch (e) { continue; }
      const sym = doc.symbol || f.replace(/\.json$/, '');
      for (const a of doc.announcements || []) {
        if (a.k === 'order' && a.d >= since) orders.push({ s: sym, n: names[sym] || sym, d: a.d, amt: a.amt || null, cust: a.cust || '', desc: a.desc || '', u: a.u });
        else if ((a.k === 'insider' || a.k === 'sast') && a.d >= since2) disclosures.push({ s: sym, n: names[sym] || sym, d: a.d, k: a.k, dir: a.dir || '', t: String(a.t).slice(0, 200), u: a.u });
      }
    }
  }
  orders.sort((a, b) => b.d.localeCompare(a.d));
  disclosures.sort((a, b) => b.d.localeCompare(a.d));
  const recentDeals = deals.filter(x => x.d >= since.slice(0, 10)).map(x => Object.assign({}, x, { n: names[x.s] || x.n }));
  fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify({ updated: new Date().toISOString(), orders, disclosures, deals: recentDeals }));
  console.log(`activity.json: ${orders.length} order wins (${orders.filter(o => o.amt).length} with value), ${disclosures.length} insider/promoter disclosures, ${recentDeals.length} bulk/block deals`);
}

