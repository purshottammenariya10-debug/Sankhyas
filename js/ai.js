/*
 * Sankhyas AI: free, built-in analysis engine.
 *
 * Everything runs in the browser from the data Sankhyas already has. No API key,
 * no server and no usage cost. It is rule-based: questions are matched to
 * intents, answers are written from templates and thresholds, and plain-English
 * screens are parsed into screen queries.
 */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ok = v => v != null && isFinite(v);
  const n = (v, d) => (ok(v) ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : 'n/a');
  const cr = v => (ok(v) ? '₹ ' + n(v, 0) + ' Cr' : 'n/a');
  const rs = v => (ok(v) ? '₹ ' + n(v, Math.abs(v) >= 1000 ? 0 : 1) : 'n/a');
  const pc = (v, d) => (ok(v) ? n(v, d == null ? 1 : d) + '%' : 'n/a');
  const x = v => (ok(v) ? n(v, 1) + 'x' : 'n/a');
  const med = a => { const s = a.filter(ok).sort((p, q) => p - q); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const lastOf = a => { for (let i = (a || []).length - 1; i >= 0; i--) if (ok(a[i])) return a[i]; return null; };
  const link = c => '[' + c.name + '](#/company/' + c.symbol + ')';

  /* ---------- analysis helpers ---------- */
  const isFin = c => /financ|bank/i.test(c.sector + ' ' + c.industry);
  function size(m) {
    if (!ok(m.marketCap)) return 'listed';
    return m.marketCap >= 50000 ? 'large-cap' : m.marketCap >= 15000 ? 'mid-cap' : 'small-cap';
  }
  const grade = (v, good, fair) => (!ok(v) ? 'unknown' : v >= good ? 'strong' : v >= fair ? 'moderate' : 'weak');
  function upYears(arr, k) {
    const a = (arr || []).slice(-(k + 1)).filter(ok);
    let up = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[i - 1]) up++;
    return { up, of: Math.max(0, a.length - 1) };
  }
  function priceOn(c, date) {
    const d = c.dates;
    let lo = 0, hi = d.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans >= 0 ? c.prices[ans] : null;
  }
  function historicPE(c) {
    if (!c.years || !c.prices || !c.dates) return null;
    const out = [];
    c.years.slice(-6).forEach((lab, j, arr) => {
      const i = c.years.length - arr.length + j;
      const yr = +lab.slice(-4), eps = c.pl.eps[i];
      const p = priceOn(c, new Date(yr, 2, 31));
      if (ok(p) && eps > 0) out.push(p / eps);
    });
    return med(out);
  }
  function sourceNote(c) {
    return c.live ? '' : '\n\n*Figures are sample data for illustration, not actual reported numbers.*';
  }

  /* ---------- company sections ---------- */
  function snapshot(c) {
    const m = c.metrics;
    return '**' + c.name + '** (' + c.symbol + ') is a ' + size(m) + ' company in **' + c.industry + '** (' + c.sector + '), valued at **' + cr(m.marketCap) + '**. ' +
      'It trades at ' + rs(m.price) + ', a P/E of **' + x(m.pe) + '** against an industry median of ' + x(m.industryPE) + '. ' +
      'Trailing twelve-month sales are ' + cr(m.sales) + ' with net profit of ' + cr(m.np) + ' and an operating margin of ' + pc(m.opm) + '.';
  }
  function growth(c) {
    const m = c.metrics, s = upYears(c.pl.sales, 5), p = upYears(c.pl.np, 5);
    const g = grade(m.salesGrowth5, 15, 8);
    const lines = [
      '- Sales CAGR: **' + pc(m.salesGrowth3) + '** (3 yr), ' + pc(m.salesGrowth5) + ' (5 yr), ' + pc(m.salesGrowth10) + ' (10 yr)',
      '- Profit CAGR: **' + pc(m.profitGrowth3) + '** (3 yr), ' + pc(m.profitGrowth5) + ' (5 yr), ' + pc(m.profitGrowth10) + ' (10 yr)',
      '- Consistency: sales grew in ' + s.up + ' of the last ' + s.of + ' years, profit in ' + p.up + ' of ' + p.of
    ];
    let verdict = g === 'strong' ? 'Growth has been **strong**.' : g === 'moderate' ? 'Growth has been **moderate**.' : g === 'weak' ? 'Growth has been **slow**.' : 'Not enough history to judge growth.';
    if (ok(m.profitGrowth5) && ok(m.salesGrowth5)) {
      if (m.profitGrowth5 > m.salesGrowth5 + 2) verdict += ' Profits grew faster than sales, which points to improving margins or operating leverage.';
      else if (m.profitGrowth5 < m.salesGrowth5 - 2) verdict += ' Profits grew slower than sales, so margins have been under pressure.';
      else verdict += ' Profits have broadly kept pace with sales.';
    }
    return '## Growth\n' + lines.join('\n') + '\n\n' + verdict;
  }
  function profitability(c) {
    const m = c.metrics, avgOpm = med(c.pl.opm.slice(-5));
    const lines = [
      '- Operating margin (TTM): **' + pc(m.opm) + '** vs 5-year median ' + pc(avgOpm),
      '- ROCE: **' + pc(m.roce) + '** (5-yr average ' + pc(m.avgRoce5) + ')',
      '- ROE: **' + pc(m.roe) + '** (5-yr average ' + pc(m.avgRoe5) + ')'
    ];
    const q = grade(m.avgRoce5, 20, 12);
    let verdict = q === 'strong' ? 'Returns on capital are **excellent**, a sign of a durable competitive advantage.'
      : q === 'moderate' ? 'Returns on capital are **reasonable**.' : q === 'weak' ? 'Returns on capital are **low**, so each rupee invested earns relatively little.' : '';
    if (ok(m.opm) && ok(avgOpm)) verdict += m.opm > avgOpm + 1.5 ? ' Margins are currently above their recent average.' : m.opm < avgOpm - 1.5 ? ' Margins are currently below their recent average.' : ' Margins are in line with their recent average.';
    if (isFin(c)) verdict += ' For lenders, operating margin is less meaningful; focus on ROE and asset quality.';
    return '## Profitability\n' + lines.join('\n') + '\n\n' + verdict.trim();
  }
  function balance(c) {
    const m = c.metrics, b = c.bs.borrowings, L = b.length - 1;
    const prev = L >= 3 ? b[L - 3] : null;
    const lines = [
      '- Debt to equity: **' + (ok(m.de) ? n(m.de, 2) : 'n/a') + '** (borrowings ' + cr(m.debt) + ')',
      '- Interest coverage: **' + (ok(m.interestCoverage) ? (m.interestCoverage >= 999 ? 'no interest cost' : x(m.interestCoverage)) : 'n/a') + '**',
      ok(prev) && ok(b[L]) ? '- Borrowings over 3 years: ' + cr(prev) + ' → ' + cr(b[L]) + (b[L] < prev ? ' (reduced)' : b[L] > prev * 1.2 ? ' (rising)' : ' (stable)') : null
    ].filter(Boolean);
    let verdict;
    if (isFin(c)) verdict = 'As a financial company, high leverage is part of the business model; judge it by capital adequacy and asset quality rather than debt to equity.';
    else if (!ok(m.de)) verdict = 'Leverage data is not available.';
    else if (m.de < 0.1) verdict = 'The company is **almost debt free**, which gives it a strong cushion.';
    else if (m.de < 0.5) verdict = 'Leverage is **comfortable**.';
    else if (m.de < 1) verdict = 'Leverage is **moderate**; worth monitoring.';
    else verdict = 'Leverage is **high**, which raises risk if earnings slow.';
    return '## Balance sheet\n' + lines.join('\n') + '\n\n' + verdict;
  }
  function cashflow(c) {
    const f = c.cf, np = c.pl.np;
    const k = Math.min(3, f.cfo.length);
    const cfo3 = f.cfo.slice(-k).filter(ok).reduce((a, v) => a + v, 0), np3 = np.slice(-k).filter(ok).reduce((a, v) => a + v, 0);
    const conv = np3 > 0 ? cfo3 / np3 * 100 : null;
    const lines = [
      '- Operating cash flow (last year): **' + cr(lastOf(f.cfo)) + '**',
      '- Free cash flow (last year): **' + cr(c.metrics.fcf) + '**',
      ok(conv) ? '- Cash conversion (operating cash ÷ net profit, last ' + k + ' yrs): **' + pc(conv, 0) + '**' : null
    ].filter(Boolean);
    const verdict = !ok(conv) ? '' : conv >= 90 ? 'Profits are **well backed by cash**.' : conv >= 60 ? 'Cash conversion is **acceptable**.' : 'Cash conversion is **weak**: reported profit is not fully turning into cash, often because of working capital build-up.';
    return '## Cash flow\n' + lines.join('\n') + (verdict ? '\n\n' + verdict : '');
  }
  function valuation(c) {
    const m = c.metrics, hpe = historicPE(c);
    const lines = [
      '- P/E: **' + x(m.pe) + '** vs industry median ' + x(m.industryPE) + (ok(hpe) ? ' and its own 5-year median ~' + x(hpe) : ''),
      '- P/B: ' + x(m.pb) + ' · EV/EBITDA: ' + x(m.evEbitda) + ' · PEG: ' + (ok(m.peg) ? n(m.peg, 2) : 'n/a'),
      '- Earnings yield: ' + pc(m.earningsYield) + ' · Dividend yield: ' + pc(m.divYield, 2)
    ];
    const parts = [];
    if (!ok(m.pe) || m.pe <= 0) parts.push('P/E is not meaningful because trailing earnings are negative or unavailable.');
    else {
      if (ok(m.industryPE)) parts.push(m.pe > m.industryPE * 1.2 ? 'The stock trades at a **premium to its industry**.' : m.pe < m.industryPE * 0.8 ? 'The stock trades at a **discount to its industry**.' : 'The stock is valued **in line with its industry**.');
      if (ok(hpe)) parts.push(m.pe > hpe * 1.15 ? 'It is also above its own historical multiple.' : m.pe < hpe * 0.85 ? 'It is below its own historical multiple.' : 'It is close to its own historical multiple.');
      if (ok(m.peg)) parts.push(m.peg < 1 ? 'A PEG below 1 suggests the price is modest relative to past profit growth.' : m.peg > 2 ? 'A PEG above 2 means the price already assumes strong future growth.' : 'The PEG is in a middle range.');
    }
    return '## Valuation\n' + lines.join('\n') + '\n\n' + parts.join(' ');
  }
  function ownership(c) {
    const m = c.metrics;
    const lines = c.live
      ? ['- Insiders/promoters: **' + pc(m.promoter, 2) + '**', '- Institutions: **' + pc(m.fii, 2) + '**']
      : ['- Promoters: **' + pc(m.promoter, 2) + '**' + (ok(m.promoterChange3y) && Math.abs(m.promoterChange3y) >= 0.01 ? ' (' + (m.promoterChange3y >= 0 ? '+' : '') + n(m.promoterChange3y, 2) + ' pts over the period shown)' : ''),
        '- FIIs: ' + pc(m.fii, 2) + ' · DIIs: ' + pc(m.dii, 2) + ' · Public: ' + pc(m.public, 2),
        ok(m.pledged) ? '- Pledged promoter shares: ' + pc(m.pledged, 2) : null].filter(Boolean);
    let verdict = !ok(m.promoter) ? '' : m.promoter === 0 ? 'There is no identifiable promoter group; the company is widely held by institutions and the public.'
      : m.promoter >= 50 ? 'Promoters hold a **controlling stake**, which aligns their interests with shareholders.' : 'Promoter holding is **below 50%**.';
    if (ok(m.pledged) && m.pledged > 5) verdict += ' Pledging above 5% is a risk to watch.';
    return '## Ownership\n' + lines.join('\n') + (verdict ? '\n\n' + verdict : '');
  }
  function pricePerf(c) {
    const m = c.metrics, pos = ok(m.high52) && ok(m.low52) && m.high52 > m.low52 ? (m.price - m.low52) / (m.high52 - m.low52) * 100 : null;
    const lines = [
      '- Returns: 1 month ' + pc(m.ret1m) + ' · 6 months ' + pc(m.ret6m) + ' · 1 year **' + pc(m.ret1y) + '** · 3 yr CAGR ' + pc(m.ret3y) + ' · 5 yr CAGR ' + pc(m.ret5y),
      '- 52-week range: ' + rs(m.low52) + ' – ' + rs(m.high52) + (ok(pos) ? ' (price is ' + n(pos, 0) + '% of the way up the range)' : ''),
      '- Moving averages: 50 DMA ' + rs(m.dma50) + ' · 200 DMA ' + rs(m.dma200)
    ];
    let t = '';
    if (ok(m.dma50) && ok(m.dma200)) t = m.price > m.dma50 && m.dma50 > m.dma200 ? 'The price is above both averages: an **uptrend**.' : m.price < m.dma50 && m.dma50 < m.dma200 ? 'The price is below both averages: a **downtrend**.' : 'The trend is **mixed**.';
    return '## Price performance\n' + lines.join('\n') + (t ? '\n\n' + t : '');
  }
  function quarter(c) {
    const q = c.q, L = q.sales.length - 1;
    if (L < 0) return '## Latest quarter\nQuarterly results are not available.';
    const qoq = (a) => (L >= 1 && ok(a[L]) && ok(a[L - 1]) && a[L - 1] > 0 ? (a[L] / a[L - 1] - 1) * 100 : null);
    const yoy = (a) => (L >= 4 && ok(a[L]) && ok(a[L - 4]) && a[L - 4] > 0 ? (a[L] / a[L - 4] - 1) * 100 : null);
    const opmPrev = L >= 4 ? q.opm[L - 4] : null;
    const lines = [
      '- Sales: **' + cr(q.sales[L]) + '** · YoY ' + pc(yoy(q.sales)) + ' · QoQ ' + pc(qoq(q.sales)),
      '- Net profit: **' + cr(q.np[L]) + '** · YoY ' + pc(yoy(q.np)) + ' · QoQ ' + pc(qoq(q.np)),
      '- Operating margin: **' + pc(q.opm[L]) + '**' + (ok(opmPrev) ? ' vs ' + pc(opmPrev) + ' a year ago' : ''),
      '- EPS: ' + rs(q.eps[L])
    ];
    const sy = yoy(q.sales), py = yoy(q.np);
    let v = '';
    if (ok(sy) && ok(py)) {
      v = sy >= 10 && py >= 10 ? 'A **strong quarter**: both sales and profit grew double digits year on year.'
        : sy >= 0 && py >= 0 ? 'A **steady quarter** with growth in both sales and profit.'
        : sy >= 0 && py < 0 ? 'Sales grew but **profit fell**, so costs rose faster than revenue.'
        : sy < 0 && py >= 0 ? 'Sales dipped but profit held up, helped by margins or other income.'
        : 'A **weak quarter**: both sales and profit fell year on year.';
      if (ok(q.opm[L]) && ok(opmPrev)) v += q.opm[L] > opmPrev + 1 ? ' Margins expanded.' : q.opm[L] < opmPrev - 1 ? ' Margins contracted.' : '';
    }
    return '## Latest quarter (' + c.quarters[L] + ')\n' + lines.join('\n') + (v ? '\n\n' + v : '');
  }
  function peers(c) {
    const all = Data.listCompanies().filter(p => p.sector === c.sector);
    if (all.length < 2) return '## Peers\nNo peers in the same sector are covered yet.';
    const rank = (k, asc) => {
      const s = all.filter(p => ok(p.metrics[k]) && (k !== 'pe' || p.metrics[k] > 0)).sort((a, b) => asc ? a.metrics[k] - b.metrics[k] : b.metrics[k] - a.metrics[k]);
      const i = s.findIndex(p => p.symbol === c.symbol);
      return i < 0 ? 'n/a' : '#' + (i + 1) + ' of ' + s.length;
    };
    const rows = all.sort((a, b) => b.metrics.marketCap - a.metrics.marketCap).slice(0, 6);
    return '## Peers in ' + c.sector + '\n' +
      '- Market cap rank: **' + rank('marketCap') + '** · ROCE rank: **' + rank('roce') + '** · 5-yr sales growth rank: **' + rank('salesGrowth5') + '** · Cheapest P/E rank: **' + rank('pe', true) + '**\n\n' +
      '| Company | P/E | ROCE % | Sales 5y % | D/E |\n|---|---|---|---|---|\n' +
      rows.map(p => '| ' + (p.symbol === c.symbol ? '**' + p.symbol + '**' : '[' + p.symbol + '](#/company/' + p.symbol + ')') + ' | ' + n(p.metrics.pe, 1) + ' | ' + n(p.metrics.roce, 1) + ' | ' + n(p.metrics.salesGrowth5, 1) + ' | ' + n(p.metrics.de, 2) + ' |').join('\n');
  }
  function bullBear(c) {
    const m = c.metrics, bull = [], bear = [], fin = isFin(c), hpe = historicPE(c);
    if (m.salesGrowth5 >= 12) bull.push('Sales have compounded at ' + pc(m.salesGrowth5) + ' over 5 years.');
    if (m.profitGrowth5 >= 12) bull.push('Profits have compounded at ' + pc(m.profitGrowth5) + ' over 5 years.');
    if (m.avgRoce5 >= 18) bull.push('High returns on capital (5-yr ROCE ' + pc(m.avgRoce5) + ').');
    if (!fin && m.de < 0.3) bull.push('Low leverage (debt to equity ' + n(m.de, 2) + ').');
    if (m.fcf > 0 && m.np > 0 && m.fcf > m.np * 0.5) bull.push('Healthy free cash flow of ' + cr(m.fcf) + '.');
    if (m.qtrProfitVar >= 10) bull.push('Latest quarter profit up ' + pc(m.qtrProfitVar) + ' year on year.');
    if (ok(m.pe) && ok(m.industryPE) && m.pe > 0 && m.pe < m.industryPE * 0.85) bull.push('Trades below the industry P/E (' + x(m.pe) + ' vs ' + x(m.industryPE) + ').');
    if (m.divYield >= 2) bull.push('Dividend yield of ' + pc(m.divYield, 2) + '.');
    if (m.promoter >= 50) bull.push('Promoters hold ' + pc(m.promoter) + '.');
    if (m.salesGrowth5 < 8) bear.push('Slow 5-year sales growth of ' + pc(m.salesGrowth5) + '.');
    if (m.profitGrowth5 < 5) bear.push('Weak 5-year profit growth of ' + pc(m.profitGrowth5) + '.');
    if (m.avgRoce5 < 12) bear.push('Modest returns on capital (5-yr ROCE ' + pc(m.avgRoce5) + ').');
    if (!fin && m.de > 1) bear.push('High leverage (debt to equity ' + n(m.de, 2) + ').');
    if (!fin && ok(m.interestCoverage) && m.interestCoverage < 3) bear.push('Thin interest coverage (' + x(m.interestCoverage) + ').');
    if (m.qtrProfitVar < 0) bear.push('Latest quarter profit fell ' + pc(Math.abs(m.qtrProfitVar)) + ' year on year.');
    if (ok(m.pe) && ok(m.industryPE) && m.pe > m.industryPE * 1.3) bear.push('Premium valuation (' + x(m.pe) + ' vs industry ' + x(m.industryPE) + ').');
    if (ok(hpe) && ok(m.pe) && m.pe > hpe * 1.25) bear.push('P/E above its own historical median (~' + x(hpe) + ').');
    if (m.pledged > 5) bear.push('Promoter pledging of ' + pc(m.pledged) + '.');
    if (m.ret1y < -15) bear.push('Stock is down ' + pc(Math.abs(m.ret1y)) + ' over the past year.');
    if (!bull.length) bull.push('An established ' + size(m) + ' player in ' + c.industry + '.');
    if (!bear.length) bear.push('Strong fundamentals may already be priced in; the key risk is a slowdown that de-rates the multiple.');
    return '## Bull case\n' + bull.slice(0, 6).map(s => '- ' + s).join('\n') + '\n\n## Bear case\n' + bear.slice(0, 6).map(s => '- ' + s).join('\n');
  }
  function watchList(c) {
    const m = c.metrics, w = [];
    w.push('Whether the operating margin holds near ' + pc(m.opm) + ' in the next quarters.');
    if (!isFin(c) && m.de > 0.5) w.push('Progress on reducing borrowings (' + cr(m.debt) + ').');
    if (m.qtrSalesVar < 5) w.push('A pick-up in sales growth (latest quarter ' + pc(m.qtrSalesVar) + ' YoY).');
    if (ok(m.pe) && ok(m.industryPE) && m.pe > m.industryPE) w.push('Earnings delivery that justifies the premium P/E.');
    w.push('Changes in promoter and institutional holdings.');
    return '## What to watch\n' + w.map(s => '- ' + s).join('\n');
  }
  function fullReport(c) {
    return '## Snapshot\n' + snapshot(c) + '\n\n' + growth(c) + '\n\n' + profitability(c) + '\n\n' + balance(c) + '\n\n' + cashflow(c) + '\n\n' +
      valuation(c) + '\n\n' + ownership(c) + '\n\n' + bullBear(c) + '\n\n' + watchList(c);
  }

  const INTENTS = [
    ['quarter', /quarter|result|\bq[1-4]\b|latest numbers/, quarter],
    ['valuation', /valu|\bp\/?e\b|expensive|cheap|price to|multiple|\bpeg\b|worth|fair/, valuation],
    ['bullbear', /bull|bear|\bcase\b|pros|cons|strength|weakness|risk|should i|buy|sell|invest/, bullBear],
    ['balance', /debt|balance|borrow|leverage|liquidity|solven|interest cover/, balance],
    ['cash', /cash|fcf|capex|working capital/, cashflow],
    ['growth', /grow|sales|revenue|cagr|top ?line/, growth],
    ['profit', /margin|profitab|\broe\b|\broce\b|return on|efficien|\bopm\b/, profitability],
    ['ownership', /promoter|holding|\bfii\b|\bdii\b|institution|sharehold|pledg|owner/, ownership],
    ['price', /\b52\b|week high|week low|return|perform|momentum|\bdma\b|moving average|price action|share price|stock price|trend/, pricePerf],
    ['peers', /peer|competitor|rival|industry|sector|compare/, peers],
    ['dividend', /dividend|payout|yield/, valuation]
  ];
  function latestConcall(c) {
    const f = c._filings, notes = (f && f.notes) || {};
    const calls = ((f && f.announcements) || []).filter(a => a.k === 'transcript' && notes[a.u] && notes[a.u].sections);
    return calls.length ? { a: calls[0], n: notes[calls[0].u] } : null;
  }
  function concall(c) {
    const lc = latestConcall(c);
    if (!lc) {
      return '## Latest concall\nNo summarised concall transcript is available for ' + c.name + ' yet. Transcripts are summarised automatically once the exchange filing has been fetched ' +
        '(see the **Concalls** panel under Documents).';
    }
    const S = lc.n.sections;
    return '## Latest concall (' + new Date(lc.n.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ')\n' +
      'Management tone: **' + lc.n.tone + '**.\n\n' +
      Object.keys(S).map(k => '**' + k + '**\n' + S[k].map(x => '- ' + x).join('\n')).join('\n\n') +
      '\n\n*Key sentences from the transcript, in management\'s own words.*';
  }
  function answerCompany(c, q) {
    const t = q.toLowerCase();
    if (window.Insights) {
      const locked = window.Account && !Account.isPro();
      const upsell = what => '## ' + what + ' (Sankhyas Pro)\n' + what + ' for ' + c.name + ' is part of **Sankhyas Pro**.' +
        (what === 'Red-flag scan' ? ' Free preview: the red-flag score is **' + Insights.redFlags(c).score + '/100**.' : '') + '\n\n[See Pro plans](#/premium)';
      if (locked && /red ?flags?|forensic|fraud|manipulat|accounting (issue|quality)|warning signs?|risk score|governance/.test(t)) return upsell('Red-flag scan');
      if (locked && /what('?s| has| have)? (changed|new)|changes? (since|this quarter|vs|from)|latest (update|changes)/.test(t)) return upsell('What changed');
      if (locked && /guidance|promis|track record|deliver(ed|y)? on|credib|execution/.test(t)) return upsell('Guidance tracker');
      if (/sankhyas score|\bscore\b|rating out of|how (good|strong) is/.test(t) && Insights.scoreOf) {
        const sc = Insights.scoreOf(c.symbol);
        if (sc && sc.score != null) {
          return '## Sankhyas Score: ' + sc.score + '/100 (' + Insights.scoreBand(sc.score) + ')\n' + (sc.sectorRank ? 'Ranked #' + sc.sectorRank + ' of ' + sc.sectorSize + ' in ' + c.sector + '.\n' : '') +
            (locked ? '\nThe five pillars (quality, growth, value, momentum, safety) are part of **Sankhyas Pro**. [See Pro plans](#/premium)'
              : Insights.PILLARS.map(([id, label]) => '- **' + label + '**: ' + (sc.pillars[id] == null ? 'n/a' : sc.pillars[id] + '/100')).join('\n')) +
            '\n\n*Each pillar is a percentile rank against all listed companies; higher is better. It is a research aid, not a recommendation.*' + sourceNote(c);
        }
      }
      if (/red ?flags?|forensic|fraud|manipulat|accounting (issue|quality)|warning signs?|risk score|governance/.test(t)) return Insights.redFlagsMd(c) + sourceNote(c);
      if (/what('?s| has| have)? (changed|new)|changes? (since|this quarter|vs|from)|latest (update|changes)/.test(t)) return Insights.whatChangedMd(c) + sourceNote(c);
      if (/guidance|promis|track record|deliver(ed|y)? on|credib|execution/.test(t)) return Insights.guidanceMd(c) + sourceNote(c);
    }
    if (/concall|con call|conference call|earnings call|transcript|management (said|say|commentary|guidance)|what did management/.test(t)) return concall(c);
    if (/report|full|detailed|everything|overview|analy[sz]|deep dive|summar|tell me about|explain the company/.test(t)) return fullReport(c) + sourceNote(c);
    const hit = [];
    INTENTS.forEach(([id, re, fn]) => { if (re.test(t) && hit.indexOf(fn) < 0) hit.push(fn); });
    let out = hit.slice(0, 3).map(fn => fn(c)).join('\n\n');
    if (/should i|buy|sell|invest/.test(t)) out += '\n\n*Sankhyas AI does not give buy or sell recommendations. Use the evidence above with your own research.*';
    if (!out) {
      out = '## Snapshot\n' + snapshot(c) + '\n\nI can summarise the **latest concall** and analyse **growth, profitability, balance sheet, cash flow, valuation, the latest quarter, ownership, price performance, peers** and the **bull and bear case**, or write a **full report**. Try asking about one of those.';
    }
    return out + sourceNote(c);
  }

  /* ---------- plain-English parser (shared by screens and Ask AI) ---------- */
  const METRIC_WORDS = [
    ['return on capital employed', 'roce'], ['roce', 'roce'], ['return on equity', 'roe'], ['roe', 'roe'],
    ['price to earnings', 'pe'], ['price to earning', 'pe'], ['pe ratio', 'pe'], ['p/e', 'pe'], ['pe', 'pe'], ['valuation', 'pe'],
    ['price to book', 'pb'], ['p/b', 'pb'], ['pb', 'pb'], ['book value', 'bookValue'],
    ['market capitalization', 'marketCap'], ['market capitalisation', 'marketCap'], ['market cap', 'marketCap'], ['mcap', 'marketCap'],
    ['dividend yield', 'divYield'], ['dividends', 'divYield'], ['dividend', 'divYield'],
    ['debt to equity', 'de'], ['d/e', 'de'], ['leverage', 'de'], ['borrowings', 'de'], ['debt', 'de'],
    ['operating profit margin', 'opm'], ['operating margin', 'opm'], ['opm', 'opm'], ['margins', 'opm'], ['margin', 'opm'],
    ['quarterly sales growth', 'qtrSalesVar'], ['quarterly revenue growth', 'qtrSalesVar'], ['quarterly profit growth', 'qtrProfitVar'],
    ['quarterly growth', 'qtrProfitVar'], ['latest quarter', 'qtrProfitVar'], ['recent quarter', 'qtrProfitVar'], ['quarterly', 'qtrProfitVar'],
    ['sales growth', 'salesGrowth'], ['revenue growth', 'salesGrowth'], ['top line growth', 'salesGrowth'], ['growing sales', 'salesGrowth'],
    ['profit growth', 'profitGrowth'], ['earnings growth', 'profitGrowth'], ['growing profits', 'profitGrowth'], ['growth', 'salesGrowth'], ['growing', 'salesGrowth'],
    ['promoter holding', 'promoter'], ['promoters', 'promoter'], ['promoter', 'promoter'], ['fii holding', 'fii'], ['fiis', 'fii'], ['fii', 'fii'],
    ['dii holding', 'dii'], ['diis', 'dii'], ['dii', 'dii'], ['pledged', 'pledged'], ['pledge', 'pledged'],
    ['peg', 'peg'], ['ev/ebitda', 'evEbitda'], ['ev to ebitda', 'evEbitda'], ['interest coverage', 'interestCoverage'],
    ['free cash flow', 'fcf'], ['fcf', 'fcf'], ['cash flow', 'fcf'], ['earnings yield', 'earningsYield'], ['earnings per share', 'eps'], ['eps', 'eps'],
    ['returns', 'ret'], ['return', 'ret'], ['performance', 'ret'], ['momentum', 'ret'],
    ['net profit', 'np'], ['profits', 'np'], ['profit', 'np'], ['sales', 'sales'], ['revenue', 'sales'],
    ['share price', 'price'], ['current price', 'price'], ['price', 'price'], ['cmp', 'price']
  ].sort((a, b) => b[0].length - a[0].length);
  const LOWER_IS_BETTER = { pe: 1, pb: 1, de: 1, peg: 1, evEbitda: 1, pledged: 1 };
  const THRESH = {
    roe: [20, 10], roce: [20, 10], pe: [40, 15], pb: [8, 1.5], divYield: [2, 0.5], de: [1, 0.3], opm: [20, 8],
    salesGrowth5: [15, 5], salesGrowth3: [15, 5], salesGrowth10: [15, 5], profitGrowth5: [15, 5], profitGrowth3: [15, 5], profitGrowth10: [15, 5],
    promoter: [60, 30], fii: [25, 10], dii: [15, 5], marketCap: [100000, 10000], ret1y: [25, 0], ret3y: [20, 5], ret5y: [18, 5],
    qtrSalesVar: [15, 0], qtrProfitVar: [15, 0], peg: [2, 1], evEbitda: [25, 10], interestCoverage: [10, 3], fcf: [5000, 0],
    earningsYield: [6, 3], np: [5000, 0], sales: [50000, 5000], eps: [100, 10], pledged: [5, 0.5], price: [5000, 200], bookValue: [1000, 100]
  };
  const HIGH_WORDS = /\b(high|higher|strong|stronger|good|great|healthy|large|big|better|excellent|fast|faster|rapid|superior|solid|decent|rising|improving)\b/;
  const LOW_WORDS = /\b(low|lower|weak|poor|small|less|little|minimal|cheap|cheaper|limited|modest|falling|declining)\b/;
  const SPECIAL = [
    [/\b(debt[- ]free|zero debt|no debt|without debt|little or no debt)\b/, 'Debt to equity < 0.1'],
    [/\b(large[- ]?caps?|blue[- ]?chips?)\b/, 'Market Capitalization > 50000'],
    [/\bmid[- ]?caps?\b/, 'Market Capitalization > 15000 AND Market Capitalization < 50000'],
    [/\bsmall[- ]?caps?\b/, 'Market Capitalization < 15000'],
    [/\b(undervalued|value stocks?|trading below (their )?industry)\b/, 'Price to Earning < Industry PE AND Price to Earning > 0'],
    [/\bnear (the |their )?52[- ]?week lows?\b/, 'Current price < Low price * 1.15'],
    [/\bnear (the |their )?52[- ]?week highs?\b/, 'Current price > High price * 0.9'],
    [/\bgolden cross(over)?\b/, 'DMA 50 > DMA 200'],
    [/\babove (the )?200[- ]?dma\b/, 'Current price > DMA 200'],
    [/\b(loss[- ]making)\b/, 'Net profit < 0'],
    [/\b(no|zero|nil) pledg(e|ing|ed)\b/, 'Pledged percentage < 0.1'],
    [/\bdividend[- ]paying\b/, 'Dividend yield > 0']
  ];
  const WORD_NUM = { one: 1, two: 2, three: 3, five: 5, ten: 10 };
  function keyFor(base, text) {
    const yr = text.match(/\b(\d+|one|three|five|ten)[- ]?(y|yr|yrs|year|years)\b/);
    const y = yr ? (WORD_NUM[yr[1]] || +yr[1]) : null;
    if (base === 'salesGrowth' || base === 'profitGrowth') return base + (y === 3 ? '3' : y === 10 ? '10' : '5');
    if (base === 'ret') return y === 3 ? 'ret3y' : y === 5 ? 'ret5y' : 'ret1y';
    return base;
  }
  function parseNumber(s) {
    const m = s.match(/(-?\d+(?:[.,]\d+)*)\s*(%|percent|x|times|lakh crores?|lakh cr|l cr|thousand crores?|k cr|crores?|cr)?/);
    if (!m) return null;
    let v = parseFloat(m[1].replace(/,/g, ''));
    const u = m[2] || '';
    if (/lakh|l cr/.test(u)) v *= 100000;
    else if (/thousand|k cr/.test(u)) v *= 1000;
    return v;
  }
  const GT = /(above|over|greater than|more than|exceeding|higher than|at least|minimum|min\.?|not less than|>=|>|\+)/;
  const LT = /(below|under|less than|lower than|at most|maximum|max\.?|not more than|up to|within|<=|<)/;
  /** Parse free text into screen conditions. Returns {conds: [query fragments], used: [keys]}. */
  function parseConditions(text) {
    let t = ' ' + text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
    const conds = [], used = [];
    SPECIAL.forEach(([re, q]) => { if (re.test(t)) { conds.push(q); t = t.replace(re, ' '); } });
    // find metric mentions
    const hits = [];
    METRIC_WORDS.forEach(([w, k]) => {
      const re = new RegExp('(^|[^a-z/])(' + w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ')(?![a-z])', 'g');
      let m;
      while ((m = re.exec(t))) {
        const s = m.index + m[1].length, e = s + m[2].length;
        if (!hits.some(h => s < h.e && e > h.s)) hits.push({ s, e, base: k });
      }
    });
    hits.sort((a, b) => a.s - b.s);
    hits.forEach((h, i) => {
      const nextS = i + 1 < hits.length ? hits[i + 1].s : t.length;
      const prevE = i ? hits[i - 1].e : 0;
      const after = t.slice(h.e, nextS), before = t.slice(prevE, h.s);
      const ctx = before.slice(-40) + ' ' + t.slice(h.s, h.e) + ' ' + after.slice(0, 40);
      const key = keyFor(h.base, ctx);
      if (!Screener.BY_KEY[key]) return;
      const name = Screener.BY_KEY[key].name;
      const seg = after.split(/\b(and|with|but|,|;)\b/)[0];
      const between = seg.match(/between\s+([^a]+?)\s+(?:and|to|-)\s+([\d.,]+\s*\S*)/) || after.match(/between\s+([\d.,]+[^ ]*)\s+(?:and|to|-)\s+([\d.,]+\s*\S*)/);
      let cond = null;
      if (between) {
        const a = parseNumber(between[1]), b = parseNumber(between[2]);
        if (ok(a) && ok(b)) cond = name + ' > ' + Math.min(a, b) + ' AND ' + name + ' < ' + Math.max(a, b);
      }
      const tryCmp = (s) => {
        const g = s.match(new RegExp(GT.source + '\\s*(of\\s*)?(-?[\\d.,]+[^a-z]*(?:%|x|lakh crores?|lakh cr|crores?|cr)?)'));
        const l = s.match(new RegExp(LT.source + '\\s*(of\\s*)?(-?[\\d.,]+[^a-z]*(?:%|x|lakh crores?|lakh cr|crores?|cr)?)'));
        const gi = g ? g.index : Infinity, li = l ? l.index : Infinity;
        if (g && gi <= li) { const v = parseNumber(g[3]); if (ok(v)) return name + ' > ' + v; }
        if (l) { const v = parseNumber(l[3]); if (ok(v)) return name + ' < ' + v; }
        return null;
      };
      if (!cond) cond = tryCmp(seg.slice(0, 50));
      if (!cond) {
        const b = before.slice(-35);
        const m2 = b.match(new RegExp(GT.source + '\\s*(-?[\\d.,]+\\s*(?:%|x|lakh crores?|crores?|cr)?)\\s*$')) ;
        const m3 = b.match(new RegExp(LT.source + '\\s*(-?[\\d.,]+\\s*(?:%|x|lakh crores?|crores?|cr)?)\\s*$'));
        if (m2) { const v = parseNumber(m2[2]); if (ok(v)) cond = name + ' > ' + v; }
        else if (m3) { const v = parseNumber(m3[2]); if (ok(v)) cond = name + ' < ' + v; }
      }
      if (!cond) {
        const bt = before.match(/between\s+(-?[\d.,]+)\s*%?\s*(?:and|to|-)\s*(-?[\d.,]+\s*(?:%|x|lakh crores?|crores?|cr)?)\s*$/);
        if (bt) { const a = parseNumber(bt[1]), b = parseNumber(bt[2]); if (ok(a) && ok(b)) cond = name + ' > ' + Math.min(a, b) + ' AND ' + name + ' < ' + Math.max(a, b); }
      }
      if (!cond && THRESH[key]) {
        // the adjective closest to the ratio wins: the two words before it, else the words after it in the same clause
        const prev = before.trim().split(' ').slice(-2).join(' ');
        const next = seg.slice(0, 24);
        const pick = str => (HIGH_WORDS.test(str) && !LOW_WORDS.test(str) ? 'hi' : LOW_WORDS.test(str) && !HIGH_WORDS.test(str) ? 'lo' : null);
        const dir = pick(prev) || pick(next);
        if (dir === 'hi') cond = name + ' > ' + THRESH[key][0];
        else if (dir === 'lo') cond = name + ' < ' + THRESH[key][1];
      }
      if (cond && conds.indexOf(cond) < 0) { conds.push(cond); if (used.indexOf(key) < 0) used.push(key); }
    });
    return { conds, used, hits: hits.map(h => keyFor(h.base, t.slice(Math.max(0, h.s - 30), h.e + 30))) };
  }
  function screenQuery(description) {
    const { conds } = parseConditions(description);
    if (!conds.length) {
      throw { code: 'no_match', message: 'Could not find any ratios in that description. Try something like "debt free companies with ROE above 20% and sales growth over 12%".' };
    }
    return conds.join(' AND ');
  }

  /* ---------- market questions (Ask AI page) ---------- */
  // each entry lists the sector names used by the sample data and by Yahoo Finance
  const SECTOR_WORDS = [
    [/\b(it|tech|technology|software|information technology)\b/, ['Information Technology', 'Technology']],
    [/\b(banks?|banking|financials?|finance|financial services|nbfcs?|lenders?|insurance)\b/, ['Financials', 'Financial Services']],
    [/\b(fmcg|consumer staples|staples|consumer defensive)\b/, ['FMCG', 'Consumer Defensive']],
    [/\b(pharma|pharmaceuticals?|healthcare|hospitals?|health)\b/, ['Healthcare']],
    [/\b(autos?|automobiles?|automotive|cars|two[- ]wheelers?|consumer cyclical)\b/, ['Automobile', 'Consumer Cyclical']],
    [/\b(energy|oil|gas|coal|refiners?)\b/, ['Energy']],
    [/\b(metals?|steel|cement|materials|basic materials|chemicals?)\b/, ['Materials', 'Basic Materials']],
    [/\b(power|utilities|utility|electricity)\b/, ['Utilities']],
    [/\b(telecom|telecommunications?|communication services|media)\b/, ['Telecom', 'Communication Services']],
    [/\b(real estate|realty|property|reits?)\b/, ['Real Estate']],
    [/\b(retail|retailers?)\b/, ['Retail', 'Consumer Cyclical']],
    [/\b(industrials?|infra|infrastructure|capital goods|engineering|defen[cs]e)\b/, ['Industrials']],
    [/\b(consumer durables?|durables|paints?|jewell?ery)\b/, ['Consumer Durables', 'Consumer Cyclical']],
    [/\b(textiles?|apparel)\b/, ['Textiles', 'Consumer Cyclical']],
    [/\b(consumer services|travel|tourism)\b/, ['Consumer Services', 'Consumer Cyclical']]
  ];
  function findSector(t, all) {
    const have = new Set(all.map(c => c.sector));
    for (const [re, names] of SECTOR_WORDS) if (re.test(t)) { const hit = names.find(s => have.has(s)); if (hit) return hit; }
    for (const s of have) if (t.indexOf(s.toLowerCase()) >= 0) return s;
    return null;
  }
  function findCompany(t, all) {
    let best = null;
    all.forEach(c => {
      const sym = c.symbol.toLowerCase(), first = c.name.toLowerCase().replace(/ (ltd|limited)\.?$/, '');
      if (new RegExp('\\b' + sym.replace(/[-&]/g, '.') + '\\b').test(t) || t.indexOf(first) >= 0) {
        if (!best || first.length > best.len) best = { c, len: first.length };
      }
    });
    return best && best.c;
  }
  const COLS = { pe: 'P/E', roce: 'ROCE %', roe: 'ROE %', de: 'D/E', opm: 'OPM %', salesGrowth5: 'Sales 5y %', profitGrowth5: 'Profit 5y %', marketCap: 'Mcap Cr', divYield: 'Div yld %', qtrProfitVar: 'Qtr profit YoY %', qtrSalesVar: 'Qtr sales YoY %', ret1y: '1y return %' };
  function table(list, keys) {
    keys = keys.filter((k, i) => keys.indexOf(k) === i).slice(0, 5);
    const label = k => COLS[k] || (Screener.BY_KEY[k] ? Screener.BY_KEY[k].label : k);
    const dec = k => (k === 'marketCap' ? 0 : k === 'de' ? 2 : 1);
    return '| Company | Sector | ' + keys.map(label).join(' | ') + ' |\n|' + '---|'.repeat(keys.length + 2) + '\n' +
      list.map(c => '| ' + link(c) + ' | ' + c.sector + ' | ' + keys.map(k => n(c.metrics[k], dec(k))).join(' | ') + ' |').join('\n');
  }
  function sectorSummary(sector, all) {
    const cs = all.filter(c => c.sector === sector);
    const m = k => med(cs.map(c => c.metrics[k]));
    const lead = (k, asc) => cs.filter(c => ok(c.metrics[k]) && (k !== 'pe' || c.metrics[k] > 0)).sort((a, b) => asc ? a.metrics[k] - b.metrics[k] : b.metrics[k] - a.metrics[k])[0];
    const big = lead('marketCap'), eff = lead('roce'), fast = lead('salesGrowth5'), cheap = lead('pe', true);
    return '## ' + sector + ' sector\n' + cs.length + ' companies covered, total market cap **' + cr(cs.reduce((a, c) => a + (c.metrics.marketCap || 0), 0)) + '**.\n\n' +
      '- Median P/E **' + x(m('pe')) + '** · median ROCE **' + pc(m('roce')) + '** · median OPM ' + pc(m('opm')) + '\n' +
      '- Median 5-yr sales growth ' + pc(m('salesGrowth5')) + ' · median latest-quarter profit growth ' + pc(m('qtrProfitVar')) + '\n' +
      '- Median 1-year return ' + pc(m('ret1y')) + '\n\n' +
      '**Leaders:** largest ' + (big ? link(big) : 'n/a') + ' · highest ROCE ' + (eff ? link(eff) + ' (' + pc(eff.metrics.roce) + ')' : 'n/a') +
      ' · fastest growing ' + (fast ? link(fast) + ' (' + pc(fast.metrics.salesGrowth5) + ')' : 'n/a') + ' · cheapest P/E ' + (cheap ? link(cheap) + ' (' + x(cheap.metrics.pe) + ')' : 'n/a') +
      '\n\n' + table(cs.sort((a, b) => b.metrics.marketCap - a.metrics.marketCap).slice(0, 8), ['marketCap', 'pe', 'roce', 'salesGrowth5']);
  }
  function sectorCompare(key, asc, all) {
    const secs = {};
    all.forEach(c => { (secs[c.sector] = secs[c.sector] || []).push(c); });
    const rows = Object.keys(secs).map(s => ({ s, n: secs[s].length, v: med(secs[s].map(c => c.metrics[key])) })).filter(r => ok(r.v))
      .sort((a, b) => asc ? a.v - b.v : b.v - a.v);
    const label = COLS[key] || Screener.BY_KEY[key].name;
    return '## Sectors ranked by median ' + label + '\n| Sector | Companies | Median ' + label + ' |\n|---|---|---|\n' +
      rows.map(r => '| [' + r.s + '](#/market/' + encodeURIComponent(r.s) + ') | ' + r.n + ' | ' + n(r.v, 1) + ' |').join('\n');
  }
  const SUPER_DESC = /\b(top|best|highest|most|strongest|largest|biggest|fastest|greatest|leading)\b/;
  const SUPER_ASC = /\b(lowest|least|smallest|slowest|cheapest|weakest|worst)\b/;
  function answerMarket(q) {
    const all = Data.listCompanies();
    const t = ' ' + q.toLowerCase() + ' ';
    const sample = all.some(c => !c.live) ? '\n\n*Figures for companies without live data are sample data for illustration.*' : '';
    const sector = findSector(t, all);
    const company = findCompany(t, all);

    if (company && !/\b(top|best|which|companies|stocks|list)\b/.test(t)) {
      return '## Snapshot\n' + snapshot(company) + '\n\n' + bullBear(company) + '\n\nOpen ' + link(company) + ' and use the **AI Analyst** tab for a full report.' + sourceNote(company);
    }
    if (sector && /summar|overview|how is|how are|tell me about|explain|outlook|doing/.test(t)) return sectorSummary(sector, all) + sample;

    const parsed = parseConditions(q);
    const asc = SUPER_ASC.test(t), desc = SUPER_DESC.test(t);
    let rankKey = null, rankAsc = false;
    if (asc || desc) {
      const word = (t.match(SUPER_ASC) || t.match(SUPER_DESC))[0];
      const after = t.slice(t.indexOf(word) + word.length);
      const mk = parseConditions(after).hits[0] || parsed.hits[0];
      rankKey = mk || (/cheap/.test(word) ? 'pe' : /grow|fast/.test(t) ? 'salesGrowth5' : /large|big/.test(word) ? 'marketCap' : 'roce');
      if (rankKey === 'price' && /cheap/.test(word)) rankKey = 'pe';
      const lower = !!LOWER_IS_BETTER[rankKey];
      rankAsc = /cheap|lowest|least|smallest|slowest/.test(word) ? true : /worst|weakest/.test(word) ? !lower : /best|strongest|top/.test(word) ? lower : false;
      if (/most expensive/.test(t)) { rankKey = 'pe'; rankAsc = false; }
    }
    if (/\bsectors?\b/.test(t) && !sector) {
      const key = rankKey || parsed.hits[0] || 'pe';
      const a = rankKey ? rankAsc : !!LOWER_IS_BETTER[key];
      return sectorCompare(key, a, all) + sample;
    }

    let list = all;
    let filterNote = '';
    if (parsed.conds.length) {
      try {
        list = Screener.run(parsed.conds.join(' AND '), all).results;
        filterNote = 'Filter: `' + parsed.conds.join(' AND ') + '`';
      } catch (e) { /* ignore unparsable */ }
    }
    if (sector) { list = list.filter(c => c.sector === sector); filterNote = (filterNote ? filterNote + ' · ' : '') + 'Sector: ' + sector; }
    if (!rankKey && !parsed.conds.length && !sector) {
      return 'I can answer questions about the ' + all.length + ' companies Sankhyas covers. For example:\n' +
        '- *Which companies combine high ROCE with low debt?*\n- *Top 5 cheapest IT stocks by P/E*\n- *Summarise the FMCG sector*\n' +
        '- *Which sectors look cheapest on P/E?*\n- *Debt free companies with sales growth above 15%*\n- *Tell me about Infosys*';
    }
    const key = rankKey || parsed.used[0] || 'marketCap';
    const dirAsc = rankKey ? rankAsc : (LOWER_IS_BETTER[key] ? true : false);
    const top = (t.match(/\btop (\d+)\b/) || t.match(/\b(\d+) (?:companies|stocks|names)\b/));
    const N = Math.min(15, top ? +top[1] : 8);
    const sorted = list.filter(c => ok(c.metrics[key]) && (key !== 'pe' || c.metrics[key] > 0))
      .sort((a, b) => dirAsc ? a.metrics[key] - b.metrics[key] : b.metrics[key] - a.metrics[key]).slice(0, N);
    if (!sorted.length) return 'No companies match that. ' + (filterNote ? filterNote + '. ' : '') + 'Try loosening the conditions.' + sample;
    const label = COLS[key] || Screener.BY_KEY[key].name;
    const head = (list.length === all.length ? '' : '**' + list.length + ' companies match.** ') + 'Showing ' + sorted.length + ', sorted by ' + label + (dirAsc ? ' (lowest first)' : ' (highest first)') + '.';
    const keys = [key].concat(parsed.used, ['pe', 'roce', 'salesGrowth5', 'de']);
    let out = head + (filterNote ? '\n\n' + filterNote : '') + '\n\n' + table(sorted, keys);
    if (parsed.conds.length) out += '\n\n[Open this as a screen](#/screen/new?q=' + encodeURIComponent(parsed.conds.join(' AND ')) + ') to sort and export all results.';
    return out + sample;
  }

  /* ---------- compare ---------- */
  function answerCompare(comps, q) {
    const t = q.toLowerCase();
    const dims = [
      ['Growth (5-yr sales CAGR)', 'salesGrowth5', false], ['Profit growth (5-yr)', 'profitGrowth5', false], ['Returns on capital (ROCE)', 'roce', false],
      ['Margins (OPM)', 'opm', false], ['Balance sheet (lowest debt to equity)', 'de', true], ['Valuation (lowest P/E)', 'pe', true],
      ['Latest quarter profit growth', 'qtrProfitVar', false], ['1-year stock return', 'ret1y', false]
    ];
    let pick = dims;
    if (/compare|overall|everything|all round|all-round/.test(t)) pick = dims;
    else if (/balance|debt|leverage/.test(t)) pick = dims.filter(d => d[1] === 'de').concat([['Interest coverage', 'interestCoverage', false], ['Free cash flow', 'fcf', false]]);
    else if (/expensive|valu|cheap|p\/?e|peg/.test(t)) pick = [['Lowest P/E', 'pe', true], ['Lowest PEG', 'peg', true], ['Lowest P/B', 'pb', true], ['Highest earnings yield', 'earningsYield', false]];
    else if (/grow/.test(t)) pick = dims.filter(d => /salesGrowth5|profitGrowth5|qtrProfitVar/.test(d[1]));
    const score = {};
    comps.forEach(c => { score[c.symbol] = 0; });
    const lines = pick.map(([label, k, asc]) => {
      const s = comps.filter(c => ok(c.metrics[k]) && (k !== 'pe' || c.metrics[k] > 0)).sort((a, b) => asc ? a.metrics[k] - b.metrics[k] : b.metrics[k] - a.metrics[k]);
      if (!s.length) return null;
      score[s[0].symbol]++;
      return '- **' + label + ':** ' + s[0].symbol + ' (' + n(s[0].metrics[k], k === 'de' ? 2 : 1) + ')' + (s.length > 1 ? ', then ' + s.slice(1).map(c => c.symbol + ' ' + n(c.metrics[k], k === 'de' ? 2 : 1)).join(', ') : '');
    }).filter(Boolean);
    const leader = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    return '## Head to head\n' + lines.join('\n') + '\n\n**' + leader + '** leads on ' + score[leader] + ' of ' + lines.length + ' measures shown. ' +
      'Leading on more measures does not make a stock a better buy; check how much of that quality is already in the price.' +
      (comps.some(c => !c.live) ? '\n\n*Some figures are sample data for illustration.*' : '');
  }

  /* ---------- markdown (escape first, then a small subset) ---------- */
  function inline(s) {
    return s.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((#\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  }
  function md(src) {
    const lines = esc(src).split('\n');
    let html = '', list = null, para = [], tbl = null;
    const flushPara = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    const isNum = v => /^(-?[\d.,]+%?x?|n\/a|)$/.test(v.replace(/<[^>]+>/g, '').trim());
    const closeTbl = () => {
      if (!tbl) return;
      const [head, ...rows] = tbl;
      const textCol = head.map((_, j) => j === 0 || rows.some(r => r[j] != null && !isNum(r[j])));
      const cell = (tag, v, j) => '<' + tag + (textCol[j] ? ' class="l"' : '') + '>' + v + '</' + tag + '>';
      html += '<div class="table-wrap"><table class="data ai-table"><thead><tr>' + head.map((v, j) => cell('th', v, j)).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map((v, j) => cell('td', v, j)).join('') + '</tr>').join('') + '</tbody></table></div>';
      tbl = null;
    };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (/^\|.*\|$/.test(line)) {
        flushPara(); closeList();
        if (/^\|[\s:|-]+\|$/.test(line)) continue;
        const cells = line.slice(1, -1).split('|').map(s => inline(s.trim()));
        (tbl = tbl || []).push(cells);
        continue;
      }
      closeTbl();
      if (!line) { flushPara(); closeList(); continue; }
      if ((m = line.match(/^#{1,4}\s+(.*)$/))) { flushPara(); closeList(); html += '<h4>' + inline(m[1]) + '</h4>'; continue; }
      if ((m = line.match(/^[-*•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      closeList();
      para.push(line);
    }
    closeTbl(); flushPara(); closeList();
    return html;
  }

  /* ---------- data context (for Claude) ---------- */
  const r2 = v => (ok(v) ? (Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 100) / 100).toString()) : 'NA');
  const KEYS = [['Price Rs', 'price'], ['Market cap Rs Cr', 'marketCap'], ['P/E', 'pe'], ['Industry P/E', 'industryPE'], ['P/B', 'pb'],
    ['Dividend yield %', 'divYield'], ['ROCE %', 'roce'], ['ROE %', 'roe'], ['Debt/Equity', 'de'], ['Sales TTM Cr', 'sales'], ['Net profit TTM Cr', 'np'],
    ['OPM %', 'opm'], ['Sales CAGR 5y %', 'salesGrowth5'], ['Profit CAGR 5y %', 'profitGrowth5'], ['Qtr sales YoY %', 'qtrSalesVar'],
    ['Qtr profit YoY %', 'qtrProfitVar'], ['Free cash flow Cr', 'fcf'], ['52w high', 'high52'], ['52w low', 'low52'], ['1y return %', 'ret1y'],
    ['Promoter/insider %', 'promoter'], ['FII/institutions %', 'fii']];
  function companyContext(c) {
    const m = c.metrics, out = ['Company: ' + c.name + ' (' + (c.exchange === 'BSE' ? 'BSE' : 'NSE') + ': ' + c.symbol + ')', 'Sector: ' + c.sector + ' | Industry: ' + c.industry,
      'Data source: ' + (c.live ? 'Yahoo Finance end-of-day data via Sankhyas' : 'SAMPLE data for illustration, not real figures'),
      'Key metrics: ' + KEYS.map(([l, k]) => l + ' ' + r2(m[k])).join('; ')];
    const ser = (label, per, vals, n) => label + ': ' + (per || []).slice(-n).map((p, i, a) => p + ' ' + r2((vals || []).slice(-a.length)[i])).join(', ');
    if (c.pl) {
      out.push(ser('Annual sales Cr', c.years, c.pl.sales, 6), ser('Annual net profit Cr', c.years, c.pl.np, 6), ser('OPM %', c.years, c.pl.opm, 6),
        ser('Quarterly sales Cr', c.quarters, c.q.sales, 6), ser('Quarterly net profit Cr', c.quarters, c.q.np, 6),
        ser('Borrowings Cr', c.years, c.bs.borrowings, 4), ser('Operating cash flow Cr', c.years, c.cf.cfo, 4), ser('ROCE %', c.years, c.ratios.roce, 5));
    }
    const lc = latestConcall(c);
    if (lc) out.push('Latest concall (' + lc.n.d.slice(0, 10) + ', tone ' + lc.n.tone + '): ' +
      Object.keys(lc.n.sections).map(k => k + ': ' + lc.n.sections[k].join(' ')).join(' | ').slice(0, 2500));
    if (window.Insights && !(window.Account && !Account.isPro())) {
      const sc = Insights.scoreOf ? Insights.scoreOf(c.symbol) : null;
      if (sc && sc.score != null) out.push('Sankhyas Score ' + sc.score + '/100 (' + Insights.PILLARS.map(([id, l]) => l + ' ' + sc.pillars[id]).join(', ') + ')');
      const rf = Insights.redFlags(c);
      out.push('Sankhyas red-flag score: ' + rf.score + '/100 (' + rf.band + ')' + (rf.flags.length ? '; flags: ' + rf.flags.map(f => f.title + ' (' + f.detail + ')').join('; ').slice(0, 1200) : '; no flags'));
      const g = Insights.guidance(c);
      if (g.rows.length) out.push('Management guidance from concalls: ' + g.rows.slice(0, 8).map(r => r.label + ' ' + r.p + ' target ' + r.target + ' -> ' + r.status + (r.actual != null ? ' (actual ' + Math.round(r.actual * 10) / 10 + '%)' : '')).join('; '));
    }
    if (c.about) out.push('About: ' + c.about.slice(0, 600));
    return out.join('\n');
  }
  function tableContext(list, note) {
    const cols = [['PE', 'pe'], ['ROCE%', 'roce'], ['ROE%', 'roe'], ['D/E', 'de'], ['Sales5y%', 'salesGrowth5'], ['Profit5y%', 'profitGrowth5'], ['QtrProfitYoY%', 'qtrProfitVar'], ['MCapCr', 'marketCap']];
    return (note ? note + '\n' : '') + 'Symbol | Name | Sector | ' + cols.map(c => c[0]).join(' | ') + '\n' +
      list.map(c => [c.symbol, c.name, c.sector].concat(cols.map(([, k]) => r2(c.metrics[k]))).join(' | ')).join('\n');
  }
  function marketContext(max) {
    const all = Data.listCompanies().slice().sort((a, b) => (b.metrics.marketCap || 0) - (a.metrics.marketCap || 0));
    return tableContext(all.slice(0, max || 120), 'Largest ' + Math.min(all.length, max || 120) + ' of ' + all.length + ' companies covered by Sankhyas (latest metrics):');
  }

  const SYSTEM = 'You are Sankhyas AI, the assistant inside Sankhyas, an Indian stock research website. Answer any question the user asks. ' +
    'When the question is about companies or markets, use the DATA provided by Sankhyas first and say when something is not in it; money is in Rs crores unless stated and fiscal years end in March. ' +
    'Be concise and structured (short paragraphs, bullets, **bold** key figures). Do not give personalised buy/sell recommendations or price targets; explain the evidence and the bull and bear case instead. ' +
    'If the DATA says it is sample data, mention that the figures are illustrative.';

  /* ---------- Claude (free: the visitor's own Claude account) ----------
     On any site, "Ask Claude" opens claude.ai with the question and this page's data pre-filled.
     When Sankhyas runs inside a claude.ai artifact view, questions can also be answered right here
     through the viewer's own Claude account (window.claude.use("sample")); nothing is billed to Sankhyas. */
  const LS = { get: k => { try { return localStorage.getItem('sankhyas_' + k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { v ? localStorage.setItem('sankhyas_' + k, v) : localStorage.removeItem('sankhyas_' + k); } catch (e) { /* ignore */ } } };
  let claudeSample = null;
  const claudeReady = (window.claude && typeof window.claude.use === 'function')
    ? window.claude.use('sample').then(s => (claudeSample = s || null), () => null) : Promise.resolve(null);
  const inClaudeView = !!(window.claude && typeof window.claude.use === 'function');
  const claude = {
    available: () => !!claudeSample,
    disable: () => { claudeSample = null; }
  };
  const chatInput = (data, turns) => {
    const rules = SYSTEM + '\n\n<DATA from Sankhyas>\n' + (data || 'No page data.').slice(0, 30000) + '\n</DATA>';
    const hist = turns.slice(-10);
    while (hist.length && hist[0].role !== 'user') hist.shift();
    return [{ role: 'user', content: rules }].concat(hist);
  };
  async function claudeAsk({ data, turns, onText, signal }) {
    const { text, truncated } = await claudeSample(chatInput(data, turns), { cache: false, signal, onText: u => onText(u.text) });
    return truncated ? text + '\n\n_(Answer cut short: ask for less at a time.)_' : text;
  }

  /* ---------- Free Claude on the public site, via Puter.js ----------
     Puter.js (https://puter.com) runs Claude with no API key: each visitor signs in to a free Puter
     account once and Puter covers their usage, so Sankhyas pays nothing. The script is loaded only
     when a visitor picks this engine. Not offered inside claude.ai, which blocks outside scripts. */
  const PUTER_SRC = 'https://js.puter.com/v2/';
  const PUTER_MODELS = ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-3-7-sonnet'];
  let puterLoading = null;
  function loadPuter() {
    if (window.puter && window.puter.ai) return Promise.resolve(window.puter);
    if (!puterLoading) {
      puterLoading = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = PUTER_SRC; sc.async = true;
        sc.onload = () => (window.puter && window.puter.ai ? res(window.puter) : rej({ code: 'puter_load' }));
        sc.onerror = () => { puterLoading = null; sc.remove(); rej({ code: 'puter_load' }); };
        document.head.appendChild(sc);
      });
    }
    return puterLoading;
  }
  const puterMsg = e => String((e && ((e.error && (e.error.message || e.error)) || e.message)) || (typeof e === 'string' ? e : '') || '');
  async function puterAsk({ data, turns, onText, signal }) {
    const puter = await loadPuter();
    const msgs = chatInput(data, turns);
    const saved = LS.get('puter_model');
    const models = [saved].filter(Boolean).concat(PUTER_MODELS.filter(m => m !== saved));
    const stopped = new Promise((_, rej) => signal.addEventListener('abort', () => rej({ code: 'cancelled' }), { once: true }));
    stopped.catch(() => {});
    let lastErr;
    for (const model of models) {
      let text = '';
      try {
        const resp = await Promise.race([puter.ai.chat(msgs, { model, stream: true }), stopped]);
        if (resp && typeof resp[Symbol.asyncIterator] === 'function') {
          for await (const part of resp) {
            if (signal.aborted) throw { code: 'cancelled', text };
            const piece = part && (part.text || '');
            if (piece) { text += piece; onText(text); }
          }
        } else {
          const c = resp && resp.message && resp.message.content;
          text = String((Array.isArray(c) ? c.map(x => x.text || '').join('') : c) || resp || '');
          if (text) onText(text);
        }
        if (signal.aborted) throw { code: 'cancelled', text };
        if (!text.trim()) throw { code: 'empty', message: 'Empty answer' };
        LS.set('puter_model', model);
        return text;
      } catch (e) {
        if (e && (e.code === 'cancelled' || text)) throw Object.assign({ text }, e);
        lastErr = e;
        if (/model|not (found|available|supported)|unknown/i.test(puterMsg(e))) continue;
        throw e;
      }
    }
    throw lastErr || { code: 'empty' };
  }
  function puterError(e) {
    const c = e && e.code, m = puterMsg(e);
    if (c === 'puter_load') return 'Could not load the free Claude service (Puter). Check your connection or ad blocker, or use "Ask Claude ↗".';
    if (/sign|auth|login|popup|cancel/i.test(m)) return 'Sign in to Puter (free) in the pop-up to use Claude here. If no pop-up appeared, allow pop-ups for this site and ask again.';
    if (/limit|quota|credit|insufficient|funds|429/i.test(m)) return 'Your free Puter allowance is used up for now. Try again later, switch to Built-in, or use "Ask Claude ↗".';
    return 'Could not get an answer from free Claude' + (m ? ' (' + m.slice(0, 120) + ')' : '') + '. Try again or use "Ask Claude ↗".';
  }

  /* ---------- Sankhyas AI on-device: an open-source model running in the visitor's browser ----------
     WebLLM (https://webllm.mlc.ai) runs Qwen2.5 on the visitor's own GPU through WebGPU. Nothing is sent
     to any AI service and it costs nothing; the model downloads once (cached by the browser) and then
     works offline. It runs in a Web Worker so the page stays responsive. */
  const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
  const DEVICE_MODELS = {
    device: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', size: 'about 1 GB', name: 'Lite' },
    device_pro: { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', size: 'about 2 GB', name: 'Pro' }
  };
  const hasWebGPU = () => typeof navigator !== 'undefined' && !!navigator.gpu;
  const dev = { engine: null, model: null, loading: null, progress: null, accepted: {} };
  function deviceEngine(modelId, onProgress) {
    dev.progress = onProgress;
    if (dev.engine && dev.model === modelId) return Promise.resolve(dev.engine);
    if (dev.loading) return dev.loading.then(() => deviceEngine(modelId, onProgress), () => deviceEngine(modelId, onProgress));
    dev.loading = (async () => {
      const w = await import(WEBLLM);
      const report = r => { if (dev.progress) dev.progress(r); };
      if (!dev.engine) {
        const src = 'import { WebWorkerMLCEngineHandler } from "' + WEBLLM + '";\nconst h = new WebWorkerMLCEngineHandler();\nself.onmessage = m => h.onmessage(m);';
        const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
        try { dev.engine = await w.CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: report }); }
        catch (e) { worker.terminate(); throw e; }
      } else {
        dev.model = null;
        dev.engine.setInitProgressCallback && dev.engine.setInitProgressCallback(report);
        await dev.engine.reload(modelId);
      }
      dev.model = modelId;
      return dev.engine;
    })();
    const done = () => { dev.loading = null; };
    dev.loading.then(done, done);
    return dev.loading;
  }
  const DEVICE_SYSTEM = 'You are Sankhyas AI, the assistant of Sankhyas, an Indian stock research website. Answer the user\'s question helpfully and briefly. ' +
    'For questions about companies or markets, rely on the DATA below and say when something is not in it. Money is in Rs crores and fiscal years end in March. ' +
    'Use short paragraphs or bullets and **bold** key numbers. Never invent figures. No buy/sell advice or price targets: explain the evidence instead.';
  async function deviceAsk(key, { data, turns, onText, onStatus, signal }) {
    const m = DEVICE_MODELS[key];
    const stopped = new Promise((_, rej) => signal.addEventListener('abort', () => rej({ code: 'cancelled' }), { once: true }));
    stopped.catch(() => {});
    const eng = await Promise.race([deviceEngine(m.id, r => onStatus && onStatus(r)), stopped]);
    LS.set('device_ok_' + m.id, '1');
    if (signal.aborted) throw { code: 'cancelled' };
    const hist = turns.slice(-6).map(t => ({ role: t.role, content: t.content.slice(0, 1500) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const msgs = [{ role: 'system', content: DEVICE_SYSTEM + '\n\nDATA from Sankhyas:\n' + (data || 'No page data.').slice(0, 6000) }].concat(hist);
    const stop = () => { try { eng.interruptGenerate(); } catch (e) { /* ignore */ } };
    signal.addEventListener('abort', stop, { once: true });
    let text = '';
    try {
      const chunks = await eng.chat.completions.create({ messages: msgs, stream: true, temperature: 0.3, max_tokens: 700 });
      for await (const c of chunks) {
        const d = c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content;
        if (d) { text += d; onText(text); }
      }
    } catch (e) { throw Object.assign({ text }, e && typeof e === 'object' ? e : { message: String(e) }); }
    finally { signal.removeEventListener('abort', stop); }
    if (signal.aborted) throw { code: 'cancelled', text };
    if (!text.trim()) throw { code: 'empty', message: 'The model returned an empty answer.' };
    return text;
  }
  function deviceError(e) {
    const m = String((e && (e.message || e.name)) || e || '');
    if (/webgpu|adapter|navigator\.gpu|shader-f16|f16/i.test(m)) return 'This browser or device can\'t run on-device AI (it needs WebGPU: a recent Chrome or Edge on a laptop, desktop or newer Android phone). Use Built-in or Free Claude instead.';
    if (/memory|oom|device (was )?lost|allocation/i.test(m)) return 'Your device ran out of graphics memory. Try the Lite model, close other tabs, or use Built-in.';
    if (/fetch|network|load|import|failed to|cache/i.test(m)) return 'The on-device model could not be downloaded. Check your connection and ask again: finished parts are kept.';
    return 'On-device AI hit a problem' + (m ? ' (' + m.slice(0, 120) + ')' : '') + '. Try again, or use Built-in.';
  }
  const deviceProgress = r => {
    const pct = Math.max(0, Math.min(100, Math.round((r && r.progress || 0) * 100)));
    return '<div class="ai-progress"><div class="ai-progress-bar"><span style="width:' + pct + '%"></span></div>' +
      '<span class="sub">' + esc(pct < 100 ? 'Loading Sankhyas AI on your device… ' + pct + '% (one-time download, cached for next time)' : 'Starting Sankhyas AI…') + '</span></div>';
  };
  const deviceEngineDef = key => ({
    label: 'Sankhyas AI on-device · ' + DEVICE_MODELS[key].name + ' (' + DEVICE_MODELS[key].size.replace('about ', '~') + ')',
    badge: 'Sankhyas AI · on-device',
    thinking: 'Sankhyas AI is thinking…',
    ask: o => deviceAsk(key, o), err: e => deviceError(e), progress: deviceProgress,
    consent: {
      ok: () => !!LS.get('device_ok_' + DEVICE_MODELS[key].id) || dev.model === DEVICE_MODELS[key].id || !!dev.accepted[key],
      accept: () => { dev.accepted[key] = true; },
      text: 'Sankhyas AI runs fully on your device: free, private and nothing is sent to any AI service. The first time, it downloads ' +
        DEVICE_MODELS[key].size + ' (use Wi-Fi). After that it loads from your browser\'s cache.'
    },
    note: 'Sankhyas AI running on your own device (open-source Qwen2.5 via WebLLM). Free and private: your questions never leave this browser. It can be wrong. Not investment advice.'
  });

  /* engine choice: 'builtin' (default), 'claude' (claude.ai view) or 'puter' (public site) */
  const ENGINES = {
    device: deviceEngineDef('device'),
    device_pro: deviceEngineDef('device_pro'),
    builtin: { label: 'Built-in', badge: 'Free', note: 'Built-in analysis generated instantly in your browser from Sankhyas data. Free, rule-based, and it can be wrong. Not investment advice.' },
    claude: { label: 'Claude (ask anything)', badge: 'Claude', thinking: 'Claude is thinking…', ask: o => claudeAsk(o), err: e => claudeError(e),
      note: 'Answers by Claude on your own Claude account, with Sankhyas data as context. It can be wrong. Not investment advice.' },
    puter: { label: 'Free Claude (ask anything)', badge: 'Claude · free', thinking: 'Asking free Claude… (sign in to Puter if a pop-up opens)', ask: o => puterAsk(o), err: e => puterError(e),
      note: 'Answers by Claude through Puter.js: free with a Puter account, no API key. Your question and this page\'s data are sent to Puter. It can be wrong. Not investment advice.' }
  };
  const engines = () => ['builtin'].concat(!inClaudeView && hasWebGPU() ? ['device', 'device_pro'] : [], claude.available() ? ['claude'] : [], inClaudeView ? [] : ['puter']);
  const engine = () => { const e = LS.get('ai_engine'); return engines().indexOf(e) > 0 ? e : 'builtin'; };

  function claudeError(e) {
    const c = e && e.code;
    if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'capability_removed') {
      claude.disable();
      return 'Claude isn\'t allowed in this view, so Sankhyas switched back to the built-in engine. Use "Ask Claude ↗" to ask in the Claude app instead.';
    }
    if (c === 'rate_limited') return 'Your Claude usage limit is reached for now. Try again later or use the built-in engine.';
    if (c === 'session_expired') return 'Please sign in to Claude again.';
    if (c === 'refused') return 'Claude declined to answer this. Try rephrasing.';
    if (c === 'prompt_too_large') return 'That was too much text for one question. Ask something shorter.';
    return 'Could not reach Claude. Try again in a moment.';
  }

  /* ---------- hand-off to the Claude app (visitor's own free account) ---------- */
  function handoffPrompt(q, data) {
    const p = 'I am researching Indian stocks on Sankhyas. ' + q.trim() + '\n\nData from Sankhyas:\n' + (data || '') +
      '\n\n(Not a request for personalised investment advice.)';
    return p.length > 6000 ? p.slice(0, 5950) + '\n…' : p;
  }
  function openClaude(q, data) {
    window.open('https://claude.ai/new?q=' + encodeURIComponent(handoffPrompt(q, data)), '_blank', 'noopener');
  }

  /* ---------- chat widget ---------- */
  const ready = Promise.resolve({ kind: 'local' });
  function mount(el, opts) {
    let ctl = null;
    const turns = [];
    const dataOf = () => { try { return opts.context ? opts.context() : ''; } catch (e) { return ''; } };
    el.innerHTML = '<div class="ai-box"><div class="ai-head"><span class="ai-spark" aria-hidden="true">✦</span><b>' + esc(opts.title || 'Sankhyas AI') + '</b>' +
      '<span class="ai-badge ai-engine"></span><span class="ai-engine-ctl"></span></div>' +
      '<div class="ai-log" aria-live="polite">' + (opts.intro ? '<div class="ai-intro">' + esc(opts.intro) + '</div>' : '') + '</div>' +
      '<div class="ai-chips">' + (opts.suggestions || []).map((s, i) => '<button type="button" class="chip" data-i="' + i + '">' + esc(s) + '</button>').join('') + '</div>' +
      '<form class="ai-form"><textarea rows="1" placeholder="' + esc(opts.placeholder || 'Ask a question') + '" aria-label="Ask AI"></textarea>' +
      '<button class="btn btn-primary" type="submit">Ask</button></form>' +
      '<div class="ai-external"><button type="button" class="btn btn-small" data-ext="claude">✳ Ask Claude (free) ↗</button>' +
      ' <span class="sub">Ask anything in the Claude app: opens with your question and this page\'s data</span></div>' +
      '<p class="ai-note"></p></div>';
    const log = el.querySelector('.ai-log'), form = el.querySelector('form'), ta = form.querySelector('textarea'), btn = form.querySelector('button');
    const renderEngine = () => {
      const cur = engine(), list = engines();
      el.querySelector('.ai-engine').textContent = ENGINES[cur].badge;
      el.querySelector('.ai-engine-ctl').innerHTML = list.length > 1
        ? '<select class="ai-engine-select" aria-label="AI engine">' + list.map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(ENGINES[k].label) + '</option>').join('') + '</select>'
        : '';
      el.querySelector('.ai-note').textContent = ENGINES[cur].note;
      const sel = el.querySelector('.ai-engine-select');
      if (sel) sel.onchange = () => { LS.set('ai_engine', sel.value); if (sel.value === 'puter') loadPuter().catch(() => {}); renderEngine(); };
    };
    renderEngine();
    claudeReady.then(renderEngine);
    const scroll = () => { log.scrollTop = log.scrollHeight; };
    function bubble(role, html) {
      const d = document.createElement('div');
      d.className = 'ai-msg ai-' + role;
      d.innerHTML = html;
      log.appendChild(d);
      scroll();
      return d;
    }
    const idle = () => { ctl = null; btn.textContent = 'Ask'; btn.classList.add('btn-primary'); };
    function lastQuestion() { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return turns[i].content; return ta.value.trim(); }
    async function send(q) {
      q = String(q || '').trim();
      if (!q || ctl) return;
      const intro = log.querySelector('.ai-intro');
      if (intro) intro.remove();
      const mine = bubble('user', esc(q));
      const out = bubble('assistant', '');
      ta.value = ''; autosize();
      const eng = ENGINES[engine()];
      if (eng.consent && !eng.consent.ok()) {
        out.innerHTML = '<p>' + esc(eng.consent.text) + '</p><p class="ai-consent"><button type="button" class="btn btn-primary btn-small" data-go>Download and ask</button> ' +
          '<button type="button" class="btn btn-small" data-no>Not now</button></p>';
        out.querySelector('[data-no]').onclick = () => { out.innerHTML = '<p class="sub">Not downloaded. Pick Built-in or Free Claude in the menu above for an answer without a download.</p>'; };
        out.querySelector('[data-go]').onclick = () => { eng.consent.accept(); mine.remove(); out.remove(); send(q); };
        scroll();
        return;
      }
      btn.textContent = 'Stop'; btn.classList.remove('btn-primary');
      if (eng.ask) {
        turns.push({ role: 'user', content: q });
        ctl = new AbortController();
        const myCtl = ctl;
        out.innerHTML = '<span class="ai-thinking">' + esc(eng.thinking) + '</span>';
        try {
          const text = await eng.ask({ data: dataOf(), turns: turns.slice(-12), signal: ctl.signal, onText: t => { out.innerHTML = md(t); scroll(); },
            onStatus: r => { if (eng.progress && ctl === myCtl) { out.innerHTML = eng.progress(r); scroll(); } } });
          out.innerHTML = md(text);
          turns.push({ role: 'assistant', content: text });
        } catch (e) {
          turns.pop();
          if (e && e.code === 'cancelled') out.innerHTML = md(e.text || '') + '<p class="sub">Stopped.</p>';
          else {
            out.innerHTML = (e && e.text ? md(e.text) : '') + '<p class="ai-err">' + esc(eng.err(e)) + '</p>';
            renderEngine();
          }
        }
        idle(); scroll();
        return;
      }
      turns.push({ role: 'user', content: q });
      let text;
      try { text = opts.answer(q); } catch (e) { text = 'Sorry, I could not work that out. Try rephrasing the question.'; }
      turns.push({ role: 'assistant', content: text });
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { out.innerHTML = md(text); scroll(); idle(); return; }
      let i = 0;
      const step = Math.max(24, Math.ceil(text.length / 60));
      ctl = { stop: false, abort() { this.stop = true; } };
      const me = ctl;
      const tick = () => {
        if (me.stop) i = text.length;
        i = Math.min(text.length, i + step);
        out.innerHTML = md(text.slice(0, i));
        scroll();
        if (i < text.length) setTimeout(tick, 16); else idle();
      };
      tick();
    }
    function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', e => { e.preventDefault(); if (ctl) ctl.abort(); else send(ta.value); });
    el.querySelectorAll('.ai-chips .chip').forEach(c => c.addEventListener('click', () => send(opts.suggestions[+c.dataset.i])));
    el.querySelectorAll('[data-ext]').forEach(b => b.addEventListener('click', () => {
      const q = lastQuestion() || opts.placeholder || 'Analyse this for me';
      openClaude(q, dataOf());
    }));
    return { send, abort: () => { if (ctl) ctl.abort(); } };
  }

  function errorCopy(e) { return (e && e.message) || 'Something went wrong.'; }

  window.AI = { ready, md, mount, answerCompany, answerMarket, answerCompare, screenQuery, parseConditions, errorCopy,
    companyContext, tableContext, marketContext, engine, kind: () => (engine() === 'builtin' ? 'local' : engine()) };
})();
