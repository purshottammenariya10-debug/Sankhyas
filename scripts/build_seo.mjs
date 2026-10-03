// Search-engine pages: one static HTML page per company at company/<SYMBOL>/index.html, plus
// sitemap.xml and robots.txt. Each page carries the company's key numbers, business description,
// latest quarterly results, the AI concall/presentation summary and links to peers, so Google can
// index it. The same page boots the full app, which then renders the interactive company view.
//
//   node scripts/build_seo.mjs <site dir> <site origin, e.g. https://sankhyas.com/>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = path.resolve(process.argv[2] || '_site');
const origin = (process.argv[3] || 'https://sankhyas.com/').replace(/\/?$/, '/');
const yahoo = path.join(root, 'data/yahoo'), filings = path.join(root, 'data/filings');
const metricsFile = path.join(yahoo, 'metrics.json');
if (!fs.existsSync(metricsFile)) { console.log('build_seo: no metrics.json; skipped'); process.exit(0); }
const companies = JSON.parse(fs.readFileSync(metricsFile, 'utf8')).companies || [];
const shell = fs.readFileSync(path.join(site, 'index.html'), 'utf8');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (v, d = 0) => (v == null || !isFinite(v) ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || !isFinite(v) ? '-' : inr(v, d) + '%');
const cr = v => (v == null || !isFinite(v) ? '-' : '₹ ' + inr(v, v < 100 ? 1 : 0) + ' Cr');
const urlOf = s => origin + 'company/' + encodeURIComponent(s) + '/';
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

// peers: same industry, largest first
const byInd = {};
companies.forEach(c => { const k = c.ind || c.sec || 'Others'; (byInd[k] = byInd[k] || []).push(c); });
Object.values(byInd).forEach(l => l.sort((a, b) => ((b.m || {}).marketCap || 0) - ((a.m || {}).marketCap || 0)));

