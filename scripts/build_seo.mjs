// Search-engine pages: one static HTML page per company at company/<SYMBOL>/index.html, plus
// sitemap.xml and robots.txt. Each page carries the company's key numbers, business description,
// latest quarterly results, the AI concall/presentation summary and links to peers, so Google can
// index it. The same page boots the full app, which then renders the interactive company view.
//
//   node scripts/build_seo.mjs <site dir> <site origin, e.g. https://sankhyas.com/>
import fs from 'node:fs';
import path from 'node:path';

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
fs.writeFileSync(path.join(site, 'index.html'), shell.replace('<head>', `<head>\n  <link rel="canonical" href="${origin}">\n  <meta property="og:type" content="website"><meta property="og:site_name" content="Sankhyas"><meta property="og:title" content="Sankhyas - India's AI-Powered Financial Research Terminal"><meta property="og:description" content="${esc(homeDesc)}"><meta property="og:url" content="${origin}"><meta property="og:image" content="${origin}assets/logo-512.png">`));
const today = new Date().toISOString().slice(0, 10);
const urls = [origin].concat(companies.filter(c => c.s && c.n).map(c => urlOf(c.s)));
// sitemaps hold at most 50,000 URLs each
fs.writeFileSync(path.join(site, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `<url><loc>${esc(u)}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(site, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}sitemap.xml\n`);
console.log(`build_seo: ${n} company pages, sitemap with ${urls.length} URLs (${origin})`);
