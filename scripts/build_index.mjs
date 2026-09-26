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
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'metrics.json'].includes(f));
const companies = [];
let skipped = 0;
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!j.prices || !j.prices.close || j.prices.close.length < 2) { skipped++; continue; }
    const c = Data._buildLive(j);
    const ff = path.join(filingsDir, c.symbol + '.json');
    if (fs.existsSync(ff)) {
      try {
        const filings = JSON.parse(fs.readFileSync(ff, 'utf8'));
        c.metrics.riskScore = Insights.redFlags(c, filings).score;
        const g = Insights.guidance(c, filings);
        if (g.score != null) c.metrics.guidanceScore = g.score;
      } catch (e) { /* keep the numbers-only score */ }
    }
    const m = {};
    for (const k of KEYS) { const v = round(c.metrics[k]); if (v != null) m[k] = v; }
    companies.push({ s: c.symbol, n: c.name, sec: c.sector, ind: c.industry, bse: c.bseCode || undefined, ex: c.exchange === 'BSE' ? 'BSE' : undefined, isin: c.isin || undefined, q: c.lastQuarter || undefined, m });
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