function head(c, m, desc) {
  const title = `${c.n} share price, financials & concall summary | Sankhyas`;
  const ld = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'Corporation', name: c.n, tickerSymbol: c.s, url: urlOf(c.s), description: desc, ...(c.isin ? { identifier: c.isin } : {}) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Sankhyas', item: origin },
        { '@type': 'ListItem', position: 2, name: c.sec || 'Companies', item: origin + '#/market/' + encodeURIComponent(c.sec || '') },
        { '@type': 'ListItem', position: 3, name: c.n, item: urlOf(c.s) }] }]
  };
  return `<title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(urlOf(c.s))}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="Sankhyas">
  <meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(urlOf(c.s))}"><meta property="og:image" content="${origin}assets/logo-512.png">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

function latestNote(f) {
  const notes = f && f.notes ? Object.entries(f.notes).filter(([, n]) => !n.failed && n.sections && (n.kind === 'transcript' || n.kind === 'ppt')) : [];
  notes.sort((a, b) => String(b[1].d).localeCompare(String(a[1].d)) || (a[1].kind === 'transcript' ? -1 : 1));
  return notes[0] || null;
}

function body(c, m, j, f) {
  const q = (j && j.quarterly) || {};
  const qi = (q.periods || []).map((p, i) => i).filter(i => (q.sales || [])[i] != null || (q.np || [])[i] != null).slice(-5);
  const peers = (byInd[c.ind || c.sec || 'Others'] || []).filter(x => x.s !== c.s).slice(0, 10);
  const note = latestNote(f);
  const about = j && j.about ? (String(j.about).length > 1200 ? String(j.about).slice(0, 1200).replace(/\s+\S*$/, '') + '…' : String(j.about)) : '';
  const rows = [['Market cap', cr(m.marketCap)], ['Current price', m.price != null ? '₹ ' + inr(m.price, 2) : '-'], ['52-week high / low', m.high52 != null ? '₹ ' + inr(m.high52, 0) + ' / ' + inr(m.low52, 0) : '-'],
    ['Stock P/E', m.pe != null ? inr(m.pe, 1) : '-'], ['Book value', m.bookValue != null ? '₹ ' + inr(m.bookValue, 1) : '-'], ['Dividend yield', pct(m.divYield, 2)],
    ['ROCE', pct(m.roce)], ['ROE', pct(m.roe)], ['Debt to equity', m.de != null ? inr(m.de, 2) : '-'],
    ['Sales growth (3 yrs)', pct(m.salesGrowth3)], ['Profit growth (3 yrs)', pct(m.profitGrowth3)], ['1-year return', pct(m.ret1y)]];
  let h = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › ${esc(c.sec || '')}${c.ind ? ' › ' + esc(c.ind) : ''}</nav>
<h1>${esc(c.n)} share price</h1>
<p class="muted">${c.ex === 'BSE' ? 'BSE: ' + esc(c.bse || c.s) : 'NSE: ' + esc(c.s) + (c.bse ? ' · BSE: ' + esc(c.bse) : '')}${c.isin ? ' · ISIN ' + esc(c.isin) : ''}</p>
<section class="card"><h2>Key numbers</h2><dl class="seo-ratios">${rows.map(r => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('')}</dl></section>`;
  if (about) h += `<section class="card"><h2>About ${esc(c.n)}</h2><p>${esc(about)}</p></section>`;
  if (qi.length) {
    const line = (label, arr, d = 0) => `<tr><td class="l">${label}</td>${qi.map(i => `<td>${inr((arr || [])[i], d)}</td>`).join('')}</tr>`;
    h += `<section class="card"><h2>Quarterly results</h2><p class="sub">Consolidated figures in ₹ crores</p><div class="table-wrap"><table class="data"><thead><tr><th class="l"></th>${qi.map(i => `<th>${esc(q.periods[i])}</th>`).join('')}</tr></thead><tbody>` +
      line('Sales', q.sales) + line('Operating profit', q.op) + line('Net profit', q.np) + line('EPS (₹)', q.eps, 2) + '</tbody></table></div></section>';
  }
  if (note) {
    const [u, n] = note;
    const pts = Object.entries(n.sections).map(([t, list]) => [t, (list || []).filter(p => p.length < 320).slice(0, 2)]).filter(x => x[1].length).slice(0, 5);
    if (pts.length) {
      h += `<section class="card"><h2>${n.kind === 'ppt' ? 'Investor presentation' : 'Concall'} summary (${esc(String(n.d).slice(0, 10))})</h2><p class="sub">AI summary of the ${n.kind === 'ppt' ? 'presentation' : 'earnings call transcript'}${n.tone ? ' · tone: ' + esc(n.tone) : ''} · <a href="${esc(u)}" rel="nofollow noopener">source document</a></p>` +
        pts.map(([t, list]) => `<h3>${esc(t)}</h3><ul>${list.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`).join('') + '</section>';
    }
  }
  if (peers.length) h += `<section class="card"><h2>Peers in ${esc(c.ind || c.sec || 'the same industry')}</h2><ul class="seo-peers">${peers.map(p => `<li><a href="${esc(urlOf(p.s))}">${esc(p.n)}</a></li>`).join('')}</ul></section>`;
  h += `<p class="table-note">Data for information only, not investment advice. Prices end of day.</p></div>`;
  return h;
}

const outDir = path.join(site, 'company');
fs.mkdirSync(outDir, { recursive: true });
const shellHead = shell.replace(/<title>[\s\S]*?<\/title>\s*/, '').replace(/<meta name="description"[^>]*>\s*/, '');
let n = 0;
for (const c of companies) {
  if (!c.s || !c.n) continue;
  const m = c.m || {};
  const j = readJSON(path.join(yahoo, c.s + '.json'));
  const f = readJSON(path.join(filings, c.s + '.json'));
  const desc = `${c.n} (${c.s}) share price ₹ ${inr(m.price, 2)}, market cap ${cr(m.marketCap)}, P/E ${m.pe != null ? inr(m.pe, 1) : '-'}, ROCE ${pct(m.roce)}. Quarterly results, balance sheet, shareholding, concall AI summary and red flags on Sankhyas.`;
  const html = shellHead
    .replace('<head>', '<head>\n  <base href="../../">\n  ' + head(c, m, desc))
    .replace('<body>', `<body data-route="company/${esc(c.s)}">`)
    .replace('<main id="app"></main>', '<main id="app">' + body(c, m, j, f) + '</main>');
  const dir = path.join(outDir, c.s);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  n++;
}

