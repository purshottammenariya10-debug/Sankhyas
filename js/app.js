/* Sankhyas single-page app: routing, pages and UI components. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const app = $('#app');
  const RATIOS = Screener.RATIOS, RBY = Screener.BY_KEY;

  /* ---------- storage ---------- */
  const store = {
    get(k, def) { try { const v = localStorage.getItem('sankhyas_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('sankhyas_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const user = () => store.get('user', null);
  const watchlist = () => store.get('watchlist', []);
  const inWatchlist = s => watchlist().indexOf(s) >= 0;
  function toggleWatch(sym) {
    const w = watchlist();
    const i = w.indexOf(sym);
    if (i >= 0) w.splice(i, 1); else w.push(sym);
    store.set('watchlist', w);
    toast(i >= 0 ? sym + ' removed from watchlist' : sym + ' added to watchlist');
    return i < 0;
  }

  /* ---------- formatting ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function num(v, d) {
    if (v == null || !isFinite(v)) return '';
    d = d == null ? 0 : d;
    if (Math.abs(v) < 0.5 / Math.pow(10, d)) v = 0;
    return Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const pct = (v, d) => (v == null || !isFinite(v) ? '' : num(v, d == null ? 0 : d) + '%');
  const signCls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  function fmtMetric(key, v) {
    const r = RBY[key];
    if (v == null || !isFinite(v)) return '';
    const unit = r ? r.unit : '';
    if (unit === 'Rs.Cr.') return '₹ ' + num(v, 0) + ' Cr.';
    if (unit === 'Rs.') return '₹ ' + num(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
    if (unit === '%') return num(v, 2) + ' %';
    if (unit === 'Cr.') return num(v, 2) + ' Cr.';
    if (key === 'shareholders' || key === 'volume') return num(v, 0);
    return num(v, 1);
  }
  function fmtCell(key, v) {
    if (v == null || !isFinite(v)) return '';
    const r = RBY[key];
    if (!r) return num(v, 2);
    if (r.unit === 'Rs.Cr.') return num(v, 2);
    if (key === 'shareholders' || key === 'volume') return num(v, 0);
    return num(v, 2);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function modal(title, bodyHtml, buttons) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>' + esc(title) +
      '</h3><button class="btn btn-plain" data-close aria-label="Close">✕</button></div><div class="modal-body">' + bodyHtml +
      '</div><div class="modal-foot"></div></div>';
    const foot = $('.modal-foot', bd);
    const close = () => { bd.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    (buttons || [{ label: 'Close' }]).forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' btn-primary' : '');
      btn.textContent = b.label;
      btn.onclick = () => { if (!b.onClick || b.onClick(bd) !== false) close(); };
      foot.appendChild(btn);
    });
    bd.addEventListener('click', e => { if (e.target === bd || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bd);
    return bd;
  }

  function downloadCSV(name, rows) {
    const csv = rows.map(r => r.map(x => {
      const s = x == null ? '' : String(x);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  /* ---------- autocomplete ---------- */
  function attachSearch(input, onSelect, opts) {
    opts = opts || {};
    const wrap = input.parentElement;
    let list = null, items = [], active = -1;
    const close = () => { if (list) { list.remove(); list = null; } active = -1; };
    const pick = c => { close(); input.value = opts.keepValue ? c.name : ''; input.blur(); onSelect(c); };
    function render() {
      close();
      items = Data.search(input.value, 8);
      if (!input.value.trim()) return;
      list = document.createElement('div');
      list.className = 'ac-list';
      if (!items.length) {
        list.innerHTML = '<div class="ac-foot">No companies found for "' + esc(input.value) + '"</div>';
      } else {
        list.innerHTML = items.map((c, i) => '<div class="ac-item" data-i="' + i + '"><span>' + esc(c.name) +
          '</span><span class="ac-sym">' + esc(c.symbol) + '</span></div>').join('') +
          (opts.footer === false ? '' : '<div class="ac-foot">Search across ' + Data.listCompanies().length + ' listed companies</div>');
      }
      wrap.appendChild(list);
      $$('.ac-item', list).forEach(el => el.addEventListener('mousedown', e => { e.preventDefault(); pick(items[+el.dataset.i]); }));
    }
    function highlight() { $$('.ac-item', list).forEach((el, i) => el.classList.toggle('active', i === active)); }
    input.addEventListener('input', render);
    input.addEventListener('focus', () => { if (input.value) render(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; highlight(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = items[active >= 0 ? active : 0]; if (c) pick(c); }
      else if (e.key === 'Escape') close();
    });
  }

  /* ---------- nav / auth ---------- */
  function renderAuth() {
    const u = user();
    const slot = $('#auth-slot');
    if (!u) {
      slot.innerHTML = '<a href="#/login" class="btn btn-small">Login</a><a href="#/register" class="btn btn-small btn-primary">Get free account</a>';
      return;
    }
    slot.innerHTML = '<div class="user-menu"><button class="btn btn-small" id="user-btn">' + esc(u.name.split(' ')[0]) + ' ▾</button></div>';
    $('#user-btn').onclick = e => {
      e.stopPropagation();
      const existing = $('.user-menu .dropdown');
      if (existing) { existing.remove(); return; }
      const dd = document.createElement('div');
      dd.className = 'dropdown';
      dd.innerHTML = '<a href="#/watchlist">Watchlist</a><a href="#/screens">My screens</a><a href="#/premium">Sankhyas Pro</a><button id="logout-btn">Logout</button>';
      $('.user-menu').appendChild(dd);
      $('#logout-btn').onclick = () => { store.set('user', null); renderAuth(); toast('Logged out'); location.hash = '#/'; };
      setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }));
    };
  }

  /* ---------- router ---------- */
  let cleanup = [];
  function onLeave(fn) { cleanup.push(fn); }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach(kv => {
      const i = kv.indexOf('=');
      const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      params[k] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params };
  }
  let navToken = 0;
  const LOADING = '<div class="container page muted">Loading…</div>';
  function route() {
    navToken++;
    cleanup.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    cleanup = [];
    $('#nav-links').classList.remove('open');
    const { parts, params } = parseHash();
    const p0 = parts[0] || '';
    $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.nav === p0 || (p0 === 'screen' && a.dataset.nav === 'screens')));
    $('#nav-search-wrap').style.visibility = p0 === '' ? 'hidden' : 'visible';
    const routes = {
      '': pageHome, company: pageCompany, screens: pageScreens, screen: pageScreen, feed: pageFeed, tools: pageTools,
      market: pageMarket, results: pageResults, compare: pageCompare, watchlist: pageWatchlist,
      login: pageLogin, register: pageRegister, premium: pagePremium, about: pageAbout, ai: pageAI
    };
    const fn = routes[p0] || pageNotFound;
    const prevY = window.scrollY;
    fn(parts.slice(1), params);
    if (!(p0 === 'company' && routeKeepScroll)) window.scrollTo(0, 0); else window.scrollTo(0, prevY);
    routeKeepScroll = false;
    document.title = (pageTitle ? pageTitle + ' | ' : '') + 'Sankhyas';
  }
  let pageTitle = '', routeKeepScroll = false;
  const setTitle = t => { pageTitle = t; };

  /* ---------- Home ---------- */
  function pageHome() {
    setTitle("India's AI-Powered Financial Research Terminal");
    const all = Data.listCompanies();
    const gainers = all.slice().sort((a, b) => b.metrics.changePct - a.metrics.changePct).slice(0, 5);
    const losers = all.slice().sort((a, b) => a.metrics.changePct - b.metrics.changePct).slice(0, 5);
    const big = all.slice().sort((a, b) => b.metrics.marketCap - a.metrics.marketCap).slice(0, 5);
    const mini = list => list.map(c => '<div class="stat-mini"><a href="#/company/' + esc(c.symbol) + '">' + esc(c.name) +
      '</a><span class="' + signCls(c.metrics.changePct) + '">' + (c.metrics.changePct > 0 ? '+' : '') + num(c.metrics.changePct, 2) + '%</span></div>').join('');
    app.innerHTML =
      '<section class="home-hero">' +
      '<div class="logo"><img class="logo-mark" src="assets/logo.svg" alt=""><span>Sankhyas</span></div>' +
      '<p class="tagline">India\'s AI-Powered Financial Research Terminal</p>' +
      '<div class="home-search"><svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input type="search" id="home-search" placeholder="Search for a company" autocomplete="off" autofocus></div>' +
      '<div class="quick-links">Or analyse: ' + ['TCS', 'RELIANCE', 'HDFCBANK', 'INFY', 'ITC', 'TITAN', 'DMART'].filter(Data.exists).map(s =>
        '<a class="chip" href="#/company/' + s + '">' + s + '</a>').join('') + '</div>' +
      '</section>' +
      '<div class="container page">' +
      '<a class="ai-cta" href="#/ai"><span class="ai-spark">✦</span><span><b>Ask Sankhyas AI</b><span class="sub"> &middot; "Which IT companies have the best margins?" &middot; "Explain HDFC Bank\'s latest quarter"</span></span><span class="ai-cta-go">Ask AI →</span></a>' +
      '<div class="grid grid-3">' +
      '<div class="card feature"><h3><span class="feature-icon">⌕</span>Stock screener</h3><p class="muted">Run queries on 10 years of financial data. Filter stocks by 60+ ratios, or just describe what you want in plain English and let AI write the query.</p><a class="btn btn-primary" href="#/screen/new">Create a stock screen</a></div>' +
      '<div class="card feature"><h3><span class="feature-icon">▤</span>Company financials</h3><p class="muted">Quarterly results, profit &amp; loss, balance sheet, cash flows, ratios and shareholding in one page.</p><a class="btn" href="#/company/TCS">See an example</a></div>' +
      '<div class="card feature"><h3><span class="feature-icon">★</span>Watchlist &amp; feed</h3><p class="muted">Follow companies to get their latest results and announcements in your feed.</p><a class="btn" href="#/feed">Open feed</a></div>' +
      '</div>' +
      '<div class="grid grid-3">' +
      '<div class="card"><h3>Top gainers</h3>' + mini(gainers) + '</div>' +
      '<div class="card"><h3>Top losers</h3>' + mini(losers) + '</div>' +
      '<div class="card"><h3>Largest companies</h3>' + big.map(c => '<div class="stat-mini"><a href="#/company/' + esc(c.symbol) + '">' + esc(c.name) +
        '</a><span>₹ ' + num(c.metrics.marketCap, 0) + ' Cr.</span></div>').join('') + '</div>' +
      '</div>' +
      '<div class="card"><div class="section-head"><div><h2>Popular stock screens</h2><p>Hand-picked queries to get you started</p></div><a class="btn" href="#/screens">View all screens</a></div>' +
      '<div class="grid grid-3">' + Screener.PRESETS.slice(0, 6).map(screenCard).join('') + '</div></div>' +
      '</div>';
    attachSearch($('#home-search'), c => { location.hash = '#/company/' + c.symbol; });
  }
  function screenCard(s) {
    return '<div class="card card-flat screen-card" style="margin:0"><h3><a href="#/screens/' + esc(s.slug) + '">' + esc(s.name) + '</a></h3><p class="muted" style="font-size:14px;margin:0">' +
      esc(s.desc) + '</p><code>' + esc(s.query) + '</code></div>';
  }

  /* ---------- Company ---------- */
  const COMPANY_SECTIONS = [
    ['top', 'Summary'], ['ai', 'AI Analyst'], ['insights', 'Insights'], ['chart', 'Chart'], ['analysis', 'Analysis'], ['peers', 'Peers'], ['quarters', 'Quarters'],
    ['profit-loss', 'Profit & Loss'], ['balance-sheet', 'Balance Sheet'], ['cash-flow', 'Cash Flow'], ['ratios', 'Ratios'],
    ['shareholding', 'Investors'], ['documents', 'Documents']
  ];
  const DEFAULT_TOP = ['marketCap', 'price', '_highlow', 'pe', 'bookValue', 'divYield', 'roce', 'roe', 'faceValue'];

  function pageCompany(parts) {
    const sym = (parts[0] || '').toUpperCase();
    const standalone = parts[1] === 'standalone';
    if (!Data.exists(sym)) return pageNotFound();
    Data.listCompanies();
    const ready = Data.getCompany(sym, standalone);
    if (ready && !ready.summary) return renderCompany(ready, sym, standalone);
    setTitle(ready ? ready.name + ' share price' : sym);
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadCompany(sym, standalone).then(c => {
      if (token !== navToken) return;
      if (!c) return pageNotFound();
      renderCompany(c, sym, standalone);
    }).catch(() => {
      if (token === navToken) app.innerHTML = '<div class="container page"><div class="error-box">Could not load data for ' + esc(sym) + '. Please try again later.</div></div>';
    });
  }

  let currentCompany = null;
  function renderCompany(c, sym, standalone) {
    const token = navToken;
    currentCompany = c;
    if (standalone) c.metrics.industryPE = Data.getCompany(sym).metrics.industryPE;
    const m = c.metrics;
    setTitle(c.name + ' share price');
    document.title = c.name + ' share price | Sankhyas';
    const followed = inWatchlist(sym);

    app.innerHTML =
      '<div class="company-head" id="top"><div class="container">' +
      '<div class="company-title"><div>' +
      '<h1>' + esc(c.name) + (c.sme ? ' <span class="sme-badge" title="Listed on the NSE Emerge SME platform">SME</span>' : '') + '</h1>' +
      '<div class="company-links">' +
      (c.website ? '<a href="https://' + esc(c.website) + '" target="_blank" rel="noopener">🔗 ' + esc(c.website) + '</a>' : '') +
      (c.exchange === 'BSE' ? '<span>BSE: ' + esc(c.bseCode || c.symbol) + '</span>'
        : (c.bseCode ? '<span>BSE: ' + esc(c.bseCode) + '</span>' : '') + '<span>NSE: ' + esc(c.symbol) + '</span>') +
      '<a href="#/market/' + encodeURIComponent(c.sector) + '">' + esc(c.sector) + '</a><span>' + esc(c.industry) + '</span>' +
      '</div>' +
      '<div class="price-line"><span class="price">₹ ' + num(m.price, 0) + '</span><span class="chg ' + signCls(m.change) + '">' +
      (m.change >= 0 ? '▲ ' : '▼ ') + num(Math.abs(m.changePct), 2) + '%</span><span class="asof">' +
      c.dates[c.dates.length - 1].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' - close price' + (c.live ? ' &middot; Yahoo Finance' : '') + '</span></div>' +
      '</div><div class="company-actions">' +
      '<button class="btn" id="export-btn">⤓ Export to Excel</button>' +
      '<button class="btn ' + (followed ? 'active' : 'btn-primary') + '" id="follow-btn">' + (followed ? '✓ Following' : '+ Follow') + '</button>' +
      '</div></div></div>' +
      '<div class="sub-nav" id="sub-nav"><div class="container"><span class="sub-nav-name">' + esc(c.symbol) + '</span>' +
      COMPANY_SECTIONS.map(s => '<a href="" data-target="' + s[0] + '">' + esc(s[1]) + '</a>').join('') + '</div></div>' +
      '</div>' +
      '<div class="container page">' +
      summarySection(c) + aiSection(c) + insightsSection(c) + chartSection(c) + analysisSection(c) + peersSection(c) + quartersSection(c) +
      plSection(c) + bsSection(c) + cfSection(c) + ratiosSection(c) + shareholdingSection(c) + documentsSection(c) + notesSection(c) +
      '</div>';

    // actions
    $('#follow-btn').onclick = () => {
      const now = toggleWatch(sym);
      const b = $('#follow-btn');
      b.className = 'btn ' + (now ? 'active' : 'btn-primary');
      b.textContent = now ? '✓ Following' : '+ Follow';
    };
    $('#export-btn').onclick = () => exportCompany(c);
    $$('[data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); routeKeepScroll = true; location.hash = a.getAttribute('href'); }));

    // sub nav
    $$('#sub-nav a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const el = document.getElementById(a.dataset.target);
      if (el) window.scrollTo({ top: a.dataset.target === 'top' ? 0 : el.getBoundingClientRect().top + window.scrollY - 118, behavior: 'smooth' });
    }));
    const onScroll = () => {
      const nav = $('#sub-nav');
      if (!nav) return;
      nav.classList.toggle('stuck', nav.getBoundingClientRect().top <= parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) + 1);
      let current = 'top';
      COMPANY_SECTIONS.forEach(s => {
        const el = document.getElementById(s[0]);
        if (el && s[0] !== 'top' && el.getBoundingClientRect().top < 140) current = s[0];
      });
      $$('#sub-nav a').forEach(a => a.classList.toggle('active', a.dataset.target === current));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onLeave(() => window.removeEventListener('scroll', onScroll));
    onScroll();

    bindTopRatios(c);
    bindChart(c);
    bindStatements();
    bindShareholding(c);
    bindDocuments();
    if (c.live) {
      Data.loadFilings(sym).then(f => {
        if (token !== navToken || !$('#documents')) return;
        const tmp = document.createElement('div');
        if (!f || (!(f.announcements || []).length && !(f.annualReports || []).length)) return;
        c._filings = f;
        tmp.innerHTML = documentsSection(c, f);
        $('#documents').replaceWith(tmp.firstChild);
        bindDocuments();
        refreshInsights(c);
      });
    }
    bindNotes(c);
    bindAI(c);
  }

  function topRatioRow(c, key) {
    const m = c.metrics;
    if (key === '_highlow') return ['High / Low', '₹ ' + num(m.high52, 0) + ' / ' + num(m.low52, 0)];
    const r = RBY[key];
    if (!r) return null;
    const names = { marketCap: 'Market Cap', price: 'Current Price', pe: 'Stock P/E', bookValue: 'Book Value', divYield: 'Dividend Yield', roce: 'ROCE', roe: 'ROE', faceValue: 'Face Value' };
    return [names[key] || r.name, fmtMetric(key, m[key])];
  }
  function summarySection(c) {
    const extra = store.get('topratios', []);
    const keys = DEFAULT_TOP.concat(extra.filter(k => DEFAULT_TOP.indexOf(k) < 0));
    const m = c.metrics;
    const other = c.standalone ? 'consolidated' : 'standalone';
    const hrefOther = '#/company/' + c.symbol + (c.standalone ? '' : '/standalone');
    return '<section class="section card" id="summary"><div class="summary-grid"><div>' +
      '<ul class="top-ratios" id="top-ratios">' + keys.map(k => {
        const row = topRatioRow(c, k);
        return row ? '<li><span class="name">' + esc(row[0]) + '</span><span class="value">' + esc(row[1]) + '</span></li>' : '';
      }).join('') + '</ul>' +
      '<div class="flex" style="margin-top:12px"><button class="btn btn-small" id="edit-ratios">✎ Edit ratios</button>' +
      '<span class="sub">Showing ' + (c.standalone ? 'standalone' : 'consolidated') + ' figures.' + (c.live ? '' : ' <a href="' + hrefOther + '" data-view>View ' + other + '</a>') + '</span></div>' +
      '</div><div class="about"><h3>About</h3><p>' + (c.about ? esc(c.about.length > 600 ? c.about.slice(0, 600).replace(/\s+\S*$/, '') + '…' : c.about) :
      esc(c.name) + ' is one of India\'s leading companies in the ' + esc(c.industry.toLowerCase()) +
      ' space, part of the ' + esc(c.sector) + ' sector. The company is listed on BSE and NSE' + (c.psu ? ' and is a public sector undertaking under the Government of India.' : '.')) + '</p>' +
      '<h3>Key Points</h3><ul>' +
      '<li><b>Scale:</b> Trailing twelve month revenue of ₹ ' + num(m.sales, 0) + ' Cr. with an operating margin of ' + num(m.opm, 1) + '%.</li>' +
      '<li><b>Growth:</b> Sales have compounded at ' + num(m.salesGrowth5, 1) + '% over the last 5 years; profits at ' + num(m.profitGrowth5, 1) + '%.</li>' +
      (c.live ? '<li><b>Ownership:</b> Insiders hold ' + num(m.promoter, 2) + '% and institutions ' + num(m.fii, 2) + '%.</li>'
        : '<li><b>Ownership:</b> Promoters hold ' + num(m.promoter, 2) + '%, FIIs ' + num(m.fii, 2) + '% and DIIs ' + num(m.dii, 2) + '%.</li>') +
      '</ul></div></div></section>';
  }
  function bindTopRatios(c) {
    $('#edit-ratios').onclick = () => {
      const sel = store.get('topratios', []);
      const body = '<p class="muted" style="font-size:14px">Pick additional ratios to show on every company page.</p><input type="search" id="ratio-filter" placeholder="Filter ratios" style="margin-bottom:10px"><div class="check-grid">' +
        RATIOS.filter(r => DEFAULT_TOP.indexOf(r.key) < 0).map(r => '<label data-name="' + esc(r.name.toLowerCase()) + '"><input type="checkbox" value="' + r.key + '"' +
          (sel.indexOf(r.key) >= 0 ? ' checked' : '') + '>' + esc(r.name) + '</label>').join('') + '</div>';
      const bd = modal('Edit ratios', body, [
        { label: 'Reset', onClick: () => { store.set('topratios', []); rerender(); } },
        { label: 'Save', primary: true, onClick: b => { store.set('topratios', $$('input[type=checkbox]:checked', b).map(i => i.value)); rerender(); } }
      ]);
      $('#ratio-filter', bd).addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        $$('.check-grid label', bd).forEach(l => { l.style.display = l.dataset.name.indexOf(q) >= 0 ? '' : 'none'; });
      });
    };
    function rerender() {
      const tmp = document.createElement('div');
      tmp.innerHTML = summarySection(c);
      $('#summary').replaceWith(tmp.firstChild);
      $$('#summary [data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); routeKeepScroll = true; location.hash = a.getAttribute('href'); }));
      bindTopRatios(c);
    }
  }

  /* AI analyst */
  /* ---------- Sankhyas Insights: red flags, guidance tracker, what changed ---------- */
  const PRO_TAG = '<span class="pro-tag" title="Sankhyas Pro feature, free during beta">PRO</span>';
  const signed = (v, unit) => (v == null || !isFinite(v) ? '<span class="muted">-</span>' : '<span class="' + (v >= 0 ? 'up' : 'down') + '">' + (v >= 0 ? '+' : '') + num(v, 1) + unit + '</span>');
  function riskCard(c) {
    const r = Insights.redFlags(c);
    const cls = r.band === 'High' ? 'risk-high' : r.band === 'Moderate' ? 'risk-mid' : 'risk-low';
    return '<div class="ins-card ins-risk"><div class="ins-head"><h3>Red-flag scan</h3>' + PRO_TAG + '</div>' +
      '<div class="risk-meter ' + cls + '"><div class="risk-score"><b>' + r.score + '</b><span>/100</span></div><div><div class="risk-band">' + r.band + ' risk</div>' +
      '<div class="risk-bar"><span style="width:' + Math.max(3, r.score) + '%"></span></div></div></div>' +
      (r.flags.length ? '<ul class="flag-list">' + r.flags.map(f => '<li><span class="sev sev-' + f.sev + '" title="' + f.sev + ' severity"></span><div><b>' + esc(f.title) + '</b>' +
        (f.src ? ' <a class="sub" target="_blank" rel="noopener noreferrer" href="' + esc(f.src) + '">filing ↗</a>' : '') + '<div class="sub">' + esc(f.detail) + '</div></div></li>').join('') + '</ul>'
        : '<p class="muted">No red flags found in the financials' + (r.checked ? ' or the last 2 years of filings' : '') + '.</p>') +
      '<p class="table-note">Checks cash conversion, debt, receivables, dilution, tax, other income' + (r.checked ? ', and filings for auditor exits, pledges, defaults, downgrades and regulatory action.' : '. Filing checks run once this company\'s exchange filings are fetched.') + ' Higher = more warning signs; not a verdict.</p></div>';
  }
  function guidanceCard(c) {
    const g = Insights.guidance(c);
    const badge = s => '<span class="gd gd-' + s.toLowerCase().replace(/\s+/g, '-') + '">' + esc(s) + '</span>';
    const body = g.rows.length
      ? '<div class="table-wrap"><table class="data gd-table"><thead><tr><th class="l">Guided</th><th class="l">For</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead><tbody>' +
        g.rows.slice(0, 12).map(r => '<tr><td class="l" title="' + esc(r.t) + '">' + esc(r.label) + '<div class="sub">said ' + new Date(r.said).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) +
          (r.move ? ' &middot; ' + esc(r.move) : '') + '</div></td><td class="l">' + esc(r.p) + '</td><td>' + esc(r.target) + '</td><td>' +
          (r.actual != null ? num(r.actual, 1) + '%' : r.runRate != null ? '<span class="sub">run-rate</span> ' + num(r.runRate, 1) + '%' : '<span class="muted">-</span>') + '</td><td>' + badge(r.status) + '</td></tr>').join('') +
        '</tbody></table></div><p class="table-note">Targets are read from concall transcripts (hover a row for the exact words). Actuals come from the annual results; "run-rate" is the latest quarter vs a year ago.</p>'
      : '<p class="muted">No numeric guidance extracted yet. It appears automatically once ' + esc(c.name) + '\'s concall transcripts are fetched and summarised.</p>';
    return '<div class="ins-card ins-guide"><div class="ins-head"><h3>Guidance tracker</h3>' + PRO_TAG + '</div>' +
      (g.score != null ? '<div class="gd-score"><b>' + g.score + '%</b> of checkable guidance delivered <span class="sub">(' + g.judged + ' target' + (g.judged === 1 ? '' : 's') + ' checked, ' + g.calls + ' call' + (g.calls === 1 ? '' : 's') + ')</span></div>' : '') +
      body + '</div>';
  }
  function changedCard(c) {
    const w = Insights.whatChanged(c);
    let html = '';
    if (w.results) {
      html += '<h4>Results: ' + esc(w.results.quarter) + '</h4><div class="table-wrap"><table class="data"><thead><tr><th class="l"></th><th>Value</th><th>vs ' + esc(w.results.prev) + '</th><th>vs ' + esc(w.results.yago || 'year ago') + '</th></tr></thead><tbody>' +
        w.results.rows.filter(r => r.cur != null && isFinite(r.cur)).map(r => '<tr><td class="l">' + esc(r.label) + '</td><td>' + (r.isPct ? num(r.cur, 1) + '%' : num(r.cur, r.label === 'EPS' ? 2 : 0)) + '</td><td>' +
          signed(r.qoq, r.isPct ? ' pts' : '%') + '</td><td>' + signed(r.yoy, r.isPct ? ' pts' : '%') + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (w.concall) {
      const cc = w.concall, mv = m => '<span class="mv mv-' + m.replace(/\s+/g, '-') + '">' + esc(m) + '</span>';
      html += '<h4>Concall: ' + new Date(cc.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</h4><ul class="chg-list">' +
        '<li>Tone <b class="tone-' + esc(cc.tone).toLowerCase() + '">' + esc(cc.tone) + '</b>' + (cc.prevTone ? (cc.prevTone === cc.tone ? ', same as last call' : ', was <b class="tone-' + esc(cc.prevTone).toLowerCase() + '">' + esc(cc.prevTone) + '</b>') : '') + '</li>' +
        cc.guidance.map(g => '<li>' + esc(g.label) + ' ' + esc(g.period) + ': <b>' + esc(g.target) + '</b> ' + mv(g.move) + (g.was && g.move !== 'maintained' ? ' <span class="sub">was ' + esc(g.was) + '</span>' : '') + '</li>').join('') +
        cc.newRisks.slice(0, 3).map(x => '<li><span class="mv mv-lowered">new risk</span> ' + esc(x) + '</li>').join('') + '</ul>';
    }
    if (w.filings.length) {
      html += '<h4>Important filings since</h4><ul class="chg-list">' + w.filings.map(a => '<li><span class="sub">' + docWhen(a.d) + '</span> <a target="_blank" rel="noopener noreferrer" href="' + esc(a.u) + '">' + esc(cleanTitle(a.t)) + '</a></li>').join('') + '</ul>';
    }
    return '<div class="ins-card ins-changed"><div class="ins-head"><h3>What changed</h3>' + PRO_TAG + '</div>' + (html || '<p class="muted">Not enough history yet to compare the latest quarter and concall with the previous ones.</p>') + '</div>';
  }
  function insightsSection(c) {
    return '<section class="section card" id="insights"><div class="section-head"><div><h2>Sankhyas Insights</h2><p>Forensic red flags, management\'s promises vs delivery, and what changed this quarter. Free during beta.</p></div></div>' +
      '<div class="ins-grid">' + riskCard(c) + guidanceCard(c) + changedCard(c) + '</div></section>';
  }
  function refreshInsights(c) {
    const el = $('#insights');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = insightsSection(c);
    el.replaceWith(tmp.firstChild);
  }

  function aiSection(c) {
    return '<section class="section card" id="ai"><div id="ai-widget"></div></section>';
  }
  function bindAI(c) {
    const w = AI.mount($('#ai-widget'), {
      title: 'AI Analyst',
      intro: 'Ask about ' + c.name + ': growth, margins, debt, cash flow, valuation, the latest quarter, ownership, peers, or the bull and bear case.',
      placeholder: 'Ask about ' + c.name + '…',
      answer: q => AI.answerCompany(c, q),
      context: () => AI.companyContext(c),
      suggestions: [
        'Write a full research report: business snapshot, growth, profitability, balance sheet, cash flows, valuation, key risks and what to watch',
        'Explain the latest quarterly results',
        'Any red flags?',
        'What changed this quarter?',
        'Has management delivered on its guidance?',
        'Summarise the latest concall',
        'Is the valuation reasonable versus its history and growth?',
        'Give me the bull case and the bear case',
        'How healthy is the balance sheet and cash flow?'
      ]
    });
    onLeave(w.abort);
  }

  /* chart */
  function chartSection() {
    const ranges = ['1m', '6m', '1Yr', '3Yr', '5Yr', '10Yr', 'Max'];
    return '<section class="section card" id="chart"><div class="section-head"><div class="tabs" id="chart-range">' +
      ranges.map(r => '<button class="btn btn-small' + (r === '1Yr' ? ' active' : '') + '" data-range="' + r + '">' + r + '</button>').join('') +
      '</div><div class="tabs" id="chart-type">' +
      [['price', 'Price'], ['pe', 'PE Ratio'], ['sales', 'Sales & Margin']].map((t, i) => '<button class="btn btn-small' + (i === 0 ? ' active' : '') + '" data-type="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div></div><div class="chart-box"><canvas id="price-chart"></canvas></div><div class="chart-legend" id="chart-legend"></div></section>';
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function bindChart(c) {
    let range = '1Yr', type = 'price', chart = null;
    const toggles = { dma50: true, dma200: true, volume: true };
    const RANGE_DAYS = { '1m': 22, '6m': 126, '1Yr': 252, '3Yr': 756, '5Yr': 1260, '10Yr': 2520, 'Max': 1e9 };
    onLeave(() => { if (chart) chart.destroy(); });

    function sma(arr, n) {
      const out = new Array(arr.length).fill(null);
      let s = 0;
      for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= n) s -= arr[i - n]; if (i >= n - 1) out[i] = s / n; }
      return out;
    }
    const dma50 = sma(c.prices, 50), dma200 = sma(c.prices, 200);
    const lastFY = c.years.length ? +c.years[c.years.length - 1].slice(-4) : 0;
    const epsAt = d => {
      const fy = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear();
      const i = c.years.indexOf('Mar ' + (fy - 1));
      if (i >= 0 && c.pl.eps[i] != null) return c.pl.eps[i];
      return fy - 1 > lastFY ? c.ttm.eps : c.pl.eps.find(v => v != null);
    };
    const peSeries = c.prices.map((p, i) => { const e = epsAt(c.dates[i]); return e > 0 ? p / e : null; });

    function draw() {
      if (typeof Chart === 'undefined') { $('.chart-box').innerHTML = '<div class="info-box">Charts need an internet connection to load the chart library.</div>'; return; }
      if (chart) chart.destroy();
      const ink3 = cssVar('--ink-3'), line = cssVar('--line-2'), primary = cssVar('--primary');
      const n = c.prices.length;
      const start = Math.max(0, n - RANGE_DAYS[range]);
      const span = n - start;
      const step = Math.max(1, Math.floor(span / 500));
      const idx = [];
      for (let i = start; i < n; i += step) idx.push(i);
      if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
      const dateFmt = span > 300 ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' };
      const labels = idx.map(i => c.dates[i].toLocaleDateString('en-IN', dateFmt));
      const common = {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: {} } },
        scales: {
          x: { ticks: { color: ink3, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
          y: { position: 'right', ticks: { color: ink3 }, grid: { color: line } }
        }
      };
      let data, legend = '';
      if (type === 'price') {
        const ds = [{ label: 'Price on NSE', data: idx.map(i => c.prices[i]), borderColor: primary, backgroundColor: primary, borderWidth: 1.6, pointRadius: 0, tension: 0.1, yAxisID: 'y' }];
        if (toggles.dma50) ds.push({ label: '50 DMA', data: idx.map(i => dma50[i]), borderColor: '#e8a33d', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' });
        if (toggles.dma200) ds.push({ label: '200 DMA', data: idx.map(i => dma200[i]), borderColor: '#8a8fa0', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' });
        if (toggles.volume) ds.push({ type: 'bar', label: 'Volume', data: idx.map(i => c.volume[i]), backgroundColor: 'rgba(96,86,255,.18)', yAxisID: 'v', barPercentage: 1, categoryPercentage: 1 });
        common.scales.v = { display: false, position: 'left', max: Math.max.apply(null, idx.map(i => c.volume[i])) * 4, grid: { display: false } };
        data = { labels, datasets: ds };
        legend = [['Price on NSE', primary, null], ['50 DMA', '#e8a33d', 'dma50'], ['200 DMA', '#8a8fa0', 'dma200'], ['Volume', 'rgba(96,86,255,.35)', 'volume']]
          .map(l => '<label>' + (l[2] ? '<input type="checkbox" data-toggle="' + l[2] + '"' + (toggles[l[2]] ? ' checked' : '') + '>' : '') + '<span class="swatch" style="background:' + l[1] + '"></span>' + l[0] + '</label>').join('');
        chart = new Chart($('#price-chart'), { type: 'line', data, options: common });
      } else if (type === 'pe') {
        const pes = idx.map(i => peSeries[i]);
        const med = Data.median(pes);
        data = { labels, datasets: [
          { label: 'PE', data: pes, borderColor: primary, borderWidth: 1.6, pointRadius: 0 },
          { label: 'Median PE = ' + num(med, 1), data: pes.map(() => med), borderColor: '#e8a33d', borderDash: [5, 4], borderWidth: 1.2, pointRadius: 0 },
          { label: 'EPS', data: idx.map(i => epsAt(c.dates[i])), borderColor: '#11813d', borderWidth: 1.2, pointRadius: 0, yAxisID: 'e', stepped: true }
        ] };
        common.scales.e = { position: 'left', ticks: { color: ink3 }, grid: { display: false } };
        legend = '<label><span class="swatch" style="background:' + primary + '"></span>PE</label><label><span class="swatch" style="background:#e8a33d"></span>Median PE = ' + num(med, 1) +
          '</label><label><span class="swatch" style="background:#11813d"></span>EPS (left axis)</label>';
        chart = new Chart($('#price-chart'), { type: 'line', data, options: common });
      } else {
        const qn = { '1m': 4, '6m': 4, '1Yr': 4, '3Yr': 12, '5Yr': 13, '10Yr': 13, 'Max': 13 }[range];
        const qs = c.quarters.slice(-qn);
        data = { labels: qs, datasets: [
          { type: 'bar', label: 'Quarter Sales', data: c.q.sales.slice(-qn), backgroundColor: 'rgba(96,86,255,.55)', yAxisID: 'y' },
          { type: 'line', label: 'OPM %', data: c.q.opm.slice(-qn), borderColor: '#e8a33d', backgroundColor: '#e8a33d', yAxisID: 'p', pointRadius: 3 }
        ] };
        common.scales.p = { position: 'left', ticks: { color: ink3, callback: v => v + '%' }, grid: { display: false } };
        legend = '<label><span class="swatch" style="background:rgba(96,86,255,.55)"></span>Quarterly Sales (₹ Cr.)</label><label><span class="swatch" style="background:#e8a33d"></span>OPM % (left axis)</label>';
        chart = new Chart($('#price-chart'), { type: 'bar', data, options: common });
      }
      $('#chart-legend').innerHTML = legend;
      $$('#chart-legend [data-toggle]').forEach(cb => cb.addEventListener('change', () => { toggles[cb.dataset.toggle] = cb.checked; draw(); }));
    }
    $$('#chart-range button').forEach(b => b.onclick = () => { range = b.dataset.range; $$('#chart-range button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    $$('#chart-type button').forEach(b => b.onclick = () => { type = b.dataset.type; $$('#chart-type button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    draw();
  }

  /* analysis */
  function prosCons(c) {
    const m = c.metrics, pros = [], cons = [];
    const fin = c.sector === 'Financials';
    if (!fin && m.de < 0.1) pros.push('Company is almost debt free.');
    if (m.avgRoe3 > 18) pros.push('Company has a good return on equity (ROE) track record: 3 Years ROE ' + num(m.avgRoe3, 1) + '%');
    if (m.divYield > 1.2) pros.push('Company has been maintaining a healthy dividend payout of ' + num(c.pl.payout[c.pl.payout.length - 1], 1) + '%');
    if (m.profitGrowth5 > 14) pros.push('Company has delivered good profit growth of ' + num(m.profitGrowth5, 1) + '% CAGR over last 5 years');
    if (m.pb < 2 && m.pb > 0) pros.push('Stock is trading at ' + num(m.pb, 2) + ' times its book value');
    if (m.promoterChange3y > 0.5) pros.push('Promoter holding has increased by ' + num(m.promoterChange3y, 2) + '% over last quarters');
    if (m.fcf > 0 && m.fcf > m.np * 0.6) pros.push('Company generates strong free cash flow of ₹ ' + num(m.fcf, 0) + ' Cr.');
    if (m.pb > 8) cons.push('Stock is trading at ' + num(m.pb, 2) + ' times its book value');
    if (m.salesGrowth5 < 9) cons.push('The company has delivered a poor sales growth of ' + num(m.salesGrowth5, 2) + '% over past five years.');
    if (m.avgRoe3 < 12) cons.push('Company has a low return on equity of ' + num(m.avgRoe3, 2) + '% over last 3 years.');
    if (!fin && m.de > 1) cons.push('Company has a high debt to equity ratio of ' + num(m.de, 2) + '.');
    if (!fin && m.interestCoverage < 3) cons.push('Company has a low interest coverage ratio.');
    if (m.promoterChange3y < -0.5) cons.push('Promoter holding has decreased over last 3 years: ' + num(m.promoterChange3y, 2) + '%');
    if (m.pe && m.industryPE && m.pe > m.industryPE * 1.4) cons.push('Stock is trading at a premium to its industry median P/E of ' + num(m.industryPE, 1) + '.');
    if (!c.live && c.promoter === 0) cons.push('The company does not have an identifiable promoter group.');
    if (!pros.length) pros.push('Company is a large, established player in the ' + c.industry + ' industry.');
    if (!cons.length) cons.push('Valuations look stretched on a price to sales basis at ' + num(m.priceToSales, 2) + 'x.');
    return { pros: pros.slice(0, 5), cons: cons.slice(0, 5) };
  }
  function analysisSection(c) {
    const pc = prosCons(c);
    return '<section class="section card" id="analysis"><div class="pros-cons"><div class="pros"><h3>Pros</h3><ul>' + pc.pros.map(p => '<li>' + esc(p) + '</li>').join('') +
      '</ul></div><div class="cons"><h3>Cons</h3><ul>' + pc.cons.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div></div>' +
      '<p class="table-note">* The pros and cons are machine generated from the financial data.</p></section>';
  }

  /* peers */
  const PEER_COLS = ['price', 'pe', 'marketCap', 'divYield', 'qtrProfit', 'qtrProfitVar', 'qtrSales', 'qtrSalesVar', 'roce'];
  function peersSection(c) {
    const all = Data.listCompanies();
    let group = c.industry ? all.filter(x => x.industry === c.industry) : [];
    if (group.length < 4) group = all.filter(x => x.sector === c.sector);
    group = group.slice().sort((a, b) => (b.metrics.marketCap || 0) - (a.metrics.marketCap || 0));
    const peers = group.slice(0, 10);
    if (!peers.some(p => p.symbol === c.symbol)) peers.push(Data.getCompany(c.symbol) || c);
    return '<section class="section card" id="peers"><div class="section-head"><div><h2>Peer comparison</h2><p>Sector: <a href="#/market/' + encodeURIComponent(c.sector) + '">' + esc(c.sector) +
      '</a> &nbsp; Industry: ' + esc(c.industry) + '</p></div><a class="btn btn-small" href="#/compare?c=' + peers.slice(0, 4).map(p => p.symbol).join(',') + '">Compare peers</a></div>' +
      listTableHtml(peers, PEER_COLS, { highlight: c.symbol, median: true, medianOf: group }) +
      (group.length > 10 ? '<p class="table-note">Showing the 10 largest of ' + group.length + ' peers' + (peers.length > 10 ? ' plus this company' : '') + '. Median is across all of them.</p>' : '') + '</section>';
  }

  /* statement tables */
  function statementTable(headers, rows, opts) {
    opts = opts || {};
    const hl = opts.highlightLast ? headers.length - 1 : -1;
    if (!headers.length) return '<div class="info-box">No data available for this section.</div>';
    let h = '<div class="table-wrap"><table class="data"><thead><tr><th></th>' + headers.map((x, i) => '<th' + (i === hl ? ' class="highlight"' : '') + '>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach(r => {
      const fmt = v => (r.type === 'pct' ? pct(v, r.dec || 0) : num(v, r.dec || 0));
      const label = r.expand ? '<button class="expand" data-expand="' + r.expand + '">' + esc(r.label) + '</button>' : esc(r.label);
      h += '<tr class="' + (r.strong ? 'strong ' : '') + (r.sub ? 'sub-row hidden ' : '') + '"' + (r.sub ? ' data-sub="' + r.sub + '"' : '') + '><td>' + label + '</td>' +
        r.values.map((v, i) => '<td' + (i === hl ? ' class="highlight"' : '') + '>' + fmt(v) + '</td>').join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function bindStatements() {
    $$('.expand').forEach(b => b.addEventListener('click', () => {
      b.classList.toggle('open');
      const table = b.closest('table');
      $$('tr[data-sub="' + b.dataset.expand + '"]', table).forEach(tr => tr.classList.toggle('hidden'));
    }));
  }
  function sectionHead(id, title, desc, c) {
    const alt = c.standalone ? 'Consolidated' : 'Standalone';
    return '<section class="section card" id="' + id + '"><div class="section-head"><div><h2>' + esc(title) + '</h2><p>' + desc + '</p></div>' +
      (c.live ? '' : '<a class="btn btn-small btn-plain" href="#/company/' + c.symbol + (c.standalone ? '' : '/standalone') + '" data-view>View ' + alt + '</a>') + '</div>';
  }
  const figs = c => (c.standalone ? 'Standalone' : 'Consolidated') + ' Figures in Rs. Crores' + (c.live ? ' &middot; Source: Yahoo Finance' : '');

  function quartersSection(c) {
    const q = c.q;
    return sectionHead('quarters', 'Quarterly Results', figs(c), c) + statementTable(c.quarters, [
      { label: 'Sales', values: q.sales, strong: true },
      { label: 'Expenses', values: q.expenses },
      { label: 'Operating Profit', values: q.op, strong: true },
      { label: 'OPM %', values: q.opm, type: 'pct' },
      { label: 'Other Income', values: q.otherIncome },
      { label: 'Interest', values: q.interest },
      { label: 'Depreciation', values: q.depreciation },
      { label: 'Profit before tax', values: q.pbt },
      { label: 'Tax %', values: q.tax, type: 'pct' },
      { label: 'Net Profit', values: q.np, strong: true },
      { label: 'EPS in Rs', values: q.eps, dec: 2 }
    ], { highlightLast: true }) + '<p class="table-note">Raw PDF and detailed result filings are available under Documents.</p></section>';
  }

  function plSection(c) {
    const p = c.pl, t = c.ttm, m = c.metrics;
    const heads = c.years.concat(['TTM']);
    const w = (arr, v) => arr.concat([v]);
    const growthBox = (title, rows) => '<div class="growth-box"><h4>' + title + '</h4>' + rows.map(r => '<div><span>' + r[0] + ':</span><b>' + (r[1] == null ? '' : num(r[1], 0) + '%') + '</b></div>').join('') + '</div>';
    return sectionHead('profit-loss', 'Profit & Loss', figs(c), c) + statementTable(heads, [
      { label: 'Sales', values: w(p.sales, t.sales), strong: true },
      { label: 'Expenses', values: w(p.expenses, t.expenses), expand: p.material ? 'exp' : null }].concat(p.material ? [
      { label: 'Material Cost %', values: w(p.material, null), type: 'pct', sub: 'exp' },
      { label: 'Employee Cost %', values: w(p.employee, null), type: 'pct', sub: 'exp' },
      { label: 'Power & Fuel %', values: w(p.power, null), type: 'pct', sub: 'exp' },
      { label: 'Other Expenses %', values: w(p.otherExp, null), type: 'pct', sub: 'exp' }] : []).concat([
      { label: 'Operating Profit', values: w(p.op, t.op), strong: true },
      { label: 'OPM %', values: w(p.opm, t.opm), type: 'pct' },
      { label: 'Other Income', values: w(p.otherIncome, t.otherIncome) },
      { label: 'Interest', values: w(p.interest, t.interest) },
      { label: 'Depreciation', values: w(p.depreciation, t.depreciation) },
      { label: 'Profit before tax', values: w(p.pbt, t.pbt) },
      { label: 'Tax %', values: w(p.tax, t.tax), type: 'pct' },
      { label: 'Net Profit', values: w(p.np, t.np), strong: true },
      { label: 'EPS in Rs', values: w(p.eps, t.eps), dec: 2 },
      { label: 'Dividend Payout %', values: w(p.payout, null), type: 'pct' }
    ]), { highlightLast: true }) +
      '<div class="growth-boxes">' +
      growthBox('Compounded Sales Growth', [['10 Years', m.salesGrowth10], ['5 Years', m.salesGrowth5], ['3 Years', m.salesGrowth3], ['TTM', m.salesGrowthTTM]]) +
      growthBox('Compounded Profit Growth', [['10 Years', m.profitGrowth10], ['5 Years', m.profitGrowth5], ['3 Years', m.profitGrowth3], ['TTM', m.profitGrowthTTM]]) +
      growthBox('Stock Price CAGR', [['10 Years', m.ret10y], ['5 Years', m.ret5y], ['3 Years', m.ret3y], ['1 Year', m.ret1y]]) +
      growthBox('Return on Equity', [['10 Years', m.avgRoe10], ['5 Years', m.avgRoe5], ['3 Years', m.avgRoe3], ['Last Year', m.roe]]) +
      '</div></section>';
  }

  function bsSection(c) {
    const b = c.bs;
    const wr = b.equity.map((e, i) => e + b.reserves[i] + b.borrowings[i] + b.otherLiab[i]);
    return sectionHead('balance-sheet', 'Balance Sheet', figs(c), c) + statementTable(c.years, [
      { label: 'Equity Capital', values: b.equity },
      { label: 'Reserves', values: b.reserves },
      { label: 'Borrowings', values: b.borrowings, expand: 'bor' },
      { label: 'Long term Borrowings', values: b.borrowings.map(x => x * 0.62), sub: 'bor' },
      { label: 'Short term Borrowings', values: b.borrowings.map(x => x * 0.30), sub: 'bor' },
      { label: 'Lease Liabilities', values: b.borrowings.map(x => x * 0.08), sub: 'bor' },
      { label: 'Other Liabilities', values: b.otherLiab },
      { label: 'Total Liabilities', values: wr, strong: true },
      { label: 'Fixed Assets', values: b.fixedAssets },
      { label: 'CWIP', values: b.cwip },
      { label: 'Investments', values: b.investments },
      { label: 'Other Assets', values: b.otherAssets, expand: 'oa' },
      { label: 'Trade receivables', values: b.otherAssets.map(x => x * 0.34), sub: 'oa' },
      { label: 'Cash Equivalents', values: b.otherAssets.map(x => x * 0.22), sub: 'oa' },
      { label: 'Inventories', values: b.otherAssets.map(x => x * 0.18), sub: 'oa' },
      { label: 'Other asset items', values: b.otherAssets.map(x => x * 0.26), sub: 'oa' },
      { label: 'Total Assets', values: b.total, strong: true }
    ], { highlightLast: true }) + '</section>';
  }

  function cfSection(c) {
    const f = c.cf;
    return sectionHead('cash-flow', 'Cash Flows', figs(c), c) + statementTable(c.years, [
      { label: 'Cash from Operating Activity', values: f.cfo },
      { label: 'Cash from Investing Activity', values: f.cfi },
      { label: 'Cash from Financing Activity', values: f.cff },
      { label: 'Net Cash Flow', values: f.net, strong: true }
    ], { highlightLast: true }) + '</section>';
  }

  function ratiosSection(c) {
    const r = c.ratios;
    return sectionHead('ratios', 'Ratios', figs(c), c) + statementTable(c.years, [
      { label: 'Debtor Days', values: r.debtor },
      { label: 'Inventory Days', values: r.inventory },
      { label: 'Days Payable', values: r.payable },
      { label: 'Cash Conversion Cycle', values: r.ccc },
      { label: 'Working Capital Days', values: r.wc },
      { label: 'ROCE %', values: r.roce, type: 'pct' },
      { label: 'ROE %', values: r.roe, type: 'pct' }
    ], { highlightLast: true }) + '</section>';
  }

  function shareholdingTable(c, yearly) {
    const s = c.sh;
    let idx = s.promoters.map((_, i) => i);
    if (yearly) idx = idx.filter(i => /^Mar/.test(c.shQuarters[i]) || i === idx.length - 1);
    const pick = arr => idx.map(i => arr[i]);
    if (c.live) {
      return statementTable(['Latest'], [
        { label: 'Insiders / Promoters', values: s.promoters, type: 'pct', dec: 2 },
        { label: 'Institutions (FII + DII)', values: s.fiis, type: 'pct', dec: 2 },
        { label: 'Public & others', values: s.public, type: 'pct', dec: 2 }
      ], { highlightLast: true }) + '<p class="table-note">Yahoo Finance provides only the latest insider and institutional holding. Quarterly history needs an exchange shareholding feed.</p>';
    }
    return statementTable(idx.map(i => c.shQuarters[i]), [
      { label: 'Promoters', values: pick(s.promoters), type: 'pct', dec: 2 },
      { label: 'FIIs', values: pick(s.fiis), type: 'pct', dec: 2 },
      { label: 'DIIs', values: pick(s.diis), type: 'pct', dec: 2 },
      { label: 'Government', values: pick(s.government), type: 'pct', dec: 2 },
      { label: 'Public', values: pick(s.public), type: 'pct', dec: 2 },
      { label: 'No. of Shareholders', values: pick(s.holders) }
    ], { highlightLast: true });
  }
  function shareholdingSection(c) {
    return '<section class="section card" id="shareholding"><div class="section-head"><div><h2>Shareholding Pattern</h2><p>Numbers in percentages</p></div>' +
      '<div class="tabs" id="sh-tabs"><button class="btn btn-small active" data-sh="q">Quarterly</button><button class="btn btn-small" data-sh="y">Yearly</button></div></div>' +
      '<div id="sh-table">' + shareholdingTable(c, false) + '</div></section>';
  }
  function bindShareholding(c) {
    $$('#sh-tabs button').forEach(b => b.onclick = () => {
      $$('#sh-tabs button').forEach(x => x.classList.toggle('active', x === b));
      $('#sh-table').innerHTML = shareholdingTable(c, b.dataset.sh === 'y');
    });
  }

  /* Documents: exact filing PDFs when the data pipeline has fetched them, otherwise the company's
     own filing pages on NSE / BSE (every panel always links somewhere useful). */
  function exchangePages(c) {
    const nseSym = /^\d+$/.test(c.symbol) || c.exchange === 'BSE' ? null : c.symbol;
    const n = nseSym ? encodeURIComponent(nseSym) : null;
    const nl = page => 'https://www.nseindia.com/companies-listing/corporate-filings-' + page + '?symbol=' + n;
    const bseBase = c.bseCode ? 'https://www.bseindia.com/stock-share-price/' + encodeURIComponent((c.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) +
      '/' + encodeURIComponent(nseSym || c.symbol) + '/' + encodeURIComponent(c.bseCode) + '/' : null;
    return {
      nse: n ? { ann: nl('announcements'), ar: nl('annual-reports'), res: nl('financial-results'), bm: nl('board-meetings'), quote: 'https://www.nseindia.com/get-quotes/equity?symbol=' + n } : null,
      bse: bseBase ? { ann: bseBase + 'corp-announcements/', ar: bseBase + 'financials-annual-reports/', res: bseBase + 'financials-results/', quote: bseBase }
        // BSE-only company known only by its BSE ticker (from Yahoo): BSE's own filing search pages
        : !n ? { ann: 'https://www.bseindia.com/corporates/ann.html', ar: 'https://www.bseindia.com/corporates/HistoricalAnnualreport.aspx',
            res: 'https://www.bseindia.com/corporates/Comp_Resultsnew.aspx', quote: 'https://www.bseindia.com/' } : null
    };
  }
  const ext = (u, label, cls, title) => '<a class="' + (cls || '') + '" target="_blank" rel="noopener noreferrer" href="' + esc(u) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + label + '</a>';
  const srcBadge = (x, u) => (u ? ext(u, esc(x.toUpperCase()), 'src-badge', 'Open on ' + x.toUpperCase()) : '<span class="src-badge">' + esc((x || '').toUpperCase()) + '</span>');
  function exchangeLinks(c) {
    const X = exchangePages(c);
    return '<div class="flex flex-wrap" style="margin-top:12px">' +
      (X.nse ? ext(X.nse.quote, 'View on NSE', 'btn btn-small') : '') + (X.bse ? ext(X.bse.quote, 'View on BSE', 'btn btn-small') : '') + '</div>';
  }
  function recentQuarters(k) {
    const out = [], d = new Date();
    let m = d.getMonth() - (d.getMonth() % 3) - 1, y = d.getFullYear(); // last completed quarter end
    if (m < 0) { m += 12; y--; }
    for (let i = 0; i < k; i++) {
      out.push(monYear(new Date(y, m, 1)));
      m -= 3; if (m < 0) { m += 12; y--; }
    }
    return out;
  }
  // NSE subjects read "<Company> has informed the Exchange about ..."; keep just the subject
  function cleanTitle(t) {
    const s = String(t || '').replace(/^.{0,160}?\b(has|have)\s+(informed|intimated|submitted to|filed with)\s+the\s+Exchange\s*(about|regarding|that|of|with|under)?\s*/i, '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(t || '');
  }
  const IMPORTANT_FILING = /financial result|outcome of board|dividend|bonus|split|sub-division|buy ?back|acquisition|amalgamation|merger|demerger|resignation|appointment of (managing|chief|ceo|cfo|md)|credit rating|rights issue|preferential|qip|fund ?rais/i;
  const RATING_AGENCY = /\b(crisil|icra|care|fitch|india ratings|brickwork|acuite|acuité|infomerics|moody'?s|s&p)\b/i;
  const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monYear = t => MON[t.getMonth()] + ' ' + t.getFullYear();
  function docWhen(d) {
    const t = new Date(d), h = (Date.now() - t) / 36e5;
    if (h >= 0 && h < 24) return Math.max(1, Math.round(h)) + 'h';
    return t.getDate() + ' ' + MON[t.getMonth()] + (t.getFullYear() === new Date().getFullYear() ? '' : ' ' + t.getFullYear());
  }
  // "2025-26" or "2026" -> 2026 (the year the financial year ends)
  function fyEnd(y) {
    const n = String(y || '').match(/\d{4}|\d{2}/g) || [];
    if (n.length >= 2 && n[0].length === 4) return +n[0] + 1;
    return n.length ? +n[0] : null;
  }
  const fyOfFiling = d => { const t = new Date(d); return t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; };
  function docPanel(cls, head, body) {
    return '<div class="doc-panel ' + cls + '"><div class="doc-head">' + head + '</div><div class="doc-scroll">' + body + '</div>' +
      '<button type="button" class="doc-more" aria-label="Show more" title="Show more">' + CHEVRON + '</button></div>';
  }
  const pill = (u, label, title) => (u ? ext(u, label, 'doc-pill', title) : '<span class="doc-pill off" aria-disabled="true" title="Not available">' + label + '</span>');

  function documentsSection(c, f) {
    const X = exchangePages(c), P = X.nse || X.bse;
    const A = (f && f.announcements) || [], R = (f && f.annualReports) || [], notes = (f && f.notes) || {};
    const noted = u => !!(u && notes[u] && notes[u].sections);
    const exName = X.nse && X.bse ? 'nse' : X.nse ? 'nse' : 'bse';
    if (!P) return '<section class="section card" id="documents"><h2>Documents</h2><p class="muted">No exchange listing found for this company.</p></section>';

    // Announcements
    const annBody = A.length
      ? '<ul class="doc-items" id="ann-list">' + A.slice(0, 100).map(a => '<li data-imp="' + (IMPORTANT_FILING.test(a.t + ' ' + a.c) ? 1 : 0) + '" data-q="' + esc((cleanTitle(a.t) + ' ' + (a.c || '')).toLowerCase()) + '">' +
          ext(a.u, esc(cleanTitle(a.t))) + '<div class="doc-meta">' + docWhen(a.d) + (a.c && a.c !== a.t ? ' - ' + esc(a.c) : '') + '</div></li>').join('') + '</ul>'
      : '<ul class="doc-items" id="ann-list">' + [
          ['Latest announcements', 'ann', 0], ['Financial results', 'res', 1], ['Board meetings &amp; outcomes', 'bm', 1],
          ['Dividends, bonus &amp; corporate actions', 'ann', 1], ['Shareholding &amp; insider disclosures', 'ann', 0]
        ].map(([label, key, imp]) => '<li data-imp="' + imp + '" data-q="' + label.toLowerCase() + '">' + ext(P[key] || P.ann, label) +
          '<div class="doc-meta">on ' + (X.nse ? ext(X.nse[key] || X.nse.ann, 'NSE') : '') + (X.nse && X.bse ? ' &middot; ' : '') + (X.bse ? ext(X.bse[key] || X.bse.ann, 'BSE') : '') + '</div></li>').join('') + '</ul>';
    const annHead = '<h3>Announcements</h3><div class="seg" role="tablist"><button type="button" class="active" data-ann="recent">Recent</button><button type="button" data-ann="important">Important</button>' +
      '<button type="button" data-ann="search">Search</button>' + ext((X.nse || X.bse).ann, 'All <span aria-hidden="true">↗</span>', '', 'All announcements on ' + exName.toUpperCase()) + '</div>' +
      '<input type="search" class="doc-search" id="ann-search" placeholder="Search announcements" hidden>';

    // Annual reports: the report list, plus Reg. 34 annual-report filings among the announcements
    const reps = [], seenY = {};
    R.forEach(r => { const y = fyEnd(r.y); if (y && !seenY[y]) { seenY[y] = 1; reps.push({ y, u: r.u, x: r.x }); } });
    A.forEach(a => {
      if (!/annual report/i.test(a.t + ' ' + (a.c || '')) || !/\.pdf($|\?)/i.test(a.u)) return;
      const y = fyOfFiling(a.d);
      if (!seenY[y]) { seenY[y] = 1; reps.push({ y, u: a.u, x: a.x }); }
    });
    reps.sort((a, b) => b.y - a.y);
    const arBody = '<ul class="doc-items">' + (reps.length
      ? reps.map(r => '<li>' + ext(r.u, 'Annual Report ' + r.y) + '<div class="doc-meta">from ' + esc(r.x || exName) +
          (noted(r.u) ? ' <button type="button" class="doc-pill" data-sum="' + esc(r.u) + '" data-sum-title="Annual Report ' + r.y + '">AI Summary</button>' : '') + '</div></li>').join('')
      : Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0) - i)
          .map(y => '<li>' + ext(P.ar, 'Annual Report ' + y) + '<div class="doc-meta">from ' + (X.nse ? ext(X.nse.ar, 'nse') : '') + (X.nse && X.bse ? ' &middot; ' : '') + (X.bse ? ext(X.bse.ar, 'bse') : '') + '</div></li>').join('')) + '</ul>';

    // Credit ratings
    const ratings = A.filter(a => a.k === 'rating').slice(0, 20);
    const crBody = '<ul class="doc-items">' + (ratings.length
      ? ratings.map(a => { const ag = (a.t + ' ' + (a.c || '')).match(RATING_AGENCY);
          return '<li>' + ext(a.u, 'Rating update', '', cleanTitle(a.t)) + '<div class="doc-meta">' + docWhen(a.d) + ' from ' + esc(ag ? ag[1].toLowerCase() : (a.x || exName)) + '</div></li>'; }).join('')
      : '<li>' + ext(P.ann, 'Rating updates') + '<div class="doc-meta">in ' + exName.toUpperCase() + ' filings</div></li>') + '</ul>';

    // Concalls: one row per month with Transcript / AI Summary / PPT / REC
    const extra = store.get('cc_extra_' + c.symbol, []);
    const rows = {}, order = [];
    const row = key => { if (!rows[key]) { rows[key] = { key, t: 0 }; order.push(key); } return rows[key]; };
    A.filter(a => /^(transcript|ppt|audio)$/.test(a.k)).forEach(a => {
      const d = new Date(a.d), r = row(monYear(d));
      r.t = Math.max(r.t, +new Date(d.getFullYear(), d.getMonth(), 1));
      if (!r[a.k]) r[a.k] = a.u;
    });
    extra.forEach(e => { const r = row(e.m); r.t = r.t || +new Date(e.m + ' 1') || 0; if (!r[e.k]) { r[e.k] = e.u; r.mine = 1; } });
    let ccBody;
    if (order.length) {
      ccBody = order.sort((a, b) => rows[b].t - rows[a].t).slice(0, 16).map(k => {
        const r = rows[k], sums = [r.transcript, r.ppt].filter(noted);
        return '<div class="cc-row"><span class="cc-period">' + esc(k) + '</span>' + pill(r.transcript, 'Transcript') +
          (sums.length ? '<button type="button" class="doc-pill" data-sum="' + esc(sums.join(' ')) + '" data-sum-title="Concall ' + esc(k) + '">AI Summary</button>' : pill(null, 'AI Summary')) +
          pill(r.ppt, 'PPT') + pill(r.audio, 'REC') + '</div>';
      }).join('');
    } else {
      const tip = 'Opens ' + c.name + '\'s filings on ' + exName.toUpperCase() + ' (look for "Analysts/Institutional Investor Meet")';
      ccBody = recentQuarters(8).map(q => '<div class="cc-row"><span class="cc-period">' + esc(q) + '</span>' + pill(P.ann, 'Transcript', tip) + pill(null, 'AI Summary') +
        pill(P.ann, 'PPT', tip) + pill(P.ann, 'REC', tip) + '</div>').join('');
    }
    const ccHead = '<h3>Concalls</h3><button type="button" class="doc-add" id="cc-add"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3 15V2h9l-2 3 2 3H4" fill="currentColor"/></svg> Add Missing</button>';

    const from = A.length ? 'Filings from ' + (A.some(a => a.x === 'nse') && A.some(a => a.x === 'bse') ? 'NSE and BSE' : A.some(a => a.x === 'nse') ? 'NSE' : 'BSE') +
      (f.updated ? ' &middot; updated ' + docWhen(f.updated) : '') + ' &middot; AI summaries are free and built in' : 'Links open ' + esc(c.name) + '\'s filings on ' + (X.nse && X.bse ? 'NSE and BSE' : X.nse ? 'NSE' : 'BSE');
    return '<section class="section card" id="documents"><div class="section-head"><div><h2>Documents</h2><p>' + from + '</p></div>' + exchangeLinks(c) + '</div><div class="docs-grid">' +
      docPanel('doc-ann', annHead, annBody) + docPanel('doc-ar', '<h3>Annual reports</h3>', arBody) +
      docPanel('doc-cr', '<h3>Credit ratings</h3>', crBody) + docPanel('doc-cc', ccHead, ccBody) +
      '</div></section>';
  }
  const NOTE_KIND = { transcript: ['Concall transcript', 'Read full transcript'], ppt: ['Investor presentation (PPT)', 'Open presentation'], ar: ['Annual report', 'Open annual report'] };
  function concallNoteHtml(n, url) {
    const k = NOTE_KIND[n.kind] || NOTE_KIND.transcript;
    const when = n.kind === 'ar' ? 'FY ' + esc(n.d) : 'Filed ' + (t => t.getDate() + ' ' + monYear(t))(new Date(n.d));
    return '<h3 class="note-kind">' + k[0] + '</h3><p class="sub">' + when + ' &middot; tone: <b class="tone-' + esc(n.tone).toLowerCase() + '">' + esc(n.tone) + '</b> &middot; ' +
      '<a target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">' + k[1] + ' ↗</a></p>' +
      Object.keys(n.sections).map(s => '<h4>' + esc(s) + '</h4><ul>' + n.sections[s].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>').join('');
  }
  const NOTE_FOOT = '<p class="table-note">Free built-in AI summary: the key points picked from the document by topic, in the company\'s own words. It can miss context, so read the document before acting on it.</p>';
  function addMissingConcall() {
    const c = currentCompany;
    if (!c) return;
    const months = recentQuarters(12).concat(Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return monYear(d); }))
      .filter((m, i, a) => a.indexOf(m) === i).sort((a, b) => new Date(b + ' 1') - new Date(a + ' 1'));
    modal('Add a missing concall document', '<p class="sub">Paste a link to a transcript, presentation or recording on the NSE, BSE or company website. It is saved in this browser only.</p>' +
      '<div class="field"><label for="cc-m">Month</label><select id="cc-m">' + months.map(m => '<option>' + esc(m) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="cc-k">Document</label><select id="cc-k"><option value="transcript">Transcript</option><option value="ppt">PPT</option><option value="audio">REC (recording)</option></select></div>' +
      '<div class="field"><label for="cc-u">Link</label><input id="cc-u" type="url" placeholder="https://…"></div><p class="form-error" id="cc-err" hidden></p>',
      [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: bd => {
        const u = $('#cc-u', bd).value.trim();
        if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(u)) { const e = $('#cc-err', bd); e.hidden = false; e.textContent = 'Enter a full link starting with https://'; return false; }
        const list = store.get('cc_extra_' + c.symbol, []);
        list.push({ m: $('#cc-m', bd).value, k: $('#cc-k', bd).value, u });
        store.set('cc_extra_' + c.symbol, list);
        refreshDocuments();
        toast('Added to Concalls');
      } }]);
  }
  function refreshDocuments() {
    const c = currentCompany, el = $('#documents');
    if (!c || !el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = documentsSection(c, c._filings);
    el.replaceWith(tmp.firstChild);
    bindDocuments();
  }
  function bindDocuments() {
    $$('#documents [data-sum]').forEach(b => b.onclick = () => {
      const c = currentCompany, N = (c && c._filings && c._filings.notes) || {};
      const us = b.dataset.sum.split(' ').filter(u => N[u] && N[u].sections);
      if (us.length) modal('AI Summary: ' + c.name + ' · ' + b.dataset.sumTitle, '<div class="ai-assistant note-body">' + us.map(u => concallNoteHtml(N[u], u)).join('<hr>') + NOTE_FOOT + '</div>');
    });
    const list = $('#ann-list'), search = $('#ann-search');
    const apply = () => {
      const mode = ($('#documents [data-ann].active') || {}).dataset;
      const imp = mode && mode.ann === 'important', q = mode && mode.ann === 'search' ? search.value.trim().toLowerCase() : '';
      if (list) $$('li', list).forEach(li => { li.style.display = (!imp || li.dataset.imp === '1') && (!q || li.dataset.q.indexOf(q) >= 0) ? '' : 'none'; });
    };
    $$('#documents [data-ann]').forEach(b => b.onclick = () => {
      $$('#documents [data-ann]').forEach(x => x.classList.toggle('active', x === b));
      search.hidden = b.dataset.ann !== 'search';
      if (!search.hidden) search.focus();
      apply();
    });
    if (search) search.oninput = apply;
    const add = $('#cc-add');
    if (add) add.onclick = addMissingConcall;
    $$('#documents .doc-panel').forEach(p => {
      const box = $('.doc-scroll', p), more = $('.doc-more', p);
      const fits = () => box.scrollHeight <= box.clientHeight + 4;
      const upd = () => p.classList.toggle('fits', !p.classList.contains('open') && fits());
      more.onclick = () => { p.classList.toggle('open'); more.setAttribute('aria-label', p.classList.contains('open') ? 'Show less' : 'Show more'); upd(); };
      upd();
    });
  }

  function notesSection(c) {
    return '<section class="section card" id="notes"><div class="section-head"><div><h2>My Notes</h2><p>Private notes about ' + esc(c.name) + ', saved in this browser.</p></div></div>' +
      '<textarea id="notes-text" placeholder="Write your investment thesis, triggers to watch, etc." style="font-family:inherit">' + esc(store.get('notes_' + c.symbol, '')) + '</textarea>' +
      '<div class="flex" style="margin-top:10px"><button class="btn btn-primary btn-small" id="save-notes">Save notes</button></div></section>';
  }
  function bindNotes(c) {
    $('#save-notes').onclick = () => { store.set('notes_' + c.symbol, $('#notes-text').value); toast('Notes saved'); };
  }

  function exportCompany(c) {
    const rows = [[c.name + ' (' + c.symbol + ') - ' + (c.standalone ? 'Standalone' : 'Consolidated') + ' figures in Rs. Cr.' + (c.live ? '' : ' (sample data)')], []];
    const add = (title, heads, obj) => {
      rows.push([title]);
      rows.push([''].concat(heads));
      obj.forEach(([label, vals]) => rows.push([label].concat(vals.map(v => (v == null ? '' : Math.round(v * 100) / 100)))));
      rows.push([]);
    };
    add('Quarterly Results', c.quarters, [['Sales', c.q.sales], ['Expenses', c.q.expenses], ['Operating Profit', c.q.op], ['OPM %', c.q.opm], ['Net Profit', c.q.np], ['EPS', c.q.eps]]);
    add('Profit & Loss', c.years, [['Sales', c.pl.sales], ['Expenses', c.pl.expenses], ['Operating Profit', c.pl.op], ['OPM %', c.pl.opm], ['Other Income', c.pl.otherIncome],
      ['Interest', c.pl.interest], ['Depreciation', c.pl.depreciation], ['Profit before tax', c.pl.pbt], ['Tax %', c.pl.tax], ['Net Profit', c.pl.np], ['EPS', c.pl.eps], ['Dividend Payout %', c.pl.payout]]);
    add('Balance Sheet', c.years, [['Equity Capital', c.bs.equity], ['Reserves', c.bs.reserves], ['Borrowings', c.bs.borrowings], ['Other Liabilities', c.bs.otherLiab],
      ['Total', c.bs.total], ['Fixed Assets', c.bs.fixedAssets], ['CWIP', c.bs.cwip], ['Investments', c.bs.investments], ['Other Assets', c.bs.otherAssets]]);
    add('Cash Flows', c.years, [['Operating', c.cf.cfo], ['Investing', c.cf.cfi], ['Financing', c.cf.cff], ['Net', c.cf.net]]);
    add('Ratios', c.years, [['Debtor Days', c.ratios.debtor], ['Inventory Days', c.ratios.inventory], ['Days Payable', c.ratios.payable], ['ROCE %', c.ratios.roce], ['ROE %', c.ratios.roe]]);
    downloadCSV(c.symbol + '.csv', rows);
  }

  /* ---------- list table (screens, peers, watchlist, sectors) ---------- */
  function listTableHtml(companies, cols, opts) {
    opts = opts || {};
    const start = opts.offset || 0;
    let h = '<div class="table-wrap"><table class="data list"><thead><tr><th>S.No.</th><th' + (opts.sortable ? ' class="sortable' + (opts.sortKey === 'name' ? ' sorted' : '') + '" data-sort="name"' : '') + '>Name</th>' +
      cols.map(k => '<th' + (opts.sortable ? ' class="sortable' + (opts.sortKey === k ? ' sorted' : '') + '" data-sort="' + k + '"' : '') + '>' + esc(RBY[k] ? RBY[k].label : k) +
        (opts.sortKey === k ? (opts.sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + (opts.remove ? '<th></th>' : '') + '</tr></thead><tbody>';
    companies.forEach((c, i) => {
      h += '<tr><td>' + (start + i + 1) + '.</td><td><a href="#/company/' + esc(c.symbol) + '">' + (c.symbol === opts.highlight ? '<b>' + esc(c.name) + '</b>' : esc(c.name)) + '</a></td>' +
        cols.map(k => '<td class="' + (/Var|ret|Growth|Change/.test(k) ? signCls(c.metrics[k]) : '') + '">' + fmtCell(k, c.metrics[k]) + '</td>').join('') +
        (opts.remove ? '<td><button class="btn btn-small btn-plain" data-remove="' + esc(c.symbol) + '">Remove</button></td>' : '') + '</tr>';
    });
    if (opts.median && companies.length > 1) {
      const all = opts.medianOf || companies;
      h += '<tr class="median"><td></td><td>Median: ' + all.length + ' Co.</td>' + cols.map(k => '<td>' + fmtCell(k, Data.median(all.map(c => c.metrics[k]))) + '</td>').join('') + (opts.remove ? '<td></td>' : '') + '</tr>';
    }
    if (!companies.length) h += '<tr><td colspan="' + (cols.length + 2) + '" style="text-align:center;padding:24px" class="muted">No companies to show.</td></tr>';
    return h + '</tbody></table></div>';
  }

  function sortableList(container, companies, cols, opts) {
    const state = { sortKey: opts.sortKey || 'marketCap', sortDir: -1, page: 0 };
    const pageSize = opts.pageSize || 25;
    function draw() {
      const sorted = companies.slice().sort((a, b) => {
        if (state.sortKey === 'name') return state.sortDir * a.name.localeCompare(b.name);
        const x = a.metrics[state.sortKey], y = b.metrics[state.sortKey];
        const xv = x == null || !isFinite(x) ? -Infinity : x, yv = y == null || !isFinite(y) ? -Infinity : y;
        return state.sortDir * (xv - yv);
      });
      const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
      state.page = Math.min(state.page, pages - 1);
      const slice = sorted.slice(state.page * pageSize, (state.page + 1) * pageSize);
      container.innerHTML = listTableHtml(slice, cols, { sortable: true, sortKey: state.sortKey, sortDir: state.sortDir, offset: state.page * pageSize, median: opts.median, medianOf: sorted, remove: opts.remove }) +
        (pages > 1 ? '<div class="pagination">' + Array.from({ length: pages }, (_, i) => '<button class="btn btn-small' + (i === state.page ? ' active' : '') + '" data-page="' + i + '">' + (i + 1) + '</button>').join('') + '</div>' : '');
      $$('[data-sort]', container).forEach(th => th.onclick = () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = k === 'name' ? 1 : -1; }
        draw();
      });
      $$('[data-page]', container).forEach(b => b.onclick = () => { state.page = +b.dataset.page; draw(); });
      $$('[data-remove]', container).forEach(b => b.onclick = () => opts.remove(b.dataset.remove));
    }
    draw();
  }

  /* ---------- Screens ---------- */
  function pageScreens(parts) {
    if (parts[0]) {
      const preset = Screener.PRESETS.find(p => p.slug === parts[0]);
      if (!preset) return pageNotFound();
      return pageScreen([], { q: preset.query }, preset);
    }
    setTitle('Stock screens');
    const saved = store.get('screens', []);
    app.innerHTML = '<div class="container page">' +
      '<div class="section-head"><div><h1>Stock Screens</h1><p>Find stocks matching your investment strategy</p></div><a class="btn btn-primary" href="#/screen/new">+ Create new screen</a></div>' +
      (saved.length ? '<div class="card"><h2>My screens</h2><div class="grid grid-3">' + saved.map((s, i) =>
        '<div class="card card-flat screen-card" style="margin:0"><div class="flex space-between"><h3 style="margin:0"><a href="#/screen/saved/' + i + '">' + esc(s.name) + '</a></h3><button class="btn btn-small btn-plain" data-del="' + i + '">Delete</button></div>' +
        '<code>' + esc(s.query) + '</code></div>').join('') + '</div></div>' : '') +
      '<div class="card"><h2>Popular screens</h2><div class="grid grid-3">' + Screener.PRESETS.map(screenCard).join('') + '</div></div>' +
      '</div>';
    $$('[data-del]').forEach(b => b.onclick = () => {
      const s = store.get('screens', []);
      s.splice(+b.dataset.del, 1);
      store.set('screens', s);
      pageScreens([]);
    });
  }

  const DEFAULT_SCREEN_COLS = ['price', 'pe', 'marketCap', 'divYield', 'qtrProfit', 'qtrProfitVar', 'qtrSales', 'qtrSalesVar', 'roce'];
  function pageScreen(parts, params, preset) {
    let meta = preset;
    let query = params.q || '';
    if (parts[0] === 'saved') {
      const s = store.get('screens', [])[+parts[1]];
      if (!s) return pageNotFound();
      meta = { name: s.name, desc: s.desc || 'Your saved screen', query: s.query };
      query = s.query;
    }
    const isNew = !meta;
    setTitle(meta ? meta.name : 'Create a stock screen');
    const example = 'Market Capitalization > 500 AND\nPrice to earning < 15 AND\nReturn on capital employed > 22';
    app.innerHTML = '<div class="container page">' +
      '<div class="card"><div class="section-head"><div><h1>' + esc(meta ? meta.name : 'Create a Search Query') + '</h1><p>' +
      esc(meta ? meta.desc : 'Custom queries use simple arithmetic and comparison operators on financial ratios.') + '</p></div>' +
      (meta ? '' : '<a class="btn btn-small" href="#/screens">View popular screens</a>') + '</div>' +
      '<div class="screen-layout"><div>' +
      '<div class="ai-screen"><label for="nl-query"><span class="ai-spark">✦</span> Describe your screen in plain English</label>' +
      '<div class="flex"><input type="text" id="nl-query" placeholder="e.g. debt free companies with ROE above 20% and sales growing faster than 12%">' +
      '<button class="btn btn-primary" id="nl-run" type="button">Generate query</button></div><div id="nl-status" class="sub" style="margin-top:6px"></div></div>' +
      '<label for="query">Query</label><textarea id="query" rows="6" placeholder="' + esc(example) + '">' + esc(query.replace(/ AND /g, ' AND\n')) + '</textarea>' +
      '<div id="query-error"></div>' +
      '<div class="flex flex-wrap" style="margin-top:10px"><button class="btn btn-primary" id="run-query">▶ Run this query</button>' +
      '<button class="btn" id="save-screen">Save this screen</button>' +
      '<button class="btn btn-plain" id="show-example">Show example</button></div>' +
      '<div class="info-box" style="margin-top:14px"><b>Tips:</b> Combine conditions with <code>AND</code> / <code>OR</code>, use brackets, and operators <code>&gt; &lt; &gt;= &lt;= = + - * /</code>. Example: <code>Current price &lt; High price * 0.8</code></div>' +
      '</div><div><label>Search ratios</label><input type="search" id="ratio-search" placeholder="e.g. growth, ROE, holding">' +
      '<div class="ratio-list" id="ratio-list"></div></div></div></div>' +
      '<div class="card" id="results-card"' + (query ? '' : ' style="display:none"') + '><div class="section-head"><div><h2 id="results-title">Query results</h2><p id="results-sub"></p></div>' +
      '<div class="flex"><button class="btn btn-small" id="edit-cols">Edit columns</button><button class="btn btn-small" id="export-results">⤓ Export</button></div></div>' +
      '<div id="results"></div></div></div>';

    const ratioList = $('#ratio-list');
    function drawRatios(f) {
      f = (f || '').toLowerCase();
      ratioList.innerHTML = RATIOS.filter(r => !f || r.name.toLowerCase().indexOf(f) >= 0 || r.desc.toLowerCase().indexOf(f) >= 0)
        .map(r => '<button data-ratio="' + esc(r.name) + '">' + esc(r.name) + (r.unit ? ' <span class="muted">(' + esc(r.unit) + ')</span>' : '') + (r.desc ? '<small class="muted">' + esc(r.desc) + '</small>' : '') + '</button>').join('');
      $$('[data-ratio]', ratioList).forEach(b => b.onclick = () => {
        const ta = $('#query');
        const pos = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        const ins = b.dataset.ratio + ' ';
        ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(pos);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pos + ins.length;
      });
    }
    drawRatios();
    $('#ratio-search').addEventListener('input', e => drawRatios(e.target.value));
    $('#show-example').onclick = () => { $('#query').value = example; };

    let lastResults = [], lastCols = [];
    function run(pushHistory) {
      const q = $('#query').value.trim();
      $('#query-error').innerHTML = '';
      let res;
      try { res = Screener.run(q, Data.listCompanies()); } catch (e) {
        $('#query-error').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>';
        $('#results-card').style.display = 'none';
        return;
      }
      if (pushHistory && isNew) history.replaceState(null, '', '#/screen/new?q=' + encodeURIComponent(q.replace(/\s*\n\s*/g, ' ')));
      const saved = store.get('screencols', null);
      const cols = (saved || DEFAULT_SCREEN_COLS).slice();
      res.used.forEach(k => { if (cols.indexOf(k) < 0) cols.push(k); });
      lastResults = res.results; lastCols = cols;
      $('#results-card').style.display = '';
      $('#results-sub').textContent = res.results.length + ' results found: Showing page 1 of ' + Math.max(1, Math.ceil(res.results.length / 25));
      sortableList($('#results'), res.results, cols, { median: true, sortKey: 'marketCap' });
    }
    $('#run-query').onclick = () => run(true);
    $('#query').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(true); });
    $('#save-screen').onclick = () => {
      if (!user()) { toast('Please login to save screens'); location.hash = '#/login?next=' + encodeURIComponent(location.hash); return; }
      const q = $('#query').value.trim();
      try { Screener.compile(q); } catch (e) { $('#query-error').innerHTML = '<div class="error-box">' + esc(e.message) + '</div>'; return; }
      const bd = modal('Save screen', '<div class="field"><label>Name</label><input type="text" id="sname" value="' + esc(meta ? meta.name : '') + '" placeholder="My screen"></div><div class="field"><label>Description</label><input type="text" id="sdesc" placeholder="Optional"></div>', [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: b => {
          const name = $('#sname', b).value.trim();
          if (!name) { $('#sname', b).focus(); return false; }
          const s = store.get('screens', []);
          s.push({ name, desc: $('#sdesc', b).value.trim(), query: q.replace(/\s*\n\s*/g, ' ') });
          store.set('screens', s);
          toast('Screen saved');
        } }
      ]);
      $('#sname', bd).focus();
    };
    $('#edit-cols').onclick = () => {
      const sel = store.get('screencols', null) || DEFAULT_SCREEN_COLS;
      const bd = modal('Edit columns', '<div class="check-grid">' + RATIOS.map(r => '<label><input type="checkbox" value="' + r.key + '"' + (sel.indexOf(r.key) >= 0 ? ' checked' : '') + '>' + esc(r.name) + '</label>').join('') + '</div>', [
        { label: 'Reset', onClick: () => { store.set('screencols', null); run(false); } },
        { label: 'Save columns', primary: true, onClick: b => { store.set('screencols', $$('input:checked', b).map(i => i.value)); run(false); } }
      ]);
      return bd;
    };
    $('#export-results').onclick = () => {
      downloadCSV('screen-results.csv', [['Name', 'NSE Code'].concat(lastCols.map(k => RBY[k].label))].concat(
        lastResults.map(c => [c.name, c.symbol].concat(lastCols.map(k => { const v = c.metrics[k]; return v == null || !isFinite(v) ? '' : Math.round(v * 100) / 100; })))));
    };
    const nlRun = () => {
      const desc = $('#nl-query').value.trim();
      if (!desc) { $('#nl-query').focus(); return; }
      try {
        const q = AI.screenQuery(desc);
        $('#query').value = q.replace(/ AND /g, ' AND\n');
        try { Screener.compile(q); $('#nl-status').textContent = 'Query generated. Review it below, then edit or run it.'; run(true); }
        catch (e) { $('#nl-status').textContent = 'The generated query needs a fix: ' + e.message + ' Edit it below and run it.'; }
      } catch (e) {
        $('#nl-status').textContent = AI.errorCopy(e);
      }
    };
    $('#nl-run').onclick = nlRun;
    $('#nl-query').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nlRun(); } });
    if (query) run(false);
  }

  /* ---------- Feed ---------- */
  // Result filing date is not in the data feed: estimate it as ~35 days after quarter end.
  function resultDate(c) {
    const lab = c.lastQuarter || (c.quarters && c.quarters[c.quarters.length - 1]);
    if (!lab) return new Date(0);
    const d = new Date(lab.replace(' ', ' 1, '));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    let h = 0;
    for (const ch of c.symbol) h = (h * 31 + ch.charCodeAt(0)) % 997;
    d.setDate(d.getDate() + 20 + (h % 30));
    return d;
  }
  function pageFeed() {
    setTitle('Feed');
    const all = Data.listCompanies();
    const w = watchlist();
    const mine = w.length ? all.filter(c => w.indexOf(c.symbol) >= 0) : [];
    const src = mine.length ? mine : all;
    const results = src.slice().sort((a, b) => resultDate(b) - resultDate(a));
    const anns = [];
    src.forEach(c => (c.docs ? c.docs.announcements : []).slice(0, 3).forEach(a => anns.push({ c, a, t: new Date(a.date).getTime() || 0 })));
    anns.sort((x, y) => y.t - x.t);
    app.innerHTML = '<div class="container page"><div class="section-head"><div><h1>Feed</h1><p>' +
      (mine.length ? 'Updates from the ' + mine.length + ' companies you follow' : 'Follow companies to personalise your feed. Showing all companies.') + '</p></div>' +
      '<a class="btn" href="#/watchlist">Manage watchlist</a></div>' +
      '<div class="grid grid-2" style="align-items:start"><div class="card"><h2>Latest results</h2>' +
      results.slice(0, 15).map(c => {
        const m = c.metrics;
        return '<div class="stat-mini" style="display:block"><div class="flex space-between"><a href="#/company/' + esc(c.symbol) + '"><b>' + esc(c.name) + '</b></a><span class="sub">' +
          resultDate(c).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</span></div>' +
          '<div class="sub">' + esc(c.lastQuarter || (c.quarters && c.quarters[c.quarters.length - 1]) || '') + ' quarter &middot; Sales ₹ ' + num(m.qtrSales, 0) + ' Cr. <span class="' + signCls(m.qtrSalesVar) + '">(' + num(m.qtrSalesVar, 1) + '% YoY)</span> &middot; Net profit ₹ ' +
          num(m.qtrProfit, 0) + ' Cr. <span class="' + signCls(m.qtrProfitVar) + '">(' + num(m.qtrProfitVar, 1) + '% YoY)</span></div></div>';
      }).join('') + '<a class="btn btn-small" style="margin-top:12px" href="#/results/latest">All results</a></div>' +
      '<div class="card"><h2>Announcements</h2><ul class="doc-list" id="feed-anns" style="max-height:none">' + anns.slice(0, 25).map(x => '<li><span><a href="#/company/' + esc(x.c.symbol) + '">' + esc(x.c.symbol) + '</a> &middot; ' +
        esc(x.a.title) + '</span><span class="date">' + esc(x.a.date) + '</span></li>').join('') + '</ul></div></div></div>';
    if (Data.mode() !== 'sample') {
      const token = navToken;
      $('#feed-anns').innerHTML = '<li class="muted">Loading exchange announcements…</li>';
      Data.latestFilings().then(f => {
        if (token !== navToken || !$('#feed-anns')) return;
        const mineSet = new Set(mine.map(c => c.symbol));
        const items = ((f && f.items) || []).filter(it => !mineSet.size || mineSet.has(it.s)).slice(0, 40);
        $('#feed-anns').innerHTML = items.length ? items.map(it => '<li><span><a href="#/company/' + encodeURIComponent(it.s) + '">' + esc(it.s) + '</a> &middot; ' +
          '<a target="_blank" rel="noopener noreferrer" href="' + esc(it.u) + '">' + esc(cleanTitle(it.t)) + '</a></span><span class="date">' +
          new Date(it.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</span></li>').join('')
          : '<li class="muted">No recent exchange announcements' + (mineSet.size ? ' for the companies you follow' : '') + '.</li>';
      });
    }
  }

  /* ---------- Tools ---------- */
  function pageTools() {
    setTitle('Tools');
    const tools = [
      ['#/screen/new', 'Create a stock screen', 'Run queries on financial ratios to find stocks that match your strategy.'],
      ['#/results/latest', 'Latest quarterly results', 'See the most recently declared quarterly results with YoY changes.'],
      ['#/compare', 'Compare companies', 'Put up to five companies side by side and compare their key metrics.'],
      ['#/market', 'Sectors & industries', 'Browse companies by sector with sector level medians.'],
      ['#/watchlist', 'Watchlist', 'Track companies you follow in one table.'],
      ['#/screens', 'Popular screens', 'Ready-made screens such as Magic Formula and Coffee Can.']
    ];
    app.innerHTML = '<div class="container page"><h1>Tools</h1><p class="muted">Everything you need to research stocks.</p><div class="grid grid-3">' +
      tools.map(t => '<a class="card feature" href="' + t[0] + '" style="color:inherit;margin:0"><h3>' + esc(t[1]) + '</h3><p class="muted" style="margin:0">' + esc(t[2]) + '</p></a>').join('') + '</div></div>';
  }

  /* ---------- Market / sectors ---------- */
  function pageMarket(parts) {
    const all = Data.listCompanies();
    if (parts[0]) {
      const sector = parts[0];
      const list = all.filter(c => c.sector === sector);
      if (!list.length) return pageNotFound();
      setTitle(sector + ' companies');
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>' + esc(sector) + '</h1><p>' + list.length +
        ' companies &middot; <a href="#/market">All sectors</a></p></div></div><div id="sector-list"></div></div></div>';
      sortableList($('#sector-list'), list, DEFAULT_SCREEN_COLS, { median: true });
      return;
    }
    setTitle('Sectors');
    const secs = Data.sectors();
    const rows = Object.keys(secs).sort().map(s => {
      const cs = all.filter(c => c.sector === s);
      return { s, n: cs.length, mcap: cs.reduce((a, c) => a + c.metrics.marketCap, 0), pe: Data.median(cs.map(c => c.metrics.pe)), roce: Data.median(cs.map(c => c.metrics.roce)), ret: Data.median(cs.map(c => c.metrics.ret1y)) };
    });
    app.innerHTML = '<div class="container page"><div class="card"><h1>Sectors</h1><p class="muted">Browse listed companies by sector.</p><div class="table-wrap"><table class="data list"><thead><tr><th>S.No.</th><th>Sector</th><th>Companies</th><th>Total Mar Cap Rs.Cr.</th><th>Median P/E</th><th>Median ROCE %</th><th>Median 1Yr return %</th></tr></thead><tbody>' +
      rows.map((r, i) => '<tr><td>' + (i + 1) + '.</td><td><a href="#/market/' + encodeURIComponent(r.s) + '">' + esc(r.s) + '</a></td><td>' + r.n + '</td><td>' + num(r.mcap, 0) + '</td><td>' + num(r.pe, 1) + '</td><td>' + num(r.roce, 1) +
        '</td><td class="' + signCls(r.ret) + '">' + num(r.ret, 1) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
  }

  /* ---------- Results ---------- */
  function pageResults() {
    setTitle('Latest results');
    const all = Data.listCompanies().slice().sort((a, b) => resultDate(b) - resultDate(a) || (b.metrics.marketCap || 0) - (a.metrics.marketCap || 0)).slice(0, 300);
    app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Latest Results</h1><p>Latest reported quarter &middot; figures in Rs. Cr.' + (Data.liveInfo().count ? ' &middot; result dates are estimated' : '') + '</p></div></div>' +
      '<div class="table-wrap"><table class="data list"><thead><tr><th>S.No.</th><th>Name</th><th>Result date</th><th>Sales</th><th>YoY %</th><th>Operating Profit</th><th>OPM %</th><th>Net Profit</th><th>YoY %</th><th>EPS</th></tr></thead><tbody>' +
      all.map((c, i) => {
        const m = c.metrics;
        return '<tr><td>' + (i + 1) + '.</td><td><a href="#/company/' + esc(c.symbol) + '">' + esc(c.name) + '</a></td><td>' + resultDate(c).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
          '</td><td>' + num(m.qtrSales, 0) + '</td><td class="' + signCls(m.qtrSalesVar) + '">' + num(m.qtrSalesVar, 1) + '</td><td>' + num(m.qtrOp, 0) + '</td><td>' + num(m.qtrOpm, 0) +
          '</td><td>' + num(m.qtrProfit, 0) + '</td><td class="' + signCls(m.qtrProfitVar) + '">' + num(m.qtrProfitVar, 1) + '</td><td>' + num(m.qtrEps, 2) + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';
  }

  /* ---------- Compare ---------- */
  function pageCompare(parts, params) {
    setTitle('Compare companies');
    Data.listCompanies();
    const syms = (params.c || '').split(',').map(s => s.trim().toUpperCase()).filter(s => Data.exists(s)).slice(0, 5);
    app.innerHTML = LOADING;
    const token = navToken;
    Promise.all(syms.map(s => Data.loadCompany(s).catch(() => null))).then(list => {
      if (token === navToken) renderCompare(list.filter(Boolean));
    });
    function renderCompare(comps) {
    const rows = ['price', 'marketCap', 'pe', 'industryPE', 'pb', 'divYield', 'roce', 'roe', 'de', 'sales', 'np', 'opm', 'salesGrowth5', 'profitGrowth5', 'qtrSalesVar', 'qtrProfitVar', 'promoter', 'fii', 'dii', 'ret1y', 'ret3y', 'ret5y'];
    const setSyms = list => { location.hash = '#/compare' + (list.length ? '?c=' + list.join(',') : ''); };
    app.innerHTML = '<div class="container page"><div class="card"><h1>Compare companies</h1><p class="muted">Add up to 5 companies.</p>' +
      '<div class="compare-picker">' + comps.map(c => '<span class="tag">' + esc(c.name) + '<button data-rm="' + c.symbol + '" aria-label="Remove">×</button></span>').join('') +
      (comps.length < 5 ? '<div class="nav-search"><svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="cmp-search" placeholder="Add a company" autocomplete="off"></div>' : '') + '</div></div>' +
      (comps.length ? '<div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>Ratio</th>' + comps.map(c => '<th><a href="#/company/' + c.symbol + '">' + esc(c.symbol) + '</a></th>').join('') + '</tr></thead><tbody>' +
        rows.map(k => '<tr><td>' + esc(RBY[k].name) + '</td>' + comps.map(c => '<td>' + fmtMetric(k, c.metrics[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>' +
        '<div class="card" id="cmp-ai"></div>' +
        '<div class="card"><h2>1 year price performance</h2><p class="muted" style="font-size:14px">Rebased to 100</p><div class="chart-box"><canvas id="cmp-chart"></canvas></div></div>' : '<div class="card muted">Pick companies above to start comparing.</div>') +
      '</div>';
    $$('[data-rm]').forEach(b => b.onclick = () => setSyms(syms.filter(s => s !== b.dataset.rm)));
    if (comps.length) {
      const w = AI.mount($('#cmp-ai'), {
        title: 'AI comparison',
        intro: 'Ask AI to compare ' + comps.map(c => c.symbol).join(', ') + '.',
        placeholder: 'Ask about these companies…',
        answer: q => AI.answerCompare(comps, q),
        context: () => comps.map(x => AI.companyContext(x)).join('\n\n---\n\n'),
        suggestions: ['Compare these companies on growth, profitability, balance sheet and valuation', 'Which has the strongest balance sheet?', 'Which looks most expensive relative to growth?']
      });
      onLeave(w.abort);
    }
    if ($('#cmp-search')) attachSearch($('#cmp-search'), c => { if (syms.indexOf(c.symbol) < 0) setSyms(syms.concat([c.symbol])); });
    if (comps.length && typeof Chart !== 'undefined') {
      const colors = ['#6056ff', '#e8a33d', '#11813d', '#d33a3a', '#0ea5b7'];
      // align every series on its most recent trading days (histories differ in length)
      const span = Math.min(252, Math.min.apply(null, comps.map(c => c.prices.length)) - 1), step = 2;
      const back = [];
      for (let k = span; k >= 0; k -= step) back.push(k);
      if (back[back.length - 1] !== 0) back.push(0);
      const at = (c, k) => c.prices[c.prices.length - 1 - k];
      const ref = comps[0];
      const ch = new Chart($('#cmp-chart'), {
        type: 'line',
        data: { labels: back.map(k => ref.dates[ref.dates.length - 1 - k].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })),
          datasets: comps.map((c, j) => ({ label: c.symbol, data: back.map(k => at(c, k) / at(c, span) * 100), borderColor: colors[j], borderWidth: 1.6, pointRadius: 0 })) },
        options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: cssVar('--ink-2') } } },
          scales: { x: { ticks: { color: cssVar('--ink-3'), maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }, y: { position: 'right', ticks: { color: cssVar('--ink-3') }, grid: { color: cssVar('--line-2') } } } }
      });
      onLeave(() => ch.destroy());
    }
    }
  }

  /* ---------- Ask AI ---------- */
  function pageAI() {
    setTitle('Ask Sankhyas AI');
    const all = Data.listCompanies();
    app.innerHTML = '<div class="container page"><div class="section-head"><div><h1><span class="ai-spark">✦</span> Ask Sankhyas AI</h1>' +
      '<p>Ask about any of the ' + all.length + ' companies Sankhyas covers: comparisons, sector trends and ideas for screens.</p></div></div>' +
      '<div class="card" id="market-ai"></div></div>';
    const w = AI.mount($('#market-ai'), {
      title: 'Sankhyas AI',
      intro: 'Ask for rankings, filters and sector overviews, e.g. "top 5 cheapest IT stocks by P/E". For a deep dive into one company, open its page and use the AI Analyst tab.',
      placeholder: 'Ask about Indian stocks…',
      answer: q => AI.answerMarket(q),
      context: () => AI.marketContext(120),
      suggestions: [
        'Which companies combine high ROCE with low debt?',
        'Which sectors look cheapest on P/E?',
        'Top 5 companies by latest quarter profit growth',
        'Summarise the IT sector',
        'Large caps with the best 5 year profit growth',
        'Debt free companies with sales growth above 12%'
      ]
    });
    onLeave(w.abort);
  }

  /* ---------- Watchlist ---------- */
  function pageWatchlist() {
    setTitle('Watchlist');
    const all = Data.listCompanies();
    const draw = () => {
      const w = watchlist();
      const list = all.filter(c => w.indexOf(c.symbol) >= 0);
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Watchlist</h1><p>' + list.length + ' companies' + (user() ? '' : ' &middot; saved in this browser') + '</p></div>' +
        '<div class="nav-search" style="min-width:260px"><svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="wl-search" placeholder="Add company to watchlist" autocomplete="off"></div></div>' +
        (list.length ? '<div id="wl-table"></div>' : '<div class="info-box">Your watchlist is empty. Search above or use the <b>Follow</b> button on any company page.</div>') + '</div></div>';
      attachSearch($('#wl-search'), c => { if (!inWatchlist(c.symbol)) toggleWatch(c.symbol); draw(); });
      if (list.length) sortableList($('#wl-table'), list, ['price', 'ret1m', 'pe', 'marketCap', 'divYield', 'qtrProfitVar', 'qtrSalesVar', 'roce', 'ret1y'], { remove: s => { toggleWatch(s); draw(); } });
    };
    draw();
  }

  /* ---------- Auth ---------- */
  function authPage(isRegister, params) {
    setTitle(isRegister ? 'Register' : 'Login');
    app.innerHTML = '<div class="container page"><div class="card auth-card"><h1>' + (isRegister ? 'Create a free account' : 'Welcome back') + '</h1>' +
      '<p class="muted" style="text-align:center">' + (isRegister ? 'Save screens, follow companies and get a personalised feed.' : 'Login to your Sankhyas account') + '</p>' +
      '<form id="auth-form">' + (isRegister ? '<div class="field"><label for="a-name">Full name</label><input type="text" id="a-name" required></div>' : '') +
      '<div class="field"><label for="a-email">Email</label><input type="email" id="a-email" required></div>' +
      '<div class="field"><label for="a-pass">Password</label><input type="password" id="a-pass" minlength="6" required></div>' +
      '<div id="auth-err"></div><button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">' + (isRegister ? 'Register' : 'Login') + '</button></form>' +
      '<p class="sub" style="text-align:center;margin-top:16px">' + (isRegister ? 'Already have an account? <a href="#/login">Login</a>' : 'New to Sankhyas? <a href="#/register">Create an account</a>') + '</p>' +
      '<p class="table-note" style="text-align:center">Your account is saved securely in this browser.</p></div></div>';
    $('#auth-form').onsubmit = e => {
      e.preventDefault();
      const email = $('#a-email').value.trim().toLowerCase();
      const pass = $('#a-pass').value;
      const accounts = store.get('accounts', {});
      const hashPw = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
      if (isRegister) {
        if (accounts[email]) { $('#auth-err').innerHTML = '<div class="error-box">An account with this email already exists.</div>'; return; }
        accounts[email] = { name: $('#a-name').value.trim(), pw: hashPw(pass) };
        store.set('accounts', accounts);
      } else if (!accounts[email] || accounts[email].pw !== hashPw(pass)) {
        $('#auth-err').innerHTML = '<div class="error-box">Invalid email or password.</div>';
        return;
      }
      store.set('user', { name: accounts[email].name, email });
      renderAuth();
      toast('Welcome, ' + accounts[email].name.split(' ')[0]);
      location.hash = params.next || '#/feed';
    };
  }
  const pageLogin = (p, params) => authPage(false, params);
  const pageRegister = (p, params) => authPage(true, params);

  function pagePremium() {
    setTitle('Sankhyas Pro');
    const feat = (list) => '<ul style="padding-left:18px;font-size:14px">' + list.map(f => '<li style="margin-bottom:6px">' + f + '</li>').join('') + '</ul>';
    app.innerHTML = '<div class="container page"><div style="text-align:center;margin-bottom:28px"><h1>Sankhyas Pro</h1><p class="muted">The AI that reads every concall, annual report and filing for you. All Pro features are free during beta.</p></div>' +
      '<div class="grid grid-2" style="max-width:820px;margin:0 auto">' +
      '<div class="card"><h2>Free</h2><p style="font-size:28px;font-weight:700;margin:0">₹ 0</p><p class="muted">forever</p>' +
      feat(['Financials, ratios, charts and peers for every NSE, BSE and SME company', 'Custom stock screens in plain English', 'Sankhyas AI (built-in, on-device and Claude)', 'Watchlist, feed and compare', 'Export to Excel']) + '<a class="btn" href="#/register">Get started</a></div>' +
      '<div class="card" style="border-color:var(--primary)"><h2>Pro ' + PRO_TAG + '</h2><p style="font-size:28px;font-weight:700;margin:0">₹ 2,499</p><p class="muted">per year, or ₹ 299 a month &middot; <b>free during beta</b></p>' +
      feat(['<b>Red-flag scan</b>: forensic score from the financials and filings (auditor exits, pledges, defaults, downgrades)', '<b>Guidance tracker</b>: management\'s promises vs what it delivered',
        '<b>What changed</b>: every quarter\'s results, concall tone, guidance and new risks vs the last one', 'AI summaries of concall transcripts, investor presentations and annual reports',
        'Screens on red-flag score and guidance delivery (e.g. Clean Compounders)']) + '<button class="btn btn-primary" id="buy">Use Pro free during beta</button></div>' +
      '</div></div>';
    $('#buy').onclick = () => { location.hash = '#/company/' + ((Data.listCompanies()[0] || {}).symbol || 'TCS'); toast('Pro features are free during beta: see Sankhyas Insights on any company page.'); };
  }

  function pageAbout() {
    setTitle('About');
    app.innerHTML = '<div class="container page"><div class="card" style="max-width:820px;margin:0 auto"><h1>About Sankhyas</h1>' +
      '<p>Sankhyas (संख्या, "numbers") is India\'s AI-Powered Financial Research Terminal. It brings company financials, ratios, charts, peers, shareholding and documents into a single page, and lets you screen the market with plain-English queries.</p>' +
      '<h3>Data</h3><p>Market data comes from Yahoo Finance (end of day), and filings, concalls and annual reports come from NSE and BSE.</p>' +
      '<h3>Disclaimer</h3><p class="muted">Nothing on this site is investment advice. Please consult a SEBI registered advisor before investing.</p></div></div>';
  }

  function pageNotFound() {
    setTitle('Not found');
    app.innerHTML = '<div class="container page" style="text-align:center"><h1>Page not found</h1><p class="muted">We could not find what you were looking for.</p><a class="btn btn-primary" href="#/">Go home</a></div>';
  }

  /* ---------- boot ---------- */
  attachSearch($('#nav-search'), c => { location.hash = '#/company/' + c.symbol; });
  $('#menu-toggle').onclick = () => $('#nav-links').classList.toggle('open');
  $('#theme-toggle').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('sankhyas_theme', next); } catch (e) { /* ignore */ }
    route();
  };
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); const s = $('#home-search') || $('#nav-search'); s.focus(); }
  });
  renderAuth();
  app.innerHTML = '<div class="container page muted">Loading market data…</div>';
  Data.init().then(() => {
    window.addEventListener('hashchange', route);
    route();
  });
})();
