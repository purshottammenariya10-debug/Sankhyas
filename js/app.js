/* Sankhyas single-page app: routing, pages and UI components. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const app = $('#app');
  const RATIOS = Screener.RATIOS, RBY = Screener.BY_KEY;

  /* ---------- storage ---------- */
  const rawSet = (k, v) => { try { if (v === undefined) localStorage.removeItem('sankhyas_' + k); else localStorage.setItem('sankhyas_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const store = {
    get(k, def) { try { const v = localStorage.getItem('sankhyas_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { rawSet(k, v); Sync.touched(k); }
  };

  /* ---------- sync across devices (signed-in cloud accounts; public.user_data) ----------
     Each group is one row: watchlist, screens, portfolio, notes {SYM: text}, cc_extra {SYM: [...]},
     prefs {topratios, screencols, chart_style}. The newer side wins; the first sync on a device
     merges both sides so nothing saved before logging in is lost. */
  const Sync = (function () {
    const DIRECT = { watchlist: 'watchlist', screens: 'screens', portfolio: 'portfolio' };
    const PREFS = ['topratios', 'screencols', 'chart_style'];
    const PREFIX = { notes_: 'notes', cc_extra_: 'cc_extra' };
    const GROUPS = ['watchlist', 'screens', 'portfolio', 'notes', 'cc_extra', 'prefs'];
    let timer = null, dirty = {}, applying = false, status = { at: null, error: null };
    const meta = () => store.get('sync_meta', {});
    const setMeta = m => rawSet('sync_meta', m);
    function groupOf(k) {
      if (DIRECT[k]) return DIRECT[k];
      if (PREFS.indexOf(k) >= 0) return 'prefs';
      for (const p in PREFIX) if (k.indexOf(p) === 0) return PREFIX[p];
      return null;
    }
    function prefixed(p) {
      const out = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('sankhyas_' + p) === 0) out[k.slice(('sankhyas_' + p).length)] = JSON.parse(localStorage.getItem(k)); } } catch (e) { /* ignore */ }
      return out;
    }
    function collect(g) {
      if (g === 'prefs') { const o = {}; PREFS.forEach(k => { const v = store.get(k, undefined); if (v !== undefined) o[k] = v; }); return o; }
      if (g === 'notes') return prefixed('notes_');
      if (g === 'cc_extra') return prefixed('cc_extra_');
      return store.get(g, null);
    }
    function apply(g, v) {
      if (g === 'prefs') { PREFS.forEach(k => { if (v && v[k] !== undefined) rawSet(k, v[k]); }); return; }
      if (g === 'notes' || g === 'cc_extra') { const p = g === 'notes' ? 'notes_' : 'cc_extra_'; Object.keys(v || {}).forEach(sym => rawSet(p + sym, v[sym])); return; }
      rawSet(g, v);
    }
    const empty = v => v == null || (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length);
    function merge(g, local, remote) {
      if (empty(local)) return remote;
      if (empty(remote)) return local;
      if (g === 'watchlist') return remote.concat(local.filter(x => remote.indexOf(x) < 0));
      if (g === 'screens') { const names = remote.map(x => x.name); return remote.concat(local.filter(x => names.indexOf(x.name) < 0)); }
      if (g === 'portfolio') { const syms = remote.map(x => x.s); return remote.concat(local.filter(x => syms.indexOf(x.s) < 0)); }
      return Object.assign({}, local, remote);
    }
    async function push(groups) {
      if (!Account.canSync()) return;
      const m = meta();
      try {
        for (const g of groups) { const v = collect(g); if (v != null) await Account.pushData(g, v); m[g] = Date.now(); }
        setMeta(m); status = { at: new Date(), error: null };
      } catch (e) { status.error = 'Could not sync: ' + (e.message || e); }
    }
    return {
      status: () => status,
      touched(k) {
        if (applying) return;
        const g = groupOf(k);
        if (!g) return;
        const m = meta(); m[g] = Date.now(); setMeta(m);
        if (!Account.canSync()) return;
        dirty[g] = 1;
        clearTimeout(timer);
        timer = setTimeout(() => { const gs = Object.keys(dirty); dirty = {}; push(gs); }, 1200);
      },
      async pull() {
        if (!Account.canSync()) return false;
        let remote;
        try { remote = await Account.pullData(); } catch (e) { status.error = 'Could not sync: ' + (e.message || e); return false; }
        const m = meta(), first = !m.synced_user || m.synced_user !== Account.user().id, toPush = [];
        let changed = false;
        applying = true;
        GROUPS.forEach(g => {
          const r = remote[g], local = collect(g), at = m[g] || 0;
          if (first) {
            const v = r ? merge(g, local, r.value) : local;
            if (r) { apply(g, v); changed = true; }
            if (!empty(v) && (!r || JSON.stringify(v) !== JSON.stringify(r.value))) toPush.push(g);
          } else if (r && new Date(r.at).getTime() > at) { apply(g, r.value); m[g] = new Date(r.at).getTime(); changed = true; }
          else if (at && (!r || at > new Date(r.at).getTime())) toPush.push(g);
        });
        applying = false;
        m.synced_user = Account.user().id;
        setMeta(m);
        if (toPush.length) await push(toPush); else status = { at: new Date(), error: null };
        return changed;
      }
    };
  })();
  const user = () => Account.user();
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
    slot.innerHTML = '<div class="user-menu"><button class="btn btn-small" id="user-btn">' + esc((u.name || u.email || 'Account').split(' ')[0]) +
      (Account.cloud && Account.isPro() ? ' ' + PRO_TAG : '') + ' ▾</button></div>';
    $('#user-btn').onclick = e => {
      e.stopPropagation();
      const existing = $('.user-menu .dropdown');
      if (existing) { existing.remove(); return; }
      const dd = document.createElement('div');
      dd.className = 'dropdown';
      dd.innerHTML = '<a href="#/account">My account</a><a href="#/watchlist">Watchlist</a><a href="#/portfolio">Portfolio X-ray</a><a href="#/alerts">Alerts</a><a href="#/screens">My screens</a><a href="#/premium">Sankhyas Pro</a><button id="logout-btn">Logout</button>';
      $('.user-menu').appendChild(dd);
      $('#logout-btn').onclick = () => { Account.signOut().then(() => { renderAuth(); toast('Logged out'); location.hash = '#/'; }); };
      setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }));
    };
  }

  /* ---------- router ---------- */
  let cleanup = [];
  function onLeave(fn) { cleanup.push(fn); }
  function parseHash() {
    // static company pages (company/<SYMBOL>/) carry their route on <body data-route>
    const h = location.hash.replace(/^#\/?/, '') || document.body.getAttribute('data-route') || '';
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
      login: pageLogin, register: pageRegister, premium: pagePremium, about: pageAbout, ai: pageAI,
      deals: pageDeals, orders: pageOrders, ratings: pageRatings, report: pageReport,
      ipo: pageIPO, calendar: pageCalendar, themes: pageThemes, theme: pageThemes, studio: pageStudio,
      account: pageAccount, portfolio: pagePortfolio, alerts: pageAlerts, forgot: pageForgot, reset: pageReset, terms: pageLegal, privacy: pageLegal, refunds: pageLegal, contact: pageLegal
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
    if (!$('.seo-page', app)) app.innerHTML = LOADING;   // keep a static page's content until the data loads
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
      (c.website ? '<a class="site-link" href="https://' + esc(c.website) + '" target="_blank" rel="noopener">🔗 ' + esc(c.website) + '</a>' : '') +
      (c.exchange === 'BSE' ? '<span>BSE: ' + esc(c.bseCode || c.symbol) + '</span>'
        : (c.bseCode ? '<span>BSE: ' + esc(c.bseCode) + '</span>' : '') + '<span>NSE: ' + esc(c.symbol) + '</span>') +
      '<a href="#/market/' + encodeURIComponent(c.sector) + '">' + esc(c.sector) + '</a><span>' + esc(c.industry) + '</span>' +
      '</div>' +
      '<div class="price-line"><span class="price">₹ ' + num(m.price, 0) + '</span><span class="chg ' + signCls(m.change) + '">' +
      (m.change >= 0 ? '▲ ' : '▼ ') + num(Math.abs(m.changePct), 2) + '%</span><span class="asof">' +
      c.dates[c.dates.length - 1].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' - close price' + (c.live ? ' &middot; Yahoo Finance' : '') + '</span></div>' +
      '</div><div class="company-actions">' +
      '<button class="btn" id="export-btn">⤓ Export to Excel</button>' +
      '<button class="btn" id="share-btn" title="Make an image for Instagram, X or WhatsApp">↗ Share card</button>' +
      '<a class="btn" href="#/report/' + encodeURIComponent(c.symbol) + '" title="Printable research report (PDF)">⤓ Research PDF</a>' +
      '<a class="btn" href="#/alerts?s=' + encodeURIComponent(c.symbol) + '" title="Email, Telegram or WhatsApp alerts for this company">🔔 Alerts</a>' +
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
      if (!requireLogin('follow companies')) return;
      const now = toggleWatch(sym);
      const b = $('#follow-btn');
      b.className = 'btn ' + (now ? 'active' : 'btn-primary');
      b.textContent = now ? '✓ Following' : '+ Follow';
    };
    $('#export-btn').onclick = () => exportCompany(c);
    $('#share-btn').onclick = () => openCardModal((c._res ? ['verdict'] : []).concat(c.listed && c.listPrice != null ? ['results', 'snapshot', 'redflags', 'listing'] : ['results', 'snapshot', 'redflags']), () => Promise.resolve(c), c.symbol);
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
        if (f && ((f.announcements || []).length || (f.annualReports || []).length)) {
          c._filings = f;
          refreshDocuments();
          refreshInsights(c);
          refreshSummary(c);
        }
        // fill the gaps live: concall history for companies the data job has not reached yet, and
        // summaries other visitors already generated
        DocAI.complete(c, f).then(changed => {
          if (!changed || token !== navToken || !$('#documents')) return;
          refreshDocuments();
          refreshInsights(c);
        });
      });
      Data.loadActivity().then(act => {
        if (token !== navToken || !act) return;
        c._activity = act;
        refreshInsights(c);
      });
      Data.loadResults(sym).then(r => {
        if (token !== navToken || !r || !(r.quarters || []).length) return;
        c._res = r;
        refreshInsights(c);
      });
      Data.loadShareholding(sym).then(sh => {
        if (token !== navToken || !sh || !(sh.quarters || []).some(q => q.fii != null)) return;
        c._shp = sh;
        const el = $('#sh-table');
        if (el) el.innerHTML = shareholdingTable(c, !!$('#sh-tabs [data-sh=y].active'));
        refreshInsights(c);
        refreshSummary(c);
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
      aboutPointsHtml(c) + '</div>' + aboutBlock(c) + '</div></section>';
  }
  /* ---------- About: a short description, facts, and key points built only from data we have ---------- */
  function aboutProfile(c) {
    const text = String(c.about || '').replace(/\s+/g, ' ').trim();
    const pick = rx => { const m = text.match(rx); return m ? m[1].trim() : ''; };
    const facts = {
      founded: pick(/\b(?:was )?(?:founded|incorporated|established|formed) in (\d{4})/i),
      hq: pick(/\b(?:is )?(?:based|headquartered) in ([A-Z][A-Za-z .'-]+?)(?:,\s*India)?\./),
      parent: pick(/\bsubsidiary of ([A-Z][A-Za-z0-9 .&'()-]+?)\.(?:\s|$)/),
      former: pick(/\bformerly known as ([A-Z][A-Za-z0-9 .&'()-]+?)(?:\s+and\s+changed|\.|,)/)
    };
    // sentences that only restate those facts move out of the description
    const sentences = text.split(/(?<=\.)\s+(?=[A-Z])/).filter(x => !/^(?:The company|It) (?:was (?:formerly known|founded|incorporated|established)|is (?:based|headquartered)|operates as a subsidiary)/i.test(x));
    // long "It offers A, a ...; B, a ...; C, a ..." product lists become "It offers A, B, C and 12 more"
    const shorten = x => {
      const parts = x.split(/;\s+(?:and\s+)?/);
      if (parts.length < 6) return x;
      const lead = parts[0].match(/^(.*?\b(?:offers|provides|operates|manufactures|sells|markets|produces|includes)\s+)/i);
      const names = parts.map((q, i) => (i === 0 && lead ? q.slice(lead[1].length) : q).split(/,\s+(?:a|an|the|which)\s/i)[0].trim()).filter(n => n && n.length < 60);
      if (!lead || names.length < 6) return x;
      return lead[1] + names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more.';
    };
    const short = [];
    let len = 0;
    for (const x of sentences.map(shorten)) {
      if (short.length && len + x.length > 420) break;
      short.push(x);
      len += x.length;
      if (short.length >= 3) break;
    }
    return { facts, short: short.join(' '), full: text, trimmed: short.join(' ').length < text.length - 40 };
  }
  function aboutData(c) {
    const m = c.metrics, P = aboutProfile(c), fin = /financ|bank|insur|nbfc/i.test((c.sector || '') + ' ' + (c.industry || ''));
    const ok = v => v != null && isFinite(v);
    const pct = (v, d) => num(v, d == null ? 1 : d) + '%';
    const desc = P.short
      ? '<p>' + esc(P.short) + '</p>' + (P.trimmed ? '<details class="about-more"><summary>Read full description</summary><p>' + esc(P.full) + '</p></details>' : '')
      : '<p>' + esc(c.name) + ' is a listed company in the ' + esc((c.industry || '').toLowerCase()) + ' industry, part of the ' + esc(c.sector || '') + ' sector' + (c.psu ? ', and a public sector undertaking of the Government of India' : '') + '.</p>';
    // facts
    const summary = Data.getCompany(c.symbol) || {};
    const listed = c.listed || summary.listed;
    const cr = c._filings && Insights.creditRatings(c._filings);
    const ar = c._filings && Insights.annualReportCheck(c._filings);
    const chips = [
      P.facts.founded && ['Founded', P.facts.founded],
      P.facts.hq && ['Headquarters', P.facts.hq],
      P.facts.parent && ['Part of', P.facts.parent],
      P.facts.former && ['Formerly', P.facts.former],
      listed && ['Listed', new Date(listed).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })],
      cr && cr.head && ['Credit rating', Insights.ratingText(cr.head)],
      ar && ar.auditor && ['Auditor', ar.auditor],
      c.isin && ['ISIN', c.isin]
    ].filter(Boolean);
    const factHtml = chips.length ? '<dl class="about-facts">' + chips.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' : '';
    // key points: each one only when its numbers exist
    const pts = [];
    const peers = Data.listCompanies().filter(x => x.industry === c.industry && x.metrics.marketCap > 0).sort((a, b) => b.metrics.marketCap - a.metrics.marketCap);
    const rank = peers.findIndex(x => x.symbol === c.symbol) + 1;
    if (ok(m.sales) && m.sales > 0) pts.push(['Scale', '₹ ' + num(m.sales, 0) + ' Cr revenue over the last 12 months' + (ok(m.opm) && !fin ? ' at a ' + pct(m.opm) + ' operating margin' : '') +
      (rank && peers.length >= 3 ? '; #' + rank + ' of ' + peers.length + ' in ' + (c.industry || 'its industry') + ' by market cap' : '') + '.']);
    const gY = ok(m.salesGrowth5) ? 5 : ok(m.salesGrowth3) ? 3 : 0;
    if (gY) {
      const sg = m['salesGrowth' + gY], pg = m['profitGrowth' + gY];
      pts.push(['Growth', 'Sales ' + (sg >= 0 ? 'grew ' : 'shrank ') + pct(Math.abs(sg)) + ' a year over ' + gY + ' years' + (ok(pg) ? '; profit ' + (pg >= 0 ? 'grew ' : 'fell ') + pct(Math.abs(pg)) + ' a year' : '') + '.']);
    }
    const ret = fin ? m.roe : m.roce, retAvg = fin ? m.avgRoe5 : m.avgRoce5;
    if (ok(ret)) pts.push(['Returns', (fin ? 'ROE ' : 'ROCE ') + pct(ret) + (ok(retAvg) ? ' (5-year average ' + pct(retAvg) + ')' : '') + (ok(m.roe) && !fin ? ', ROE ' + pct(m.roe) : '') + '.']);
    if (!fin && ok(m.de)) pts.push(['Balance sheet', m.de < 0.05 ? 'Almost debt free.' : 'Debt is ' + num(m.de, 2) + 'x equity' + (ok(m.interestCoverage) && m.interestCoverage < 900 ? ', with interest covered ' + num(m.interestCoverage, 1) + ' times' : '') + '.']);
    const h = c._shp && Insights.holdingStats(c._shp);
    if (h) pts.push(['Ownership', (h.promoter > 0 ? 'Promoters ' + pct(h.promoter, 2) + ', ' : 'No promoter group; ') + 'FIIs ' + pct(h.fii, 2) + ', DIIs ' + pct(h.dii, 2) + (h.pledge ? '; ' + pct(h.pledge, 2) + ' of promoter shares pledged' : '') + ' (' + new Date(h.latest.q + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) + ').']);
    else if (ok(m.promoter)) pts.push(['Ownership', 'Insiders hold ' + pct(m.promoter, 2) + (ok(m.fii) ? ' and institutions ' + pct(m.fii, 2) : '') + '.']);
    const payout = c.pl && c.pl.payout ? c.pl.payout[c.pl.payout.length - 1] : null;
    if (ok(m.divYield) && m.divYield > 0) pts.push(['Dividends', 'Yield ' + pct(m.divYield, 2) + (ok(payout) && payout > 0 ? ', paying out ' + pct(payout, 0) + ' of profit' : '') + '.']);
    if (!fin && ok(m.cfo) && ok(m.np) && m.np > 0 && ok(m.fcf)) pts.push(['Cash', 'Operating cash flow ₹ ' + num(m.cfo, 0) + ' Cr last year; free cash flow ₹ ' + num(m.fcf, 0) + ' Cr.']);
    return { desc, factHtml, pts };
  }
  function aboutBlock(c) {
    const a = aboutData(c);
    return '<div class="about"><h3>About</h3>' + a.desc + a.factHtml + '</div>';
  }
  // key points sit under the ratios, so both columns carry weight
  function aboutPointsHtml(c) {
    const pts = aboutData(c).pts;
    return pts.length ? '<div class="key-points"><h3>Key points</h3><ul class="about-points">' + pts.map(([k, v]) => '<li><b>' + k + ':</b> ' + esc(v) + '</li>').join('') + '</ul></div>' : '';
  }
  function refreshSummary(c) {
    const el = $('#summary');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = summarySection(c);
    el.replaceWith(tmp.firstChild);
    $$('#summary [data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); routeKeepScroll = true; location.hash = a.getAttribute('href'); }));
    bindTopRatios(c);
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
  function guidanceCard(c, empty) {
    const g = Insights.guidance(c);
    if (empty && !g.rows.length) { empty.push('no concall guidance tracked yet'); return ''; }
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
  function changedCard(c, empty) {
    const w = Insights.whatChanged(c);
    let html = '';
    // the results card above already covers the quarter from the NSE filing
    if (w.results && !c._res) {
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
    if (empty && !html) { empty.push('no new concall or important filing'); return ''; }
    return '<div class="ins-card ins-changed"><div class="ins-head"><h3>What changed</h3>' + PRO_TAG + '</div>' + (html || '<p class="muted">Not enough history yet to compare the latest quarter and concall with the previous ones.</p>') + '</div>';
  }
  /* ---------- Sankhyas Score, order wins, deals & insider activity ---------- */
  const PILLAR_HELP = { quality: 'ROCE, ROE, margins', growth: 'Sales & profit growth', value: 'P/E, P/B, yields', momentum: '6M & 1Y returns, vs 200 DMA', safety: 'Debt, interest cover, pledges, red flags' };
  function scoreRing(v, size) {
    const r = 42, C = 2 * Math.PI * r, band = Insights.scoreBand(v);
    const col = band === 'Strong' ? 'var(--green)' : band === 'Good' ? 'var(--primary)' : band === 'Average' ? '#d99a1a' : 'var(--red)';
    return '<svg class="score-ring" viewBox="0 0 100 100" width="' + (size || 96) + '" height="' + (size || 96) + '" aria-hidden="true"><circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--bg-3)" stroke-width="9"/>' +
      '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (C * v / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 50 50)"/>' +
      '<text x="50" y="57" text-anchor="middle" font-size="26" font-weight="800" fill="currentColor">' + v + '</text></svg>';
  }
  function scoreCard(c, open) {
    const sc = Insights.scoreOf(c.symbol);
    if (!sc || sc.score == null) return '';
    const bars = Insights.PILLARS.map(([id, label]) => {
      const v = sc.pillars[id];
      return '<div class="pillar"><div class="pillar-head"><b>' + label + '</b><span>' + (v == null ? '-' : v) + '</span></div><div class="pillar-bar"><span style="width:' + (v || 0) + '%"></span></div><div class="sub">' + PILLAR_HELP[id] + '</div></div>';
    }).join('');
    return '<div class="score-card"><div class="score-main">' + scoreRing(sc.score) + '<div><h3>Sankhyas Score</h3><div class="score-band">' + Insights.scoreBand(sc.score) + '</div>' +
      (sc.sectorRank ? '<div class="sub">#' + sc.sectorRank + ' of ' + sc.sectorSize + ' in ' + esc(c.sector) + '</div>' : '') + '<div class="sub">Out of 100, vs all ' + Data.listCompanies().length.toLocaleString('en-IN') + ' companies</div></div></div>' +
      '<div class="score-pillars' + (open ? '' : ' blurred') + '">' + bars + '</div>' +
      (open ? '' : '<div class="score-lock"><span aria-hidden="true">🔒</span> See the 5 pillars with <a href="#/premium">Sankhyas Pro</a></div>') + '</div>';
  }
  const crFmt = v => (v == null ? '-' : '₹ ' + num(v, v < 10 ? 2 : 0) + ' Cr');
  function ordersCard(c, empty) {
    const act = c._activity;
    if (!act) return '';
    const list = act.orders.filter(o => o.s === c.symbol);
    if (empty && !list.length) { empty.push('no order wins announced in 12 months'); return ''; }
    const total = list.reduce((a, o) => a + (o.amt || 0), 0), sales = c.metrics.sales;
    return '<div class="ins-card ins-orders"><div class="ins-head"><h3>Order wins</h3>' + PRO_TAG + '</div>' +
      (list.length ? '<div class="stats-row mini"><div class="stat"><div class="sub">Last 12 months</div><b>' + list.length + '</b></div><div class="stat"><div class="sub">Value stated</div><b>' + (total ? crFmt(total) : '-') + '</b></div>' +
        (total && sales ? '<div class="stat"><div class="sub">vs annual sales</div><b>' + num(total / sales * 100, 0) + '%</b></div>' : '') + '</div>' +
        '<ul class="act-list">' + list.slice(0, 8).map(o => '<li><span class="sub">' + docWhen(o.d) + '</span> ' + (o.amt ? '<b>' + crFmt(o.amt) + '</b>' : '<span class="muted">value not stated</span>') + (o.cust ? ' from ' + esc(o.cust) : '') +
          '<div class="sub">' + esc((o.desc || '').slice(0, 160)) + ' <a target="_blank" rel="noopener noreferrer" href="' + esc(o.u) + '">filing ↗</a></div></li>').join('') + '</ul>'
        : '<p class="muted">No order wins announced to the exchange in the last 12 months.</p>') +
      '<p class="table-note">From "bagging/receiving of orders" filings; values are read from the filing and some filings do not state one.</p></div>';
  }
  const DIR = { buy: ['Bought', 'up'], sell: ['Sold', 'down'], pledge: ['Pledged', 'down'], release: ['Pledge released', 'up'] };
  function dealsCard(c, empty) {
    const act = c._activity;
    if (!act) return '';
    const dl = act.deals.filter(x => x.s === c.symbol), ds = act.disclosures.filter(x => x.s === c.symbol);
    if (empty && !dl.length && !ds.length) { empty.push('no bulk/block deals or insider trades'); return ''; }
    const since = new Date(Date.now() - 92 * 864e5).toISOString().slice(0, 10);
    const net = dl.filter(x => x.d >= since).reduce((a, x) => a + (x.side === 'B' ? x.v : -x.v), 0);
    return '<div class="ins-card ins-deals"><div class="ins-head"><h3>Deals &amp; insider activity</h3>' + PRO_TAG + '</div>' +
      (dl.length ? '<div class="sub" style="margin-bottom:6px">Bulk/block net in 3 months: <b class="' + signCls(net) + '">' + (net >= 0 ? '+' : '−') + crFmt(Math.abs(net)) + '</b></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th class="l">Date</th><th class="l">Client</th><th class="l">Side</th><th>Qty</th><th>Price</th><th>Value</th></tr></thead><tbody>' +
        dl.slice(0, 8).map(x => '<tr><td class="l">' + docWhen(x.d) + '</td><td class="l">' + esc(x.c) + ' <span class="sub">' + x.t + '</span></td><td class="l ' + (x.side === 'B' ? 'up' : 'down') + '">' + (x.side === 'B' ? 'Buy' : 'Sell') + '</td><td>' + num(x.q, 0) + '</td><td>' + num(x.p, 2) + '</td><td>' + crFmt(x.v) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      (ds.length ? '<h4>Insider &amp; promoter disclosures</h4><ul class="act-list">' + ds.slice(0, 6).map(x => '<li><span class="sub">' + docWhen(x.d) + '</span> ' + (x.dir && DIR[x.dir] ? '<b class="' + DIR[x.dir][1] + '">' + DIR[x.dir][0] + '</b> · ' : '') +
        (x.k === 'insider' ? 'Insider trading disclosure' : 'Takeover / substantial holding disclosure') + ' <a target="_blank" rel="noopener noreferrer" href="' + esc(x.u) + '">filing ↗</a></li>').join('') + '</ul>' : '') +
      (!dl.length && !ds.length ? '<p class="muted">No bulk/block deals or insider/promoter disclosures in the last months.</p>' : '') + '</div>';
  }

  // free users see the score and what is inside, with the details behind Pro
  function lockedCard(cls, title, teaser) {
    return '<div class="ins-card ' + cls + ' locked"><div class="ins-head"><h3>' + title + '</h3>' + PRO_TAG + '</div>' + teaser +
      '<div class="lock-cta"><span aria-hidden="true">🔒</span> <b>Unlock with Sankhyas Pro</b><div class="sub">From ₹ 208 a month on the yearly plan.</div>' +
      '<a class="btn btn-primary btn-small" href="#/premium">See Pro plans</a></div></div>';
  }
  function insightsSection(c) {
    const open = Account.isPro();
    const note = !Account.cloud || Account.config.proFreeDuringBeta ? 'Free during beta.' : open ? 'Included in your Pro plan.' : 'The quick read, results and ownership are free; the detailed cards are part of Sankhyas Pro.';
    let cards, empty = [];
    if (open) cards = riskCard(c) + arCheckCard(c) + ratingsCard(c) + changedCard(c, empty) + guidanceCard(c, empty) + ordersCard(c, empty) + dealsCard(c, empty);
    else {
      const r = Insights.redFlags(c), g = Insights.guidance(c), w = Insights.whatChanged(c);
      const cls = r.band === 'High' ? 'risk-high' : r.band === 'Moderate' ? 'risk-mid' : 'risk-low';
      cards = lockedCard('ins-risk', 'Red-flag scan', '<div class="risk-meter ' + cls + '"><div class="risk-score"><b>' + r.score + '</b><span>/100</span></div><div><div class="risk-band">' + r.band + ' risk</div>' +
          '<div class="risk-bar"><span style="width:' + Math.max(3, r.score) + '%"></span></div></div></div><p class="muted">' + (r.flags.length ? r.flags.length + ' warning sign' + (r.flags.length > 1 ? 's' : '') + ' found' : 'No warning signs found') + '. See each one and the filing behind it with Pro.</p>') +
        ratingsCard(c) + (Insights.annualReportCheck(c._filings) ? lockedCard('ins-ar', 'Annual report check', '<p class="muted">' + ((Insights.annualReportCheck(c._filings).flags || []).length ? (Insights.annualReportCheck(c._filings).flags || []).length + ' finding(s) from the auditor\'s report, CARO and the notes, each with its page number.' : 'Auditor\'s opinion, CARO remarks, contingent liabilities and pay, each with its page number.') + '</p>') : '') +
        lockedCard('ins-changed', 'What changed', '<p class="muted">' + (w.results ? 'Results for ' + esc(w.results.quarter) + ' vs the previous quarter and a year ago' : 'Latest results vs the previous quarter') + (w.concall ? ', concall tone and guidance changes' : '') + (w.filings.length ? ', and ' + w.filings.length + ' important filing' + (w.filings.length > 1 ? 's' : '') : '') + '.</p>') +
        lockedCard('ins-guide', 'Guidance tracker', '<p class="muted">' + (g.rows.length ? g.rows.length + ' management target' + (g.rows.length > 1 ? 's' : '') + ' tracked from ' + g.calls + ' concall' + (g.calls > 1 ? 's' : '') + '. See what was promised and what was delivered.' : 'Management\'s concall promises, scored against what was actually delivered.') + '</p>');
      const act = c._activity;
      if (act) {
        const o = act.orders.filter(x => x.s === c.symbol), dl = act.deals.filter(x => x.s === c.symbol), ds = act.disclosures.filter(x => x.s === c.symbol);
        cards += lockedCard('ins-orders', 'Order wins', '<p class="muted">' + (o.length ? o.length + ' order win' + (o.length > 1 ? 's' : '') + ' announced in the last year.' : 'No order wins announced in the last year.') + '</p>') +
          lockedCard('ins-deals', 'Deals &amp; insider activity', '<p class="muted">' + (dl.length + ds.length ? dl.length + ' bulk/block deal' + (dl.length === 1 ? '' : 's') + ' and ' + ds.length + ' insider/promoter disclosure' + (ds.length === 1 ? '' : 's') + '.' : 'No bulk/block deals or insider disclosures recently.') + '</p>');
      }
    }
    const score = scoreCard(c, open), own = ownershipCard(c);
    const quiet = empty.length ? '<p class="ins-quiet"><b>Nothing to report:</b> ' + empty.map(esc).join(' · ') + '.</p>' : '';
    return '<section class="section card" id="insights"><div class="section-head"><div><h2>Sankhyas Insights</h2><p>A quick read of results, ownership, valuation and risks, generated from exchange filings and the financials. ' + note + '</p></div></div>' +
      quickReadPanel(c) + resultsCard(c) + score + '<div class="ins-grid">' + own + cards + '</div>' + quiet + '</section>';
  }
  const QR_ICON = { 'Credit rating': '🏦', 'Annual report': '📘', Results: '📊', Ownership: '👥', Valuation: '🏷️', Quality: '⚙️', 'Red flags': '🚩', Management: '🎙️', Orders: '📦', Price: '📈' };
  function quickReadPanel(c) {
    let hpe = null;
    try { hpe = window.AI && AI.historicPE ? AI.historicPE(c) : null; } catch (e) { hpe = null; }
    const items = Insights.quickRead(c, { hpe, res: c._res, shp: c._shp });
    if (!items.length) return '';
    const n = t => items.filter(x => x.tone === t).length;
    return '<div class="qr-panel"><div class="qr-head"><h3>Quick read</h3><div class="qr-tally"><span class="qr-t pos">' + n('pos') + ' positive</span><span class="qr-t neg">' + n('neg') + ' watch</span><span class="qr-t neu">' + n('neu') + ' neutral</span></div></div>' +
      '<ul class="qr-list">' + items.map(x => '<li class="qr-' + x.tone + '"><span class="qr-ico" aria-hidden="true">' + (QR_ICON[x.area] || '•') + '</span><div><div class="qr-area">' + esc(x.area) +
        '<span class="qr-dot" title="' + (x.tone === 'pos' ? 'Positive' : x.tone === 'neg' ? 'Watch' : 'Neutral') + '"></span></div><p>' + esc(x.text) + '</p></div></li>').join('') + '</ul></div>';
  }
  const VERDICT_CLS = { Strong: 'v-strong', Mixed: 'v-mixed', Weak: 'v-weak', New: 'v-new' };
  function resultsCard(c) {
    const v = c._res && Insights.resultsVerdict(c._res);
    if (!v) return '';
    // a swing between profit and loss has no meaningful % change: say so instead
    const chip = (x, unit, lbl, key, base) => {
      const cur = v.cur[key], was = base && base[key];
      if ((key === 'np' || key === 'eps') && cur != null && was != null && (cur < 0) !== (was < 0))
        return '<span class="rk-chg ' + (cur < 0 ? 'down' : 'up') + '">' + (cur < 0 ? '▼ to loss' : '▲ from loss') + ' <small>' + lbl + '</small></span>';
      if ((key === 'np' || key === 'eps') && cur < 0 && was < 0)
        return '<span class="rk-chg ' + (cur < was ? 'down' : 'up') + '">' + (cur < was ? '▼ loss widened' : '▲ loss narrowed') + ' <small>' + lbl + '</small></span>';
      if (x == null || !isFinite(x)) return '';
      return '<span class="rk-chg ' + signCls(x) + '">' + (x >= 0 ? '▲ ' : '▼ ') + num(Math.abs(x), 1) + unit + ' <small>' + lbl + '</small></span>';
    };
    const tile = (label, val, key, unit) => '<div class="rk-tile"><div class="rk-label">' + label + '</div><div class="rk-val">' + val + '</div><div class="rk-chgs">' +
      chip(v.yoy[key], unit, 'YoY', key, v.yago) + chip(v.qoq[key], unit, 'QoQ', key, v.prev) + '</div></div>';
    const cr = x => (x == null ? '-' : '₹ ' + num(x, Math.abs(x) < 100 ? 1 : 0) + '<small> Cr</small>');
    const filed = v.filed ? v.filed.replace(/\s+\d{2}:\d{2}(:\d{2})?$/, '') : '';
    const oneOff = v.points.find(p => /^Includes a one-off/.test(p));
    return '<div class="res-card ' + VERDICT_CLS[v.verdict] + '"><div class="res-head"><div><div class="sub">Latest results · filed ' + esc(filed || '-') + ' · ' + (v.cons ? 'consolidated' : 'standalone') + '</div>' +
      '<h3>' + esc(v.label) + ' results <span class="v-pill ' + VERDICT_CLS[v.verdict] + '">' + (v.verdict === 'New' ? 'First results' : v.verdict) + '</span></h3></div>' +
      '<button class="btn btn-small" type="button" data-verdict-card="' + esc(c.symbol) + '">↗ Share card</button></div>' +
      '<p class="res-why">' + esc(Insights.resultsWhy(v)) + '</p>' +
      '<div class="rk-grid">' + tile('Revenue', cr(v.cur.sales), 'sales', '%') + (v.bank ? '' : tile('Operating profit', cr(v.cur.op), 'op', '%') + tile('Operating margin', v.cur.opm == null ? '-' : num(v.cur.opm, 1) + '%', 'opm', ' pts')) +
        tile('Net profit', cr(v.cur.np), 'np', '%') + tile('EPS', v.cur.eps == null ? '-' : '₹ ' + num(v.cur.eps, 2), 'eps', '%') + '</div>' +
      (oneOff ? '<p class="res-note">⚠ ' + esc(oneOff) + '.</p>' : '') +
      '<p class="table-note">From the results filed with NSE. The verdict weighs revenue and profit growth against the same quarter last year and the change in margin; it is not a recommendation.</p></div>';
  }
  const RATING_CLS = { upgrade: 'up', outlook_up: 'up', downgrade: 'down', outlook_down: 'down', watch: 'down', withdraw: 'muted' };
  const ratingWhen = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  function ratingActHtml(a) {
    const lbl = Insights.RATING_ACT[a.act] || '';
    return lbl ? '<span class="rt-act ' + (RATING_CLS[a.act] || '') + '">' + (a.act === 'upgrade' || a.act === 'outlook_up' ? '▲ ' : a.act === 'downgrade' || a.act === 'outlook_down' ? '▼ ' : '') + lbl + '</span>' : '';
  }
  // free: credit ratings read from the rating letters filed with the exchange
  function ratingsCard(c) {
    const cr = c._filings && Insights.creditRatings(c._filings);
    if (!cr) return '';
    const own = cr.latest.filter(a => !a.sub);
    const chips = (own.length ? own : cr.latest).slice(0, 4).map(a => '<div class="rt-chip"><div class="sub">' + esc(a.ag || 'Agency') + '</div><b>' + esc(a.rt) + '</b>' + (a.ol ? '<span class="sub"> / ' + esc(a.ol) + '</span>' : '') +
      '<div class="sub">' + ratingWhen(a.d) + '</div></div>').join('');
    const rows = cr.list.slice(0, 8).map(a => '<li><span class="sub">' + docWhen(a.d) + '</span> <b>' + esc(Insights.ratingText(a)) + '</b> ' + ratingActHtml(a) +
      (a.from ? ' <span class="sub">from ' + esc(a.from) + '</span>' : '') + '<div class="sub">' + esc([a.ins, a.ramt ? '₹ ' + num(a.ramt, 0) + ' Cr' : '', a.sub ? 'subsidiary' : '', a.st ? 'short term ' + a.st : ''].filter(Boolean).join(' · ')) +
      ' <a target="_blank" rel="noopener noreferrer" href="' + esc(a.u) + '">letter ↗</a></div></li>').join('');
    return '<div class="ins-card ins-ratings"><div class="ins-head"><h3>Credit ratings</h3>' + (cr.down ? '<span class="rt-act down">▼ downgraded in 12m</span>' : cr.up ? '<span class="rt-act up">▲ upgraded in 12m</span>' : '') + '</div>' +
      '<div class="rt-chips">' + chips + '</div><ul class="act-list">' + rows + '</ul>' +
      '<p class="table-note">Read from rating letters filed with the exchange. AAA is the highest; BBB- is the lowest investment grade; D is default.</p></div>';
  }
  // Pro: forensic read of the latest annual report, each finding linked to its page
  function arCheckCard(c) {
    const ar = c._filings && Insights.annualReportCheck(c._filings);
    if (!ar) return '';
    const link = p => (p ? ' <a target="_blank" rel="noopener noreferrer" href="' + esc(ar.url) + '#page=' + p + '">p. ' + p + ' ↗</a>' : '');
    const nw = (c.bs && c.bs.equity && c.bs.reserves) ? (c.bs.equity[c.bs.equity.length - 1] || 0) + (c.bs.reserves[c.bs.reserves.length - 1] || 0) : null;
    const facts = (ar.facts || []).map(f => {
      let v = f.t === 'Contingent liabilities' ? '₹ ' + num(f.v, 0) + ' Cr' + (nw > 0 ? ' <span class="sub">(' + num(f.v / nw * 100, 0) + '% of net worth)</span>' : '') : esc(String(f.v));
      if (f.t === 'Audit opinion') v = '<span class="' + (/^Unmodified/.test(f.v) ? 'up' : 'down') + '">' + (/^Unmodified/.test(f.v) ? 'Clean (unmodified)' : esc(f.v)) + '</span>';
      return '<div class="ar-fact"><div class="sub">' + esc(f.t) + '</div><div>' + v + link(f.p) + '</div></div>';
    }).join('');
    const flags = (ar.flags || []).length
      ? '<ul class="flag-list">' + ar.flags.map(f => '<li><span class="sev sev-' + f.sev + '" title="' + f.sev + ' severity"></span><div><b>' + esc(f.t) + '</b>' + link(f.p) + '<div class="sub">"' + esc(f.x) + '"</div></div></li>').join('') + '</ul>'
      : '<p class="ar-clean">✓ No qualification, going-concern doubt, emphasis of matter or adverse CARO remark found.</p>';
    return '<div class="ins-card ins-ar"><div class="ins-head"><h3>Annual report check' + (ar.year ? ' <span class="sub">' + esc(ar.year) + '</span>' : '') + '</h3>' + PRO_TAG + '</div>' +
      '<div class="ar-facts">' + facts + '</div>' + flags +
      '<p class="table-note">Read from the full annual report' + (ar.pages ? ' (' + ar.pages + ' pages)' : '') + ': the independent auditor\'s reports, the CARO annexure, the directors\' report and the notes. Quotes are the report\'s own words; click a page to check.</p></div>';
  }
  // free: how promoters, foreign and domestic institutions moved, from the NSE shareholding filings
  function ownershipCard(c) {
    const h = c._shp && Insights.holdingStats(c._shp);
    if (!h) return '';
    const Q = c._shp.quarters.filter(q => q.fii != null && !(q.fii > 100 || q.promoter > 100 || q.dii > 100)).sort((a, b) => (a.q < b.q ? 1 : -1)).slice(0, 8).reverse();
    const spark = k => {
      const vals = Q.map(q => q[k]).filter(x => x != null);
      if (vals.length < 2) return '';
      const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
      const pts = vals.map((x, i) => (i / (vals.length - 1) * 100).toFixed(1) + ',' + (26 - (x - lo) / span * 22).toFixed(1)).join(' ');
      return '<svg class="own-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
    };
    const d = x => (x == null || !isFinite(x) ? '<span class="muted">-</span>' : '<span class="' + signCls(x) + '">' + (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x), 2) + '</span>');
    const row = (label, k) => '<div class="own-row"><div class="own-name">' + label + '</div><div class="own-val">' + (h[k] == null ? '-' : num(h[k], 2) + '%') + '</div>' +
      '<div class="own-spk ' + (h[k + 'Chg4q'] > 0 ? 'up' : h[k + 'Chg4q'] < 0 ? 'down' : '') + '">' + spark(k) + '</div><div class="own-d">' + d(h[k + 'Chg1q']) + '</div><div class="own-d">' + d(h[k + 'Chg4q']) + '</div></div>';
    const qLabel = new Date(h.latest.q + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return '<div class="ins-card own-card"><div class="ins-head"><h3>Ownership moves</h3><span class="sub">' + esc(qLabel) + '</span></div>' +
      '<div class="own-table"><div class="own-row own-h"><div></div><div>Holding</div><div>2 years</div><div>1Q chg</div><div>1Y chg</div></div>' +
      row('Promoters', 'promoter') + row('FIIs', 'fii') + row('DIIs', 'dii') + '</div>' +
      '<div class="own-foot">' + (h.holders ? '<span>' + num(h.holders, 0) + ' shareholders' + (h.holdersChg1q != null ? ' (<span class="' + signCls(h.holdersChg1q) + '">' + (h.holdersChg1q >= 0 ? '+' : '−') + num(Math.abs(h.holdersChg1q), 1) + '%</span> QoQ)' : '') + '</span>' : '') +
      (h.pledge ? '<span class="' + (h.pledge >= 5 ? 'down' : '') + '">' + num(h.pledge, 2) + '% of promoter shares pledged</span>' : '') +
      '<a href="" data-scroll="shareholding">Full pattern ↓</a></div>' +
      '<p class="table-note">Changes in percentage points, from the quarterly shareholding filed with NSE.</p></div>';
  }
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-scroll]');
    if (!a) return;
    e.preventDefault();
    const el = document.getElementById(a.dataset.scroll);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 118, behavior: 'smooth' });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-verdict-card]');
    if (!b || !currentCompany) return;
    const c = currentCompany;
    openCardModal(['verdict', 'results', 'snapshot'], () => Promise.resolve(c), c.symbol);
  });
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
    let range = '1Yr', type = 'price', chart = null, style = store.get('chart_style', 'candle');
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
      if (type === 'price' && style === 'candle') {
        drawCandles(start, n, common, ink3);
        legend = '';
      } else if (type === 'price') {
        const ds = [{ label: 'Price on NSE', data: idx.map(i => c.prices[i]), borderColor: primary, backgroundColor: primary, borderWidth: 1.6, pointRadius: 0, tension: 0.1, yAxisID: 'y' }];
        if (toggles.dma50) ds.push({ label: '50 DMA', data: idx.map(i => dma50[i]), borderColor: '#e8a33d', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' });
        if (toggles.dma200) ds.push({ label: '200 DMA', data: idx.map(i => dma200[i]), borderColor: '#8a8fa0', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' });
        if (toggles.volume) ds.push({ type: 'bar', label: 'Volume', data: idx.map(i => c.volume[i]), backgroundColor: 'rgba(96,86,255,.18)', yAxisID: 'v', barPercentage: 1, categoryPercentage: 1 });
        common.scales.v = { display: false, position: 'left', max: Math.max.apply(null, idx.map(i => c.volume[i])) * 4, grid: { display: false } };
        data = { labels, datasets: ds };
        legend = priceLegend([['Price on NSE', primary, null], ['50 DMA', '#e8a33d', 'dma50'], ['200 DMA', '#8a8fa0', 'dma200'], ['Volume', 'rgba(96,86,255,.35)', 'volume']]);
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
      if (legend) $('#chart-legend').innerHTML = legend;
      $$('#chart-legend [data-toggle]').forEach(cb => cb.addEventListener('change', () => { toggles[cb.dataset.toggle] = cb.checked; draw(); }));
      $$('#chart-legend [data-style]').forEach(b => b.onclick = () => { style = b.dataset.style; store.set('chart_style', style); draw(); });
    }
    function priceLegend(items) {
      return '<span class="seg" role="group" aria-label="Chart style">' + [['candle', 'Candles'], ['line', 'Line']].map(x =>
        '<button class="btn btn-small' + (style === x[0] ? ' active' : '') + '" data-style="' + x[0] + '">' + x[1] + '</button>').join('') + '</span>' +
        items.map(l => '<label>' + (l[2] ? '<input type="checkbox" data-toggle="' + l[2] + '"' + (toggles[l[2]] ? ' checked' : '') + '>' : '') + '<span class="swatch" style="background:' + l[1] + '"></span>' + l[0] + '</label>').join('');
    }

    /* Candles: real open/high/low for recent sessions (from Yahoo); older sessions, or data without
       them, use the previous close as the open. Long ranges are grouped into weekly/monthly candles. */
    const ohlcFrom = c.ohlc ? c.prices.length - c.ohlc.open.length : Infinity;
    function dayOHLC(i) {
      const cl = c.prices[i];
      if (i >= ohlcFrom) {
        const j = i - ohlcFrom, o = c.ohlc.open[j], h = c.ohlc.high[j], l = c.ohlc.low[j];
        if (o != null && h != null && l != null) return [o, Math.max(h, o, cl), Math.min(l, o, cl), cl];
      }
      const o = i > 0 ? c.prices[i - 1] : cl;
      return [o, Math.max(o, cl), Math.min(o, cl), cl];
    }
    function drawCandles(start, n, common, ink3) {
      const span = n - start;
      const unit = span <= 300 ? 'day' : span <= 1300 ? 'week' : 'month';
      const keyOf = d => unit === 'day' ? +d : unit === 'week' ? Math.floor((+d / 864e5 + 3) / 7) : d.getFullYear() * 12 + d.getMonth();
      const buckets = [];
      for (let i = start; i < n; i++) {
        const k = keyOf(c.dates[i]), b = buckets[buckets.length - 1], x = dayOHLC(i);
        if (b && b.k === k) { b.h = Math.max(b.h, x[1]); b.l = Math.min(b.l, x[2]); b.c = x[3]; b.v += c.volume[i] || 0; b.last = i; }
        else buckets.push({ k, o: x[0], h: x[1], l: x[2], c: x[3], v: c.volume[i] || 0, first: i, last: i });
      }
      const up = cssVar('--green') || '#11813d', down = cssVar('--red') || '#d33a3a';
      const col = buckets.map(b => (b.c >= b.o ? up : down));
      const dateFmt = unit === 'month' ? { month: 'short', year: 'numeric' } : unit === 'week' ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
      const labels = buckets.map(b => c.dates[b.first].toLocaleDateString('en-IN', dateFmt));
      const ds = [
        { type: 'bar', label: 'wick', data: buckets.map(b => [b.l, b.h]), backgroundColor: col, barPercentage: 0.14, categoryPercentage: 1, grouped: false, yAxisID: 'y', order: 2 },
        { type: 'bar', label: 'candle', data: buckets.map(b => { const lo = Math.min(b.o, b.c), hi = Math.max(b.o, b.c); return [lo, hi - lo < (b.h - b.l) * 0.004 + 1e-6 ? lo + Math.max((b.h - b.l) * 0.004, hi * 0.0004) : hi]; }),
          backgroundColor: col, borderColor: col, barPercentage: 0.72, categoryPercentage: 1, grouped: false, yAxisID: 'y', order: 1 }
      ];
      if (toggles.dma50) ds.push({ type: 'line', label: '50 DMA', data: buckets.map(b => dma50[b.last]), borderColor: '#e8a33d', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y', order: 0 });
      if (toggles.dma200) ds.push({ type: 'line', label: '200 DMA', data: buckets.map(b => dma200[b.last]), borderColor: '#8a8fa0', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y', order: 0 });
      if (toggles.volume) ds.push({ type: 'bar', label: 'Volume', data: buckets.map(b => b.v), backgroundColor: 'rgba(96,86,255,.16)', yAxisID: 'v', barPercentage: 0.9, categoryPercentage: 1, grouped: false, order: 3 });
      common.scales.y.beginAtZero = false;
      common.scales.y.grace = '3%';
      common.scales.v = { display: false, position: 'left', beginAtZero: true, max: Math.max.apply(null, buckets.map(b => b.v).concat([1])) * 4, grid: { display: false } };
      common.plugins.tooltip = {
        filter: it => it.dataset.label !== 'wick',
        callbacks: {
          label: it => {
            const b = buckets[it.dataIndex];
            if (it.dataset.label === 'candle') return ['Open ' + num(b.o, 2) + '   High ' + num(b.h, 2), 'Low ' + num(b.l, 2) + '   Close ' + num(b.c, 2) + '  (' + (b.c >= b.o ? '+' : '') + num((b.c / b.o - 1) * 100, 2) + '%)'];
            if (it.dataset.label === 'Volume') return 'Volume ' + num(b.v, 0);
            return it.dataset.label + ' ' + num(it.parsed.y, 2);
          }
        }
      };
      chart = new Chart($('#price-chart'), { type: 'bar', data: { labels, datasets: ds }, options: common });
      const note = unit === 'day' ? 'Daily candles' : unit === 'week' ? 'Weekly candles' : 'Monthly candles';
      $('#chart-legend').innerHTML = priceLegend([['50 DMA', '#e8a33d', 'dma50'], ['200 DMA', '#8a8fa0', 'dma200'], ['Volume', 'rgba(96,86,255,.35)', 'volume']]) +
        '<span class="sub">' + note + (c.ohlc ? '' : ' from closing prices') + '</span>';
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
  function sectionHead(id, title, desc, c, extra) {
    const alt = c.standalone ? 'Consolidated' : 'Standalone';
    return '<section class="section card" id="' + id + '"><div class="section-head"><div><h2>' + esc(title) + '</h2><p>' + desc + '</p></div>' +
      '<div class="head-actions">' + (extra || '') +
      (c.live ? '' : '<a class="btn btn-small btn-plain" href="#/company/' + c.symbol + (c.standalone ? '' : '/standalone') + '" data-view>View ' + alt + '</a>') + '</div></div>';
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
    return sectionHead('balance-sheet', 'Balance Sheet', figs(c), c, '<button class="btn btn-small" id="ca-btn">Corporate actions</button>') + statementTable(c.years, [
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
    if (c._shp) return nseShareholdingTable(c, yearly);
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
  function nseShareholdingTable(c, yearly) {
    let Q = c._shp.quarters.filter(q => q.fii != null && !(q.fii > 100 || q.promoter > 100 || q.dii > 100)).slice().sort((a, b) => (a.q < b.q ? -1 : 1));
    if (yearly) Q = Q.filter((q, i) => q.q.slice(5, 7) === '03' || i === Q.length - 1);
    const heads = Q.map(q => monYear(new Date(q.q + 'T00:00:00')));
    const col = k => Q.map(q => q[k]);
    const hs = Insights.holdingStats(c._shp);
    const chg = (v, label) => (v == null || Math.abs(v) < 0.01 ? '' : '<span class="' + (v > 0 ? 'up' : 'down') + '">' + label + ' ' + (v > 0 ? '+' : '−') + num(Math.abs(v), 2) + ' pts</span>');
    const moves = hs ? [chg(hs.promoterChg1q, 'Promoters'), chg(hs.fiiChg1q, 'FIIs'), chg(hs.diiChg1q, 'DIIs')].filter(Boolean) : [];
    return statementTable(heads, [
      { label: 'Promoters', values: col('promoter'), type: 'pct', dec: 2 },
      { label: 'FIIs', values: col('fii'), type: 'pct', dec: 2 },
      { label: 'DIIs', values: col('dii'), type: 'pct', dec: 2 },
      { label: 'Government', values: col('gov'), type: 'pct', dec: 2 },
      { label: 'Public', values: col('public'), type: 'pct', dec: 2 },
      { label: 'No. of Shareholders', values: col('holders') }
    ].concat(Q.some(q => q.pledge > 0) ? [{ label: 'Pledged (% of promoter)', values: col('pledge'), type: 'pct', dec: 2 }] : []), { highlightLast: true }) +
      '<p class="table-note">' + (moves.length ? 'Last quarter: ' + moves.join(' &middot; ') + '. ' : '') + (hs && hs.fiiUpQtrs >= 2 ? 'FIIs have raised their stake for ' + hs.fiiUpQtrs + ' quarters in a row. ' : '') +
      'Source: shareholding pattern filed with NSE.</p>';
  }
  function shareholdingSection(c) {
    return '<section class="section card" id="shareholding"><div class="section-head"><div><h2>Shareholding Pattern</h2><p>Numbers in percentages</p></div>' +
      '<div class="head-actions"><button class="btn btn-small" id="trades-btn">Trades</button>' +
      '<div class="tabs" id="sh-tabs"><button class="btn btn-small active" data-sh="q">Quarterly</button><button class="btn btn-small" data-sh="y">Yearly</button></div></div></div>' +
      '<div id="sh-table">' + shareholdingTable(c, false) + '</div></section>';
  }
  function bindShareholding(c) {
    $$('#sh-tabs button').forEach(b => b.onclick = () => {
      $$('#sh-tabs button').forEach(x => x.classList.toggle('active', x === b));
      $('#sh-table').innerHTML = shareholdingTable(c, b.dataset.sh === 'y');
    });
    $('#trades-btn').onclick = () => openTrades(c);
    const ca = $('#ca-btn');
    if (ca) ca.onclick = () => openCorporateActions(c);
  }

  /* ---------- Trades: insider trades, bulk and block deals, SAST disclosures ---------- */
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthKey = d => String(d).slice(0, 7);
  const monthLabel = k => MONTHS_FULL[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4);
  const SMALL_TRADE_CR = 0.1;   // "hide small quantities": trades under Rs 10 lakh
  function tradeRows(c, act, tab) {
    if (!act) return [];
    if (tab === 'bulk' || tab === 'block') {
      return act.deals.filter(x => x.s === c.symbol && x.t === tab).map(x => ({
        d: x.d, who: x.c, sub: tab === 'bulk' ? 'Bulk deal' : 'Block deal', buy: x.side === 'B', q: x.q, pr: x.p, v: x.v
      }));
    }
    return act.disclosures.filter(x => x.s === c.symbol && x.k === (tab === 'sast' ? 'sast' : 'insider')).map(x => ({
      d: x.d.slice(0, 10), who: x.who || '', sub: [x.cat, x.mode].filter(Boolean).join(' · ') || (tab === 'sast' ? 'SAST disclosure' : 'Insider disclosure'),
      buy: x.dir === 'buy' || x.dir === 'release', dir: x.dir, q: x.q, pr: x.pr, v: x.v, u: x.u
    }));
  }
  function tradesTable(rows, hideSmall) {
    const list = hideSmall ? rows.filter(r => r.v == null || r.v >= SMALL_TRADE_CR) : rows;
    if (!list.length) return '<p class="muted" style="padding:12px 0">' + (rows.length ? 'Only small trades in this list. Untick "Hide small quantities" to see them.' : 'No trades of this type on record for this company yet.') + '</p>';
    const byMonth = {};
    list.sort((a, b) => b.d.localeCompare(a.d)).forEach(r => (byMonth[monthKey(r.d)] = byMonth[monthKey(r.d)] || []).push(r));
    const qty = r => (r.q == null ? '<span class="muted">-</span>' : '<span class="' + (r.dir && !DIR[r.dir] ? '' : r.buy ? 'up' : 'down') + '">' + (r.buy ? '' : '−') + num(r.q, 0) + '</span>');
    return '<div class="table-wrap"><table class="data trades"><thead><tr><th class="l">Person</th><th>Quantity</th><th>Avg Price</th><th>Value<br><span class="sub">Rs. Lacs</span></th></tr></thead><tbody>' +
      Object.keys(byMonth).map(k => '<tr class="month-row"><td class="l" colspan="4">' + monthLabel(k) + '</td></tr>' + byMonth[k].map(r =>
        '<tr><td class="l"><div class="person">' + (r.who ? esc(r.who) : '<span class="muted">' + (r.dir && DIR[r.dir] ? DIR[r.dir][0] : 'Trade') + ' - see filing</span>') + '</div>' +
        '<div class="sub">' + esc(r.sub) + ' · ' + docWhen(r.d) + (r.u ? ' · <a target="_blank" rel="noopener noreferrer" href="' + esc(r.u) + '">filing ↗</a>' : '') + '</div></td>' +
        '<td>' + qty(r) + '</td><td>' + (r.pr == null ? '<span class="muted">-</span>' : num(r.pr, 2)) + '</td><td>' + (r.v == null ? '<span class="muted">-</span>' : num(r.v * 100, 2)) + '</td></tr>').join('')).join('') +
      '</tbody></table></div>';
  }
  function tabbedModal(title, tabs, render, footNote) {
    const bd = modal(title, '<div class="tabs modal-tabs">' + tabs.map((t, i) => '<button class="btn btn-small' + (i === 0 ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="modal-tab-body"></div>' + (footNote ? '<p class="table-note">' + footNote + '</p>' : ''));
    bd.querySelector('.modal').classList.add('modal-wide');
    let current = tabs[0][0];
    const show = () => { $('.modal-tab-body', bd).innerHTML = render(current, bd); };
    $$('[data-tab]', bd).forEach(b => b.onclick = () => { current = b.dataset.tab; $$('[data-tab]', bd).forEach(x => x.classList.toggle('active', x === b)); show(); });
    show();
    return { bd, show };
  }
  function openTrades(c) {
    let act = c._activity || null, hideSmall = store.get('hide_small_trades', true), loading = !act && c.live;
    const tabs = [['insider', 'Insider Trades'], ['bulk', 'Bulk Deals'], ['block', 'Block Deals'], ['sast', 'SAST Trades']];
    const m = tabbedModal('Trades', tabs, tab => loading ? '<p class="muted">Loading…</p>' :
      '<label class="check-line"><input type="checkbox" id="hide-small"' + (hideSmall ? ' checked' : '') + '> Hide small quantities <span class="sub">(under ₹ 10 lakh)</span></label>' +
      tradesTable(tradeRows(c, act, tab), hideSmall),
      'Bulk and block deals from NSE\'s daily files. Insider (SEBI PIT) and SAST trades are read from the company\'s filings; open the filing when a figure is missing. Quantities sold are shown in red.');
    const rebind = () => { const cb = $('#hide-small', m.bd); if (cb) cb.onchange = () => { hideSmall = cb.checked; store.set('hide_small_trades', hideSmall); m.show(); rebind(); }; };
    $$('[data-tab]', m.bd).forEach(b => b.addEventListener('click', rebind));
    rebind();
    if (loading) Data.loadActivity().then(a => { act = c._activity = a; loading = false; m.show(); rebind(); });
  }

  /* ---------- Corporate actions: equity history, preferential and rights issues, mergers, splits, dividends ---------- */
  const CA_KINDS = [
    ['equity', 'Equity History', /allot(ment|ted)|conversion of (share )?warrants|\besops?\b|\besos\b|employee stock option|increase in (the )?(paid[- ]up|authori[sz]ed|share) capital|listing (approval )?of (further|additional|new) (equity )?shares|\bqip\b|qualified institutions? placement|reduction of (share )?capital/i],
    ['prefs', 'Prefs', /preferential/i],
    ['rights', 'Rights', /rights? (issue|entitlement|shares)|rights basis/i],
    ['merger', 'Merger', /amalgamation|\bmerger\b|demerger|scheme of arrangement|slump sale|composite scheme/i],
    ['splits', 'Splits & Bonus', /\bbonus\b|sub-?division|stock split|\bsplit\b/i],
    ['dividends', 'Dividends', /dividend/i],
    ['buyback', 'Buyback', /buy ?-?back/i]
  ];
  const ratioText = r => { const f = [[2, '1:1'], [3, '2:1'], [1.5, '1:2']].find(x => Math.abs(x[0] - r) < 0.001); return f ? f[1] : num(r, r < 10 ? 2 : 0) + ' for 1'; };
  function corporateActions(c, f) {
    const out = {};
    CA_KINDS.forEach(k => (out[k[0]] = []));
    ((f && f.announcements) || []).forEach(a => {
      const t = cleanTitle(a.t || '');
      const k = CA_KINDS.find(x => x[2].test(t));
      if (!k || /trading window|newspaper|intimation of (record date )?for? ?agm|postal ballot/i.test(t) && k[0] !== 'dividends') return;
      out[k[0]].push({ d: a.d.slice(0, 10), text: t, u: a.u });
    });
    const acts = c.actions || {};
    (acts.splits || []).forEach(x => out.splits.push({ d: x[0], text: 'Split or bonus: shares multiplied ' + ratioText(x[1]) + ' (' + num(x[1], 4).replace(/\.?0+$/, '') + 'x shares; past prices adjusted)' }));
    (acts.dividends || []).forEach(x => out.dividends.push({ d: x[0], text: 'Dividend of ₹ ' + num(x[1], 2) + ' per share (ex-date)' }));
    // share capital changes from the balance sheet
    const eq = (c.bs && c.bs.equity) || [];
    for (let i = 1; i < eq.length; i++) {
      if (eq[i] != null && eq[i - 1] != null && Math.abs(eq[i] - eq[i - 1]) > Math.max(0.01, eq[i - 1] * 0.001)) {
        out.equity.push({ d: '', label: c.years[i], text: 'Equity share capital ' + (eq[i] > eq[i - 1] ? 'rose' : 'fell') + ' from ₹ ' + num(eq[i - 1], 2) + ' Cr to ₹ ' + num(eq[i], 2) + ' Cr' });
      }
    }
    Object.keys(out).forEach(k => out[k].sort((a, b) => (b.d || yearDate(b.label)).localeCompare(a.d || yearDate(a.label))));
    return out;
  }
  const yearDate = l => { const m = /(\w{3}) (\d{4})/.exec(l || ''); return m ? m[2] + '-' + String(MON.indexOf(m[1]) + 1).padStart(2, '0') + '-31' : ''; };
  function openCorporateActions(c) {
    let f = c._filings || null, loading = !f && c.live;
    const tabs = CA_KINDS.map(k => [k[0], k[1]]);
    const m = tabbedModal('Corporate actions', tabs, tab => {
      if (loading) return '<p class="muted">Loading…</p>';
      const rows = corporateActions(c, f)[tab];
      if (!rows.length) return '<p class="muted" style="padding:12px 0">No ' + esc(tabs.find(t => t[0] === tab)[1].toLowerCase()) + ' records for this company yet.</p>';
      return '<div class="table-wrap"><table class="data ca-table"><thead><tr><th class="l">Date</th><th class="l">Details</th></tr></thead><tbody>' +
        rows.map(r => '<tr><td class="l nowrap">' + (r.d ? new Date(r.d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : esc(r.label)) + '</td><td class="l">' +
          (r.u ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(r.u) + '">' + esc(r.text) + ' ↗</a>' : esc(r.text)) + '</td></tr>').join('') + '</tbody></table></div>';
    }, 'From exchange filings, Yahoo Finance splits and dividends, and changes in share capital on the balance sheet. Filings history grows as Sankhyas collects them.');
    if (loading) Data.loadFilings(c.symbol).then(x => { f = c._filings = x; loading = false; m.show(); });
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

  /* ---------- live documents and on-demand AI summaries (doc-ai Edge Function) ---------- */
  const DocAI = (function () {
    const cfg = Account.config || {};
    const on = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
    const base = on ? cfg.supabaseUrl.replace(/\/$/, '') : '';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.supabaseAnonKey, apikey: cfg.supabaseAnonKey };
    async function call(body) {
      const r = await fetch(base + '/functions/v1/doc-ai?forceFunctionRegion=ap-south-1', { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Server error ' + r.status);
      return j;
    }
    const hasCC = f => !!(f && (f.announcements || []).some(a => a.k === 'transcript' || a.k === 'ppt'));
    return {
      on,
      /** Adds live NSE filings and shared summaries to c._filings. Resolves true when anything changed. */
      async complete(c, f) {
        if (!on || !c.live) return false;
        f = c._filings = f || c._filings || { symbol: c.symbol, announcements: [], annualReports: [], notes: {} };
        f.announcements = f.announcements || []; f.annualReports = f.annualReports || []; f.notes = f.notes || {};
        let changed = false;
        const jobs = [];
        if (c.exchange !== 'BSE' && !/^\d+$/.test(c.symbol) && (!f.backfilled || !hasCC(f))) {
          jobs.push(call({ action: 'filings', symbol: c.symbol }).then(live => {
            const have = new Set(f.announcements.map(a => a.u));
            const add = (live.announcements || []).filter(a => !have.has(a.u));
            if (add.length) { f.announcements = f.announcements.concat(add).sort((a, b) => (a.d < b.d ? 1 : -1)); changed = true; }
            const haveR = new Set(f.annualReports.map(r => r.u));
            (live.annualReports || []).forEach(r => { if (!haveR.has(r.u)) { f.annualReports.push(r); changed = true; } });
            Object.keys(live.notes || {}).forEach(u => { if (!f.notes[u]) { f.notes[u] = live.notes[u]; changed = true; } });
            if (!f.updated) f.updated = live.updated;
          }).catch(() => null));
        }
        // summaries generated on demand by any visitor (public table)
        jobs.push(fetch(base + '/rest/v1/doc_notes?select=url,note&symbol=eq.' + encodeURIComponent(c.symbol), { headers })
          .then(r => (r.ok ? r.json() : [])).then(rows => { (rows || []).forEach(r => { if (!f.notes[r.url]) { f.notes[r.url] = r.note; changed = true; } }); }).catch(() => null));
        await Promise.all(jobs);
        return changed;
      },
      summarize(c, url, kind, d) { return call({ action: 'summary', symbol: c.symbol, url, kind, d }); }
    };
  })();

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
          const lbl = a.rt ? Insights.ratingText(a) + (a.act && Insights.RATING_ACT[a.act] ? ' · ' + Insights.RATING_ACT[a.act] : '') : a.act === 'withdraw' ? 'Rating withdrawn' : 'Rating update';
          return '<li>' + ext(a.u, lbl, '', cleanTitle(a.t)) + '<div class="doc-meta">' + docWhen(a.d) + ' from ' + esc(a.ag || (ag ? ag[1].toLowerCase() : (a.x || exName))) + (a.sub ? ' · subsidiary' : '') + '</div></li>'; }).join('')
      : '<li>' + ext(P.ann, 'Rating updates') + '<div class="doc-meta">in ' + exName.toUpperCase() + ' filings</div></li>') + '</ul>';

    // Concalls: one row per results quarter with Transcript / AI Summary / PPT / REC. Documents we
    // have link to the exchange filing; missing ones search the web for that exact quarter's document.
    const qEndOf = d => { const t = new Date(d); const m = t.getMonth() - (t.getMonth() % 3) - 1; return new Date(t.getFullYear(), m, 1); };
    const qLabel = qe => { const m = qe.getMonth(); return 'Q' + ({ 5: 1, 8: 2, 11: 3, 2: 4 })[m] + ' FY' + String((m === 2 ? qe.getFullYear() : qe.getFullYear() + 1) % 100).padStart(2, '0'); };
    const extra = store.get('cc_extra_' + c.symbol, []);
    const rows = {};
    const row = qe => { const k = monYear(qe); return rows[k] || (rows[k] = { qe, call: null }); };
    recentQuarters(8).forEach(q => row(new Date(q + ' 1')));
    A.filter(a => /^(transcript|ppt|audio)$/.test(a.k)).forEach(a => {
      const r = row(qEndOf(a.d));
      if (!r[a.k]) { r[a.k] = a.k === 'audio' && a.rec ? a.rec : a.u; r[a.k + 'Filed'] = a.u; }
      if (!r.call || a.d < r.call) r.call = a.d;
    });
    extra.forEach(e => { const r = row(qEndOf(new Date(e.m + ' 15'))); if (!r[e.k]) { r[e.k] = e.u; r.mine = 1; } });
    const shortName = (c.name || c.symbol).replace(/\s+(limited|ltd\.?)$/i, '');
    const find = (label, q, what) => ext('https://www.google.com/search?q=' + encodeURIComponent('"' + shortName + '" ' + q + ' ' + what), label, 'doc-pill find',
      'Not in Sankhyas yet: search the web for ' + shortName + '\'s ' + q + ' ' + what.replace(/ filetype:pdf$/, ''));
    const ccBody = Object.values(rows).sort((a, b) => b.qe - a.qe).slice(0, 16).map(r => {
      const q = qLabel(r.qe), sums = [r.transcript, r.ppt].filter(noted);
      // documents we have but nobody has summarised yet: summarise on demand (exchange PDFs only)
      const todo = DocAI.on ? [['transcript', r.transcriptFiled], ['ppt', r.pptFiled]].filter(x => x[1] && !noted(x[1]) && /\.pdf($|\?)/i.test(x[1])) : [];
      const callMonth = r.call ? monYear(new Date(r.call)) : monYear(new Date(r.qe.getFullYear(), r.qe.getMonth() + 1, 1));
      return '<div class="cc-row"><span class="cc-period" title="Results call for ' + q + '">' + esc(callMonth) + '<small>' + esc(q) + '</small></span>' +
        (r.transcript ? pill(r.transcript, 'Transcript') : find('Transcript', q, 'earnings call transcript filetype:pdf')) +
        (sums.length || todo.length ? '<button type="button" class="doc-pill' + (sums.length ? '' : ' gen') + '" data-sum="' + esc(sums.join(' ')) + '" data-sum-gen="' + esc(todo.map(x => x[0] + '|' + x[1] + '|' + (r.call || '')).join(' ')) +
          '" data-sum-title="Concall ' + esc(q) + '"' + (sums.length ? '' : ' title="Read the document and summarise it now (takes a few seconds)"') + '>AI Summary</button>' : pill(null, 'AI Summary')) +
        (r.ppt ? pill(r.ppt, 'PPT') : find('PPT', q, 'investor presentation filetype:pdf')) +
        (r.audio ? pill(r.audio, 'REC', r.audio !== r.audioFiled ? 'Recording of the call' : 'Recording notice') : find('REC', q, 'earnings call audio recording')) + '</div>';
    }).join('') + '<p class="cc-note">Solid = filed on the exchange (AI Summary when read). Dashed = not in Sankhyas yet, searches the web. New filings arrive every 2 hours.</p>';
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
    $$('#documents [data-sum]').forEach(b => b.onclick = async () => {
      const c = currentCompany, f = c && c._filings;
      if (!f) return;
      const N = f.notes = f.notes || {};
      const gen = (b.dataset.sumGen || '').split(' ').filter(Boolean).map(x => x.split('|'));
      const title = 'AI Summary: ' + c.name + ' · ' + b.dataset.sumTitle;
      const show = errs => {
        const us = b.dataset.sum.split(' ').concat(gen.map(g => g[1])).filter((u, i, a) => u && a.indexOf(u) === i && N[u] && N[u].sections);
        return '<div class="ai-assistant note-body">' + (us.length ? us.map(u => concallNoteHtml(N[u], u)).join('<hr>') : '') +
          (errs.length ? '<div class="info-box">' + errs.map(esc).join('<br>') + '</div>' : '') + (us.length ? NOTE_FOOT : '') + '</div>';
      };
      if (!gen.length) { modal(title, show([])); return; }
      const bd = modal(title, '<div class="ai-assistant note-body"><p class="muted"><span class="spinner" aria-hidden="true"></span> Reading the ' + (gen.length > 1 ? 'transcript and presentation' : gen[0][0] === 'ppt' ? 'presentation' : 'transcript') +
        ' from the exchange and summarising it. This takes a few seconds the first time; after that it is instant for everyone.</p></div>');
      const errs = [];
      await Promise.all(gen.map(([kind, url, d]) => DocAI.summarize(c, url, kind, d).then(j => { N[url] = j.note; })
        .catch(e => errs.push((kind === 'ppt' ? 'Presentation' : 'Transcript') + ': ' + e.message))));
      const body = $('.modal-body', bd);
      if (body) body.innerHTML = show(errs);
      refreshDocuments();
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
    $('#save-notes').onclick = () => { if (!requireLogin('save notes')) return; store.set('notes_' + c.symbol, $('#notes-text').value); toast('Notes saved'); };
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
      if (!user()) { if (!requireLogin('save screens')) return; }
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
      ['#/screens', 'Popular screens', 'Ready-made screens such as Magic Formula and Coffee Can.'],
      ['#/deals', 'Smart money', 'Bulk and block deals, and insider and promoter buying and selling, market-wide.'],
      ['#/orders', 'Order wins', 'Every order and contract win announced to the exchange, with its value.'],
      ['#/ratings', 'Credit rating changes', 'Upgrades, downgrades and outlook changes from CRISIL, ICRA, CARE, India Ratings and others.'],
      ['#/ipo', 'IPOs', 'Open and upcoming IPOs with live subscription, recent listings vs issue price, and rights issues.'],
      ['#/calendar', 'Results calendar', 'Upcoming board meetings for results, dividends and fund raising.'],
      ['#/themes', 'Theme tracker', 'Defence, railways, EV, PSU banks, renewables and more, with leaders and laggards.'],
      ['#/studio', 'Social post studio', 'Turn results, red flags, listings and themes into Instagram and X posts.']
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
  function pageResults(parts, params) {
    setTitle('Latest results');
    params = params || {};
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadResultsList().then(list => {
      if (token !== navToken) return;
      if (!list || !(list.results || []).length) return pageResultsEstimated();
      const f = params.v || 'all';
      const rows = list.results.filter(r => f === 'all' || r.v.toLowerCase() === f);
      const count = v => list.results.filter(r => r.v === v).length;
      const fmtF = r => (r.f ? r.f.replace(/\s+\d{2}:\d{2}(:\d{2})?$/, '') : r.q);
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Latest Results</h1><p>Quarterly results filed with NSE, newest first, with the Sankhyas verdict &middot; ₹ Cr, consolidated where filed</p></div>' +
        '<div class="tabs">' + [['all', 'All ' + list.results.length], ['strong', 'Strong ' + count('Strong')], ['mixed', 'Mixed ' + count('Mixed')], ['weak', 'Weak ' + count('Weak')]].concat(count('New') ? [['new', 'New ' + count('New')]] : [])
          .map(t => '<a class="btn btn-small' + (f === t[0] ? ' active' : '') + '" href="#/results' + (t[0] === 'all' ? '' : '?v=' + t[0]) + '">' + t[1] + '</a>').join('') + '</div></div>' +
        '<div class="table-wrap"><table class="data list"><thead><tr><th>S.No.</th><th>Name</th><th>Filed</th><th>Quarter</th><th>Verdict</th><th>Sales</th><th>YoY %</th><th>Op. Profit</th><th>OPM %</th><th>Net Profit</th><th>YoY %</th><th>EPS</th><th></th></tr></thead><tbody>' +
        rows.slice(0, 500).map((r, i) => '<tr><td>' + (i + 1) + '.</td><td><a href="#/company/' + encodeURIComponent(r.s) + '">' + esc(r.n) + '</a></td><td>' + esc(fmtF(r)) + '</td><td>' + esc(r.q) + (r.cons ? '' : ' <span class="sub">SA</span>') + '</td>' +
          '<td><span class="v-pill ' + VERDICT_CLS[r.v] + '">' + r.v + '</span></td><td>' + num(r.sales, 0) + '</td><td class="' + signCls(r.sy) + '">' + num(r.sy, 1) + '</td><td>' + num(r.op, 0) + '</td><td>' + num(r.opm, 1) +
          '</td><td>' + num(r.np, 0) + '</td><td class="' + signCls(r.py) + '">' + num(r.py, 1) + '</td><td>' + num(r.eps, 2) + '</td>' +
          '<td><button class="btn btn-small btn-plain card-btn" data-card="' + esc(r.s) + '" title="Share results card">↗ Card</button></td></tr>').join('') + '</tbody></table></div>' +
        '<p class="table-note">Verdict: Strong, Mixed or Weak from revenue and profit growth vs the same quarter last year and the change in operating margin. SA = standalone figures. Not investment advice.</p></div></div>';
      $$('[data-card]').forEach(b => b.onclick = () => openCardModal(['verdict', 'results', 'snapshot'], () => Data.loadCompany(b.dataset.card).then(c => Data.loadResults(b.dataset.card).then(r => { if (r) c._res = r; return c; })), b.dataset.card));
    });
  }
  function pageResultsEstimated() {
    const all = Data.listCompanies().slice().sort((a, b) => resultDate(b) - resultDate(a) || (b.metrics.marketCap || 0) - (a.metrics.marketCap || 0)).slice(0, 300);
    app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Latest Results</h1><p>Latest reported quarter &middot; figures in Rs. Cr.' + (Data.liveInfo().count ? ' &middot; result dates are estimated' : '') + '</p></div></div>' +
      '<div class="table-wrap"><table class="data list"><thead><tr><th>S.No.</th><th>Name</th><th>Result date</th><th>Sales</th><th>YoY %</th><th>Operating Profit</th><th>OPM %</th><th>Net Profit</th><th>YoY %</th><th>EPS</th><th></th></tr></thead><tbody>' +
      all.map((c, i) => {
        const m = c.metrics;
        return '<tr><td>' + (i + 1) + '.</td><td><a href="#/company/' + esc(c.symbol) + '">' + esc(c.name) + '</a></td><td>' + resultDate(c).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
          '</td><td>' + num(m.qtrSales, 0) + '</td><td class="' + signCls(m.qtrSalesVar) + '">' + num(m.qtrSalesVar, 1) + '</td><td>' + num(m.qtrOp, 0) + '</td><td>' + num(m.qtrOpm, 0) +
          '</td><td>' + num(m.qtrProfit, 0) + '</td><td class="' + signCls(m.qtrProfitVar) + '">' + num(m.qtrProfitVar, 1) + '</td><td>' + num(m.qtrEps, 2) +
          '</td><td><button class="btn btn-small btn-plain card-btn" data-card="' + esc(c.symbol) + '" title="Share results card">↗ Card</button></td></tr>';
      }).join('') + '</tbody></table></div></div></div>';
    $$('[data-card]').forEach(b => b.onclick = () => openCardModal(['results', 'snapshot'], () => Data.loadCompany(b.dataset.card), b.dataset.card));
  }

  /* ---------- Social cards (Instagram / X / WhatsApp) ---------- */
  function openCardModal(kinds, loadData, name) {
    let kind = kinds[0], format = 'square', data = null, canvas = null, seq = 0;
    const bd = modal('Share card', '<div class="card-studio">' +
      '<div class="card-controls">' + (kinds.length > 1 ? '<label>Template <select id="cm-kind">' + kinds.map(k => '<option value="' + k + '">' + esc(Cards.kinds[k]) + '</option>').join('') + '</select></label>' : '') +
      '<div class="seg" role="tablist"><button type="button" class="active" data-fmt="square">Post 1:1</button><button type="button" data-fmt="story">Story 9:16</button></div></div>' +
      '<div class="card-preview"><div class="muted">Drawing…</div></div>' +
      '<label class="sub" for="cm-cap">Caption</label><textarea id="cm-cap" rows="6"></textarea>' +
      '<p class="table-note">Download the image and paste the caption into Instagram, X or LinkedIn. On phones, Share opens your apps directly.</p></div>',
      [{ label: 'Copy caption', onClick: () => { copyText($('#cm-cap', bd).value); toast('Caption copied'); return false; } },
       { label: 'Share…', onClick: () => { if (canvas) Cards.share(canvas, $('#cm-cap', bd).value, fname()).then(ok => { if (!ok) { Cards.download(canvas, fname()); copyText($('#cm-cap', bd).value); toast('Image downloaded and caption copied'); } }).catch(() => {}); return false; } },
       { label: 'Download PNG', primary: true, onClick: () => { if (canvas) Cards.download(canvas, fname()); return false; } }]);
    bd.querySelector('.modal').classList.add('modal-wide');
    const fname = () => 'sankhyas-' + String(name || kind).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + kind + (format === 'story' ? '-story' : '');
    async function draw() {
      const my = ++seq, box = $('.card-preview', bd);
      box.innerHTML = '<div class="muted">Drawing…</div>';
      try {
        if (!data) data = await loadData();
        canvas = await Cards.render(kind, data, format);
        if (my !== seq) return;
        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        img.alt = Cards.kinds[kind] + ' preview';
        img.className = format === 'story' ? 'story' : '';
        box.innerHTML = ''; box.appendChild(img);
        $('#cm-cap', bd).value = Cards.caption(kind, data);
      } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="error-box">Could not draw this card.</div>';
      }
    }
    if ($('#cm-kind', bd)) $('#cm-kind', bd).onchange = e => { kind = e.target.value; draw(); };
    $$('[data-fmt]', bd).forEach(b => b.onclick = () => { $$('[data-fmt]', bd).forEach(x => x.classList.toggle('active', x === b)); format = b.dataset.fmt; draw(); });
    draw();
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(() => {});
  }

  /* ---------- IPOs: open & upcoming, recent listings, below issue price, rights issues ---------- */
  const IPO_TABS = [['open', 'Open & upcoming'], ['recent', 'Recent listings'], ['below', 'Below issue price'], ['rights', 'Rights issues']];
  // listed issues joined with today's prices: listing-day gain and return since the IPO
  function ipoListed(ipo) {
    return (ipo ? ipo.past : []).filter(x => x.ld && x.ip).map(x => {
      const c = Data.getCompany(x.s), m = c ? c.metrics : {};
      const first = c && c.listPrice != null && (!c.listPriceDate || Math.abs(Date.parse(c.listPriceDate) - Date.parse(x.ld)) < 5 * 864e5) ? c.listPrice : null;
      // prices are adjusted for later splits and bonuses, the issue price is not: when the first close
      // is a clean fraction of the issue price (1/2, 1/5, 1/10...), adjust the issue price the same way
      let ip = x.ip, adj = 0;
      if (first && x.ip / first > 1.8) {
        const k = [2, 3, 4, 5, 10, 20, 25, 50].map(k => [k, Math.abs(x.ip / k / first - 1)]).sort((a, b) => a[1] - b[1])[0];
        if (k[1] < 0.35) { ip = x.ip / k[0]; adj = k[0]; }
      }
      return Object.assign({}, x, { c, ipAdj: ip, adj, price: m.price, first, lgain: first ? (first / ip - 1) * 100 : null, ret: m.price ? (m.price / ip - 1) * 100 : null, mc: m.marketCap, pe: m.pe, roce: m.roce });
    });
  }
  // "IIFL Capital Services Limited (formerly known as ...)" -> "iifl capital services"
  const leadKey = n => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(private|pvt|limited|ltd|llp|company|co|india|the)\b\.?/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const leadList = s => String(s || '').split(/,\s*|\s+and\s+/i).map(x => x.trim()).filter(x => leadKey(x).length > 2);

  function pageIPO(parts, params) {
    if (parts[0]) return pageIPONote(parts[0]);
    setTitle('IPOs');
    const tab = IPO_TABS.some(t => t[0] === params.tab) ? params.tab : 'open';
    const board = params.board || 'all', period = params.period || '1y';
    const link = o => '#/ipo?' + Object.entries(Object.assign({ tab, board, period }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadIPO().then(ipo => {
      if (token !== navToken) return;
      const today = new Date().toISOString().slice(0, 10);
      const d = s => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-');
      const dy = s => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
      const rs = v => (v == null ? '<span class="muted">-</span>' : '₹' + num(v, v < 100 ? 2 : 0));
      const pc = v => (v == null || !isFinite(v) ? '<span class="muted">-</span>' : '<span class="' + signCls(v) + '">' + (v > 0 ? '+' : '') + num(v, 1) + '%</span>');
      const co = x => { const c = Data.getCompany(x.s); return c ? '<a href="#/company/' + encodeURIComponent(x.s) + '">' + esc(x.n || c.name) + '</a>' : esc(x.n || x.s); };
      const badge = x => (x.board === 'SME' ? '<span class="sme-badge">' + (x.ex === 'BSE' ? 'BSE SME' : 'NSE SME') + '</span>' : '<span class="board-tag">Mainboard</span>');
      const boardOk = x => board === 'all' || (board === 'sme' ? x.board === 'SME' : x.board !== 'SME');
      const seg = (items, cur, mk) => '<div class="seg">' + items.map(([k, l]) => '<a class="' + (k === cur ? 'active' : '') + '" href="' + mk(k) + '">' + l + '</a>').join('') + '</div>';
      const boardSeg = seg([['all', 'All'], ['main', 'Mainboard'], ['sme', 'SME']], board, b => link({ board: b }));
      const tile = (label, value, sub) => '<div class="stat"><div class="sub">' + label + '</div><b>' + value + '</b>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
      const counts = ipo ? { open: (ipo.open || []).length + (ipo.upcoming || []).length, rights: (ipo.rights || []).filter(r => (r.rec || r.ex) >= today).length } : {};
      const tabs = '<div class="ipo-tabs" role="tablist">' + IPO_TABS.map(([k, l]) => '<a role="tab" class="' + (k === tab ? 'active' : '') + '" href="' + link({ tab: k }) + '">' + l +
        (counts[k] ? ' <span class="ipo-count">' + counts[k] + '</span>' : '') + '</a>').join('') + '</div>';

      const listed = ipoListed(ipo);
      let body = '';
      if (!ipo) body = '<p class="muted">IPO data appears with the daily data update, from NSE\'s issue lists.</p>';
      else if (tab === 'open') {
        const subsCell = x => {
          if (x.x == null) return '<span class="muted">' + (x.start > today ? 'opens ' + d(x.start) : '-') + '</span>';
          const s = x.subs || {};
          const parts = [['QIB', s.qib], ['NII', s.nii], ['Retail', s.rii], ['Employee', s.emp], ['Shareholder', s.sh]].filter(p => p[1] != null);
          const main = '<b class="' + (x.x >= 1 ? 'up' : '') + '">' + num(x.x, x.x < 10 ? 2 : 1) + '×</b>';
          return parts.length ? '<details class="subs"><summary>' + main + '</summary>' + parts.map(p => '<div><span>' + p[0] + '</span><b>' + num(p[1], p[1] < 10 ? 2 : 1) + '×</b></div>').join('') + '</details>' : main;
        };
        const when = x => {
          if (x.start > today) return 'Opens ' + d(x.start) + '<div class="sub">closes ' + d(x.end) + '</div>';
          const left = Math.round((Date.parse(x.end) - Date.parse(today)) / 864e5);
          return d(x.start) + ' – ' + d(x.end) + '<div class="sub ' + (left <= 0 ? 'down' : '') + '">' + (left < 0 ? 'closed' : left === 0 ? 'closes today' : 'closes in ' + left + ' day' + (left > 1 ? 's' : '')) + '</div>';
        };
        const docs = x => [x.note && '<a class="note-link" href="#/ipo/' + encodeURIComponent(x.s) + '">Research note</a>', x.rhp && '<a target="_blank" rel="noopener noreferrer" href="' + esc(x.rhp) + '">RHP</a>', x.ratios && '<a target="_blank" rel="noopener noreferrer" href="' + esc(x.ratios) + '">Basis of price</a>'].filter(Boolean).join(' · ');
        const row = x => '<tr><td class="l ipo-co"><div class="ipo-name">' + (x.note ? '<a href="#/ipo/' + encodeURIComponent(x.s) + '">' + esc(x.n) + '</a>' : esc(x.n)) + '</div><div class="sub">' + badge(x) + (x.lead ? ' · ' + esc(x.lead.split(/,| and /)[0]) : '') + '</div></td><td class="l" data-label="Bidding">' + when(x) + '</td><td data-label="Price band">' +
          (x.band ? '₹' + num(x.band[0], 0) + (x.band[1] !== x.band[0] ? '–' + num(x.band[1], 0) : '') : '<span class="muted">-</span>') + '</td><td data-label="Min. investment">' + (x.min ? '₹' + num(x.min, 0) + '<div class="sub">' + x.lot + ' shares</div>' : '<span class="muted">-</span>') +
          '</td><td data-label="Issue size ₹ Cr">' + (x.size ? num(x.size, x.size < 100 ? 1 : 0) : '<span class="muted">-</span>') + '</td><td data-label="Listing">' + (x.lst ? (x.lst < today ? '<span class="muted">awaited</span>' : d(x.lst)) : '-') + '</td><td data-label="Subscribed">' + subsCell(x) + '</td><td class="l" data-label="Documents">' + (docs(x) || '<span class="muted">-</span>') + '</td></tr>';
        const group = (title, list, note) => list.length ? '<tr class="ipo-group"><td colspan="8">' + title + ' <span class="sub">' + list.length + (note ? ' · ' + note : '') + '</span></td></tr>' + list.map(row).join('') : '';
        const open = (ipo.open || []).filter(boardOk), up = (ipo.upcoming || []).filter(boardOk), closed = (ipo.closed || []).filter(boardOk);
        body = '<div class="flex flex-wrap ipo-filters">' + boardSeg + '</div>' +
          '<div class="stats-row">' + tile('Open now', open.length) + tile('Opening soon', up.length) + tile('Awaiting listing', closed.length) +
          tile('Most subscribed', (() => { const t = open.concat(closed).filter(x => x.x != null).sort((a, b) => b.x - a.x)[0]; return t ? esc(t.n.replace(/ Limited$/i, '')) : '-'; })(),
            (() => { const t = open.concat(closed).filter(x => x.x != null).sort((a, b) => b.x - a.x)[0]; return t ? num(t.x, 1) + '× subscribed' : ''; })()) + '</div>' +
          '<div class="table-wrap"><table class="data list ipo-table"><thead><tr><th class="l">Company</th><th class="l">Bidding</th><th>Price band</th><th>Min. investment</th><th>Issue size ₹ Cr</th><th>Listing</th><th>Subscribed</th><th class="l">Documents</th></tr></thead><tbody>' +
          (group('Open now', open) + group('Opening soon', up) + group('Closed · awaiting listing', closed) || '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No open or upcoming issues right now.</td></tr>') +
          '</tbody></table></div><p class="table-note">Subscription is the number of times the shares on offer were bid for (tap it for QIB, NII and retail). Listing dates are estimated at three working days after the issue closes. Issue size is at the top of the price band. Research notes are read from each red herring prospectus. From NSE, updated with the site data.</p>';
      } else if (tab === 'recent' || tab === 'below') {
        const DAYS = { '3m': 92, '6m': 183, '1y': 366, '3y': 1096 };
        const since = new Date(Date.now() - DAYS[tab === 'below' ? '3y' : period] * 864e5).toISOString().slice(0, 10);
        let list = listed.filter(x => x.ld >= since && boardOk(x));
        if (tab === 'below') list = list.filter(x => x.ret != null && x.ret < 0).sort((a, b) => a.ret - b.ret);
        const rets = list.map(x => x.ret).filter(v => v != null), gains = list.map(x => x.lgain).filter(v => v != null);
        const best = list.filter(x => x.ret != null).sort((a, b) => b.ret - a.ret)[0];
        body = '<div class="flex flex-wrap ipo-filters">' + boardSeg + (tab === 'recent' ? seg([['3m', '3 months'], ['6m', '6 months'], ['1y', '1 year'], ['3y', '3 years']], period, p => link({ period: p })) : '') + '</div>' +
          (tab === 'recent'
            ? '<div class="stats-row">' + tile('Listings', list.length) + tile('Median listing gain', gains.length ? pc(Data.median(gains)) : '-') + tile('Median return since IPO', rets.length ? pc(Data.median(rets)) : '-') +
              tile('Above issue price', rets.length ? Math.round(rets.filter(v => v > 0).length / rets.length * 100) + '%' : '-') + tile('Best', best ? co(best) : '-', best ? pc(best.ret) : '') + '</div>'
            : '<div class="stats-row">' + tile('Below issue price', list.length + ' <span class="sub">of ' + listed.filter(x => x.ld >= since && boardOk(x) && x.ret != null).length + '</span>', 'listed in the last 3 years') + tile('Median fall', rets.length ? pc(Data.median(rets)) : '-') + '</div>') +
          '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Company</th><th>Listed</th><th>Issue price</th><th>Listing day close</th><th>Listing gain</th><th>Price now</th><th>Since IPO</th><th>M.Cap ₹ Cr</th><th>P/E</th><th>ROCE</th><th></th></tr></thead><tbody>' +
          (list.length ? list.map(x => '<tr><td class="l"><div class="ipo-name">' + co(x) + '</div><div class="sub">' + badge(x) + '</div></td><td>' + dy(x.ld) + '</td><td>' + rs(x.ip) + (x.adj ? '<div class="sub" title="Shares were split or bonus shares issued after listing; returns use the adjusted issue price">adj. ' + rs(x.ipAdj) + '</div>' : '') + '</td><td>' + rs(x.first) + '</td><td>' + pc(x.lgain) + '</td><td>' + rs(x.price) + '</td><td>' + pc(x.ret) +
            '</td><td>' + (x.mc ? num(x.mc, 0) : '<span class="muted">-</span>') + '</td><td>' + (x.pe > 0 ? num(x.pe, 1) : '<span class="muted">-</span>') + '</td><td>' + (x.roce != null ? num(x.roce, 1) + '%' : '<span class="muted">-</span>') + '</td><td>' +
            (x.c ? '<button class="btn btn-small btn-plain" data-lcard="' + esc(x.s) + '">↗ Card</button>' : '') + '</td></tr>').join('')
            : '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">' + (tab === 'below' ? 'No recent listing is below its issue price.' : 'No listings in this period.') + '</td></tr>') +
          '</tbody></table></div><p class="table-note">Issue price and listing date from NSE. Listing gain is the first day\'s close against the issue price; "since IPO" is today\'s price against it. P/E and ROCE are from the latest financials.</p>';
      } else {
        const R = (ipo.rights || []).slice().sort((a, b) => ((b.rec || b.ex) < (a.rec || a.ex) ? 1 : -1));
        const up = R.filter(r => (r.rec || r.ex) >= today), past = R.filter(r => (r.rec || r.ex) < today).reverse();
        const row = r => { const c = Data.getCompany(r.s), p = c && c.metrics.price; const disc = p && r.price ? (r.price / p - 1) * 100 : null;
          return '<tr><td class="l">' + co(r) + '</td><td>' + dy(r.rec || r.ex) + '</td><td>' + esc(r.ratio) + '<div class="sub">new for existing</div></td><td>' + rs(r.price) + '</td><td>' + rs(p) + '</td><td>' + (disc == null ? '<span class="muted">-</span>' : disc < 0 ? num(-disc, 1) + '% below market' : num(disc, 1) + '% above market') + '</td><td class="l sub">' + esc(r.subject || '') + '</td></tr>'; };
        body = '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Company</th><th>Record date</th><th>Ratio</th><th>Rights price</th><th>Price now</th><th>Discount</th><th class="l">Details</th></tr></thead><tbody>' +
          (up.length ? '<tr class="ipo-group"><td colspan="7">Upcoming <span class="sub">' + up.length + '</span></td></tr>' + up.map(row).join('') : '') +
          (past.length ? '<tr class="ipo-group"><td colspan="7">Last 30 days <span class="sub">' + past.length + '</span></td></tr>' + past.map(row).join('') : '') +
          (!R.length ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No rights issues announced.</td></tr>' : '') +
          '</tbody></table></div><p class="table-note">From NSE corporate actions. Ratio 2:21 means 2 new shares for every 21 held on the record date. Rights price is face value plus premium; the discount is against today\'s price.</p>';
      }
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>IPOs</h1><p>Open and upcoming issues with live subscription, how recent listings have done, and rights issues, mainboard and SME.' +
        (ipo && ipo.updated ? ' <span class="sub">Updated ' + new Date(ipo.updated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '.</span>' : '') + '</p></div>' +
        '<a class="btn" href="#/studio?kind=listing">↗ Make a post</a></div>' + tabs + body + '</div></div>';
      $$('[data-lcard]').forEach(b => b.onclick = () => openCardModal(['listing', 'snapshot'], () => Data.loadCompany(b.dataset.lcard), b.dataset.lcard));
    });
  }

  /* ---------- IPO research note: one page from the red herring prospectus ---------- */
  function pageIPONote(sym) {
    setTitle(sym + ' IPO research note');
    app.innerHTML = LOADING;
    const token = navToken;
    Promise.all([Data.loadIPO(), Data.loadIPONote(sym)]).then(([ipo, n]) => {
      if (token !== navToken) return;
      const it = ipo ? (ipo.open || []).concat(ipo.upcoming || [], ipo.closed || []).find(x => x.s === sym) || (ipo.past || []).find(x => x.s === sym) : null;
      const name = (n && n.n) || (it && it.n) || sym;
      setTitle(name.replace(/ Limited$/i, '') + ' IPO: research note');
      const back = '<a class="sub" href="#/ipo">← All IPOs</a>';
      if (!n) {
        app.innerHTML = '<div class="container page"><div class="card">' + back + '<h1>' + esc(name) + '</h1><p class="muted">' +
          (it && it.board === 'SME' ? 'Research notes cover mainboard issues; SME issues do not publish their prospectus on NSE in the same way.' : 'The research note for this issue is being prepared from its red herring prospectus. It usually appears within a few hours of the prospectus being filed.') +
          '</p>' + (it && it.rhp ? '<p><a target="_blank" rel="noopener noreferrer" href="' + esc(it.rhp) + '">Red herring prospectus (NSE) ↗</a></p>' : '') + '</div></div>';
        return;
      }
      const pro = Account.isPro();
      const today = new Date().toISOString().slice(0, 10);
      const d = s => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
      const pg = p => (p ? ' <span class="note-pg" title="Page of the red herring prospectus">p.' + p + '</span>' : '');
      const cr = v => (v == null ? '<span class="muted">-</span>' : '₹' + num(v, v < 10 ? 2 : v < 100 ? 1 : 0) + ' Cr');
      const x = v => (v == null ? '<span class="muted">-</span>' : num(v, v < 10 ? 2 : 1) + '×');
      const pct = v => (v == null ? '<span class="muted">-</span>' : num(v, 1) + '%');
      const band = n.band || (it && it.band), upper = band ? band[1] : null;
      const tile = (label, value, sub) => '<div class="stat"><div class="sub">' + label + '</div><b>' + value + '</b>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
      const card = (title, body, cls) => '<div class="ins-card ' + (cls || '') + '"><div class="ins-head"><h3>' + title + '</h3></div>' + body + '</div>';

      // the issue at a glance (from NSE's issue list)
      let when = '';
      if (it && it.start) when = it.start > today ? 'Opens ' + d(it.start) + ', closes ' + d(it.end) : it.end >= today ? 'Bidding ' + d(it.start) + ' – ' + d(it.end) : 'Closed ' + d(it.end) + (it.ld ? ', listed ' + d(it.ld) : it.lst ? ', listing expected ' + d(it.lst) : '');
      const head = '<div class="section-head"><div>' + back + '<h1>' + esc(name) + ' <span class="sub">IPO research note</span></h1><p>' + (it && it.board === 'SME' ? '<span class="sme-badge">SME</span> ' : '<span class="board-tag">Mainboard</span> · ') + esc(when) +
        (n.promoters ? '<br><span class="sub">Promoters: ' + esc(n.promoters.toLowerCase().replace(/\s+,/g, ',').replace(/\b\w/g, c => c.toUpperCase())) + '</span>' : '') + '</p></div>' +
        '<div class="flex flex-wrap">' + (n.rhp ? '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(n.rhp) + '">RHP ↗</a>' : '') + '</div></div>';
      const o = n.offer || {}, v = n.val || {};
      const tiles = '<div class="stats-row">' +
        tile('Price band', band ? '₹' + num(band[0], 0) + (band[1] !== band[0] ? '–' + num(band[1], 0) : '') : '-', it && it.lot ? it.lot + ' shares a lot · ₹' + num(it.min || it.lot * upper, 0) : '') +
        tile('Issue size', cr(o.total || (it && it.size)), o.total ? (o.fresh ? 'fresh ' + cr(o.fresh) : '') + (o.fresh && o.ofs ? ' + ' : '') + (o.ofs ? 'OFS ' + cr(o.ofs) : '') : '') +
        tile('Value at the top of the band', cr(v.mcap), v.ps ? num(v.ps, 1) + '× last year\'s revenue' : '') +
        tile('P/E at the top of the band', v.pe ? num(v.pe, 1) : '<span class="muted">-</span>', v.ind_pe && v.ind_pe.avg ? 'listed peers average ' + num(v.ind_pe.avg, 1) : v.eps_year ? 'on ' + v.eps_year + ' EPS' : '') +
        (it && it.x != null ? tile('Subscribed', num(it.x, it.x < 10 ? 2 : 1) + '×', it.subs && it.subs.rii != null ? [['retail', it.subs.rii], ['QIB', it.subs.qib], ['NII', it.subs.nii]].filter(q => q[1] != null).map(q => q[0] + ' ' + num(q[1], 1) + '×').join(' · ') : '') : '') + '</div>';

      // free: what it does, where the money goes (company vs sellers), the numbers
      const about = n.about && n.about.t ? card('What the company does', '<p>' + esc(n.about.t) + pg(n.about.p) + '</p>' +
        (n.about.long && n.about.long.length > n.about.t.length + 40 ? '<details class="about-more"><summary>More from the prospectus</summary><p>' + esc(n.about.long) + '</p></details>' : ''), 'note-about') : '';
      let split = '';
      if (o.fresh != null || o.ofs != null) {
        const f = o.fresh || 0, s = o.ofs || 0, t = f + s || 1;
        split = card('Who gets the money', '<div class="split-bar"><span class="sb-fresh" style="width:' + (f / t * 100).toFixed(1) + '%"></span><span class="sb-ofs" style="width:' + (s / t * 100).toFixed(1) + '%"></span></div>' +
          '<div class="split-legend"><div><i class="sb-fresh"></i><b>Fresh issue ' + cr(f) + '</b> <span class="sub">' + Math.round(f / t * 100) + '% · new shares; the money goes to the company</span></div>' +
          '<div><i class="sb-ofs"></i><b>Offer for sale ' + cr(s) + '</b> <span class="sub">' + Math.round(s / t * 100) + '% · existing shareholders sell; the money goes to them</span></div></div>' +
          (s === 0 ? '<p class="sub">The whole issue is new shares: no existing shareholder is selling.</p>' : f === 0 ? '<p class="sub">The whole issue is an offer for sale: the company raises no money.</p>' : ''), 'note-split');
      }
      let fin = '';
      const k = n.kpi;
      if (k && k.rev) {
        const rows = [['Revenue', 'rev', cr], ['EBITDA', 'ebitda', cr], ['EBITDA margin', 'ebitda_m', pct], ['Profit after tax', 'pat', cr], ['Profit margin', 'pat_m', pct], ['Return on equity', 'roe', pct], ['ROCE', 'roce', pct], ['Net debt to equity', 'de', x]]
          .filter(r => k[r[1]] && k[r[1]].some(v => v != null));
        const fy = k.periods.map((p, i) => [p, i]).filter(p => /^FY/.test(p[0]));
        const g = (key) => { if (fy.length < 2 || !k[key]) return null; const a = k[key][fy[0][1]], b = k[key][fy[fy.length - 1][1]], yrs = fy.length - 1; return a > 0 && b > 0 ? (Math.pow(a / b, 1 / yrs) - 1) * 100 : null; };
        const rg = g('rev'), pgw = g('pat');
        fin = card('The numbers' + pg(k.p), '<div class="table-wrap"><table class="data"><thead><tr><th class="l"></th>' + k.periods.map(p => '<th>' + esc(p.replace(/^(\w{3}) (\d{4})$/, '$1 $2*')) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr><td class="l">' + r[0] + '</td>' + k[r[1]].map(v => '<td>' + r[2](v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
          (rg != null || pgw != null ? '<p class="sub">' + [rg != null && 'Revenue grew ' + num(rg, 0) + '% a year', pgw != null && 'profit ' + num(pgw, 0) + '% a year'].filter(Boolean).join(', ') + ' over ' + fy[fy.length - 1][0] + '–' + fy[0][0] + '.</p>' : '') +
          (k.periods.some(p => !/^FY/.test(p)) ? '<p class="sub">* Part-year, not annualised.</p>' : ''), 'note-fin');
      }

      // Pro: what sellers paid, use of money, peers, lead managers, risks, contingent liabilities, auditor
      const sellers = (n.sellers || []).filter(s => s.waca != null);
      const sellersCard = sellers.length ? card('What the sellers paid', '<div class="table-wrap"><table class="data"><thead><tr><th class="l">Selling shareholder</th><th>Selling</th><th>Average cost a share</th><th>Top of band vs cost</th></tr></thead><tbody>' +
        sellers.map(s => '<tr><td class="l">' + esc(s.n) + ' <span class="sub">' + esc(s.type) + '</span></td><td>' + cr(s.cr) + '</td><td>₹' + num(s.waca, s.waca < 10 ? 2 : 0) + '</td><td>' + (upper && s.waca > 0.5 ? x(upper / s.waca) : upper && s.waca <= 0.5 ? '<span class="sub">bought near zero (bonus or founder shares)</span>' : '-') + '</td></tr>').join('') +
        '</tbody></table></div><p class="sub">Weighted average cost of acquisition, as stated in the price band advertisement.</p>', 'wide') : '';
      const objs = n.objects && n.objects.list && n.objects.list.length ? card('What the new money is for' + pg(n.objects.p), '<ul class="note-list">' +
        n.objects.list.map(ob => '<li><span>' + esc(ob.t) + '</span><b>' + (ob.cr != null ? cr(ob.cr) : '<span class="muted">rest</span>') + '</b></li>').join('') + '</ul>' +
        (o.fresh ? '<p class="sub">Out of the fresh issue of ' + cr(o.fresh) + ', before issue expenses. The offer for sale money goes to the sellers, not the company.</p>' : '')) : '';
      let peers = '';
      if (n.peers && n.peers.length) {
        const all = Data.listCompanies();
        const key = s => String(s).toLowerCase().replace(/\b(limited|ltd)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
        const rows = n.peers.map(p => { const k2 = key(p); const c = all.find(c => key(c.name) === k2) || all.find(c => key(c.name).indexOf(k2) === 0 || k2.indexOf(key(c.name)) === 0 && key(c.name).length > 6); return { p, c }; });
        const pes = rows.map(r => r.c && r.c.metrics.pe).filter(v => v > 0);
        peers = card('Listed peers (named in the prospectus)', '<div class="table-wrap"><table class="data"><thead><tr><th class="l">Company</th><th>M.Cap ₹ Cr</th><th>P/E</th><th>ROCE</th><th>Sales growth 3Y</th></tr></thead><tbody>' +
          (v.pe ? '<tr class="note-self"><td class="l"><b>' + esc(name.replace(/ Limited$/i, '')) + '</b> <span class="sub">at the top of the band</span></td><td>' + (v.mcap ? num(v.mcap, 0) : '-') + '</td><td>' + num(v.pe, 1) + '</td><td>' + (k && k.roce && k.roce[k.periods.findIndex(p => /^FY/.test(p))] != null ? num(k.roce[k.periods.findIndex(p => /^FY/.test(p))], 1) + '%' : '-') + '</td><td>-</td></tr>' : '') +
          rows.map(r => { const m = r.c ? r.c.metrics : null; return '<tr><td class="l">' + (r.c ? '<a href="#/company/' + encodeURIComponent(r.c.symbol) + '">' + esc(r.c.name) + '</a>' : esc(r.p)) + '</td><td>' + (m && m.marketCap ? num(m.marketCap, 0) : '<span class="muted">-</span>') +
            '</td><td>' + (m && m.pe > 0 ? num(m.pe, 1) : '<span class="muted">-</span>') + '</td><td>' + (m && m.roce != null ? num(m.roce, 1) + '%' : '<span class="muted">-</span>') + '</td><td>' + (m && m.salesGrowth3 != null ? num(m.salesGrowth3, 1) + '%' : '<span class="muted">-</span>') + '</td></tr>'; }).join('') +
          '</tbody></table></div><p class="sub">Peers as named in the prospectus; their P/E, ROCE and growth are today\'s figures from Sankhyas' + (pes.length ? ' (median P/E ' + num(Data.median(pes), 1) + ')' : '') + '.' +
          (v.ind_pe && v.ind_pe.avg ? ' The prospectus puts the peer P/E at ' + (v.ind_pe.lo != null ? num(v.ind_pe.lo, 1) + ' to ' + num(v.ind_pe.hi, 1) + ', average ' : '') + num(v.ind_pe.avg, 1) + '.' : '') + '</p>', 'wide');
      }
      // lead managers: the record NSE's past listings give us, and the one stated in the advertisement
      let brlm = '';
      const leads = leadList(it && it.lead);
      if (leads.length || n.brlm) {
        const listed = ipoListed(ipo).filter(y => y.lead && y.s !== sym);
        const rows = leads.map(l => {
          const kk = leadKey(l), mine = listed.filter(y => leadList(y.lead).some(z => leadKey(z) === kk));
          const g = mine.map(y => y.lgain).filter(v => v != null), r = mine.map(y => y.ret).filter(v => v != null);
          const ad = ((n.brlm && n.brlm.rows) || []).find(b => leadKey(b.n) === kk || leadKey(b.n).indexOf(kk) === 0 || kk.indexOf(leadKey(b.n)) === 0);
          return '<tr><td class="l">' + esc(l) + '</td><td>' + (ad ? ad.total + ' <span class="sub">(' + ad.below + ' below issue price)</span>' : '<span class="muted">-</span>') + '</td><td>' + (mine.length || '<span class="muted">-</span>') + '</td><td>' +
            (g.length ? '<span class="' + signCls(Data.median(g)) + '">' + num(Data.median(g), 1) + '%</span>' : '<span class="muted">-</span>') + '</td><td>' + (r.length ? Math.round(r.filter(v => v > 0).length / r.length * 100) + '%' : '<span class="muted">-</span>') + '</td></tr>';
        });
        brlm = card('Lead managers\' track record', (n.brlm && n.brlm.all ? '<p>The lead managers handled <b>' + n.brlm.all[0] + '</b> public issues in the past three years; <b>' + n.brlm.all[1] + '</b> closed below the issue price on listing day.</p>' : '') +
          (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr><th class="l">Lead manager</th><th>Issues, 3 years (their disclosure)</th><th>Listings we track</th><th>Median listing gain</th><th>Above issue price today</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
            '<p class="sub">"Listings we track" are NSE issues from the last three years with this lead manager; the history fills in over the coming days.</p>' : ''), 'wide');
      }
      const risks = n.risks && n.risks.length ? card('Risks the company lists first', '<ol class="note-risks">' + n.risks.slice(0, 10).map(r => '<li>' + esc(r) + '</li>').join('') + '</ol><p class="sub">In the order the company states them. The prospectus has the full list.</p>') : '';
      const checks = [];
      if (n.contingent && n.contingent.cr != null) {
        const fyRev = k && k.rev ? k.rev[k.periods.findIndex(p => /^FY/.test(p))] : null;
        checks.push('<li><b>Contingent liabilities ' + cr(n.contingent.cr) + '</b>' + pg(n.contingent.p) + (v.mcap && n.contingent.cr ? ' <span class="sub">' + num(n.contingent.cr / v.mcap * 100, 1) + '% of the issue-price value' + (fyRev ? ', ' + num(n.contingent.cr / fyRev * 100, 0) + '% of last year\'s revenue' : '') + '</span>' : '') + '</li>');
      }
      if (n.quals) checks.push('<li><b>Auditor qualifications:</b> ' + (n.quals.t ? esc(n.quals.t) : 'none that were left out of the restated accounts') + pg(n.quals.p) + '</li>');
      if (v.ronw_w != null) checks.push('<li><b>Return on net worth, weighted over three years:</b> ' + num(v.ronw_w, 1) + '%</li>');
      if (v.nav != null && upper) checks.push('<li><b>Book value a share:</b> ₹' + num(v.nav, 2) + ' <span class="sub">the top of the band is ' + num(upper / v.nav, 1) + '× book</span></li>');
      const checksCard = checks.length ? card('Balance sheet and audit', '<ul class="note-checks">' + checks.join('') + '</ul>') : '';

      const locked = [sellersCard, objs, peers, brlm, risks, checksCard].filter(Boolean);
      const lockedHtml = pro ? '<div class="note-grid">' + locked.join('') + '</div>'
        : '<div class="ins-card locked note-lock"><div class="ins-head"><h3>Full research note</h3>' + PRO_TAG + '</div><p class="muted">' +
          ['what the selling shareholders paid for their shares', 'where the new money goes', 'listed peers at today\'s P/E', 'the lead managers\' listing record', 'the risks the company lists first', 'contingent liabilities and auditor remarks'].filter((t, i) => [sellersCard, objs, peers, brlm, risks, checksCard][i]).join(', ').replace(/, ([^,]*)$/, ' and $1') +
          ', each with its page in the prospectus.</p><div class="lock-cta"><span aria-hidden="true">🔒</span> <b>Unlock with Sankhyas Pro</b><div class="sub">From ₹ 208 a month on the yearly plan.</div><a class="btn btn-primary btn-small" href="#/premium">See Pro plans</a></div></div>';

      app.innerHTML = '<div class="container page"><div class="card ipo-note">' + head + tiles +
        '<div class="note-grid">' + about + split + '</div>' + fin + lockedHtml +
        '<p class="table-note">Read from the red herring prospectus (' + n.pages + ' pages) and the price band advertisement filed on NSE, ' + d((n.updated || '').slice(0, 10)) + '. "p." is the page of the PDF. ' +
        'Money is in ₹ crore. This note sets out facts from the offer documents; it is not a recommendation to apply or not. Read the prospectus, especially its risk factors, before you invest.</p></div></div>';
    });
  }

  /* ---------- Results calendar ---------- */
  function pageCalendar(parts, params) {
    setTitle('Results calendar');
    const mine = params.mine === '1';
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadCalendar().then(cal => {
      if (token !== navToken) return;
      const today = new Date().toISOString().slice(0, 10), wl = watchlist();
      let ev = (cal && cal.events) || [];
      if (mine) ev = ev.filter(e => wl.indexOf(e.s) >= 0);
      const up = ev.filter(e => e.d >= today), past = ev.filter(e => e.d < today).reverse();
      const dayLabel = d => {
        const t = new Date(d + 'T00:00:00'), diff = Math.round((t - new Date(today + 'T00:00:00')) / 864e5);
        return (diff === 0 ? 'Today, ' : diff === 1 ? 'Tomorrow, ' : '') + t.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      };
      const gcal = e => 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.n + ': board meeting (' + e.p.join(', ') + ')') +
        '&dates=' + e.d.replace(/-/g, '') + '/' + new Date(Date.parse(e.d) + 864e5).toISOString().slice(0, 10).replace(/-/g, '') + '&details=' + encodeURIComponent('Via Sankhyas. Exchange filing: ' + e.u);
      const group = list => {
        const by = {}, order = [];
        list.forEach(e => { if (!by[e.d]) { by[e.d] = []; order.push(e.d); } by[e.d].push(e); });
        return order.map(d => '<div class="cal-day"><h3>' + esc(dayLabel(d)) + ' <span class="sub">' + by[d].length + '</span></h3><ul class="cal-list">' + by[d].map(e => {
          const known = Data.exists(e.s);
          return '<li><div>' + (known ? '<a href="#/company/' + encodeURIComponent(e.s) + '"><b>' + esc(e.n) + '</b></a>' : '<b>' + esc(e.n) + '</b>') + ' <span class="sub">' + esc(e.s) + '</span></div>' +
            '<div class="cal-tags">' + e.p.map(p => '<span class="mv ' + (p === 'Results' ? 'mv-new' : '') + '">' + esc(p) + '</span>').join('') +
            ' <a class="sub" target="_blank" rel="noopener noreferrer" href="' + esc(e.u) + '">filing ↗</a> <a class="sub" target="_blank" rel="noopener noreferrer" href="' + gcal(e) + '">+ Google Calendar</a></div></li>';
        }).join('') + '</ul></div>').join('');
      };
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Results calendar</h1><p>Board meetings announced to the exchanges for results, dividends and fund raising' +
        (cal ? ' &middot; updated ' + new Date(cal.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '') + '</p></div>' +
        '<div class="flex flex-wrap"><div class="seg"><a class="' + (mine ? '' : 'active') + '" href="#/calendar">All companies</a><a class="' + (mine ? 'active' : '') + '" href="#/calendar?mine=1">My watchlist</a></div>' +
        '<a class="btn" href="#/results/latest">Latest results</a></div></div>' +
        (!cal ? '<p class="muted">The calendar is built from live exchange filings and appears on the live site.</p>'
          : up.length ? group(up) : '<p class="muted">' + (mine ? 'No upcoming board meetings for companies in your watchlist.' : 'No upcoming board meetings announced yet.') + '</p>') +
        (past.length ? '<h2 style="margin-top:28px">Held in the last 7 days</h2>' + group(past) : '') +
        '<p class="table-note">Companies must tell the exchange at least 5 working days before a results board meeting. The list grows as new intimations are filed. Dates can change: check the filing.</p></div></div>';
    });
  }

  /* ---------- Smart money: bulk/block deals and insider disclosures ---------- */
  const proLock = (shown, total, what) => (total > shown ? '<div class="lock-cta" style="margin-top:12px"><span aria-hidden="true">🔒</span> <b>' + (total - shown) + ' more ' + what + ' with Sankhyas Pro</b>' +
    '<div class="sub">From ₹ 208 a month on the yearly plan.</div><a class="btn btn-primary btn-small" href="#/premium">See Pro plans</a></div>' : '');
  function pageDeals(parts, params) {
    setTitle('Smart money');
    const tab = params.tab === 'insider' ? 'insider' : 'deals', days = +(params.days || 30), side = params.side || 'all';
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadActivity().then(act => {
      if (token !== navToken) return;
      const pro = Account.isPro(), limit = pro ? 500 : 5;
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const link = (o) => '#/deals?' + Object.entries(Object.assign({ tab, days, side }, o)).map(([k, v]) => k + '=' + v).join('&');
      const seg = (items, cur, key) => '<div class="seg">' + items.map(([k, l]) => '<a class="' + (String(k) === String(cur) ? 'active' : '') + '" href="' + link({ [key]: k }) + '">' + l + '</a>').join('') + '</div>';
      const co = (sym, name) => Data.exists(sym) ? '<a href="#/company/' + encodeURIComponent(sym) + '">' + esc(name || sym) + '</a>' : esc(name || sym);
      let body = '';
      if (!act) body = '<p class="muted">Deals and insider disclosures appear with the live data. They are built from NSE\'s daily bulk and block deal files and exchange filings.</p>';
      else if (tab === 'deals') {
        const list = act.deals.filter(x => x.d >= since && (side === 'all' || x.side === side));
        const net = {};
        list.forEach(x => { const n = net[x.s] || (net[x.s] = { s: x.s, n: x.n, v: 0, k: 0 }); n.v += x.side === 'B' ? x.v : -x.v; n.k++; });
        const nets = Object.values(net).sort((a, b) => b.v - a.v);
        const top = arr => '<ul class="rank-list">' + arr.map(n => '<li>' + co(n.s, n.n) + '<span class="' + signCls(n.v) + '">' + (n.v >= 0 ? '+' : '−') + '₹ ' + num(Math.abs(n.v), 1) + ' Cr</span></li>').join('') + '</ul>';
        body = (side === 'all' && nets.length ? '<div class="grid grid-2" style="margin-bottom:18px"><div><h3>Net buying</h3>' + top(nets.filter(n => n.v > 0).slice(0, pro ? 10 : 3)) + '</div><div><h3>Net selling</h3>' +
            top(nets.filter(n => n.v < 0).reverse().slice(0, pro ? 10 : 3)) + '</div></div>' : '') +
          '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Date</th><th class="l">Company</th><th class="l">Client</th><th class="l">Type</th><th class="l">Side</th><th>Quantity</th><th>Price ₹</th><th>Value ₹ Cr</th></tr></thead><tbody>' +
          (list.length ? list.slice(0, limit).map(x => '<tr><td class="l">' + docWhen(x.d) + '</td><td class="l">' + co(x.s, x.n) + '</td><td class="l">' + esc(x.c) + '</td><td class="l">' + (x.t === 'block' ? 'Block' : 'Bulk') + '</td><td class="l ' + (x.side === 'B' ? 'up' : 'down') + '">' +
            (x.side === 'B' ? 'Buy' : 'Sell') + '</td><td>' + num(x.q, 0) + '</td><td>' + num(x.p, 2) + '</td><td>' + num(x.v, 2) + '</td></tr>').join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No deals in this period yet. The history builds up from NSE\'s daily files.</td></tr>') +
          '</tbody></table></div>' + proLock(Math.min(limit, list.length), list.length, 'deals');
      } else {
        const list = act.disclosures.filter(x => x.d.slice(0, 10) >= since && (side === 'all' || (side === 'B' ? x.dir === 'buy' : side === 'S' ? x.dir === 'sell' : true)));
        body = '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Date</th><th class="l">Company</th><th class="l">Disclosure</th><th class="l">Action</th><th class="l">Filing</th></tr></thead><tbody>' +
          (list.length ? list.slice(0, limit).map(x => '<tr><td class="l">' + docWhen(x.d) + '</td><td class="l">' + co(x.s, x.n) + '</td><td class="l">' + (x.k === 'insider' ? 'Insider trading (Reg 7)' : 'Takeover / substantial holding') + '</td><td class="l">' +
            (x.dir && DIR[x.dir] ? '<b class="' + DIR[x.dir][1] + '">' + DIR[x.dir][0] + '</b>' : '<span class="muted">see filing</span>') + '</td><td class="l"><a target="_blank" rel="noopener noreferrer" href="' + esc(x.u) + '">Open ↗</a></td></tr>').join('')
            : '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No disclosures in this period.</td></tr>') + '</tbody></table></div>' + proLock(Math.min(limit, list.length), list.length, 'disclosures') +
          '<p class="table-note">Insiders and promoters must disclose trades above set limits under SEBI\'s insider-trading and takeover rules. "Action" is read from the filing and may be blank when it is unclear.</p>';
      }
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Smart money</h1><p>Who is buying and selling: bulk and block deals, and insider and promoter disclosures.' + (act ? ' Updated ' + docWhen(act.updated) + '.' : '') + '</p></div></div>' +
        '<div class="flex flex-wrap" style="gap:12px;margin-bottom:16px">' + seg([['deals', 'Bulk &amp; block deals'], ['insider', 'Insider &amp; promoter']], tab, 'tab') + seg([[7, '1 week'], [30, '1 month'], [90, '3 months'], [365, '1 year']], days, 'days') +
        seg([['all', 'All'], ['B', 'Buys'], ['S', 'Sells']], side, 'side') + '</div>' + body + '</div></div>';
    });
  }

  /* ---------- Order wins ---------- */
  function pageOrders(parts, params) {
    setTitle('Order wins');
    const days = +(params.days || 90), theme = params.theme || '';
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadActivity().then(act => {
      if (token !== navToken) return;
      const pro = Account.isPro(), limit = pro ? 500 : 5;
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const members = theme && Themes.get(theme) ? new Set(Themes.members(Themes.get(theme), Data.listCompanies()).map(c => c.symbol)) : null;
      const list = act ? act.orders.filter(o => o.d >= since && (!members || members.has(o.s))) : [];
      const total = list.reduce((a, o) => a + (o.amt || 0), 0);
      const biggest = list.filter(o => o.amt).sort((a, b) => b.amt - a.amt)[0];
      const byCo = {};
      list.forEach(o => { const x = byCo[o.s] || (byCo[o.s] = { s: o.s, n: o.n, amt: 0, k: 0 }); x.amt += o.amt || 0; x.k++; });
      const leaders = Object.values(byCo).map(x => { const c = Data.getCompany(x.s); return Object.assign(x, { pct: c && c.metrics.sales ? x.amt / c.metrics.sales * 100 : null }); })
        .filter(x => x.amt).sort((a, b) => b.amt - a.amt).slice(0, pro ? 10 : 3);
      const link = o => '#/orders?' + Object.entries(Object.assign({ days, theme }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      const co = (sym, name) => Data.exists(sym) ? '<a href="#/company/' + encodeURIComponent(sym) + '">' + esc(name || sym) + '</a>' : esc(name || sym);
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Order wins</h1><p>Orders and contracts announced to the exchange, with the value stated in the filing.</p></div></div>' +
        '<div class="flex flex-wrap" style="gap:12px;margin-bottom:16px"><div class="seg">' + [[30, '1 month'], [90, '3 months'], [365, '1 year']].map(([k, l]) => '<a class="' + (k === days ? 'active' : '') + '" href="' + link({ days: k }) + '">' + l + '</a>').join('') + '</div>' +
        '<select id="ord-theme" aria-label="Theme" style="width:auto"><option value="">All companies</option>' + Themes.list.map(t => '<option value="' + t.slug + '"' + (t.slug === theme ? ' selected' : '') + '>' + t.icon + ' ' + esc(t.name) + '</option>').join('') + '</select></div>' +
        (!act ? '<p class="muted">Order wins appear with the live data, from exchange filings.</p>'
          : '<div class="stats-row"><div class="stat"><div class="sub">Order wins</div><b>' + list.length + '</b></div><div class="stat"><div class="sub">Value stated</div><b>₹ ' + num(total, 0) + ' Cr</b></div>' +
            '<div class="stat"><div class="sub">Biggest</div><b>' + (biggest ? co(biggest.s, biggest.n) : '-') + '</b>' + (biggest ? '<div class="sub">₹ ' + num(biggest.amt, 0) + ' Cr</div>' : '') + '</div></div>' +
            (leaders.length ? '<h3>Most order value</h3><ul class="rank-list" style="margin-bottom:18px">' + leaders.map(x => '<li>' + co(x.s, x.n) + '<span>₹ ' + num(x.amt, 0) + ' Cr' + (x.pct != null ? ' <span class="sub">(' + num(x.pct, 0) + '% of sales)</span>' : '') + '</span></li>').join('') + '</ul>' : '') +
            '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Date</th><th class="l">Company</th><th>Value ₹ Cr</th><th class="l">From</th><th class="l">Details</th></tr></thead><tbody>' +
            (list.length ? list.slice(0, limit).map(o => '<tr><td class="l">' + docWhen(o.d) + '</td><td class="l">' + co(o.s, o.n) + '</td><td>' + (o.amt ? num(o.amt, o.amt < 10 ? 2 : 0) : '<span class="muted">-</span>') + '</td><td class="l">' + esc(o.cust || '') +
              '</td><td class="l wrap">' + esc((o.desc || '').slice(0, 140)) + ' <a target="_blank" rel="noopener noreferrer" href="' + esc(o.u) + '">filing ↗</a></td></tr>').join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No order wins in this period yet.</td></tr>') +
            '</tbody></table></div>' + proLock(Math.min(limit, list.length), list.length, 'order wins') +
            '<p class="table-note">Read from "bagging/receiving of orders" filings. Values in foreign currency are converted at approximate rates; some filings state no value.</p>') + '</div></div>';
      const sel = $('#ord-theme');
      if (sel) sel.onchange = () => { location.hash = link({ theme: sel.value }); };
    });
  }

  /* ---------- Credit rating changes, market-wide ---------- */
  function pageRatings(parts, params) {
    setTitle('Credit rating changes');
    const view = params.view || 'changes', days = +(params.days || 90);
    app.innerHTML = LOADING;
    const token = navToken;
    Data.loadRatings().then(data => {
      if (token !== navToken) return;
      const pro = Account.isPro(), limit = pro ? 500 : 10;
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const all = data ? data.ratings.filter(r => r.d >= since && !r.sub) : [];
      const isUp = r => r.act === 'upgrade' || r.act === 'outlook_up', isDown = r => r.act === 'downgrade' || r.act === 'outlook_down' || r.act === 'watch';
      const list = all.filter(r => view === 'all' ? true : view === 'up' ? isUp(r) : view === 'down' ? isDown(r) : isUp(r) || isDown(r));
      const link = o => '#/ratings?' + Object.entries(Object.assign({ view, days }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      const co = (sym, name) => Data.exists(sym) ? '<a href="#/company/' + encodeURIComponent(sym) + '">' + esc(name || sym) + '</a>' : esc(name || sym);
      const n = f => all.filter(f).length;
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Credit rating changes</h1><p>Rating actions by CRISIL, ICRA, CARE, India Ratings, Acuite, Infomerics and Brickwork, read from the rating letters companies file with the exchange.</p></div></div>' +
        '<div class="flex flex-wrap" style="gap:12px;margin-bottom:16px"><div class="seg">' + [['changes', 'All changes'], ['up', 'Upgrades'], ['down', 'Downgrades'], ['all', 'Everything']].map(([k, l]) => '<a class="' + (k === view ? 'active' : '') + '" href="' + link({ view: k }) + '">' + l + '</a>').join('') + '</div>' +
        '<div class="seg">' + [[30, '1 month'], [90, '3 months'], [365, '1 year']].map(([k, l]) => '<a class="' + (k === days ? 'active' : '') + '" href="' + link({ days: k }) + '">' + l + '</a>').join('') + '</div></div>' +
        (!data ? '<p class="muted">Rating changes appear with the live data, from exchange filings.</p>'
          : '<div class="stats-row"><div class="stat"><div class="sub">Upgrades</div><b class="up">' + n(isUp) + '</b></div><div class="stat"><div class="sub">Downgrades &amp; watch</div><b class="down">' + n(isDown) + '</b></div>' +
            '<div class="stat"><div class="sub">Reaffirmed</div><b>' + n(r => r.act === 'reaffirm') + '</b></div><div class="stat"><div class="sub">Companies</div><b>' + new Set(all.map(r => r.s)).size + '</b></div></div>' +
            '<div class="table-wrap"><table class="data list"><thead><tr><th class="l">Date</th><th class="l">Company</th><th class="l">Agency</th><th class="l">Rating</th><th class="l">Action</th><th class="l">Instrument</th><th>₹ Cr</th><th></th></tr></thead><tbody>' +
            (list.length ? list.slice(0, limit).map(r => '<tr><td class="l">' + docWhen(r.d) + '</td><td class="l">' + co(r.s, r.n) + '</td><td class="l">' + esc(r.ag || '-') + '</td><td class="l"><b>' + esc(r.rt || '-') + '</b>' +
              (r.ol ? ' <span class="sub">' + esc(r.ol) + '</span>' : '') + (r.from ? '<div class="sub">from ' + esc(r.from) + '</div>' : '') + '</td><td class="l">' + (ratingActHtml(r) || '<span class="muted">-</span>') + '</td><td class="l">' + esc(r.ins || '') + '</td><td>' +
              (r.ramt ? num(r.ramt, 0) : '<span class="muted">-</span>') + '</td><td><a target="_blank" rel="noopener noreferrer" href="' + esc(r.u) + '">letter ↗</a></td></tr>').join('')
              : '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No rating actions of this kind in this period yet.</td></tr>') +
            '</tbody></table></div>' + proLock(Math.min(limit, list.length), list.length, 'rating actions') +
            '<p class="table-note">Ratings of subsidiaries are left out. A rating is an agency\'s view of credit risk, not of the share price; it is not investment advice.</p>') + '</div></div>';
    });
  }

  /* ---------- Research report (print / save as PDF) ---------- */
  function pageReport(parts) {
    const sym = decodeURIComponent(parts[0] || '');
    setTitle('Research report');
    if (!Account.isPro()) {
      app.innerHTML = '<div class="container page"><div class="card" style="max-width:640px;margin:0 auto;text-align:center"><h1>Research PDF ' + PRO_TAG + '</h1><p class="muted">A 2-page branded report with financials, Sankhyas Score, red flags, guidance and the latest concall summary, ready to print or save as PDF.</p>' +
        '<a class="btn btn-primary" href="#/premium">See Pro plans</a> <a class="btn" href="#/company/' + encodeURIComponent(sym) + '">Back to company</a></div></div>';
      return;
    }
    app.innerHTML = LOADING;
    const token = navToken;
    Data.listCompanies();
    Promise.all([Data.loadCompany(sym), Data.loadFilings(sym).catch(() => null), Data.loadActivity().catch(() => null)]).then(([c, f, act]) => {
      if (token !== navToken) return;
      if (!c) return pageNotFound();
      if (f) c._filings = f;
      if (act) c._activity = act;
      setTitle(c.name + ' research report');
      const m = c.metrics, sc = Insights.scoreOf(c.symbol), r = Insights.redFlags(c), g = Insights.guidance(c);
      const lc = ((f && f.announcements) || []).find(a => a.k === 'transcript' && f.notes && f.notes[a.u] && f.notes[a.u].sections);
      const note = lc ? f.notes[lc.u] : null;
      const yrs = c.years.slice(-6), yi = c.years.length - yrs.length;
      const row = (label, arr, d, pct) => '<tr><td class="l">' + label + '</td>' + yrs.map((_, i) => '<td>' + (pct ? num(arr[yi + i], 1) + '%' : num(arr[yi + i], d || 0)) + '</td>').join('') + '</tr>';
      const qs = c.quarters.slice(-5), qi = c.quarters.length - qs.length;
      const qrow = (label, arr, d) => '<tr><td class="l">' + label + '</td>' + qs.map((_, i) => '<td>' + num(arr[qi + i], d || 0) + '</td>').join('') + '</tr>';
      const pc = v => (v == null || !isFinite(v) ? '-' : num(v, 1) + '%');
      const kv = [['Price', '₹ ' + num(m.price, 2)], ['Market cap', '₹ ' + num(m.marketCap, 0) + ' Cr'], ['P/E', num(m.pe, 1)], ['P/B', num(m.pb, 1)], ['ROCE', pc(m.roce)], ['ROE', pc(m.roe)],
        ['Debt / equity', num(m.de, 2)], ['Dividend yield', pc(m.divYield)], ['Sales growth 5Y', pc(m.salesGrowth5)], ['Profit growth 5Y', pc(m.profitGrowth5)], ['1-year return', pc(m.ret1y)], ['Promoters', pc(m.promoter)]];
      const orders = act ? act.orders.filter(o => o.s === c.symbol) : [];
      app.innerHTML = '<div class="container page report"><div class="report-actions no-print"><a class="btn" href="#/company/' + encodeURIComponent(c.symbol) + '">← Back</a><button class="btn btn-primary" id="print-btn">⤓ Save as PDF / Print</button>' +
        '<span class="sub">In the print dialog choose "Save as PDF".</span></div>' +
        '<div class="report-page"><header class="report-head"><div class="logo"><img class="logo-mark" src="assets/logo.svg" alt=""><span>Sankhyas</span></div><div class="sub">Research report · ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></header>' +
        '<h1>' + esc(c.name) + '</h1><p class="sub">' + esc([c.exchange === 'BSE' ? 'BSE: ' + (c.bseCode || c.symbol) : 'NSE: ' + c.symbol, c.sector, c.industry].filter(Boolean).join(' · ')) + '</p>' +
        '<div class="report-top">' + (sc && sc.score != null ? '<div class="report-score">' + scoreRing(sc.score, 90) + '<div><b>Sankhyas Score</b><div>' + Insights.scoreBand(sc.score) + (sc.sectorRank ? ' · #' + sc.sectorRank + ' of ' + sc.sectorSize + ' in sector' : '') + '</div>' +
          '<div class="sub">' + Insights.PILLARS.map(([id, l]) => l + ' ' + (sc.pillars[id] == null ? '-' : sc.pillars[id])).join(' · ') + '</div></div></div>' : '') +
        '<table class="kv">' + kv.map(([k, v], i) => (i % 2 ? '' : '<tr>') + '<th>' + k + '</th><td>' + v + '</td>' + (i % 2 ? '</tr>' : '')).join('') + '</table></div>' +
        (c.about ? '<h2>Business</h2><p>' + esc(c.about.slice(0, 700)) + (c.about.length > 700 ? '…' : '') + '</p>' : '') +
        '<h2>Financials (₹ Cr)</h2><div class="table-wrap report-wrap"><table class="data report-table"><thead><tr><th class="l"></th>' + yrs.map(y => '<th>' + esc(y) + '</th>').join('') + '</tr></thead><tbody>' +
        row('Sales', c.pl.sales) + row('Operating profit', c.pl.op) + row('OPM', c.pl.opm, 1, true) + row('Net profit', c.pl.np) + row('EPS (₹)', c.pl.eps, 2) + row('Operating cash flow', c.cf.cfo) + row('Borrowings', c.bs.borrowings) + '</tbody></table></div>' +
        (qs.length ? '<h2>Recent quarters (₹ Cr)</h2><div class="table-wrap report-wrap"><table class="data report-table"><thead><tr><th class="l"></th>' + qs.map(q => '<th>' + esc(q) + '</th>').join('') + '</tr></thead><tbody>' +
          qrow('Sales', c.q.sales) + qrow('Operating profit', c.q.op) + qrow('Net profit', c.q.np) + qrow('EPS (₹)', c.q.eps, 2) + '</tbody></table></div>' : '') +
        '<div class="report-cols"><div><h2>Red-flag scan: ' + r.score + '/100 (' + r.band + ')</h2>' + (r.flags.length ? '<ul>' + r.flags.slice(0, 6).map(fl => '<li><b>' + esc(fl.title) + '</b>: ' + esc(fl.detail) + '</li>').join('') + '</ul>' : '<p>No warning signs found.</p>') + '</div>' +
        '<div><h2>Management guidance</h2>' + (g.rows.length ? '<ul>' + g.rows.slice(0, 6).map(x => '<li>' + esc(x.label) + ' ' + esc(x.p) + ': ' + esc(x.target) + ' <b>' + esc(x.status) + '</b>' + (x.actual != null ? ' (actual ' + num(x.actual, 1) + '%)' : '') + '</li>').join('') + '</ul>' : '<p class="sub">No numeric guidance extracted yet.</p>') +
        (orders.length ? '<h2>Order wins (12 months)</h2><p>' + orders.length + ' announced' + (orders.some(o => o.amt) ? ', ₹ ' + num(orders.reduce((a, o) => a + (o.amt || 0), 0), 0) + ' Cr stated' : '') + '.</p>' : '') + '</div></div>' +
        (note ? '<h2>Latest concall (' + docWhen(note.d) + ', tone: ' + esc(note.tone) + ')</h2>' + Object.keys(note.sections).slice(0, 4).map(k => '<h3>' + esc(k) + '</h3><ul>' + note.sections[k].slice(0, 2).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>').join('') : '') +
        '<footer class="report-foot">Sankhyas · India\'s AI-Powered Financial Research Terminal · ' + esc('@' + ((Account.config.business || {}).instagram || 'sankhyas.co')) + ' · ' + esc((Account.config.business || {}).email || '') +
        '<br>Data: Yahoo Finance and NSE/BSE filings. For research and education only; not investment advice. Sankhyas is not a SEBI-registered adviser.</footer></div></div>';
      $('#print-btn').onclick = () => window.print();
    }).catch(() => { if (token === navToken) pageNotFound(); });
  }

  /* ---------- Themes ---------- */
  function pageThemes(parts) {
    const all = Data.listCompanies();
    const theme = parts[0] ? Themes.get(parts[0]) : null;
    if (parts[0] && !theme) return pageNotFound();
    const stats = list => ({ n: list.length, mcap: list.reduce((a, c) => a + (c.metrics.marketCap || 0), 0), pe: Data.median(list.map(c => c.metrics.pe)),
      roce: Data.median(list.map(c => c.metrics.roce)), ret: Data.median(list.map(c => c.metrics.ret1y)),
      top: list.filter(c => c.metrics.ret1y != null).sort((a, b) => b.metrics.ret1y - a.metrics.ret1y) });
    if (!theme) {
      setTitle('Theme tracker');
      const rows = Themes.list.map(t => Object.assign({ t }, stats(Themes.members(t, all)))).filter(r => r.n);
      app.innerHTML = '<div class="container page"><div class="section-head"><div><h1>Theme tracker</h1><p class="muted">Follow India\'s big investment themes: who leads, who lags, and what they cost.</p></div>' +
        '<a class="btn" href="#/studio?kind=theme">↗ Make a post</a></div><div class="grid grid-3">' +
        rows.map(r => '<a class="card theme-card" href="#/theme/' + r.t.slug + '"><div class="theme-icon" aria-hidden="true">' + r.t.icon + '</div><h3>' + esc(r.t.name) + '</h3><p class="muted">' + esc(r.t.desc) + '</p>' +
          '<div class="theme-stats"><div><span class="sub">Companies</span><b>' + r.n + '</b></div><div><span class="sub">Median 1Y</span><b class="' + signCls(r.ret) + '">' + num(r.ret, 1) + '%</b></div><div><span class="sub">Median P/E</span><b>' + num(r.pe, 1) + '</b></div></div>' +
          (r.top[0] ? '<div class="sub" style="margin-top:8px">Leader: ' + esc(r.top[0].name) + ' <span class="' + signCls(r.top[0].metrics.ret1y) + '">' + num(r.top[0].metrics.ret1y, 0) + '%</span></div>' : '') + '</a>').join('') +
        '</div>' + (rows.length ? '' : '<p class="muted">Themes appear once company data has loaded.</p>') + '</div>';
      return;
    }
    const list = Themes.members(theme, all), st = stats(list);
    setTitle(theme.name + ' stocks');
    const mini = arr => arr.map(c => '<li><a href="#/company/' + esc(c.symbol) + '">' + esc(c.name) + '</a><span class="' + signCls(c.metrics.ret1y) + '">' + num(c.metrics.ret1y, 1) + '%</span></li>').join('');
    app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>' + theme.icon + ' ' + esc(theme.name) + '</h1><p>' + esc(theme.desc) + ' &middot; <a href="#/themes">All themes</a></p></div>' +
      '<button class="btn" id="theme-share">↗ Share leaderboard</button></div>' +
      '<div class="stats-row"><div class="stat"><div class="sub">Companies</div><b>' + st.n + '</b></div><div class="stat"><div class="sub">Total market cap</div><b>₹ ' + num(st.mcap, 0) + ' Cr</b></div>' +
      '<div class="stat"><div class="sub">Median 1Y return</div><b class="' + signCls(st.ret) + '">' + num(st.ret, 1) + '%</b></div><div class="stat"><div class="sub">Median P/E</div><b>' + num(st.pe, 1) + '</b></div><div class="stat"><div class="sub">Median ROCE</div><b>' + num(st.roce, 1) + '%</b></div></div>' +
      '<div class="grid grid-2" style="margin:8px 0 20px"><div><h3>Leaders (1 year)</h3><ul class="rank-list">' + mini(st.top.slice(0, 5)) + '</ul></div><div><h3>Laggards (1 year)</h3><ul class="rank-list">' + mini(st.top.slice(-5).reverse()) + '</ul></div></div>' +
      '<div id="theme-list"></div></div></div>';
    sortableList($('#theme-list'), list, ['price', 'marketCap', 'pe', 'roce', 'ret1y', 'qtrSalesVar', 'qtrProfitVar'], { median: true, sortKey: 'marketCap' });
    $('#theme-share').onclick = () => openCardModal(['theme'], () => Promise.resolve({ theme, list }), theme.slug);
  }

  /* ---------- Social post studio ---------- */
  function pageStudio(parts, params) {
    setTitle('Social post studio');
    const kinds = Object.keys(Cards.kinds);
    const kind0 = kinds.indexOf(params.kind) >= 0 ? params.kind : 'results';
    const all = Data.listCompanies();
    const recentListings = all.filter(c => c.listed && c.listPrice != null).sort((a, b) => b.listed.localeCompare(a.listed)).slice(0, 12);
    app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Social post studio</h1><p>Turn Sankhyas data into ready-to-post images and captions for Instagram, X, LinkedIn and WhatsApp. Every card carries the Sankhyas brand and ' +
      esc('@' + ((Account.config.business || {}).instagram || 'sankhyas.co')) + '.</p></div></div>' +
      '<div class="studio-grid"><div class="studio-form">' +
      '<div class="field"><label for="st-kind">Template</label><select id="st-kind">' + kinds.map(k => '<option value="' + k + '"' + (k === kind0 ? ' selected' : '') + '>' + esc(Cards.kinds[k]) + '</option>').join('') + '</select></div>' +
      '<div class="field" id="st-co-wrap"><label for="st-co">Company</label><div class="search-wrap"><input id="st-co" type="search" placeholder="Search a company" autocomplete="off"></div>' +
      (recentListings.length ? '<div class="sub" id="st-recent" style="margin-top:6px">Recent listings: ' + recentListings.slice(0, 6).map(c => '<a href="" data-pick="' + esc(c.symbol) + '">' + esc(c.symbol) + '</a>').join(', ') + '</div>' : '') + '</div>' +
      '<div class="field" id="st-theme-wrap" hidden><label for="st-theme">Theme</label><select id="st-theme">' + Themes.list.map(t => '<option value="' + t.slug + '">' + t.icon + ' ' + esc(t.name) + '</option>').join('') + '</select></div>' +
      '<button class="btn btn-primary" id="st-make">Create post</button>' +
      '<p class="table-note">Tip: post results cards on results day, red-flag scans for trending stocks, and theme leaderboards weekly. Automatic posting to Instagram needs a Meta business app and can be added later.</p></div>' +
      '<div class="studio-help"><h3>What you get</h3><ul class="feat-list"><li>A 1080×1080 feed image or a 1080×1920 story</li><li>A caption with key numbers, hashtags and a disclaimer</li><li>Download, copy, or share straight to apps on your phone</li></ul></div></div></div></div>';
    let picked = null;
    const sync = () => { const k = $('#st-kind').value; $('#st-theme-wrap').hidden = k !== 'theme'; $('#st-co-wrap').hidden = k === 'theme'; };
    $('#st-kind').onchange = sync; sync();
    attachSearch($('#st-co'), c => { picked = c; $('#st-co').value = c.name; }, { keepValue: true, footer: false });
    $$('[data-pick]').forEach(a => a.onclick = e => { e.preventDefault(); picked = Data.getCompany(a.dataset.pick); $('#st-co').value = picked ? picked.name : ''; if ($('#st-kind').value !== 'listing') { $('#st-kind').value = 'listing'; sync(); } });
    if (params.s && Data.exists(params.s)) { picked = Data.getCompany(params.s); $('#st-co').value = picked.name; }
    $('#st-make').onclick = () => {
      const k = $('#st-kind').value;
      if (k === 'theme') {
        const t = Themes.get($('#st-theme').value);
        return openCardModal(['theme'], () => Promise.resolve({ theme: t, list: Themes.members(t, all) }), t.slug);
      }
      if (!picked) { toast('Pick a company first'); $('#st-co').focus(); return; }
      if (k === 'listing' && !picked.listed) { toast('No listing data for ' + picked.name + ' (only companies listed in the last 5 years)'); return; }
      openCardModal([k], () => Data.loadCompany(picked.symbol), picked.symbol);
    };
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
    if (Account.cloud && !user()) {
      app.innerHTML = loginGate('Your watchlist', 'Login to follow companies and see their prices, results and ratios in one list, synced on every device.', '#/watchlist');
      socialButtons($('#gate-social'), '#/watchlist', 'Login');
      return;
    }
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

  /* ---------- Portfolio X-ray ----------
     Holdings are [{ s: symbol, q: quantity, p: average buy price }] kept in the 'portfolio' store
     (synced across devices when logged in). The X-ray part is a Pro feature. */
  const portfolio = () => store.get('portfolio', []);
  const CSV_COLS = {
    sym: /^(instrument|symbol|trading ?symbol|tradingsymbol|scrip( name| code)?|stock( name)?|company( name)?|security( name)?|name)$/i,
    isin: /^isin/i,
    qty: /^(qty\.?|quantity( available)?|total quantity|shares|holding|no\.? of shares|units)$/i,
    avg: /^(avg\.? ?(cost|price)|average ?(buy )?(price|cost)|buy (avg|average)( price)?|avg\.? buy price|cost price|purchase price)$/i
  };
  function splitCSVLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if ((ch === ',' || ch === '\t' || ch === ';') && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  /** Broker holdings export (Zerodha, Groww, Upstox, Angel, ICICI...) -> holdings + names we could not match. */
  function parseHoldingsCSV(text, all) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    let hi = lines.findIndex(l => { const cells = splitCSVLine(l); return cells.some(c => CSV_COLS.qty.test(c)) && cells.some(c => CSV_COLS.sym.test(c) || CSV_COLS.isin.test(c)); });
    if (hi < 0) return { error: 'Could not find the header row. The file needs a symbol (or ISIN) column and a quantity column.' };
    const head = splitCSVLine(lines[hi]);
    const col = k => head.findIndex(h => CSV_COLS[k].test(h));
    const ci = { sym: col('sym'), isin: col('isin'), qty: col('qty'), avg: col('avg') };
    const byIsin = {}, bySym = {};
    all.forEach(c => { if (c.isin) byIsin[c.isin.toUpperCase()] = c; bySym[c.symbol.toUpperCase()] = c; });
    const holdings = [], missed = [];
    lines.slice(hi + 1).forEach(l => {
      const cells = splitCSVLine(l);
      const q = parseFloat(String(cells[ci.qty] || '').replace(/,/g, ''));
      if (!(q > 0)) return;
      const raw = ci.sym >= 0 ? (cells[ci.sym] || '').replace(/-(EQ|BE|SM|ST|BZ)$/i, '').trim() : '';
      let c = (ci.isin >= 0 && byIsin[(cells[ci.isin] || '').toUpperCase()]) || bySym[raw.toUpperCase()];
      if (!c && raw) { const hit = Data.search(raw, 1)[0]; if (hit && hit.name.toLowerCase().indexOf(raw.toLowerCase().split(/\s+/)[0]) === 0) c = hit; }
      if (!c) { if (raw) missed.push(raw); return; }
      const avg = ci.avg >= 0 ? parseFloat(String(cells[ci.avg] || '').replace(/[,₹\s]/g, '')) : NaN;
      holdings.push({ s: c.symbol, q, p: isFinite(avg) && avg > 0 ? avg : null });
    });
    return { holdings, missed };
  }
  const CAP_BANDS = [['Large cap', 90000], ['Mid cap', 30000], ['Small cap', 0]];
  function xray(rows) {
    const total = rows.reduce((a, r) => a + r.value, 0) || 1;
    const w = r => r.value / total;
    const wavg = key => {
      let sw = 0, sv = 0;
      rows.forEach(r => { const v = r.c.metrics[key]; if (v != null && isFinite(v)) { sw += w(r); sv += w(r) * v; } });
      return sw >= 0.5 ? sv / sw : null;
    };
    // portfolio P/E = value / earnings: harmonic weighting, loss makers excluded
    let ey = 0, eyw = 0;
    rows.forEach(r => { const pe = r.c.metrics.pe; if (pe > 0) { ey += w(r) / pe; eyw += w(r); } });
    const sectors = {}, caps = {};
    rows.forEach(r => {
      sectors[r.c.sector || 'Others'] = (sectors[r.c.sector || 'Others'] || 0) + w(r) * 100;
      const band = r.c.sme ? 'SME' : CAP_BANDS.find(b => (r.c.metrics.marketCap || 0) >= b[1])[0];
      caps[band] = (caps[band] || 0) + w(r) * 100;
    });
    const sorted = rows.slice().sort((a, b) => b.value - a.value);
    const hhi = rows.reduce((a, r) => a + w(r) * w(r), 0);
    return {
      pe: eyw > 0.5 ? eyw / ey : null, roce: wavg('roce'), roe: wavg('roe'), divYield: wavg('divYield'), de: wavg('de'), ret1y: wavg('ret1y'),
      score: wavg('sankhyasScore'), risk: wavg('riskScore'), salesGrowth3: wavg('salesGrowth3'),
      sectors: Object.entries(sectors).sort((a, b) => b[1] - a[1]), caps: Object.entries(caps).sort((a, b) => b[1] - a[1]),
      top1: sorted[0] ? w(sorted[0]) * 100 : 0, top5: sorted.slice(0, 5).reduce((a, r) => a + w(r) * 100, 0), effective: hhi ? 1 / hhi : 0,
      flagged: rows.filter(r => (r.c.metrics.riskScore || 0) >= 45), lowScore: rows.filter(r => r.c.metrics.sankhyasScore != null && r.c.metrics.sankhyasScore < 40)
    };
  }
  function xrayNotes(x, rows) {
    const n = [];
    if (x.top1 > 25) n.push(['warn', 'Your largest holding is ' + num(x.top1, 0) + '% of the portfolio. A single bad result can hurt a lot.']);
    if (x.sectors[0] && x.sectors[0][1] > 40) n.push(['warn', num(x.sectors[0][1], 0) + '% sits in one sector (' + x.sectors[0][0] + ').']);
    if (rows.length >= 25 && x.effective > 20) n.push(['info', 'With ' + rows.length + ' stocks, the portfolio behaves like an index fund. Consider fewer, higher-conviction holdings.']);
    if (x.effective && x.effective < 5 && rows.length >= 3) n.push(['info', 'Effectively ' + num(x.effective, 1) + ' stocks after weighting: quite concentrated.']);
    if (x.flagged.length) n.push(['bad', x.flagged.length + ' holding' + (x.flagged.length > 1 ? 's have' : ' has') + ' a high red-flag score: ' + x.flagged.map(r => r.c.symbol).join(', ') + '.']);
    if (x.de != null && x.de > 1) n.push(['warn', 'Weighted debt to equity is ' + num(x.de, 2) + ': the portfolio leans on leveraged companies.']);
    if (x.roce != null && x.roce >= 18) n.push(['good', 'Weighted ROCE of ' + num(x.roce, 0) + '%: good quality businesses on average.']);
    if (x.pe != null && x.pe > 45) n.push(['warn', 'Portfolio P/E of ' + num(x.pe, 0) + ' is rich; returns depend on growth staying high.']);
    const sme = (x.caps.find(c => c[0] === 'SME') || [0, 0])[1], small = (x.caps.find(c => c[0] === 'Small cap') || [0, 0])[1];
    if (sme + small > 50) n.push(['warn', num(sme + small, 0) + '% in small caps and SME stocks: expect bigger swings and lower liquidity.']);
    if (!n.length) n.push(['good', 'Nothing stands out: diversified, with no high red-flag holdings.']);
    return n;
  }
  function barList(entries) {
    return '<div class="bar-list">' + entries.map(e => '<div class="bar-row"><span class="bar-label">' + esc(e[0]) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + Math.max(1, Math.min(100, e[1])).toFixed(1) + '%"></span></span><b>' + num(e[1], 1) + '%</b></div>').join('') + '</div>';
  }
  function pagePortfolio() {
    setTitle('Portfolio X-ray');
    if (Account.cloud && !user()) {
      app.innerHTML = loginGate('Portfolio X-ray', 'Login to add your holdings or import your broker CSV, and see your portfolio\'s sectors, concentration, combined P/E and red flags.', '#/portfolio');
      socialButtons($('#gate-social'), '#/portfolio', 'Login');
      return;
    }
    const all = Data.listCompanies();
    const draw = () => {
      const hold = portfolio();
      const rows = hold.map(h => {
        const c = Data.getCompany(h.s);
        if (!c || !c.metrics) return null;
        const price = c.metrics.price, value = price * h.q, cost = h.p ? h.p * h.q : null;
        return { h, c, price, value, cost, pnl: cost != null ? value - cost : null, day: c.metrics.changePct != null ? value - value / (1 + c.metrics.changePct / 100) : 0 };
      }).filter(Boolean);
      const total = rows.reduce((a, r) => a + r.value, 0), invested = rows.filter(r => r.cost != null).reduce((a, r) => a + r.cost, 0);
      const pnl = rows.filter(r => r.cost != null).reduce((a, r) => a + r.pnl, 0), day = rows.reduce((a, r) => a + r.day, 0);
      const rupees = v => '₹ ' + num(v, 0);
      const x = rows.length ? xray(rows) : null, open = Account.isPro();
      app.innerHTML = '<div class="container page"><div class="card"><div class="section-head"><div><h1>Portfolio X-ray</h1><p>' + rows.length + ' holdings' +
        (user() && Account.canSync() ? ' &middot; synced to your account' : user() ? '' : ' &middot; saved in this browser. <a href="#/login?next=%23%2Fportfolio">Log in</a> to sync across devices') + '</p></div>' +
        '<div class="head-actions"><label class="btn btn-small" for="pf-file">⤒ Import broker CSV</label><input type="file" id="pf-file" accept=".csv,.txt,text/csv" hidden>' +
        (rows.length ? '<button class="btn btn-small" id="pf-export">⤓ Export</button><button class="btn btn-small btn-plain" id="pf-clear">Clear all</button>' : '') + '</div></div>' +
        '<form id="pf-add" class="pf-add"><div class="nav-search"><svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="pf-search" placeholder="Company" autocomplete="off"></div>' +
        '<input type="number" id="pf-qty" min="0" step="any" placeholder="Quantity" required><input type="number" id="pf-avg" min="0" step="any" placeholder="Avg buy price (optional)"><button class="btn btn-primary" type="submit">Add</button></form>' +
        '<div id="pf-msg"></div>' +
        (rows.length ? '<div class="stats-row"><div class="stat"><div class="sub">Current value</div><b>' + rupees(total) + '</b></div>' +
          (invested ? '<div class="stat"><div class="sub">Invested</div><b>' + rupees(invested) + '</b></div><div class="stat"><div class="sub">Total P&amp;L</div><b class="' + signCls(pnl) + '">' + (pnl >= 0 ? '+' : '−') + rupees(Math.abs(pnl)) + ' (' + num(pnl / invested * 100, 1) + '%)</b></div>' : '') +
          '<div class="stat"><div class="sub">Today</div><b class="' + signCls(day) + '">' + (day >= 0 ? '+' : '−') + rupees(Math.abs(day)) + '</b></div></div>'
          : '<div class="info-box">Add your holdings above, or import the holdings CSV from your broker (Zerodha Console, Groww, Upstox, Angel One, ICICI Direct and most others work). Nothing leaves your device unless you are logged in, when it syncs to your account.</div>') +
        '</div>' +
        (x ? (open ? '<div class="xray-grid">' +
          '<div class="card"><h3>What the X-ray sees</h3><ul class="xray-notes">' + xrayNotes(x, rows).map(n => '<li class="' + n[0] + '">' + esc(n[1]) + '</li>').join('') + '</ul></div>' +
          '<div class="card"><h3>Portfolio as one company ' + PRO_TAG + '</h3><div class="stats-row mini">' +
            [['P/E', x.pe, 1, ''], ['ROCE', x.roce, 1, '%'], ['ROE', x.roe, 1, '%'], ['Div. yield', x.divYield, 2, '%'], ['Debt / equity', x.de, 2, ''], ['Sales growth 3Y', x.salesGrowth3, 1, '%'], ['1Y return', x.ret1y, 1, '%'], ['Sankhyas Score', x.score, 0, ''], ['Red-flag score', x.risk, 0, '']]
              .map(m => '<div class="stat"><div class="sub">' + m[0] + '</div><b>' + (m[1] == null ? '-' : num(m[1], m[2]) + m[3]) + '</b></div>').join('') +
          '</div><p class="table-note">Value-weighted averages of your holdings. P/E is total value over total earnings (loss makers left out).</p></div>' +
          '<div class="card"><h3>Sectors</h3>' + barList(x.sectors.slice(0, 10)) + '</div>' +
          '<div class="card"><h3>Size &amp; concentration</h3>' + barList(x.caps) +
            '<div class="stats-row mini" style="margin-top:12px"><div class="stat"><div class="sub">Largest holding</div><b>' + num(x.top1, 1) + '%</b></div><div class="stat"><div class="sub">Top 5</div><b>' + num(x.top5, 1) + '%</b></div><div class="stat"><div class="sub">Effective no. of stocks</div><b>' + num(x.effective, 1) + '</b></div></div></div>' +
          '</div>' : '<div style="margin-top:16px">' + lockedCard('xray-lock', 'Portfolio X-ray', '<p class="muted">Sector and size mix, concentration, the portfolio\'s combined P/E, ROCE and debt, and holdings with red flags.</p>') + '</div>') : '') +
        (rows.length ? '<div class="card" style="margin-top:16px"><h3>Holdings</h3><div class="table-wrap"><table class="data"><thead><tr><th class="l">Company</th><th>Qty</th><th>Avg price</th><th>CMP</th><th>Value</th><th>Weight</th><th>P&amp;L %</th><th>Score</th><th>Red flags</th><th></th></tr></thead><tbody>' +
          rows.sort((a, b) => b.value - a.value).map(r => {
            const m = r.c.metrics, pl = r.cost ? (r.value / r.cost - 1) * 100 : null;
            return '<tr><td class="l"><a href="#/company/' + encodeURIComponent(r.c.symbol) + '">' + esc(r.c.name) + '</a><div class="sub">' + esc(r.c.sector || '') + '</div></td><td>' + num(r.h.q, 0) + '</td><td>' + (r.h.p ? num(r.h.p, 2) : '-') + '</td><td>' + num(r.price, 2) + '</td><td>' + num(r.value, 0) +
              '</td><td>' + num(r.value / total * 100, 1) + '%</td><td class="' + signCls(pl) + '">' + (pl == null ? '-' : num(pl, 1)) + '</td><td>' + (m.sankhyasScore == null ? '-' : num(m.sankhyasScore, 0)) + '</td><td class="' + ((m.riskScore || 0) >= 45 ? 'down' : '') + '">' + (m.riskScore == null ? '-' : num(m.riskScore, 0)) +
              '</td><td><button class="btn btn-plain btn-small" data-rm="' + esc(r.c.symbol) + '" aria-label="Remove">✕</button></td></tr>';
          }).join('') + '</tbody></table></div></div>' : '') + '</div>';

      let picked = null;
      attachSearch($('#pf-search'), c => { picked = c; $('#pf-search').value = c.name; $('#pf-qty').focus(); }, { keepValue: true, footer: false });
      $('#pf-add').onsubmit = e => {
        e.preventDefault();
        const q = parseFloat($('#pf-qty').value), p = parseFloat($('#pf-avg').value);
        if (!picked) { $('#pf-msg').innerHTML = errBox('Pick a company from the list.'); return; }
        if (!(q > 0)) return;
        const list = portfolio(), ex = list.find(h => h.s === picked.symbol);
        if (ex) { const cost = (ex.p || 0) * ex.q + (p > 0 ? p : 0) * q; ex.q += q; ex.p = ex.p && p > 0 ? cost / ex.q : ex.p || (p > 0 ? p : null); }
        else list.push({ s: picked.symbol, q, p: p > 0 ? p : null });
        store.set('portfolio', list);
        draw();
      };
      $('#pf-file').onchange = () => {
        const f = $('#pf-file').files[0];
        if (!f) return;
        f.text().then(t => {
          const r = parseHoldingsCSV(t, all);
          if (r.error) { $('#pf-msg').innerHTML = errBox(r.error); return; }
          if (!r.holdings.length) { $('#pf-msg').innerHTML = errBox('No holdings found in this file.'); return; }
          const replace = !portfolio().length || confirm('Replace your current holdings with the ' + r.holdings.length + ' in this file? Cancel adds them instead.');
          const list = replace ? [] : portfolio();
          r.holdings.forEach(h => { const ex = list.find(x => x.s === h.s); if (ex) { ex.q += h.q; } else list.push(h); });
          store.set('portfolio', list);
          draw();
          $('#pf-msg').innerHTML = okBox('Imported ' + r.holdings.length + ' holdings.' + (r.missed.length ? ' Not matched: ' + esc(r.missed.slice(0, 12).join(', ')) + (r.missed.length > 12 ? '…' : '') + '. Add them by hand.' : ''));
        });
      };
      $$('[data-rm]').forEach(b => b.onclick = () => { store.set('portfolio', portfolio().filter(h => h.s !== b.dataset.rm)); draw(); });
      if ($('#pf-clear')) $('#pf-clear').onclick = () => { if (confirm('Remove all holdings?')) { store.set('portfolio', []); draw(); } };
      if ($('#pf-export')) $('#pf-export').onclick = () => downloadCSV('sankhyas-portfolio.csv', [['Symbol', 'Quantity', 'Avg price', 'CMP', 'Value']].concat(rows.map(r => [r.c.symbol, r.h.q, r.h.p || '', r.price, Math.round(r.value)])));
    };
    draw();
  }

  /* ---------- Alerts: email, Telegram, WhatsApp ----------
     Rules live in public.alerts; the dispatch-alerts Edge Function checks them after every data
     refresh and sends each event once (public.alert_log). */
  const ALERT_KINDS = [
    ['results', 'Quarterly results announced', 'company'],
    ['red_flags', 'Red-flag score changes', 'company'],
    ['insider_buy', 'Promoter / insider buying', 'company'],
    ['order_win', 'New order wins', 'company'],
    ['rating_change', 'Credit rating upgraded or downgraded', 'company'],
    ['bulk_deal', 'Bulk or block deals', 'company'],
    ['concall', 'Concall transcript or presentation filed', 'company'],
    ['price_above', 'Price rises above', 'price'],
    ['price_below', 'Price falls below', 'price'],
    ['screen', 'New companies match a screen', 'screen']
  ];
  const CHANNELS = [['email', 'Email'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp']];
  function alertLabel(a) {
    const k = ALERT_KINDS.find(x => x[0] === a.kind) || [a.kind, a.kind];
    const who = a.kind === 'screen' ? 'screen “' + (a.params.name || a.params.query || '') + '”' : a.symbol ? a.symbol : a.params.scope === 'watchlist' ? 'all watchlist companies' : 'any company';
    return k[1] + (a.kind.indexOf('price_') === 0 ? ' ₹ ' + num(a.params.price, 2) : '') + ' · ' + who;
  }
  function pageAlerts(parts, params) {
    setTitle('Alerts');
    const u = user(), cfg = Account.config;
    const shell = body => { app.innerHTML = '<div class="container page"><div class="card" style="max-width:860px;margin:0 auto"><div class="section-head"><div><h1>Alerts ' + PRO_TAG + '</h1><p>Results, red-flag changes, insider buying, order wins and screen matches, sent to you by email, Telegram or WhatsApp.</p></div></div>' + body + '</div></div>'; };
    if (!Account.cloud) return shell('<div class="info-box">Alerts need Sankhyas accounts, which are not switched on for this site.</div>');
    if (!u) {
      app.innerHTML = loginGate('Alerts', 'Login to get results, red-flag changes, insider buying and order wins for the companies you follow, by email, Telegram or WhatsApp.', '#/alerts');
      socialButtons($('#gate-social'), '#/alerts', 'Login');
      return;
    }
    if (!Account.isPro()) return shell(lockedCard('alerts-lock', 'Alerts', '<p class="muted">Get told the moment results, red flags, insider buying or order wins land for the companies you follow.</p>'));
    const prof = Account.profile() || {};
    const screens = store.get('screens', []);
    const tgOn = !!prof.telegram_chat_id;
    shell(
      '<h3>Where to send alerts</h3><div class="channel-grid">' +
      '<div class="channel"><div><b>✉ Email</b><div class="sub">' + esc(u.email) + '</div></div><label class="switch"><input type="checkbox" id="ch-email"' + (prof.email_alerts !== false ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="channel"><div><b>✈ Telegram</b><div class="sub">' + (tgOn ? 'Connected' : cfg.telegramBot ? 'Not connected' : 'Coming soon') + '</div></div>' +
        (tgOn ? '<button class="btn btn-small" id="tg-unlink">Disconnect</button>' : cfg.telegramBot ? '<button class="btn btn-small btn-primary" id="tg-link">Connect</button>' : '') + '</div>' +
      '<div class="channel channel-wa"><div><b>🟢 WhatsApp</b><div class="sub">' + (cfg.whatsappAlerts ? (prof.whatsapp_opt_in && prof.whatsapp_number ? 'On for +' + esc(prof.whatsapp_number) : 'Off') : 'Save your number now; sending starts soon') + '</div></div>' +
        '<form id="wa-form" class="wa-form"><input type="tel" id="wa-num" inputmode="tel" placeholder="91 98xxxxxxxx" value="' + esc(prof.whatsapp_number || '') + '"><label class="check-line"><input type="checkbox" id="wa-opt"' + (prof.whatsapp_opt_in ? ' checked' : '') + '> I agree to get alerts on WhatsApp</label><button class="btn btn-small" type="submit">Save</button></form></div>' +
      '</div><div id="ch-msg"></div>' +
      '<h3>Quick start</h3><p class="sub">One click alerts for every company in your watchlist (' + watchlist().length + (watchlist().length === 1 ? ' company' : ' companies') + '; alerts follow the list as it changes).</p>' +
      '<div class="flex flex-wrap" id="quick">' + ['results', 'red_flags', 'insider_buy', 'order_win'].map(k => '<button class="btn btn-small" data-quick="' + k + '">+ ' + ALERT_KINDS.find(x => x[0] === k)[1] + '</button>').join('') + '</div>' +
      '<h3>New alert</h3><form id="al-form" class="al-form">' +
      '<label>When<select id="al-kind">' + ALERT_KINDS.map(k => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>' +
      '<label id="al-scope-wrap">For<select id="al-scope"><option value="company">One company</option><option value="watchlist">My watchlist</option></select></label>' +
      '<label id="al-co-wrap">Company<div class="nav-search"><input type="search" id="al-co" placeholder="Search company" autocomplete="off"></div></label>' +
      '<label id="al-price-wrap" hidden>Price (₹)<input type="number" id="al-price" min="0" step="any"></label>' +
      '<label id="al-screen-wrap" hidden>Screen<select id="al-screen">' + (screens.length ? screens.map((x, i) => '<option value="' + i + '">' + esc(x.name) + '</option>').join('') : '<option value="">No saved screens yet</option>') + '</select></label>' +
      '<div class="al-ch">Send by ' + CHANNELS.map(c => '<label class="check-line"><input type="checkbox" name="al-ch" value="' + c[0] + '"' + (c[0] === 'email' || (c[0] === 'telegram' && tgOn) ? ' checked' : '') + '> ' + c[1] + '</label>').join(' ') + '</div>' +
      '<button class="btn btn-primary" type="submit">Create alert</button></form><div id="al-msg"></div>' +
      '<h3>Your alerts</h3><div id="al-list" class="muted">Loading…</div>' +
      '<h3>Recently sent</h3><div id="al-log" class="muted">Loading…</div>' +
      '<p class="table-note">Alerts are checked after every data refresh (about every 2 hours during market days). Screen alerts tell you about companies that newly match. Not investment advice.</p>'
    );
    const msg = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
    $('#ch-email').onchange = async e => { const r = await Account.updateProfile({ email_alerts: e.target.checked }); msg('#ch-msg', r.error ? errBox(r.error) : ''); toast(e.target.checked ? 'Email alerts on' : 'Email alerts off'); };
    if ($('#tg-link')) $('#tg-link').onclick = async () => {
      const r = await Account.alerts.telegramLink();
      if (r.error) return msg('#ch-msg', errBox(r.error));
      window.open('https://t.me/' + encodeURIComponent(cfg.telegramBot) + '?start=' + r.token, '_blank', 'noopener');
      msg('#ch-msg', okBox('Telegram opened. Press <b>Start</b> in the chat with @' + esc(cfg.telegramBot) + ', then <a href="" id="tg-refresh">refresh this page</a>.'));
      $('#tg-refresh').onclick = e => { e.preventDefault(); Account.refresh().then(() => pageAlerts()); };
    };
    if ($('#tg-unlink')) $('#tg-unlink').onclick = async () => { await Account.alerts.unlinkTelegram(); pageAlerts(); };
    $('#wa-form').onsubmit = async e => {
      e.preventDefault();
      const n = $('#wa-num').value.replace(/[^\d]/g, ''), opt = $('#wa-opt').checked;
      if (n && !/^\d{10,15}$/.test(n)) return msg('#ch-msg', errBox('Enter the number with country code, e.g. 91 98765 43210.'));
      const full = n.length === 10 ? '91' + n : n;
      const r = await Account.updateProfile({ whatsapp_number: full || null, whatsapp_opt_in: !!(full && opt) });
      msg('#ch-msg', r.error ? errBox(r.error) : okBox('WhatsApp settings saved.'));
    };
    const channels = () => $$('input[name=al-ch]:checked').map(x => x.value);
    let picked = params && params.s && Data.exists(params.s.toUpperCase()) ? Data.getCompany(params.s.toUpperCase()) : null;
    if (picked) $('#al-co').value = picked.name + ' (' + picked.symbol + ')';
    attachSearch($('#al-co'), c => { picked = c; $('#al-co').value = c.name + ' (' + c.symbol + ')'; }, { keepValue: true, footer: false });
    const syncForm = () => {
      const k = ALERT_KINDS.find(x => x[0] === $('#al-kind').value);
      $('#al-scope-wrap').hidden = k[2] !== 'company';
      $('#al-co-wrap').hidden = k[2] === 'screen' || (k[2] === 'company' && $('#al-scope').value === 'watchlist');
      $('#al-price-wrap').hidden = k[2] !== 'price';
      $('#al-screen-wrap').hidden = k[2] !== 'screen';
    };
    $('#al-kind').onchange = syncForm; $('#al-scope').onchange = syncForm; syncForm();
    const loadList = async () => {
      const list = await Account.alerts.list();
      const el = $('#al-list');
      if (!el) return;
      el.classList.remove('muted');
      el.innerHTML = list.length ? '<ul class="alert-list">' + list.map(a => '<li class="' + (a.active ? '' : 'off') + '"><div><b>' + esc(alertLabel(a)) + '</b><div class="sub">' + a.channels.map(c => (CHANNELS.find(x => x[0] === c) || [c, c])[1]).join(', ') + '</div></div>' +
        '<div class="flex"><label class="switch" title="On / off"><input type="checkbox" data-toggle-alert="' + a.id + '"' + (a.active ? ' checked' : '') + '><span></span></label><button class="btn btn-plain btn-small" data-del-alert="' + a.id + '" aria-label="Delete">✕</button></div></li>').join('') + '</ul>'
        : '<p class="muted">No alerts yet. Use Quick start or create one above.</p>';
      $$('[data-toggle-alert]', el).forEach(cb => cb.onchange = () => Account.alerts.update(+cb.dataset.toggleAlert, { active: cb.checked }).then(loadList));
      $$('[data-del-alert]', el).forEach(b => b.onclick = () => Account.alerts.remove(+b.dataset.delAlert).then(loadList));
    };
    const add = async rule => {
      if (!rule.channels.length) return msg('#al-msg', errBox('Pick at least one way to send the alert.'));
      const r = await Account.alerts.add(rule);
      msg('#al-msg', r.error ? errBox(r.error) : '');
      if (!r.error) { toast('Alert created'); loadList(); }
    };
    $$('[data-quick]').forEach(b => b.onclick = () => add({ kind: b.dataset.quick, symbol: null, params: { scope: 'watchlist' }, channels: channels() }));
    $('#al-form').onsubmit = e => {
      e.preventDefault();
      const k = ALERT_KINDS.find(x => x[0] === $('#al-kind').value);
      const rule = { kind: k[0], symbol: null, params: {}, channels: channels() };
      if (k[2] === 'screen') {
        const sc = screens[+$('#al-screen').value];
        if (!sc) return msg('#al-msg', errBox('Save a screen first (Screens → run a query → Save), then pick it here.'));
        rule.params = { name: sc.name, query: sc.query };
      } else if (k[2] === 'price') {
        const pr = parseFloat($('#al-price').value);
        if (!picked) return msg('#al-msg', errBox('Pick a company.'));
        if (!(pr > 0)) return msg('#al-msg', errBox('Enter a price.'));
        rule.symbol = picked.symbol; rule.params = { price: pr };
      } else if ($('#al-scope').value === 'watchlist') rule.params = { scope: 'watchlist' };
      else if (!picked) return msg('#al-msg', errBox('Pick a company.'));
      else rule.symbol = picked.symbol;
      add(rule);
    };
    loadList();
    Account.alerts.log().then(list => {
      const el = $('#al-log');
      if (!el) return;
      el.innerHTML = list.length ? '<ul class="act-list">' + list.map(x => '<li><span class="sub">' + new Date(x.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</span> ' + esc(x.message) + '</li>').join('') + '</ul>' : 'Nothing sent yet.';
    });
  }

  /* ---------- Auth ---------- */
  const GOOGLE_ICON = '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const SOCIAL = [
    ['google', 'Google', GOOGLE_ICON],
    ['azure', 'Microsoft', '<svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>'],
    ['apple', 'Apple', '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.4 0 2.2-1.2 3-2.5.9-1.4 1.3-2.8 1.3-2.8s-2.4-1-2.4-4.1zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>'],
    ['github', 'GitHub', '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0z"/></svg>'],
    ['twitter', 'X', '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 2h3.4l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.4l7.9-9L1 2h7l4.8 6.4L18.2 2zm-1.2 18h1.9L7.1 3.9H5.1L17 20z"/></svg>']
  ];
  const errBox = m => '<div class="error-box">' + esc(m) + '</div>';
  const okBox = m => '<div class="ok-box">' + m + '</div>';
  /* social login buttons: Google always (the main way in); others once switched on in Supabase */
  function socialButtons(el, next, verb) {
    Account.providers().then(on => {
      if (!el.isConnected) return;
      const list = SOCIAL.filter(x => x[0] === 'google' || on[x[0]]);
      el.innerHTML = list.map(x => '<button class="btn btn-social" type="button" data-provider="' + x[0] + '">' + x[2] + '<span>' + verb + ' using ' + x[1] + '</span></button>').join('');
      $$('[data-provider]', el).forEach(b => b.onclick = async () => {
        const errEl = $('#auth-err') || $('.gate-err', el.parentElement);
        if (on[b.dataset.provider] === false) {
          if (errEl) errEl.innerHTML = errBox('Google login is being switched on. Please use email for now; your account will work with Google later too.');
          return;
        }
        try { sessionStorage.setItem('sankhyas_next', next); } catch (e) { /* ignore */ }
        b.disabled = true;
        const r = await Account.oauth(b.dataset.provider);
        b.disabled = false;
        if (r.error && errEl) errEl.innerHTML = errBox(r.error);
      });
    });
  }
  function authPage(isRegister, params) {
    setTitle(isRegister ? 'Register' : 'Login');
    const next = params.next || '#/feed';
    if (user()) { location.hash = next; return; }
    const nq = params.next ? '?next=' + encodeURIComponent(params.next) : '';
    const USER_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14z"/></svg>';
    app.innerHTML = '<div class="container page"><div class="auth-wrap">' +
      '<h1 class="auth-title">' + (isRegister ? 'Create your free account' : 'Login to Sankhyas') + '</h1>' +
      '<p class="muted auth-sub">' + (isRegister ? 'Follow companies, save screens, track your portfolio and get alerts on every device.' : 'Your watchlist, screens and portfolio, on every device.') + '</p>' +
      (Account.cloud ? '<div id="social-btns" class="social-btns"></div><div class="or-line"><span>or using email</span></div>' : '') +
      '<form id="auth-form" class="card auth-form">' +
      (isRegister ? '<div class="field"><label for="a-name">Full name</label><input type="text" id="a-name" autocomplete="name" required></div>' : '') +
      '<div class="field"><label for="a-email">Email</label><input type="email" id="a-email" autocomplete="email" required autofocus></div>' +
      '<div class="field"><label for="a-pass">Password</label><input type="password" id="a-pass" minlength="' + (Account.cloud ? 8 : 6) + '" autocomplete="' + (isRegister ? 'new-password' : 'current-password') + '" required></div>' +
      '<div id="auth-err">' + (Account.error ? errBox(Account.error) : '') + '</div>' +
      '<div class="auth-actions"><button class="btn btn-primary" type="submit">' + USER_ICON + ' ' + (isRegister ? 'Register' : 'Login') + '</button>' +
      (!isRegister && Account.cloud ? '<a href="#/forgot">Lost password?</a>' : '') + '</div>' +
      (Account.cloud ? '<button class="link-btn" id="magic-btn" type="button">✉ Email me a one-time login link instead</button>' : '') + '</form>' +
      '<p class="auth-switch">' + (isRegister ? 'Already have an account? <a href="#/login' + nq + '">Login</a>' : 'Don\'t have an account? <a href="#/register' + nq + '">Register for free</a>.') + '</p>' +
      '<p class="table-note" style="text-align:center">' + (Account.cloud ? 'By continuing you agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy policy</a>.' : 'Your account is saved in this browser.') + '</p></div></div>';
    if ($('#social-btns')) socialButtons($('#social-btns'), next, isRegister ? 'Sign up' : 'Login');
    if ($('#magic-btn')) $('#magic-btn').onclick = async () => {
      const email = $('#a-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#auth-err').innerHTML = errBox('Enter your email above first.'); $('#a-email').focus(); return; }
      try { sessionStorage.setItem('sankhyas_next', next); } catch (e) { /* ignore */ }
      $('#magic-btn').disabled = true;
      const r = await Account.magicLink(email);
      $('#magic-btn').disabled = false;
      if (r.error) { $('#auth-err').innerHTML = errBox(r.error); return; }
      $('#auth-form').outerHTML = okBox('Check your inbox: we sent a login link to <b>' + esc(email) + '</b>. Open it on this device to sign in. No password needed.');
    };
    $('#auth-form').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#auth-form button[type=submit]');
      const email = $('#a-email').value.trim().toLowerCase(), pass = $('#a-pass').value;
      btn.disabled = true;
      const r = isRegister ? await Account.signUp($('#a-name').value.trim(), email, pass) : await Account.signIn(email, pass);
      btn.disabled = false;
      if (r.error) { $('#auth-err').innerHTML = errBox(r.error); return; }
      if (r.needsConfirm) {
        $('#auth-form').outerHTML = okBox('Almost done! We sent a confirmation link to <b>' + esc(email) + '</b>. Open it to activate your account; you will be logged in straight away.');
        try { sessionStorage.setItem('sankhyas_next', next); } catch (e2) { /* ignore */ }
        return;
      }
      renderAuth();
      toast('Welcome, ' + ((user() && user().name) || '').split(' ')[0]);
      location.hash = next;
    };
  }

  /* Features that belong to an account (watchlist, portfolio, notes, saved screens, alerts) ask
     visitors to sign in first. Returns true when the visitor may go ahead. */
  function requireLogin(what, next) {
    if (user() || !Account.cloud) return true;
    next = next || location.hash || '#/';
    const nq = '?next=' + encodeURIComponent(next);
    const bd = modal('Login to ' + what, '<p class="muted">Create a free Sankhyas account to ' + esc(what) + '. Your watchlist, screens, notes and portfolio stay in sync on every device.</p>' +
      '<div class="social-btns gate-social"></div><div class="gate-err"></div><div class="or-line"><span>or using email</span></div>' +
      '<div class="gate-links"><a class="btn btn-primary" href="#/login' + nq + '">Login with email</a><a class="btn" href="#/register' + nq + '">Register for free</a></div>', []);
    $('.modal-foot', bd).remove();
    socialButtons($('.gate-social', bd), next, 'Login');
    $$('.gate-links a', bd).forEach(a => a.addEventListener('click', () => bd.remove()));
    return false;
  }
  function loginGate(title, text, next) {
    return '<div class="container page"><div class="card gate-card"><div class="gate-icon" aria-hidden="true">🔒</div><h1>' + esc(title) + '</h1><p class="muted">' + text + '</p>' +
      '<div class="social-btns gate-social" id="gate-social"></div><div class="gate-err"></div><div class="or-line"><span>or using email</span></div>' +
      '<div class="gate-links"><a class="btn btn-primary" href="#/login?next=' + encodeURIComponent(next) + '">Login with email</a><a class="btn" href="#/register?next=' + encodeURIComponent(next) + '">Register for free</a></div></div></div>';
  }
  function pageForgot() {
    setTitle('Reset password');
    app.innerHTML = '<div class="container page"><div class="card auth-card"><h1>Reset your password</h1><p class="muted" style="text-align:center">We will email you a link to set a new password.</p>' +
      '<form id="forgot-form"><div class="field"><label for="f-email">Email</label><input type="email" id="f-email" autocomplete="email" required></div><div id="auth-err"></div>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Send reset link</button></form><p class="sub" style="text-align:center;margin-top:16px"><a href="#/login">Back to login</a></p></div></div>';
    $('#forgot-form').onsubmit = async e => {
      e.preventDefault();
      const email = $('#f-email').value.trim().toLowerCase();
      const r = await Account.resetPassword(email);
      if (r.error) { $('#auth-err').innerHTML = errBox(r.error); return; }
      $('#forgot-form').outerHTML = okBox('If an account exists for <b>' + esc(email) + '</b>, a reset link is on its way. Check your inbox.');
    };
  }
  function pageReset() {
    setTitle('Set a new password');
    if (!user()) { app.innerHTML = '<div class="container page"><div class="card auth-card"><h1>Link expired</h1><p class="muted" style="text-align:center">Open the reset link from your email again, or <a href="#/forgot">request a new one</a>.</p></div></div>'; return; }
    app.innerHTML = '<div class="container page"><div class="card auth-card"><h1>Set a new password</h1>' +
      '<form id="reset-form"><div class="field"><label for="r-pass">New password</label><input type="password" id="r-pass" minlength="8" autocomplete="new-password" required></div><div id="auth-err"></div>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Save password</button></form></div></div>';
    $('#reset-form').onsubmit = async e => {
      e.preventDefault();
      const r = await Account.setPassword($('#r-pass').value);
      if (r.error) { $('#auth-err').innerHTML = errBox(r.error); return; }
      toast('Password updated');
      location.hash = '#/account';
    };
  }
  function pageAccount() {
    setTitle('My account');
    const u = user();
    if (!u) { location.hash = '#/login?next=' + encodeURIComponent('#/account'); return; }
    const pro = Account.isPro(), until = Account.proUntil();
    const planHtml = !Account.cloud ? '<p><b>Sankhyas Pro</b> ' + PRO_TAG + ' is free for everyone during beta.</p>'
      : pro && until ? '<p><b>Sankhyas Pro</b> ' + PRO_TAG + ' active until <b>' + until.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + '</b>.</p><a class="btn" href="#/premium">Extend Pro</a>'
      : pro ? '<p><b>Sankhyas Pro</b> ' + PRO_TAG + ' is free during beta.</p>'
      : '<p>You are on the <b>Free</b> plan.' + (until ? ' Pro expired on ' + until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '.' : '') + '</p><a class="btn btn-primary" href="#/premium">Upgrade to Pro</a>';
    app.innerHTML = '<div class="container page"><div class="card" style="max-width:720px;margin:0 auto"><h1>My account</h1>' +
      '<div class="acct-grid"><div><div class="sub">Name</div><b>' + esc(u.name || '-') + '</b></div><div><div class="sub">Email</div><b>' + esc(u.email || '-') + '</b></div></div>' +
      '<h3>Plan</h3>' + planHtml +
      (Account.cloud ? '<h3>Payments</h3><div id="pay-list" class="muted">Loading…</div>' : '') +
      '<div class="flex flex-wrap" style="margin-top:24px">' + (Account.cloud ? '<a class="btn" href="#/forgot">Change password</a>' : '') +
      '<button class="btn" id="acct-logout">Logout</button></div></div></div>';
    $('#acct-logout').onclick = () => Account.signOut().then(() => { renderAuth(); location.hash = '#/'; });
    if (Account.cloud) {
      Account.payments().then(list => {
        const el = $('#pay-list');
        if (!el) return;
        el.innerHTML = list.length ? '<div class="table-wrap"><table class="data"><thead><tr><th class="l">Date</th><th class="l">Plan</th><th>Amount</th><th class="l">Status</th><th class="l">Payment ID</th></tr></thead><tbody>' +
          list.map(x => '<tr><td class="l">' + new Date(x.paid_at || x.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</td><td class="l">' +
            (x.plan === 'pro_yearly' ? 'Pro, 1 year' : 'Pro, 1 month') + '</td><td>₹ ' + num(x.amount / 100, 0) + '</td><td class="l">' + esc(x.status === 'created' ? 'not completed' : x.status) + '</td><td class="l">' + esc(x.payment_id || '-') + '</td></tr>').join('') +
          '</tbody></table></div>' : 'No payments yet.';
      });
    }
  }
  const pageLogin = (p, params) => authPage(false, params);
  const pageRegister = (p, params) => authPage(true, params);

  function pagePremium(p, params) {
    setTitle('Sankhyas Pro');
    const feat = (list) => '<ul class="feat-list">' + list.map(f => '<li>' + f + '</li>').join('') + '</ul>';
    const paid = Account.cloud && !Account.config.proFreeDuringBeta;
    const pro = Account.isPro(), until = Account.proUntil();
    const status = !paid ? '<p class="pro-status">All Pro features are <b>free during beta</b>.</p>'
      : pro && until ? '<p class="pro-status">You have Pro until <b>' + until.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + '</b>. Buying again extends it.</p>' : '';
    const buy = (plan, label, primary) => paid ? '<button class="btn ' + (primary ? 'btn-primary' : '') + ' buy-btn" data-plan="' + plan + '">' + label + '</button>'
      : '<a class="btn ' + (primary ? 'btn-primary' : '') + '" href="#/company/' + encodeURIComponent((Data.listCompanies()[0] || {}).symbol || 'TCS') + '">Try Pro free</a>';
    app.innerHTML = '<div class="container page"><div style="text-align:center;margin-bottom:28px"><h1>Sankhyas Pro</h1><p class="muted">The AI that reads every concall, annual report and filing for you.</p>' + status + '</div>' +
      '<div class="grid grid-3 plans" style="max-width:1040px;margin:0 auto">' +
      '<div class="card"><h2>Free</h2><p class="price">₹ 0</p><p class="muted">forever</p>' +
      feat(['Financials, ratios, charts and peers for every NSE, BSE and SME company', 'Plain-English stock screens', 'Sankhyas AI (built-in, on-device and Claude)', 'Red-flag score for every company', 'Watchlist, feed, compare and Excel export']) +
      (user() ? '<span class="btn" aria-disabled="true">Your plan' + (pro && paid ? ' before Pro' : '') + '</span>' : '<a class="btn" href="#/register">Get started</a>') + '</div>' +
      '<div class="card"><h2>Pro monthly ' + PRO_TAG + '</h2><p class="price">₹ 299</p><p class="muted">per month &middot; one-time payment, no auto-renewal</p>' +
      feat(['Everything in Free', '<b>Full red-flag scan</b> with every warning and the filing behind it', '<b>Guidance tracker</b>: management\'s promises vs delivery', '<b>What changed</b> every quarter: results, tone, guidance, new risks', 'Sankhyas AI answers on red flags, guidance and changes']) +
      buy('pro_monthly', 'Buy 1 month', false) + '</div>' +
      '<div class="card plan-best"><div class="plan-ribbon">Save 30%</div><h2>Pro yearly ' + PRO_TAG + '</h2><p class="price">₹ 2,499</p><p class="muted">per year (₹ 208/month) &middot; one-time payment</p>' +
      feat(['Everything in Pro monthly', '12 months for the price of about 8', 'New Pro features as they launch']) +
      buy('pro_yearly', 'Buy 1 year', true) + '</div>' +
      '</div><p class="table-note" style="text-align:center;margin-top:18px">Payments are processed securely by Razorpay (UPI, cards, net banking, wallets). Prices include applicable taxes. ' +
      'See <a href="#/refunds">refunds &amp; cancellation</a> and <a href="#/terms">terms</a>. Sankhyas is a research tool, not investment advice.</p></div>';
    $$('.buy-btn').forEach(b => b.onclick = async () => {
      if (!user()) { toast('Please create an account or log in first'); location.hash = '#/register?next=' + encodeURIComponent('#/premium'); return; }
      const all = $$('.buy-btn');
      all.forEach(x => { x.disabled = true; });
      const label = b.textContent;
      b.textContent = 'Opening payment…';
      try {
        const r = await Account.checkout(b.dataset.plan, { onVerifying: () => { b.textContent = 'Confirming payment…'; }, onFailed: msg => toast(msg) });
        renderAuth();
        modal('Welcome to Sankhyas Pro', '<p>Your payment was successful. Pro is active until <b>' + new Date(r.pro_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + '</b>.</p><p>Open any company page to see the full <b>Sankhyas Insights</b>.</p>',
          [{ label: 'My account', onClick: () => { location.hash = '#/account'; } }, { label: 'Start exploring', primary: true, onClick: () => { location.hash = '#/company/' + encodeURIComponent((Data.listCompanies()[0] || {}).symbol || 'TCS'); } }]);
      } catch (e) {
        if (e.code === 'login') { location.hash = '#/login?next=' + encodeURIComponent('#/premium'); return; }
        if (e.code !== 'dismissed') modal(e.code === 'verify' ? 'Confirming your payment' : 'Payment not completed', '<p>' + esc(e.message) + '</p>');
      } finally {
        all.forEach(x => { x.disabled = false; });
        b.textContent = label;
      }
    });
    if (params && params.plan && paid) { const b = $('.buy-btn[data-plan="' + params.plan + '"]'); if (b) b.focus(); }
  }

  /* Pages Razorpay asks every merchant website to have. */
  function pageLegal(p) {
    const kind = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const B = Account.config.business || {}, name = esc(B.name || 'Sankhyas');
    const email = B.email ? '<a href="mailto:' + esc(B.email) + '">' + esc(B.email) + '</a>' : '<i>(support email: set business.email in js/config.js)</i>';
    const contactLines = '<p><b>' + name + '</b><br>' + (B.address ? esc(B.address) + '<br>' : '') +
      'Email: ' + email + (B.phone ? '<br>Phone: ' + esc(B.phone) : '') +
      (B.instagram ? '<br>Instagram: <a href="https://www.instagram.com/' + encodeURIComponent(B.instagram) + '/" target="_blank" rel="noopener noreferrer">@' + esc(B.instagram) + '</a>' : '') + '</p>';
    const updated = '<p class="sub">Last updated: 26 September 2026</p>';
    const pages = {
      contact: ['Contact & support', '<p>We are happy to help with your account, payments or data questions. We usually reply within 1–2 working days.</p>' + contactLines],
      terms: ['Terms of use', updated +
        '<h3>1. The service</h3><p>' + name + ' provides stock market data, screens, analytics and AI-generated summaries for research and education. Data comes from public sources (such as Yahoo Finance and NSE/BSE filings) and may be delayed, incomplete or wrong.</p>' +
        '<h3>2. Not investment advice</h3><p>Nothing on ' + name + ' is a recommendation to buy, sell or hold any security. ' + name + ' is not a SEBI-registered investment adviser or research analyst. Do your own research or consult a SEBI-registered adviser before investing. You are solely responsible for your investment decisions.</p>' +
        '<h3>3. Accounts</h3><p>Keep your login details safe. You are responsible for activity on your account. We may suspend accounts that misuse the service, scrape it in bulk or break the law.</p>' +
        '<h3>4. Sankhyas Pro</h3><p>Pro is sold as a one-time purchase for a fixed period (1 month or 1 year) and does not renew automatically. Features may change as the product improves. Refunds follow our <a href="#/refunds">Refund &amp; cancellation policy</a>.</p>' +
        '<h3>5. Liability</h3><p>The service is provided "as is". To the extent permitted by law, ' + name + ' is not liable for losses arising from use of the data, analytics or AI output, and total liability is limited to the amount you paid in the last 12 months.</p>' +
        '<h3>6. Governing law</h3><p>These terms are governed by the laws of India. Contact us first to resolve any dispute.</p>' + contactLines],
      privacy: ['Privacy policy', updated +
        '<h3>What we collect</h3><ul><li>Account details: name, email and login method.</li><li>Payment records: plan, amount, status and Razorpay order/payment IDs. Card, UPI and bank details are handled by Razorpay and never reach us.</li><li>Your watchlist, saved screens and notes are stored in your browser.</li></ul>' +
        '<h3>How we use it</h3><p>To run your account, provide Pro features, process payments, send service emails (such as login links and receipts) and prevent abuse. We do not sell your personal data.</p>' +
        '<h3>Service providers</h3><p>Supabase (accounts and database), Razorpay (payments) and GitHub Pages (hosting). If you use an optional third-party AI engine in Sankhyas AI (such as Claude via Puter), your question and the page\'s data go to that provider. The on-device and built-in engines send nothing.</p>' +
        '<h3>Your rights</h3><p>You can ask us to access, correct or delete your data, as provided under India\'s Digital Personal Data Protection Act, 2023. Write to us at ' + email + '.</p>' + contactLines],
      refunds: ['Refund & cancellation policy', updated +
        '<ul><li><b>No auto-renewal:</b> Pro is a one-time payment for 1 month or 1 year. Nothing is charged again unless you buy again, so there is nothing to cancel.</li>' +
        '<li><b>7-day refund:</b> if Pro is not right for you, email us within 7 days of payment with your registered email and payment ID for a full refund.</li>' +
        '<li><b>Failed or duplicate payments:</b> if money was deducted but Pro did not activate, or you were charged twice, contact us and we will activate Pro or refund the extra amount.</li>' +
        '<li><b>Timeline:</b> approved refunds are processed within 5–7 working days to the original payment method, via Razorpay.</li></ul>' + contactLines]
    };
    const pg = pages[kind] || pages.contact;
    setTitle(pg[0]);
    app.innerHTML = '<div class="container page"><div class="card legal" style="max-width:820px;margin:0 auto"><h1>' + esc(pg[0]) + '</h1>' + pg[1] + '</div></div>';
  }

  function pageAbout() {
    setTitle('About');
    app.innerHTML = '<div class="container page"><article class="card about-page">' +
      '<p class="about-kicker">About Sankhyas</p>' +
      '<h1>A world of financial information. A clearer perspective.</h1>' +
      '<p class="about-lead">The markets move on information. Sound investment decisions depend on understanding it.</p>' +
      '<p><b>Sankhyas is being built to bridge that gap.</b> An AI-powered financial research platform, Sankhyas brings together financial analysis, business context, and technology to help investors see the bigger picture—and examine the details that matter.</p>' +
      '<p>Founded by <b>CA Purshottam Menariya</b> and <b>CA Devanshu Soni</b>, Sankhyas draws on a foundation in accounting, financial analysis, and equity research. Our approach begins with a simple belief: every company deserves to be understood beyond its share price.</p>' +
      '<p>We are building a connected research experience that brings company financials, corporate disclosures, market developments, and AI-assisted insights into one intuitive platform. By making complex information easier to navigate and interpret, we aim to give investors more time for thoughtful analysis.</p>' +
      '<p>Our ambition is to make rigorous financial research accessible to individual investors and experienced professionals alike. Whether exploring a business, evaluating its performance, or questioning an investment thesis, Sankhyas is designed to support informed, independent thinking.</p>' +
      '<div class="about-mission"><div class="sub">Our mission</div><p>To turn financial complexity into clarity—and enable investors to build conviction through understanding.</p></div>' +
      '<p class="about-tagline">Sankhyas — Understand the business. See beyond the numbers.</p>' +
      '<h3>Data</h3><p>Market data comes from Yahoo Finance (end of day), and filings, concalls and annual reports come from NSE and BSE.</p>' +
      '<h3>Disclaimer</h3><p class="muted">Nothing on this site is investment advice. Please consult a SEBI registered advisor before investing.</p></article></div>';
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
  if (!document.body.getAttribute('data-route')) app.innerHTML = '<div class="container page muted">Loading market data…</div>';
  let booted = false;
  let syncedFor = null;
  function syncOnLogin() {
    const u = user();
    if (!u || !Account.canSync() || syncedFor === u.id) { if (!u) syncedFor = null; return; }
    syncedFor = u.id;
    Sync.pull().then(changed => {
      if (!changed) return;
      const p0 = parseHash().parts[0] || '';
      if (['watchlist', 'screens', 'portfolio', 'account', 'company'].indexOf(p0) >= 0) { routeKeepScroll = p0 === 'company'; route(); }
    });
  }
  Account.onChange(() => {
    if (!booted) return;
    syncOnLogin();
    renderAuth();
    const p0 = parseHash().parts[0] || '';
    if (['account', 'premium', 'login', 'register'].indexOf(p0) >= 0) route();
    else if (p0 === 'company' && currentCompany) refreshInsights(currentCompany);
  });
  Promise.all([Data.init(), Account.ready]).then(() => {
    booted = true;
    renderAuth();
    if (Account.inRecovery()) location.hash = '#/reset';
    else {
      let next = null;
      try { next = sessionStorage.getItem('sankhyas_next'); sessionStorage.removeItem('sankhyas_next'); } catch (e) { /* ignore */ }
      if (next && user() && /^#\//.test(next)) location.hash = next;
    }
    window.addEventListener('hashchange', route);
    route();
    syncOnLogin();
    // bring changes made on other devices when the tab comes back into view
    let lastPull = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !user() || !Account.canSync() || Date.now() - lastPull < 60e3) return;
      lastPull = Date.now(); syncedFor = null; syncOnLogin();
    });
  });
})();