// home page tags, sitemap and robots
const homeDesc = "Sankhyas: India's AI-powered financial research platform. Financials, ratios, concall AI summaries, red flags, screens and alerts for every NSE and BSE company.";
// home page: who runs the site and its logo, so search engines can show the brand (Organization + WebSite)
const homeLd = { '@context': 'https://schema.org', '@graph': [
  { '@type': 'Organization', '@id': origin + '#org', name: 'Sankhyas', url: origin, logo: { '@type': 'ImageObject', url: origin + 'assets/logo-512.png', width: 512, height: 512 },
    email: 'connect@sankhyas.com', sameAs: ['https://www.instagram.com/sankhyas.co/'] },
  { '@type': 'WebSite', '@id': origin + '#website', name: 'Sankhyas', alternateName: 'Sankhyas.com', url: origin, publisher: { '@id': origin + '#org' } }] };
fs.writeFileSync(path.join(site, 'index.html'), shell.replace('<head>', `<head>\n  <script type="application/ld+json">${JSON.stringify(homeLd)}</script>\n  <link rel="canonical" href="${origin}">\n  <meta property="og:type" content="website"><meta property="og:site_name" content="Sankhyas"><meta property="og:title" content="Sankhyas - India's AI-Powered Financial Research Terminal"><meta property="og:description" content="${esc(homeDesc)}"><meta property="og:url" content="${origin}"><meta property="og:image" content="${origin}assets/logo-512.png">`));
const today = new Date().toISOString().slice(0, 10);
// ---------- ready-made screens (screens/<slug>/) and the dividends calendar (dividends/) ----------
// Pages people search for ("debt free stocks", "upcoming dividends"): today's list, readable without
// JavaScript, which then boots the full app on the same view (body data-route).
const sctx = { window: {} };
vm.createContext(sctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/screener.js'), 'utf8'), sctx);
const Screener = sctx.window.Screener;
const monthYear = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const todayText = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const everyone = companies.filter(c => c.s && c.n).map(c => ({ symbol: c.s, name: c.n, metrics: c.m || {} }));
const screenUrl = slug => origin + 'screens/' + slug + '/';
const fmtKey = (k, v) => {
  const r = Screener.BY_KEY[k], u = r ? r.unit : '';
  if (v == null || !isFinite(v)) return '-';
  return u === 'Rs.Cr.' ? cr(v) : u === '%' ? pct(v, 1) : u === 'Rs.' ? '₹ ' + inr(v, Math.abs(v) < 100 ? 2 : 0) : inr(v, Math.abs(v) < 10 ? 2 : 1);
};
const colName = k => (Screener.BY_KEY[k] ? Screener.BY_KEY[k].label : k);
function staticPage(rel, depth, route, headHtml, bodyHtml) {
  const html = shellHead
    .replace('<head>', '<head>\n  <base href="' + '../'.repeat(depth) + '">\n  ' + headHtml)
    .replace('<body>', `<body data-route="${esc(route)}">`)
    .replace('<main id="app"></main>', '<main id="app">' + bodyHtml + '</main>');
  const dir = path.join(site, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}
const pageHead = (title, desc, url, ld) => `<title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="Sankhyas">
  <meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${origin}assets/logo-512.png">
  <meta name="twitter:card" content="summary">` + (ld ? `\n  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '');

const screenCounts = {};
const screenPages = [];
for (const p of Screener.PRESETS) {
  let res;
  try { res = Screener.run(p.query, everyone); } catch (e) { continue; }
  const list = res.results.slice().sort((a, b) => (b.metrics.marketCap || 0) - (a.metrics.marketCap || 0));
  screenCounts[p.slug] = list.length;
  const base = ['price', 'marketCap', 'pe', 'roce'];
  const cols = base.concat(res.used.filter(k => base.indexOf(k) < 0)).slice(0, 7);
  const url = screenUrl(p.slug);
  const title = `${p.name}: ${list.length} stocks in India (${monthYear}) | Sankhyas`;
  const desc = (`${p.desc} ${list.length} NSE and BSE stocks match today` + (list.length ? `, largest first: ${list.slice(0, 4).map(x => x.name.replace(/ (Limited|Ltd\.?)$/i, '')).join(', ')}.` : '.')).slice(0, 300);
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'ItemList', name: p.name, numberOfItems: list.length, itemListElement: list.slice(0, 10).map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, url: urlOf(x.symbol) })) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Sankhyas', item: origin },
      { '@type': 'ListItem', position: 2, name: 'Stock screens', item: origin + 'screens/' },
      { '@type': 'ListItem', position: 3, name: p.name, item: url }] }] };
  const related = Screener.PRESETS.filter(x => x.slug !== p.slug && x.cat === p.cat).slice(0, 6);
  const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › <a href="${origin}screens/">Stock screens</a> › ${esc(p.name)}</nav>
<h1>${esc(p.name)}: ${list.length} stocks</h1>
<p>${esc(p.desc)}</p>
<p class="sub">Screen: <code>${esc(p.query)}</code> · updated ${esc(todayText)} · ${list.length} NSE and BSE companies match, largest first.</p>
<p><a class="btn btn-primary" href="${origin}#/screens/${esc(p.slug)}">Open this screen: sort, change it, export</a></p>
<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th class="l">#</th><th class="l">Company</th>${cols.map(k => `<th>${esc(colName(k))}</th>`).join('')}</tr></thead><tbody>` +
    list.slice(0, 50).map((x, i) => `<tr><td class="l">${i + 1}</td><td class="l"><a href="${esc(urlOf(x.symbol))}">${esc(x.name)}</a></td>${cols.map(k => `<td>${fmtKey(k, x.metrics[k])}</td>`).join('')}</tr>`).join('') +
    `</tbody></table></div>${list.length > 50 ? `<p class="sub">Showing the 50 largest of ${list.length}. <a href="${origin}#/screens/${esc(p.slug)}">See all ${list.length}</a>.</p>` : ''}</section>` +
    (related.length ? `<section class="card"><h2>Similar screens</h2><ul class="seo-peers">${related.map(x => `<li><a href="${esc(screenUrl(x.slug))}">${esc(x.name)}</a></li>`).join('')}</ul></section>` : '') +
    `<p class="table-note">Lists are worked out from each company's latest reported numbers and prices, end of day. For research and education, not investment advice.</p></div>`;
  staticPage(path.join('screens', p.slug), 2, 'screens/' + p.slug, pageHead(title, desc, url, ld), bodyHtml);
  screenPages.push(url);
}
// all screens
{
  const url = origin + 'screens/';
  const cats = [...new Set(Screener.PRESETS.map(p => p.cat || 'More'))];
  const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › Stock screens</nav>
<h1>Stock screens for Indian shares</h1><p>Ready-made lists of NSE and BSE stocks, updated every day: debt-free companies, high dividend yield, compounders, stocks near their 52-week low and more. Open any one to sort it, change the rules or export it.</p>` +
    cats.map(cat => `<section class="card"><h2>${esc(cat)}</h2><ul class="seo-peers">${Screener.PRESETS.filter(p => (p.cat || 'More') === cat).map(p => `<li><a href="${esc(screenUrl(p.slug))}">${esc(p.name)}</a> <span class="sub">${screenCounts[p.slug] != null ? screenCounts[p.slug] + ' stocks' : ''}</span></li>`).join('')}</ul></section>`).join('') + '</div>';
  staticPage('screens', 1, 'screens', pageHead(`Stock screens: debt free, high dividend, compounders and more (${monthYear}) | Sankhyas`, 'Ready-made stock screens for NSE and BSE shares, updated daily: debt free companies, high dividend yield, magic formula, coffee can, stocks near 52-week low and more.', url), bodyHtml);
  screenPages.push(url);
}
// dividends calendar
const dividendsUrl = origin + 'dividends/';
{
  const ca = readJSON(path.join(yahoo, 'corporate_actions.json'));
  const up = ((ca && ca.items) || []).filter(x => x.rd >= today0()).slice(0, 150);
  const dd = s => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const title = `Upcoming dividends, bonus issues and stock splits in India (${monthYear}) | Sankhyas`;
  const desc = `Record dates for dividends, bonus issues and stock splits of NSE and BSE companies, with the amount per share and yield.` + (up.length ? ` Next: ${up.slice(0, 3).map(x => x.n.replace(/ (Limited|Ltd\.?)$/i, '') + ' (' + dd(x.rd) + ')').join(', ')}.` : '');
  const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › Dividends</nav>
<h1>Upcoming dividends, bonus &amp; stock splits</h1><p>Record dates announced by NSE and BSE companies. Own the shares on the record date to get the dividend or bonus: buy by the trading day before it (T+1 settlement). Updated ${esc(todayText)}.</p>
<p><a class="btn btn-primary" href="${origin}#/dividends">Open the full calendar</a></p>` +
    (up.length ? `<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th class="l">Record date</th><th class="l">Company</th><th class="l">Action</th><th>Per share</th><th>Yield</th></tr></thead><tbody>` +
      up.map(x => `<tr><td class="l">${dd(x.rd)}</td><td class="l"><a href="${esc(urlOf(x.s))}">${esc(x.n)}</a></td><td class="l">${esc(x.label)}</td><td>${x.k === 'div' ? (x.amt ? '₹ ' + inr(x.amt, x.amt % 1 ? 2 : 0) : 'to be announced') : '-'}</td><td>${x.y != null ? inr(x.y, 2) + '%' : '-'}</td></tr>`).join('') +
      '</tbody></table></div></section>' : '<p class="muted">No record dates announced for the coming weeks yet.</p>') +
    `<p class="table-note">From the companies' filings on NSE. Not investment advice.</p></div>`;
  staticPage('dividends', 1, 'dividends', pageHead(title, desc, dividendsUrl), bodyHtml);
}
function today0() { return new Date().toISOString().slice(0, 10); }

// ---------- investors (investors/, investor/<slug>/) and who bought and who sold (holders/) ----------
// "LIC portfolio", "Rekha Jhunjhunwala holdings", "Government of Singapore stocks": each larger investor's
// holdings as filed in the latest shareholding patterns (scripts/build_index.mjs)
const investorPages = [];
{
  const d = readJSON(path.join(yahoo, 'investors.json'));
  if (d && d.inv && d.inv.length) {
    const nameOf = {};
    companies.forEach(c => { nameOf[c.s] = c.n; });
    const TYPE = { mf: 'Mutual fund house', fii: 'Foreign investor', dii: 'Indian institution', public: 'Individual / other', promoter: 'Promoter group', gov: 'Government' };
    const invUrl = slug => origin + 'investor/' + slug + '/';
    const ql = q => new Date(q + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    const chg = (now, was) => (was == null ? '-' : !(was > 0) ? 'New' : inr(now - was, 2));
    // investors outside promoter groups with three or more companies, and every mutual fund house
    const picked = d.inv.filter(r => r[5] || (r[2] !== 'promoter' && r[3] >= 3)).slice(0, 800);
    const shards = {};
    const holdOf = slug => { const k = slug[0]; if (!(k in shards)) shards[k] = readJSON(path.join(yahoo, 'inv', k + '.json')) || {}; return shards[k][slug] || null; };
    for (const r of picked) {
      const [slug, name, g, n, value] = r;
      const hold = holdOf(slug);
      if (!hold) continue;
      const held = hold.filter(h => h[1] > 0);
      const qn = {};
      held.forEach(h => { qn[h[3]] = (qn[h[3]] || 0) + 1; });
      const q = Object.keys(qn).sort((a, b) => qn[b] - qn[a] || (a < b ? 1 : -1))[0];   // the quarter most of its companies are at
      const url = invUrl(slug);
      const title = `${name} portfolio: ${n} stocks${q ? ' (' + ql(q) + ')' : ''} | Sankhyas`;
      const desc = `${name} holds ${n} listed Indian companies worth about ₹ ${inr(value)} Cr: ` + held.slice(0, 4).map(h => (nameOf[h[0]] || h[0]).replace(/ (Limited|Ltd\.?)$/i, '') + ' ' + inr(h[1], 2) + '%').join(', ') + '. Stakes and changes from shareholding patterns.';
      const ld = { '@context': 'https://schema.org', '@graph': [
        { '@type': 'ItemList', name: name + ' portfolio', numberOfItems: held.length, itemListElement: held.slice(0, 10).map((h, i) => ({ '@type': 'ListItem', position: i + 1, name: nameOf[h[0]] || h[0], url: urlOf(h[0]) })) },
        { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Sankhyas', item: origin },
          { '@type': 'ListItem', position: 2, name: 'Investors', item: origin + 'investors/' },
          { '@type': 'ListItem', position: 3, name, item: url }] }] };
      const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › <a href="${origin}investors/">Investors</a> › ${esc(name)}</nav>
<h1>${esc(name)}: portfolio and holdings</h1><p>${esc(TYPE[g] || 'Investor')} · ${held.length} companies · about ₹ ${inr(value)} Cr at today's prices. Stakes as filed in the companies' shareholding patterns${q ? ' for ' + ql(q) : ''}, with the change from the quarter before.</p>
<p><a class="btn btn-primary" href="${origin}#/investor/${esc(slug)}">Open the full portfolio</a></p>
<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th class="l">#</th><th class="l">Company</th><th>Stake %</th><th>Change pts</th><th class="l">Quarter</th></tr></thead><tbody>` +
        held.slice(0, 100).map((h, i) => `<tr><td class="l">${i + 1}</td><td class="l"><a href="${esc(urlOf(h[0]))}">${esc(nameOf[h[0]] || h[0])}</a></td><td>${inr(h[1], 2)}</td><td>${chg(h[1], h[2])}</td><td class="l">${ql(h[3])}</td></tr>`).join('') +
        `</tbody></table></div></section><p class="table-note">Shareholding patterns name every promoter group holder, and other holders only at 1% or more. For information only, not investment advice.</p></div>`;
      staticPage(path.join('investor', slug), 2, 'investor/' + slug, pageHead(title, desc, url, ld), bodyHtml);
      investorPages.push(url);
    }
    // all investors
    {
      const url = origin + 'investors/';
      const list = d.inv.filter(r => r[2] !== 'promoter').slice(0, 300);
      const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › Investors</nav>
<h1>Investor portfolios: who owns what in Indian stocks</h1><p>LIC, mutual fund houses, foreign funds such as the Government of Singapore and Vanguard, and well-known individual investors: the listed companies each one holds, from the latest shareholding patterns. Updated ${esc(todayText)}.</p>
<p><a class="btn btn-primary" href="${origin}#/investors">Search all investors</a> <a class="btn" href="${origin}holders/">Who bought and who sold</a></p>
<section class="card"><div class="table-wrap"><table class="data"><thead><tr><th class="l">#</th><th class="l">Investor</th><th class="l">Type</th><th>Companies</th><th>Value ₹ Cr</th></tr></thead><tbody>` +
        list.map((r, i) => `<tr><td class="l">${i + 1}</td><td class="l">${investorPages.indexOf(invUrl(r[0])) >= 0 ? `<a href="${esc(invUrl(r[0]))}">${esc(r[1])}</a>` : esc(r[1])}</td><td class="l">${TYPE[r[2]] || ''}</td><td>${r[3]}</td><td>${inr(r[4])}</td></tr>`).join('') +
        '</tbody></table></div></section></div>';
      staticPage('investors', 1, 'investors', pageHead(`Investor portfolios: LIC, mutual funds, FIIs and big investors (${monthYear}) | Sankhyas`, 'What LIC, SBI Mutual Fund, the Government of Singapore, Vanguard, Rekha Jhunjhunwala and other big investors hold in Indian stocks, and how their stakes changed last quarter.', url), bodyHtml);
      investorPages.push(url);
    }
    // who bought and who sold, the largest changes of the latest quarter
    {
      const url = origin + 'holders/';
      const inv = {};
      d.inv.forEach(r => { inv[r[0]] = r; });
      const byQ = {};
      d.chg.forEach(x => { byQ[x[5]] = (byQ[x[5]] || 0) + 1; });
      const q = Object.keys(byQ).sort((a, b) => byQ[b] - byQ[a])[0];
      const sec = (kind, h) => {
        const l = d.chg.filter(x => x[5] === q && x[2] === kind && inv[x[1]]).slice(0, 30);
        return `<section class="card"><h2>${h}</h2><div class="table-wrap"><table class="data"><thead><tr><th class="l">Company</th><th class="l">Investor</th><th>Previous %</th><th>Now %</th></tr></thead><tbody>` +
          l.map(x => `<tr><td class="l"><a href="${esc(urlOf(x[0]))}">${esc(nameOf[x[0]] || x[0])}</a></td><td class="l">${investorPages.indexOf(invUrl(x[1])) >= 0 ? `<a href="${esc(invUrl(x[1]))}">${esc(inv[x[1]][1])}</a>` : esc(inv[x[1]][1])}</td><td>${inr(x[4], 2)}</td><td>${inr(x[3], 2)}</td></tr>`).join('') + '</tbody></table></div></section>';
      };
      const bodyHtml = `<div class="container page seo-page"><nav class="sub" aria-label="Breadcrumb"><a href="${origin}">Sankhyas</a> › Who bought and who sold</nav>
<h1>Who bought and who sold: ${q ? ql(q) : 'last'} quarter</h1><p>Named shareholders who came onto a company's shareholder list, added to their stake, trimmed it or left the list, against the quarter before. Largest by value first. Updated ${esc(todayText)}.</p>
<p><a class="btn btn-primary" href="${origin}#/holders">Open the full list</a></p>` +
        (q ? sec('new', 'New on the list') + sec('up', 'Added') + sec('down', 'Trimmed') + sec('exit', 'Left the list') : '') +
        `<p class="table-note">Shareholding patterns name every promoter group holder, and others only at 1% or more, so "new" can mean crossing 1% and "left the list" falling below it. Not investment advice.</p></div>`;
      staticPage('holders', 1, 'holders', pageHead(`Who bought and who sold: shareholding changes${q ? ' ' + ql(q) : ''} | Sankhyas`, 'Which mutual funds, FIIs, LIC and big investors entered, raised, cut or exited Indian stocks last quarter, from shareholding patterns.', url), bodyHtml);
      investorPages.push(url);
    }
  }
}

const urls = [origin].concat(screenPages, [dividendsUrl], investorPages, companies.filter(c => c.s && c.n).map(c => urlOf(c.s)));
// sitemaps hold at most 50,000 URLs each
fs.writeFileSync(path.join(site, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `<url><loc>${esc(u)}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n') + '\n</urlset>\n');
// IndexNow (Bing, Yandex and others): a public key file proves the site owns the URLs it submits
const INDEXNOW_KEY = 'e75c62e0ffa1fb81d6edb2177fbb2375';
fs.writeFileSync(path.join(site, INDEXNOW_KEY + '.txt'), INDEXNOW_KEY);
fs.writeFileSync(path.join(path.dirname(site), 'indexnow.json'),   // beside the site folder, not published
   JSON.stringify({ host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: origin + INDEXNOW_KEY + '.txt', urlList: urls }));
fs.writeFileSync(path.join(site, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}sitemap.xml\n`);
console.log(`build_seo: ${n} company pages, sitemap with ${urls.length} URLs (${origin})`);
