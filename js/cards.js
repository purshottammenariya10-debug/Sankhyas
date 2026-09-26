/* Social cards: shareable images for Instagram, X and WhatsApp, drawn on a <canvas> in the browser.
 *
 *   Cards.render(kind, data, format) -> Promise<canvas>   kind: results | redflags | listing | theme | snapshot
 *   Cards.caption(kind, data)        -> post caption with hashtags
 *   Cards.download(canvas, name) / Cards.share(canvas, caption, name)
 *
 * format: 'square' (1080x1080, feed posts) or 'story' (1080x1920, stories and reels covers).
 */
(function () {
  const C = { bg1: '#0b1526', bg2: '#10263a', card: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.12)', ink: '#f4f7fb', ink2: '#a9b6c8', ink3: '#71819a',
    teal: '#22c3a6', purple: '#8b82ff', up: '#3ecf75', down: '#ff6b6b', amber: '#f5b841' };
  const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
  const ok = v => v != null && Number.isFinite(v);
  const fmt = (v, d) => (ok(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '-');
  const pct = (v, d) => (ok(v) ? (v >= 0 ? '+' : '') + fmt(v, d == null ? 1 : d) + '%' : '-');
  const cr = v => (ok(v) ? '₹' + (Math.abs(v) >= 1e5 ? fmt(v / 1e5, 2) + ' L Cr' : fmt(v, 0) + ' Cr') : '-');
  const HANDLE = () => '@' + (((window.SANKHYAS_CONFIG || {}).business || {}).instagram || 'sankhyas.co');

  let logoP = null;
  function logo() {
    if (!logoP) {
      logoP = new Promise(res => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = 'assets/logo-192.png';
      });
    }
    return logoP;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, size, color, weight, align) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }
  // wrap s into at most maxLines lines of width w; returns the y after the last line
  function wrap(ctx, s, x, y, w, size, color, weight, maxLines, lh) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT;
    const words = String(s).split(/\s+/), lines = [];
    let line = '';
    words.forEach(word => {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > w && line) { lines.push(line); line = word; } else line = t;
    });
    if (line) lines.push(line);
    const out = lines.slice(0, maxLines || 3);
    if (lines.length > out.length) {
      let last = out[out.length - 1];
      while (ctx.measureText(last + '…').width > w && last.length) last = last.slice(0, -1);
      out[out.length - 1] = last + '…';
    }
    out.forEach((l, i) => text(ctx, l, x, y + i * (lh || size * 1.2), size, color, weight));
    return y + (out.length - 1) * (lh || size * 1.2);
  }
  function tile(ctx, x, y, w, h, label, value, sub, subColor) {
    rr(ctx, x, y, w, h, 22); ctx.fillStyle = C.card; ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, label.toUpperCase(), x + 28, y + 46, 22, C.ink3, 600);
    text(ctx, value, x + 28, y + 104, 46, C.ink, 700);
    if (sub) text(ctx, sub, x + 28, y + 148, 28, subColor || C.ink2, 600);
  }

  async function frame(format, tag) {
    const W = 1080, H = format === 'story' ? 1920 : 1080;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft brand glow
    const rg = ctx.createRadialGradient(W - 120, 140, 10, W - 120, 140, 520);
    rg.addColorStop(0, 'rgba(34,195,166,0.22)'); rg.addColorStop(1, 'rgba(34,195,166,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    const top = format === 'story' ? 150 : 70;
    const img = await logo();
    if (img) { rr(ctx, 70, top, 76, 76, 18); ctx.save(); ctx.clip(); ctx.drawImage(img, 70, top, 76, 76); ctx.restore(); }
    text(ctx, 'Sankhyas', img ? 166 : 70, top + 52, 40, C.ink, 700);
    if (tag) {
      ctx.font = '700 22px ' + FONT;
      const tw = ctx.measureText(tag).width + 40;
      rr(ctx, W - 70 - tw, top + 16, tw, 46, 23); ctx.fillStyle = 'rgba(139,130,255,0.18)'; ctx.fill();
      text(ctx, tag, W - 70 - tw / 2, top + 47, 22, C.purple, 700, 'center');
    }
    // footer
    const fy = H - (format === 'story' ? 150 : 60);
    ctx.fillStyle = C.line; ctx.fillRect(70, fy - 44, W - 140, 2);
    text(ctx, HANDLE(), 70, fy, 26, C.ink, 700);
    text(ctx, 'Research, not investment advice', W - 70, fy, 22, C.ink3, 400, 'right');
    if (format === 'story') {
      // call to action above the footer
      const by = fy - 250;
      rr(ctx, 70, by, W - 140, 170, 26); ctx.fillStyle = 'rgba(139,130,255,0.14)'; ctx.fill();
      ctx.strokeStyle = 'rgba(139,130,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, 'Free on Sankhyas', 110, by + 70, 40, C.ink, 800);
      text(ctx, 'Financials · red flags · AI concall summaries', 110, by + 122, 28, C.ink2, 500);
    }
    return { cv, ctx, W, H, y: top + 150, bottom: format === 'story' ? fy - 300 : fy - 70 };
  }
  function heading(f, name, sub) {
    const y = wrap(f.ctx, name, 70, f.y + 40, f.W - 140, 64, C.ink, 800, 2, 74);
    if (sub) text(f.ctx, sub, 70, y + 56, 28, C.ink2, 500);
    return y + (sub ? 100 : 50);
  }
  const subOf = c => [c.exchange === 'BSE' ? 'BSE: ' + (c.bseCode || c.symbol) : 'NSE: ' + c.symbol, c.sme ? 'SME' : '', c.industry || c.sector].filter(Boolean).join('  ·  ');

  /* ---------- templates ---------- */
  const T = {};
  T.results = async (c, format) => {
    const m = c.metrics, q = c.q, Q = c.quarters || [];
    const n = Q.length;
    const get = (arr, i) => (arr && i >= 0 ? arr[i] : null);
    const yoy = (arr) => { const a = get(arr, n - 1), b = get(arr, n - 5); return ok(a) && ok(b) && b !== 0 ? (a / Math.abs(b) - 1) * 100 * (b < 0 ? -1 : 1) : null; };
    const sales = q ? get(q.sales, n - 1) : m.qtrSales, np = q ? get(q.np, n - 1) : m.qtrProfit, op = q ? get(q.op, n - 1) : m.qtrOp;
    const salesY = q ? yoy(q.sales) : m.qtrSalesVar, npY = q ? yoy(q.np) : m.qtrProfitVar, opY = q ? yoy(q.op) : null;
    const opm = q ? get(q.opm, n - 1) : m.qtrOpm, eps = q ? get(q.eps, n - 1) : m.qtrEps;
    const f = await frame(format, 'RESULTS · ' + (Q[n - 1] || c.lastQuarter || 'LATEST').toUpperCase());
    let y = heading(f, c.name, subOf(c));
    const good = ok(npY) ? npY >= 0 : ok(salesY) ? salesY >= 0 : true;
    const head = ok(npY) ? 'Net profit ' + (npY >= 0 ? 'up ' : 'down ') + fmt(Math.abs(npY), 0) + '% YoY' : ok(salesY) ? 'Revenue ' + (salesY >= 0 ? 'up ' : 'down ') + fmt(Math.abs(salesY), 0) + '% YoY' : 'Quarterly results';
    y += 30;
    text(f.ctx, (good ? '▲ ' : '▼ ') + head, 70, y + 60, 60, good ? C.up : C.down, 800);
    y += 120;
    const w = (f.W - 140 - 30) / 2, h = 180;
    const col = v => (ok(v) ? (v >= 0 ? C.up : C.down) : C.ink2);
    tile(f.ctx, 70, y, w, h, 'Revenue', cr(sales), ok(salesY) ? pct(salesY) + ' YoY' : '', col(salesY));
    tile(f.ctx, 70 + w + 30, y, w, h, 'Operating profit', cr(op), ok(opY) ? pct(opY) + ' YoY' : ok(opm) ? 'OPM ' + fmt(opm, 1) + '%' : '', ok(opY) ? col(opY) : C.ink2);
    tile(f.ctx, 70, y + h + 30, w, h, 'Net profit', cr(np), ok(npY) ? pct(npY) + ' YoY' : '', col(npY));
    tile(f.ctx, 70 + w + 30, y + h + 30, w, h, ok(opm) && ok(opY) ? 'OPM · EPS' : 'EPS', ok(opm) && ok(opY) ? fmt(opm, 1) + '% · ₹' + fmt(eps, 2) : '₹' + fmt(eps, 2), '');
    if (format === 'story') moreStory(f, c, y + 2 * h + 90);
    return f.cv;
  };
  T.snapshot = async (c, format) => {
    const m = c.metrics;
    const f = await frame(format, 'STOCK SNAPSHOT');
    let y = heading(f, c.name, subOf(c));
    y += 20;
    text(f.ctx, '₹' + fmt(m.price, m.price < 100 ? 2 : 0), 70, y + 70, 80, C.ink, 800);
    if (ok(m.ret1y)) text(f.ctx, pct(m.ret1y) + ' in 1 year', f.W - 70, y + 62, 36, m.ret1y >= 0 ? C.up : C.down, 700, 'right');
    y += 120;
    const w = (f.W - 140 - 40) / 3, h = 170;
    const tiles = [['Market cap', cr(m.marketCap)], ['P/E', fmt(m.pe, 1)], ['ROCE', fmt(m.roce, 1) + '%'], ['ROE', fmt(m.roe, 1) + '%'],
      ['Debt / equity', fmt(m.de, 2)], ['Sales growth 5Y', ok(m.salesGrowth5) ? fmt(m.salesGrowth5, 1) + '%' : '-']];
    tiles.forEach((t, i) => tile(f.ctx, 70 + (i % 3) * (w + 20), y + Math.floor(i / 3) * (h + 20), w, h, t[0], t[1]));
    if (format === 'story') moreStory(f, c, y + 2 * h + 80);
    return f.cv;
  };
  T.redflags = async (c, format) => {
    const r = window.Insights ? Insights.redFlags(c) : { score: c.metrics.riskScore || 0, band: '', flags: [] };
    const band = r.band || (r.score >= 45 ? 'High' : r.score >= 20 ? 'Moderate' : 'Low');
    const color = band === 'High' ? C.down : band === 'Moderate' ? C.amber : C.up;
    const f = await frame(format, 'RED-FLAG SCAN');
    let y = heading(f, c.name, subOf(c));
    // gauge
    const cx = 250, cy = y + 190, R = 150, ctx = f.ctx;
    ctx.lineCap = 'round'; ctx.lineWidth = 30;
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
    ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * Math.max(0.02, r.score / 100))); ctx.stroke();
    text(ctx, String(r.score), cx, cy + 22, 96, C.ink, 800, 'center');
    text(ctx, 'out of 100', cx, cy + 64, 24, C.ink3, 500, 'center');
    text(ctx, band + ' risk', 470, y + 150, 58, color, 800);
    wrap(ctx, r.flags.length ? r.flags.length + ' warning sign' + (r.flags.length > 1 ? 's' : '') + ' found in the numbers and exchange filings' : 'No warning signs found in the numbers or filings', 470, y + 205, f.W - 540, 28, C.ink2, 500, 3, 38);
    y = cy + R + 40;
    const show = r.flags.slice(0, format === 'story' ? 8 : 3);
    show.forEach((fl, i) => {
      const yy = y + i * 70;
      ctx.fillStyle = fl.sev === 'high' ? C.down : fl.sev === 'medium' ? C.amber : C.ink3;
      ctx.beginPath(); ctx.arc(84, yy - 10, 9, 0, Math.PI * 2); ctx.fill();
      wrap(ctx, fl.title, 110, yy, f.W - 180, 34, C.ink, 600, 1);
    });
    if (!show.length) text(ctx, 'Clean on every check Sankhyas runs.', 70, y, 34, C.ink2, 600);
    if (format === 'story') moreStory(f, c, y + Math.max(1, show.length) * 70 + 20);
    return f.cv;
  };
  T.listing = async (c, format) => {
    const m = c.metrics, ret = ok(c.listPrice) && ok(m.price) ? (m.price / c.listPrice - 1) * 100 : null;
    const f = await frame(format, c.sme ? 'SME LISTING' : 'NEW LISTING');
    let y = heading(f, c.name, subOf(c));
    y += 20;
    const good = ok(ret) ? ret >= 0 : true;
    text(f.ctx, ok(ret) ? pct(ret, 0) : '-', 70, y + 110, 130, ok(ret) ? (good ? C.up : C.down) : C.ink, 800);
    text(f.ctx, 'since its first trading day', 70, y + 160, 32, C.ink2, 500);
    y += 210;
    const w = (f.W - 140 - 40) / 3, h = 170;
    const listed = c.listed ? new Date(c.listed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    tile(f.ctx, 70, y, w, h, 'Listed on', listed);
    tile(f.ctx, 70 + w + 20, y, w, h, 'First close', '₹' + fmt(c.listPrice, c.listPrice < 100 ? 2 : 0));
    tile(f.ctx, 70 + 2 * (w + 20), y, w, h, 'Price now', '₹' + fmt(m.price, m.price < 100 ? 2 : 0));
    if (format === 'story') moreStory(f, c, y + h + 80);
    return f.cv;
  };
  T.theme = async (d, format) => {
    const { theme, list } = d;
    const f = await frame(format, 'THEME TRACKER');
    let y = heading(f, theme.name, list.length + ' companies  ·  1-year returns');
    const top = list.filter(c => ok(c.metrics.ret1y)).sort((a, b) => b.metrics.ret1y - a.metrics.ret1y).slice(0, format === 'story' ? 10 : 6);
    const max = Math.max(1, ...top.map(c => Math.abs(c.metrics.ret1y)));
    const rowH = format === 'story' ? 104 : 88, barX = 470, barW = f.W - 70 - barX - 150;
    y += 20;
    top.forEach((c, i) => {
      const yy = y + i * rowH, v = c.metrics.ret1y, ctx = f.ctx;
      wrap(ctx, c.name.replace(/ (limited|ltd\.?)$/i, ''), 70, yy + 38, barX - 100, 30, C.ink, 600, 1);
      rr(ctx, barX, yy + 10, barW, 36, 12); ctx.fillStyle = C.card; ctx.fill();
      rr(ctx, barX, yy + 10, Math.max(14, barW * Math.abs(v) / max), 36, 12); ctx.fillStyle = v >= 0 ? C.teal : C.down; ctx.fill();
      text(ctx, pct(v, 0), f.W - 70, yy + 40, 30, v >= 0 ? C.up : C.down, 700, 'right');
    });
    return f.cv;
  };
  function moreStory(f, c, y) {
    if (y > f.bottom - 200) return;
    wrap(f.ctx, (c.about || 'Full financials, ratios, concall summaries and red-flag checks for ' + c.name + ' on Sankhyas.').slice(0, 320), 70, y + 40, f.W - 140, 32, C.ink2, 400, 6, 46);
  }

  /* ---------- captions ---------- */
  const tagOf = s => '#' + String(s || '').replace(/[^A-Za-z0-9]/g, '');
  function caption(kind, d) {
    const H = HANDLE(), tail = '\n\nFree research on Sankhyas: India\'s AI-Powered Financial Research Terminal. Follow ' + H + ' for more.\nNot investment advice. Do your own research.\n\n';
    if (kind === 'theme') {
      const top = d.list.filter(c => ok(c.metrics.ret1y)).sort((a, b) => b.metrics.ret1y - a.metrics.ret1y).slice(0, 3);
      return d.theme.icon + ' ' + d.theme.name + ' stocks: the top performers over the last year\n\n' + top.map((c, i) => (i + 1) + '. ' + c.name + ': ' + pct(c.metrics.ret1y, 0)).join('\n') + tail +
        '#Sankhyas ' + tagOf(d.theme.name) + 'Stocks #StockMarketIndia #NSE #Investing #ThemeInvesting';
    }
    const c = d, m = c.metrics, sym = tagOf(c.symbol);
    if (kind === 'results') {
      return '📊 ' + c.name + ' results (' + (c.lastQuarter || (c.quarters || []).slice(-1)[0] || 'latest quarter') + ')\n\n' +
        '• Revenue: ' + cr(m.qtrSales) + ' (' + pct(m.qtrSalesVar) + ' YoY)\n• Net profit: ' + cr(m.qtrProfit) + ' (' + pct(m.qtrProfitVar) + ' YoY)\n• EPS: ₹' + fmt(m.qtrEps, 2) + tail +
        '#Sankhyas ' + sym + ' #QuarterlyResults #Earnings #StockMarketIndia #NSE #BSE';
    }
    if (kind === 'redflags') {
      const r = window.Insights ? Insights.redFlags(c) : { score: m.riskScore, band: '', flags: [] };
      return '🚩 Red-flag scan: ' + c.name + '\n\nSankhyas forensic score: ' + r.score + '/100 (' + (r.band || '') + ' risk)\n' +
        (r.flags.length ? r.flags.slice(0, 3).map(fl => '• ' + fl.title).join('\n') : '• No warning signs found') + tail +
        '#Sankhyas ' + sym + ' #RedFlags #ForensicAccounting #StockMarketIndia #InvestorAwareness';
    }
    if (kind === 'listing') {
      const ret = ok(c.listPrice) && ok(m.price) ? (m.price / c.listPrice - 1) * 100 : null;
      return '🆕 ' + c.name + (c.sme ? ' (SME)' : '') + ' since listing\n\n• Listed: ' + (c.listed || '-') + '\n• First close: ₹' + fmt(c.listPrice, 2) + '\n• Now: ₹' + fmt(m.price, 2) + ' (' + pct(ret, 0) + ')' + tail +
        '#Sankhyas ' + sym + ' #IPO ' + (c.sme ? '#SMEIPO ' : '') + '#NewListing #StockMarketIndia #NSE';
    }
    return '🔎 ' + c.name + ' at a glance\n\n• Price: ₹' + fmt(m.price, 2) + ' (' + pct(m.ret1y, 0) + ' in 1 year)\n• Market cap: ' + cr(m.marketCap) + '\n• P/E ' + fmt(m.pe, 1) + ' · ROCE ' + fmt(m.roce, 1) + '% · ROE ' + fmt(m.roe, 1) + '%' + tail +
      '#Sankhyas ' + sym + ' #StockAnalysis #StockMarketIndia #NSE #Investing';
  }

  function toBlob(cv) { return new Promise(res => cv.toBlob(res, 'image/png')); }
  async function download(cv, name) {
    const blob = await toBlob(cv);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (name || 'sankhyas-card') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function share(cv, text, name) {
    const blob = await toBlob(cv);
    const file = new File([blob], (name || 'sankhyas-card') + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return true;
    }
    return false;
  }

  window.Cards = {
    kinds: { results: 'Results card', snapshot: 'Company snapshot', redflags: 'Red-flag scan', listing: 'New listing performance', theme: 'Theme leaderboard' },
    render: (kind, data, format) => T[kind](data, format === 'story' ? 'story' : 'square'),
    caption, download, share
  };
})();
