/* Sankhyas Insights: free, rule-based research tools that read the numbers and the filings.
 *
 *   Insights.redFlags(c, filings)    forensic checks -> { score 0-100, band, flags: [{sev, title, detail, src}] }
 *   Insights.guidance(c, filings)    management targets from concalls vs what was delivered
 *   Insights.whatChanged(c, filings) latest results and concall compared with the previous ones
 *
 * c is a company object from js/data.js; filings is data/filings/<SYM>.json (optional).
 * Also runs under Node (scripts/build_index.mjs) to put riskScore and guidanceScore into metrics.json.
 */
(function () {
  const ok = v => v != null && Number.isFinite(v);
  const last = (arr, n) => (arr || []).slice(-(n || 1));
  const sum = arr => arr.reduce((s, v) => s + (ok(v) ? v : 0), 0);
  const allOk = arr => arr.length > 0 && arr.every(ok);
  const r1 = v => (Math.round(v * 10) / 10).toLocaleString('en-IN');
  const r0 = v => Math.round(v).toLocaleString('en-IN');
  const isFinancial = c => /financ|bank|insur|nbfc|capital markets|credit services|asset management/i.test((c.sector || '') + ' ' + (c.industry || ''));
  const SEV = { high: 3, medium: 2, low: 1 };

  /* ---------- 1. Red-flag / forensic scanner ---------- */
  const FILING_FLAGS = [
    ['high', 25, 'Auditor resigned', /resignation of (the )?(statutory |joint |secretarial )?auditors?|auditors?\b.{0,40}\bresign/i],
    ['high', 25, 'Default or delay in paying lenders', /\bdefault(s|ed)?\b|delay in (payment|servicing|repayment)|non[- ]payment of (interest|principal)/i],
    ['high', 20, 'Pledged shares invoked', /invocation of pledge|pledge.{0,30}invok/i],
    ['medium', 10, 'Promoter shares pledged', /creation of (pledge|encumbrance)|(pledge|encumbrance).{0,30}creat/i],
    ['medium', 10, 'Credit rating downgraded', /downgrad/i],
    ['medium', 10, 'Regulatory or tax action', /show[- ]cause|sebi (order|penalty)|penalty (imposed|levied)|adjudication|forensic audit|search (and|&) seizure|income[- ]tax search|enforcement directorate|\bcbi\b|investigation by/i],
    ['medium', 10, 'Top management exit', /resignation of (the )?(chief financial officer|cfo|chief executive officer|ceo|managing director|whole[- ]time director|md\b)/i],
    ['low', 5, 'Independent director resigned', /resignation of (an? )?independent director/i]
  ];
  function filingFlags(filings) {
    const A = (filings && filings.announcements) || [];
    const since = Date.now() - 2 * 365 * 864e5, out = [];
    FILING_FLAGS.forEach(([sev, pts, title, re]) => {
      const hits = A.filter(a => +new Date(a.d) >= since && re.test(a.t + ' ' + (a.c || '')));
      if (hits.length) {
        out.push({ sev, pts, title, src: hits[0].u, kind: 'filing',
          detail: hits.length + ' filing' + (hits.length > 1 ? 's' : '') + ' in the last 2 years, latest ' + new Date(hits[0].d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ': "' + String(hits[0].t).slice(0, 120) + '"' });
      }
    });
    return out;
  }
  function numberFlags(c) {
    const out = [], fin = isFinancial(c);
    const add = (sev, pts, title, detail) => out.push({ sev, pts, title, detail, kind: 'numbers' });
    const pl = c.pl || {}, cf = c.cf || {}, bs = c.bs || {}, ra = c.ratios || {}, m = c.metrics || {};
    const np3 = last(pl.np, 3), cfo3 = last(cf.cfo, 3), cfi3 = last(cf.cfi, 3);
    if (!fin && allOk(np3) && allOk(cfo3) && sum(np3) > 0) {
      const conv = sum(cfo3) / sum(np3);
      if (conv < 0.5) add('high', 20, 'Profits are not turning into cash', 'Operating cash flow was only ' + r0(conv * 100) + '% of net profit over the last 3 years (healthy companies are usually above 80%).');
      else if (conv < 0.8) add('medium', 10, 'Weak cash conversion', 'Operating cash flow was ' + r0(conv * 100) + '% of net profit over the last 3 years.');
    }
    if (!fin && allOk(np3) && allOk(cfo3) && allOk(cfi3) && np3.every(v => v > 0) && cfo3.every((v, i) => v + cfi3[i] < 0)) {
      add('medium', 10, 'Negative free cash flow every year', 'Profitable on paper, but cash from operations minus investments was negative in each of the last 3 years.');
    }
    const dd = (ra.debtor || []).filter(ok);
    if (!fin && dd.length >= 3) {
      const now = dd[dd.length - 1], before = dd[dd.length - 3];
      if (now > 90 && before > 0 && now > before * 1.3) add('medium', 10, 'Customers are paying slower', 'Debtor days rose from ' + r0(before) + ' to ' + r0(now) + ' in two years. Rising receivables can mean aggressive revenue booking.');
    }
    const inv = (ra.inventory || []).filter(ok);
    if (!fin && inv.length >= 3) {
      const now = inv[inv.length - 1], before = inv[inv.length - 3];
      if (now > 120 && before > 0 && now > before * 1.4) add('low', 5, 'Inventory is piling up', 'Inventory days rose from ' + r0(before) + ' to ' + r0(now) + ' in two years.');
    }
    const s3 = last(pl.sales, 4), b3 = last(bs.borrowings, 4);
    if (!fin && allOk(s3) && allOk(b3) && s3.length === 4 && s3[0] > 0 && b3[0] > 0) {
      const sg = s3[3] / s3[0] - 1, bg = b3[3] / b3[0] - 1;
      if (bg > 0.5 && bg > 2 * Math.max(sg, 0.05) && ok(m.de) && m.de > 0.5) add('medium', 10, 'Debt growing much faster than sales', 'Borrowings grew ' + r0(bg * 100) + '% in 3 years while sales grew ' + r0(sg * 100) + '%.');
    }
    if (!fin && ok(m.de) && m.de > 2) add('high', 15, 'Very high debt', 'Debt is ' + r1(m.de) + ' times shareholders\' equity.');
    if (!fin && ok(m.interestCoverage) && ok(m.de) && m.de > 0.1) {
      if (m.interestCoverage < 1.5) add('high', 15, 'Profits barely cover interest', 'Interest coverage is ' + r1(m.interestCoverage) + 'x (below 1.5x is risky).');
      else if (m.interestCoverage < 3) add('low', 5, 'Thin interest cover', 'Interest coverage is ' + r1(m.interestCoverage) + 'x.');
    }
    const oi = last(pl.otherIncome, 1)[0], pbt = last(pl.pbt, 1)[0];
    if (ok(oi) && ok(pbt) && pbt > 0 && oi / pbt > 0.4 && !fin) add('medium', 10, 'Profit depends on other income', r0(oi / pbt * 100) + '% of last year\'s pre-tax profit came from other income, not the core business.');
    const taxPct = last(pl.tax, 1)[0];   // pl.tax is the tax rate in %
    if (ok(taxPct) && ok(pbt) && pbt > 10 && taxPct < 10) add('low', 5, 'Unusually low tax rate', 'Tax was ' + r0(taxPct) + '% of pre-tax profit last year (the normal rate is about 25%).');
    const sh = (c.sharesOut || []).filter(ok);
    if (sh.length >= 3 && sh[sh.length - 3] > 0) {
      const g = sh[sh.length - 1] / sh[sh.length - 3] - 1;
      if (g > 0.15) add('medium', 10, 'Shareholders being diluted', 'The share count grew ' + r0(g * 100) + '% in two years.');
    }
    const ttm = c.ttm || {};
    const npT = ok(ttm.np) ? ttm.np : last(pl.np, 1)[0];
    if (ok(npT) && npT < 0) add('medium', 10, 'Loss-making', 'Net loss of ₹' + r0(-npT) + ' Cr over the last 12 months.');
    const s4 = last(pl.sales, 4);
    if (allOk(s4) && s4.length === 4 && s4[3] < s4[2] && s4[2] < s4[1] && s4[1] < s4[0]) add('low', 5, 'Sales falling for 3 years', 'Revenue has declined every year since ' + (last(c.years, 4)[0] || 'three years ago') + '.');
    if (ok(m.promoter) && m.promoter > 0 && m.promoter < 20 && !/bank|financial/i.test(c.sector || '')) add('low', 5, 'Low insider ownership', 'Promoters and insiders own ' + r1(m.promoter) + '%. That is normal for professionally run companies, but worth checking.');
    return out;
  }
  /* ---------- credit ratings read from the rating letters (scripts/ratings.py) ---------- */
  const LONG_SCALE = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
  const ratingRank = r => LONG_SCALE.indexOf(String(r || '').toUpperCase());
  const RATING_ACT = { upgrade: 'Upgraded', downgrade: 'Downgraded', reaffirm: 'Reaffirmed', assign: 'Assigned', withdraw: 'Withdrawn', outlook_up: 'Outlook raised', outlook_down: 'Outlook cut', watch: 'On watch' };
  function creditRatings(filings) {
    const A = ((filings && filings.announcements) || []).filter(a => a.k === 'rating' && a.rt && !a.skip).sort((a, b) => (a.d < b.d ? 1 : -1));
    if (!A.length) return null;
    // latest long-term rating per agency
    // the company's own ratings; a subsidiary's only when there is nothing else
    const own = A.filter(a => !a.sub).length ? A.filter(a => !a.sub) : A;
    const byAg = {};
    own.forEach(a => { const ag = a.ag || 'Agency'; if (!byAg[ag] && a.term !== 'short') byAg[ag] = a; });
    const latest = Object.values(byAg).sort((a, b) => (a.d < b.d ? 1 : -1));
    const since = new Date(Date.now() - 365 * 864e5).toISOString();
    const changes = own.filter(a => a.d >= since && /^(upgrade|downgrade|outlook_up|outlook_down|watch)$/.test(a.act || ''));
    const head = latest[0] || own[0];
    return { list: A, latest, head, up: changes.filter(a => a.act === 'upgrade' || a.act === 'outlook_up').length,
      down: changes.filter(a => a.act === 'downgrade' || a.act === 'outlook_down').length, changes, rank: ratingRank(head.rt) };
  }
  const ratingText = a => (a.ag ? a.ag + ' ' : '') + a.rt + (a.ol ? ' (' + a.ol + ')' : '');

  /* ---------- annual report forensic check (scripts/ar_forensics.py) ---------- */
  function annualReportCheck(filings) {
    const f = filings || {}, notes = f.notes || {};
    const reps = (f.annualReports || []).slice().sort((a, b) => ((a.y || '') < (b.y || '') ? 1 : -1));
    const urls = reps.map(r => [r.u, r.y]).concat((f.announcements || []).filter(a => notes[a.u] && notes[a.u].kind === 'ar').map(a => [a.u, '']));
    for (const [u, y] of urls) {
      const n = notes[u];
      if (n && n.forensic) return Object.assign({ url: u, year: y || n.y || '' }, n.forensic);
    }
    return null;
  }
  const AR_PTS = { high: 20, medium: 10, low: 3 };
  function arFlags(filings) {
    const ar = annualReportCheck(filings);
    if (!ar) return [];
    return (ar.flags || []).map(x => ({ sev: x.sev, pts: AR_PTS[x.sev] || 3, title: x.t, detail: 'Annual report ' + (ar.year || '') + (x.p ? ', page ' + x.p : '') + ': "' + x.x + '"',
      src: ar.url + (x.p ? '#page=' + x.p : ''), kind: 'annual report' }));
  }
  function ratingFlags(filings) {
    const cr = creditRatings(filings);
    if (!cr) return [];
    const since = new Date(Date.now() - 2 * 365 * 864e5).toISOString();
    const out = [];
    const dn = cr.list.find(a => a.d >= since && a.act === 'downgrade' && !a.sub);
    if (dn) out.push({ sev: 'medium', pts: 10, title: 'Credit rating downgraded', detail: (dn.ag || 'Rating agency') + ' cut the rating' + (dn.from ? ' from ' + dn.from : '') + ' to ' + dn.rt +
      (dn.ol ? ' (' + dn.ol + ')' : '') + ' on ' + new Date(dn.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '.', src: dn.u, kind: 'filing' });
    const cur = cr.head;
    if (cur && ratingRank(cur.rt) >= LONG_SCALE.indexOf('BB+')) out.push({ sev: ratingRank(cur.rt) >= LONG_SCALE.indexOf('C+') ? 'high' : 'medium', pts: ratingRank(cur.rt) >= LONG_SCALE.indexOf('C+') ? 20 : 10,
      title: cur.rt === 'D' ? 'Rated in default (D)' : 'Below investment grade credit rating', detail: 'Latest rating ' + ratingText(cur) + ' on ' + new Date(cur.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '.', src: cur.u, kind: 'filing' });
    return out;
  }
  function redFlags(c, filings) {
    const F = filings || c._filings;
    let fl = filingFlags(F);
    const rf = ratingFlags(F);
    // the rating letter is more precise than the filing title: prefer it
    if (rf.some(x => x.title === 'Credit rating downgraded')) fl = fl.filter(x => x.title !== 'Credit rating downgraded');
    const flags = numberFlags(c).concat(fl, rf, arFlags(F));
    flags.sort((a, b) => SEV[b.sev] - SEV[a.sev] || b.pts - a.pts);
    const score = Math.min(100, sum(flags.map(f => f.pts)));
    const band = score >= 45 ? 'High' : score >= 20 ? 'Moderate' : 'Low';
    return { score, band, flags, checked: !!(filings || c._filings) };
  }

  /* ---------- 2. Guidance tracker: what management promised vs what happened ---------- */
  const METRIC_LABEL = { revenue_growth: 'Revenue growth', pat_growth: 'Profit growth', margin: 'Operating margin', volume_growth: 'Volume growth', capex: 'Capex', order_inflow: 'Order inflow' };
  const fyIndex = (c, per) => {
    const m = /^FY(\d{4})$/.exec(per || '');
    if (!m) return -1;
    return (c.years || []).indexOf('Mar ' + m[1]);
  };
  const growthAt = (arr, i) => (i > 0 && ok(arr[i]) && ok(arr[i - 1]) && arr[i - 1] > 0 ? (arr[i] / arr[i - 1] - 1) * 100 : null);
  function actualFor(c, g) {
    const i = fyIndex(c, g.p), pl = c.pl || {};
    if (i < 0) return null;
    if (g.m === 'revenue_growth') return growthAt(pl.sales || [], i);
    if (g.m === 'pat_growth') return growthAt(pl.np || [], i);
    if (g.m === 'margin') return ok((pl.opm || [])[i]) ? pl.opm[i] : null;
    return null;
  }
  // latest year-on-year run rate from the last four quarters vs the four before
  function runRate(c, g) {
    const q = c.q || {}, key = g.m === 'revenue_growth' ? 'sales' : g.m === 'pat_growth' ? 'np' : g.m === 'margin' ? 'opm' : null;
    if (!key || !q[key]) return null;
    const v = q[key].filter(ok);
    if (key === 'opm') return v.length ? v[v.length - 1] : null;
    if (v.length >= 5 && v[v.length - 5] > 0) return (v[v.length - 1] / v[v.length - 5] - 1) * 100;
    return null;
  }
  const fmtTarget = g => (g.u === 'cr' ? '₹' + r0(g.lo) + ' Cr' : g.hi == null ? r1(g.lo) + '%+' : g.hi === g.lo ? '~' + r1(g.lo) + '%' : r1(g.lo) + '–' + r1(g.hi) + '%');
  function guidance(c, filings) {
    const f = filings || c._filings, notes = (f && f.notes) || {};
    const calls = ((f && f.announcements) || []).filter(a => a.k === 'transcript' && notes[a.u] && notes[a.u].guidance);
    const items = [];
    calls.forEach(a => (notes[a.u].guidance || []).forEach(g => items.push(Object.assign({ said: a.d, url: a.u }, g))));
    items.sort((a, b) => new Date(b.said) - new Date(a.said));
    // one row per metric + period: the latest statement, with how it moved since earlier calls
    const byKey = {}, rows = [];
    items.forEach(g => {
      const k = g.m + '|' + g.p;
      if (!byKey[k]) { byKey[k] = Object.assign({ history: [] }, g); rows.push(byKey[k]); }
      byKey[k].history.push({ said: g.said, lo: g.lo, hi: g.hi });
    });
    let delivered = 0, missed = 0;
    rows.forEach(g => {
      g.label = METRIC_LABEL[g.m] || g.m;
      g.target = fmtTarget(g);
      if (g.history.length > 1) {
        const prev = g.history[1];
        g.move = g.lo > prev.lo + 0.4 ? 'raised' : g.lo < prev.lo - 0.4 ? 'lowered' : 'maintained';
      }
      const act = actualFor(c, g);
      const tol = g.m === 'margin' ? 0.5 : 1;
      if (act != null) {
        g.actual = act;
        g.status = act >= g.lo - tol ? (g.hi != null && act > g.hi + 2 ? 'Beat' : 'Delivered') : act >= g.lo * 0.8 - tol ? 'Nearly' : 'Missed';
        if (g.status === 'Missed') missed++; else if (g.status !== 'Nearly') delivered++; else { delivered += 0.5; missed += 0.5; }
      } else if (/^FY\d{4}$/.test(g.p) && (g.m === 'revenue_growth' || g.m === 'pat_growth' || g.m === 'margin')) {
        g.status = 'Pending';
        g.runRate = runRate(c, g);
      } else {
        g.status = g.p === 'Medium term' ? 'Long term' : 'Not tracked';
      }
    });
    const judged = delivered + missed;
    return { rows, calls: calls.length, score: judged ? Math.round(delivered / judged * 100) : null, judged };
  }

  /* ---------- 3. What changed since the previous quarter / concall ---------- */
  const IMPORTANT = /financial result|outcome of board|dividend|bonus|split|buy ?back|acquisition|amalgamation|merger|demerger|resignation|appointment of (managing|chief|ceo|cfo|md)|credit rating|rights issue|preferential|qip|fund ?rais|order|contract|capacity|commission|default|pledge/i;
  function pct(a, b) { return ok(a) && ok(b) && b !== 0 ? (a / Math.abs(b) - 1) * 100 * (b < 0 ? -1 : 1) : null; }
  function whatChanged(c, filings) {
    const f = filings || c._filings, notes = (f && f.notes) || {}, q = c.q || {}, Q = c.quarters || [];
    const out = { results: null, concall: null, filings: [] };
    const n = Q.length;
    if (n >= 2) {
      const row = (label, arr, isPct) => {
        const cur = arr ? arr[n - 1] : null, prev = arr ? arr[n - 2] : null, yago = arr && n >= 5 ? arr[n - 5] : null;
        return { label, cur, qoq: isPct ? (ok(cur) && ok(prev) ? cur - prev : null) : pct(cur, prev), yoy: isPct ? (ok(cur) && ok(yago) ? cur - yago : null) : pct(cur, yago), isPct };
      };
      out.results = { quarter: Q[n - 1], prev: Q[n - 2], yago: n >= 5 ? Q[n - 5] : null,
        rows: [row('Sales', q.sales), row('Operating profit', q.op), row('OPM %', q.opm, true), row('Net profit', q.np), row('EPS', q.eps)] };
    }
    const calls = ((f && f.announcements) || []).filter(a => a.k === 'transcript' && notes[a.u] && notes[a.u].sections);
    if (calls.length) {
      const cur = notes[calls[0].u], prev = calls[1] ? notes[calls[1].u] : null;
      const cc = { date: calls[0].d, url: calls[0].u, tone: cur.tone, prevTone: prev && prev.tone, prevDate: calls[1] && calls[1].d, guidance: [], newRisks: [], newTopics: [] };
      const key = g => g.m + '|' + g.p;
      const pg = {};
      ((prev && prev.guidance) || []).forEach(g => { pg[key(g)] = g; });
      (cur.guidance || []).forEach(g => {
        const p = pg[key(g)];
        cc.guidance.push({ label: METRIC_LABEL[g.m] || g.m, period: g.p, target: fmtTarget(g), text: g.t,
          move: !prev ? 'stated' : !p ? 'new' : g.lo > p.lo + 0.4 ? 'raised' : g.lo < p.lo - 0.4 ? 'lowered' : 'maintained', was: p ? fmtTarget(p) : null });
      });
      if (prev) {
        const curG = {};
        (cur.guidance || []).forEach(g => { curG[key(g)] = 1; });
        if ((cur.guidance || []).length) (prev.guidance || []).forEach(g => { if (!curG[key(g)] && /^FY/.test(g.p)) cc.guidance.push({ label: METRIC_LABEL[g.m] || g.m, period: g.p, target: fmtTarget(g), move: 'not repeated', text: g.t }); });
        const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(w => w.length > 3);
        const prevRisk = ((prev.sections || {})['Risks & challenges'] || []).map(norm);
        ((cur.sections || {})['Risks & challenges'] || []).forEach(s => {
          const w = norm(s);
          const seen = prevRisk.some(p => { const set = new Set(p); return w.filter(x => set.has(x)).length / Math.max(1, w.length) > 0.5; });
          if (!seen) cc.newRisks.push(s);
        });
        cc.newTopics = Object.keys(cur.sections || {}).filter(k => !(prev.sections || {})[k]);
      }
      out.concall = cc;
    }
    const since = calls[1] ? +new Date(calls[1].d) : Date.now() - 100 * 864e5;
    out.filings = ((f && f.announcements) || []).filter(a => +new Date(a.d) > since && a.k !== 'transcript' && a.k !== 'ppt' && a.k !== 'audio' && IMPORTANT.test(a.t + ' ' + (a.c || ''))).slice(0, 8);
    return out;
  }

  /* ---------- markdown for Sankhyas AI ---------- */
  function redFlagsMd(c) {
    const r = redFlags(c);
    let s = '## Red-flag scan: ' + r.score + '/100 (' + r.band + ' risk)\n';
    if (!r.flags.length) s += 'No red flags found in the financials' + (r.checked ? ' or in the last 2 years of exchange filings' : '') + '.\n';
    r.flags.forEach(f => { s += '- **' + f.title + '** (' + f.sev + '): ' + f.detail + '\n'; });
    if (!r.checked) s += '\n*Exchange filings for this company have not been fetched yet, so filing-based checks (auditor exits, pledges, defaults) were skipped.*';
    return s + '\n*A higher score means more warning signs. It is a starting point for research, not a verdict.*';
  }
  function guidanceMd(c) {
    const g = guidance(c);
    if (!g.rows.length) return '## Guidance tracker\nNo numeric guidance has been extracted from ' + c.name + '\'s concall transcripts yet. It appears once transcripts are fetched and summarised.';
    let s = '## Guidance tracker' + (g.score != null ? ': ' + g.score + '% delivered' : '') + '\n| Target | For | Guided | Actual | Status |\n|---|---|---|---|---|\n';
    g.rows.slice(0, 10).forEach(r => { s += '| ' + r.label + ' | ' + r.p + ' | ' + r.target + (r.move ? ' (' + r.move + ')' : '') + ' | ' + (r.actual != null ? r1(r.actual) + '%' : r.runRate != null ? 'run-rate ' + r1(r.runRate) + '%' : '-') + ' | ' + r.status + ' |\n'; });
    return s;
  }
  function whatChangedMd(c) {
    const w = whatChanged(c);
    let s = '';
    if (w.results) {
      s += '## Latest quarter: ' + w.results.quarter + '\n';
      w.results.rows.forEach(r => {
        if (!ok(r.cur)) return;
        const f = v => (ok(v) ? (v >= 0 ? '+' : '') + r1(v) + (r.isPct ? ' pts' : '%') : 'n/a');
        s += '- **' + r.label + '**: ' + (r.isPct ? r1(r.cur) + '%' : '₹' + r0(r.cur) + (r.label === 'EPS' ? '' : ' Cr')) + ' (QoQ ' + f(r.qoq) + ', YoY ' + f(r.yoy) + ')\n';
      });
    }
    if (w.concall) {
      const cc = w.concall;
      s += '\n## Concall changes\n- Tone: **' + cc.tone + '**' + (cc.prevTone ? ' (previous call: ' + cc.prevTone + ')' : '') + '\n';
      cc.guidance.forEach(g => { s += '- ' + g.label + ' ' + g.period + ': ' + g.target + ' - **' + g.move + '**' + (g.was && g.move !== 'maintained' ? ' (was ' + g.was + ')' : '') + '\n'; });
      cc.newRisks.slice(0, 3).forEach(x => { s += '- New risk mentioned: "' + x + '"\n'; });
    }
    if (w.filings.length) s += '\n## Important filings since\n' + w.filings.map(a => '- ' + new Date(a.d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ': ' + String(a.t).replace(/^.{0,160}?\b(has|have)\s+informed\s+the\s+Exchange\s*(about|regarding|that)?\s*/i, '')).join('\n');
    return s || 'Not enough history yet to compare ' + c.name + '\'s latest results and concall with the previous ones.';
  }

  /* ---------- Sankhyas Score: 0-100 from five pillars, each a percentile rank across all companies ---------- */
  const PILLARS = [
    ['quality', 'Quality', 0.25, [['roce', 1], ['roe', 1], ['opm', 1], ['avgRoce5', 1]]],
    ['growth', 'Growth', 0.20, [['salesGrowth3', 1], ['profitGrowth3', 1], ['qtrSalesVar', 1], ['qtrProfitVar', 1]]],
    ['value', 'Value', 0.20, [['pe', -1], ['pb', -1], ['earningsYield', 1], ['divYield', 1]]],
    ['momentum', 'Momentum', 0.15, [['ret6m', 1], ['ret1y', 1], ['vsDma200', 1]]],
    ['safety', 'Safety', 0.20, [['de', -1], ['interestCoverage', 1], ['pledged', -1], ['riskScore', -1]]]
  ];
  const SCORE_KEY = { quality: 'scoreQuality', growth: 'scoreGrowth', value: 'scoreValue', momentum: 'scoreMomentum', safety: 'scoreSafety' };
  let scoreMap = {};
  function inputOf(c, key) {
    const m = c.metrics;
    if (key === 'vsDma200') return ok(m.price) && ok(m.dma200) && m.dma200 > 0 ? m.price / m.dma200 - 1 : null;
    if (key === 'pe') return ok(m.pe) ? (m.pe > 0 ? m.pe : 1e6) : null;        // loss-makers rank as the most expensive
    if (key === 'pb') return ok(m.pb) ? (m.pb > 0 ? m.pb : 1e6) : null;
    if (key === 'de' && isFinancial(c)) return null;                          // leverage is the business model for lenders
    if (key === 'pledged') return ok(m.pledged) ? m.pledged : (m.promoter != null ? 0 : null);
    return ok(m[key]) ? m[key] : null;
  }
  function computeScores(all) {
    const ranks = {};
    const need = new Set();
    PILLARS.forEach(p => p[3].forEach(([k]) => need.add(k)));
    need.forEach(k => {
      const vals = all.map(c => inputOf(c, k)).filter(v => v != null).sort((a, b) => a - b);
      ranks[k] = vals.length >= 20 ? vals : null;
    });
    const pct = (k, v) => {
      const a = ranks[k];
      let lo = 0, hi = a.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
      let eq = lo;
      while (eq < a.length && a[eq] === v) eq++;
      return (lo + (eq - lo) / 2) / a.length * 100;
    };
    scoreMap = {};
    all.forEach(c => {
      const out = { pillars: {} };
      let wsum = 0, tot = 0, n = 0;
      PILLARS.forEach(([id, , w, inputs]) => {
        const got = inputs.map(([k, dir]) => { const v = inputOf(c, k); return v == null || !ranks[k] ? null : (dir > 0 ? pct(k, v) : 100 - pct(k, v)); }).filter(v => v != null);
        const val = got.length >= 2 ? Math.round(got.reduce((a, b) => a + b, 0) / got.length) : null;
        out.pillars[id] = val;
        if (val != null) { wsum += w; tot += w * val; n++; }
        c.metrics[SCORE_KEY[id]] = val;
      });
      out.score = n >= 3 ? Math.round(tot / wsum) : null;
      c.metrics.sankhyasScore = out.score;
      scoreMap[c.symbol] = out;
    });
    // rank within sector for context
    const bySector = {};
    all.forEach(c => { if (scoreMap[c.symbol].score != null) (bySector[c.sector] = bySector[c.sector] || []).push(c); });
    Object.keys(bySector).forEach(sec => {
      const list = bySector[sec].sort((a, b) => scoreMap[b.symbol].score - scoreMap[a.symbol].score);
      list.forEach((c, i) => { scoreMap[c.symbol].sectorRank = i + 1; scoreMap[c.symbol].sectorSize = list.length; });
    });
    return scoreMap;
  }
  const scoreOf = sym => scoreMap[sym] || null;
  const scoreBand = v => (v == null ? '' : v >= 75 ? 'Strong' : v >= 55 ? 'Good' : v >= 40 ? 'Average' : 'Weak');

  /* ---------- results-day verdict (quarterly results from NSE integrated filings) ---------- */
  const quarterLabel = qe => {
    const d = new Date(qe + 'T00:00:00'), m = d.getMonth();
    const q = { 5: 1, 8: 2, 11: 3, 2: 4 }[m];
    return q ? 'Q' + q + ' FY' + String((m === 2 ? d.getFullYear() : d.getFullYear() + 1) % 100).padStart(2, '0') : qe;
  };
  const growth = (a, b) => (ok(a) && ok(b) && b !== 0 ? (a - b) / Math.abs(b) * 100 : null);
  /** Verdict on the latest quarter vs the same quarter last year (and the previous quarter). */
  function resultsVerdict(doc) {
    const Q = ((doc && doc.quarters) || []).filter(q => q && q.qe).slice().sort((a, b) => (a.qe < b.qe ? 1 : -1));
    if (!Q.length) return null;
    const cur = Q[0];
    const back = months => { const d = new Date(cur.qe + 'T00:00:00'); d.setDate(15); d.setMonth(d.getMonth() - months); const k = d.toISOString().slice(0, 7); return Q.find(q => q.qe.slice(0, 7) === k) || null; };
    const prev = back(3), yago = back(12);
    // some filers leave the owners' share as 0 when there is no minority interest; fall back to total profit
    const profit = q => (q ? (ok(q.np_owners) && (q.np_owners !== 0 || !ok(q.np)) ? q.np_owners : q.np) : null);
    const opm = q => (q && ok(q.op) && q.sales ? q.op / q.sales * 100 : null);
    const pick = q => ({ sales: q && q.sales, op: q && q.op, np: profit(q), eps: q && q.eps, opm: opm(q) });
    const c = pick(cur), p = pick(prev), y = pick(yago);
    const epsG = (a, b) => (ok(a) && ok(b) && a > 0 && b > 0 ? growth(a, b) : null);
    const yoy = { sales: growth(c.sales, y.sales), op: growth(c.op, y.op), np: growth(c.np, y.np), eps: epsG(c.eps, y.eps), opm: ok(c.opm) && ok(y.opm) ? c.opm - y.opm : null };
    const qoq = { sales: growth(c.sales, p.sales), op: growth(c.op, p.op), np: growth(c.np, p.np), eps: epsG(c.eps, p.eps), opm: ok(c.opm) && ok(p.opm) ? c.opm - p.opm : null };
    // a bonus issue or split changes EPS without a change in profit: drop EPS growth that disagrees with profit growth
    [[yoy, c.np, y.np], [qoq, c.np, p.np]].forEach(([g]) => { if (ok(g.eps) && ok(g.np) && Math.abs(g.eps - g.np) > 30 && Math.abs(g.eps - g.np) > Math.abs(g.np)) g.eps = null; });
    const cmp = yago ? yoy : qoq, basis = yago ? 'YoY' : 'QoQ';
    let score = 0;
    const sG = cmp.sales, pG = cmp.np;
    if (ok(sG)) score += sG >= 15 ? 2 : sG >= 5 ? 1 : sG <= -15 ? -2 : sG <= -5 ? -1 : 0;
    const base = profit(yago || prev);
    if (ok(c.np) && c.np < 0) score -= ok(base) && base < 0 ? 1 : 3;
    else if (ok(pG)) score += pG >= 20 ? 2 : pG >= 5 ? 1 : pG <= -20 ? -2 : pG <= -5 ? -1 : 0;
    if (ok(cmp.opm) && !cur.bank) score += cmp.opm >= 1 ? 1 : cmp.opm <= -1.5 ? -1 : 0;
    // newly listed companies: nothing reported to compare with
    const verdict = !ok(sG) && !ok(pG) && !(ok(c.np) && c.np < 0) ? 'New' : score >= 3 ? 'Strong' : score <= -2 ? 'Weak' : 'Mixed';
    const cr = v => '₹ ' + Math.round(v).toLocaleString('en-IN') + ' Cr';
    const chg = (v, unit) => (v >= 0 ? 'up ' : 'down ') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + (unit || '%');
    const points = [];
    if (ok(c.sales)) points.push('Revenue ' + (ok(sG) ? chg(sG) + ' ' + basis + ' to ' : 'of ') + cr(c.sales) + (yago && ok(qoq.sales) ? ' (' + chg(qoq.sales) + ' QoQ)' : ''));
    if (ok(c.np)) points.push(c.np < 0 ? 'Net loss of ' + cr(-c.np) + (ok(profit(yago)) ? ' against ' + (profit(yago) < 0 ? 'a loss' : 'a profit') + ' of ' + cr(Math.abs(profit(yago))) + ' a year ago' : '')
      : 'Net profit ' + (ok(pG) ? chg(pG) + ' ' + basis + ' to ' : 'of ') + cr(c.np));
    if (ok(c.opm) && !cur.bank) points.push('Operating margin ' + c.opm.toFixed(1) + '%' + (ok(cmp.opm) ? ', ' + chg(cmp.opm, ' pts') + ' from ' + (yago ? 'a year ago' : 'last quarter') : ''));
    if (ok(cur.exceptional) && cur.exceptional !== 0 && ok(cur.pbt) && Math.abs(cur.exceptional) >= Math.abs(cur.pbt) * 0.05)
      points.push('Includes a one-off ' + (cur.exceptional < 0 ? 'charge' : 'gain') + ' of ' + cr(Math.abs(cur.exceptional)) + ' (exceptional items)');
    if (ok(c.eps)) points.push('EPS ₹ ' + c.eps.toFixed(2) + (ok(cmp.eps) ? ' (' + chg(cmp.eps) + ' ' + basis + ')' : ''));
    return { raw: cur, qe: cur.qe, label: quarterLabel(cur.qe), filed: cur.filed || '', cons: !!cur.cons, bank: !!cur.bank, cur: c, prev: prev && p, yago: yago && y,
      yoy, qoq, basis, score, verdict, points };
  }

  /* ---------- shareholding trend (NSE shareholding pattern, latest first) ---------- */
  function holdingStats(doc) {
    const Q = ((doc && doc.quarters) || []).filter(q => q && q.q && q.fii != null && ['promoter', 'fii', 'dii'].every(k => !(q[k] > 100))).slice().sort((a, b) => (a.q < b.q ? 1 : -1));
    if (!Q.length) return null;
    const d = (k, i) => (Q[i] && ok(Q[i][k]) && ok(Q[0][k]) ? Q[0][k] - Q[i][k] : null);
    let fiiUp = 0;
    for (let i = 0; i + 1 < Q.length && Q[i].fii > Q[i + 1].fii; i++) fiiUp++;
    let diiUp = 0;
    for (let i = 0; i + 1 < Q.length && Q[i].dii > Q[i + 1].dii; i++) diiUp++;
    const streak = (k, dir) => { let n = 0; for (let i = 0; i + 1 < Q.length && ok(Q[i][k]) && ok(Q[i + 1][k]) && (Q[i][k] - Q[i + 1][k]) * dir > 0; i++) n++; return n; };
    return { latest: Q[0], promoter: Q[0].promoter, fii: Q[0].fii, dii: Q[0].dii, pledge: Q[0].pledge, holders: Q[0].holders,
      promoterChg1q: d('promoter', 1), promoterChg4q: d('promoter', 4), fiiChg1q: d('fii', 1), fiiChg4q: d('fii', 4), diiChg1q: d('dii', 1), diiChg4q: d('dii', 4),
      holdersChg1q: Q[1] && Q[0].holders && Q[1].holders ? (Q[0].holders / Q[1].holders - 1) * 100 : null, fiiUpQtrs: fiiUp, diiUpQtrs: diiUp, fiiDownQtrs: streak('fii', -1), diiDownQtrs: streak('dii', -1) };
  }

  /* ---------- Quick read: a handful of plain-English takeaways across results, ownership, valuation, risk ----------
   * Returns [{ area, tone: 'pos' | 'neg' | 'neu', text }]. opts: { hpe: own median P/E, res, shp } */
  function quickRead(c, opts) {
    const o = opts || {}, m = c.metrics || {}, out = [], fin = isFinancial(c);
    const add = (area, tone, text) => { if (text) out.push({ area, tone, text }); };
    const pc = v => (v >= 0 ? '+' : '−') + r1(Math.abs(v)) + '%';
    const pts = v => r1(Math.abs(v)) + ' pts';

    // 1. latest results
    const v = o.res && resultsVerdict(o.res);
    if (v) {
      const g = v.yago ? v.yoy : v.qoq, b = v.yago ? 'YoY' : 'QoQ', bits = [];
      if (ok(g.sales)) bits.push('revenue ' + pc(g.sales));
      if (ok(v.cur.np) && v.cur.np < 0) bits.push('net loss of ₹ ' + r0(-v.cur.np) + ' Cr');
      else if (ok(g.np)) bits.push('net profit ' + pc(g.np));
      if (ok(g.opm) && !v.bank) bits.push('margin ' + (g.opm >= 0 ? '+' : '−') + pts(g.opm));
      add('Results', v.verdict === 'Strong' ? 'pos' : v.verdict === 'Weak' ? 'neg' : 'neu', v.verdict === 'New' ? v.label + ' is its first reported quarter as a listed company.'
        : (v.verdict === 'Mixed' ? 'Mixed' : v.verdict) + ' ' + v.label + (bits.length ? ': ' + bits.join(', ') + ' ' + b : '') + '.');
    }
    else if (ok(m.qtrSalesVar) && ok(m.qtrProfitVar))
      add('Results', m.qtrSalesVar > 5 && m.qtrProfitVar > 10 ? 'pos' : m.qtrSalesVar < -5 || m.qtrProfitVar < -15 ? 'neg' : 'neu',
        'Latest quarter: sales ' + pc(m.qtrSalesVar) + ' and net profit ' + pc(m.qtrProfitVar) + ' vs a year ago.');

    // 2. ownership
    const h = o.shp && holdingStats(o.shp);
    if (h) {
      const bits = [];
      let tone = 'neu';
      if (ok(h.promoterChg1q) && Math.abs(h.promoterChg1q) >= 0.3) {
        bits.push('Promoters ' + (h.promoterChg1q > 0 ? 'raised' : 'cut') + ' their stake by ' + pts(h.promoterChg1q) + ' last quarter to ' + r1(h.promoter) + '%');
        tone = h.promoterChg1q > 0 ? 'pos' : 'neg';
      }
      const inst = (who, key, up, down) => {
        if (up >= 3) return who + ' have added for ' + up + ' quarters in a row (now ' + r1(h[key]) + '%)';
        if (down >= 3) return who + ' have trimmed for ' + down + ' quarters in a row (now ' + r1(h[key]) + '%)';
        const d4 = h[key + 'Chg4q'];
        if (ok(d4) && Math.abs(d4) >= 1) return who + ' ' + (d4 > 0 ? 'added ' : 'cut ') + pts(d4) + ' in a year (now ' + r1(h[key]) + '%)';
        return '';
      };
      const f = inst('FIIs', 'fii', h.fiiUpQtrs, h.fiiDownQtrs), d = inst('DIIs', 'dii', h.diiUpQtrs, h.diiDownQtrs);
      if (f) bits.push(f);
      if (d) bits.push(d);
      if (tone === 'neu' && (f || d)) {
        const net = (h.fiiChg4q || 0) + (h.diiChg4q || 0);
        tone = net >= 1 ? 'pos' : net <= -1 ? 'neg' : 'neu';
      }
      if (ok(h.pledge) && h.pledge >= 5) { bits.push(r1(h.pledge) + '% of promoter shares are pledged'); tone = 'neg'; }
      if (!bits.length) bits.push('Ownership steady: promoters ' + r1(h.promoter) + '%, FIIs ' + r1(h.fii) + '%, DIIs ' + r1(h.dii) + '%' + (ok(h.holdersChg1q) && Math.abs(h.holdersChg1q) >= 5 ? '; shareholder count ' + pc(h.holdersChg1q) + ' in a quarter' : ''));
      add('Ownership', tone, bits.slice(0, 2).join('; ') + '.');
    }

    // 3. valuation
    if (ok(m.pe) && m.pe > 0) {
      const hpe = ok(o.hpe) && o.hpe > 0 ? o.hpe : null, ipe = ok(m.industryPE) && m.industryPE > 0 && Math.abs(m.industryPE - m.pe) > 0.01 ? m.industryPE : null;
      const vsH = hpe ? m.pe / hpe - 1 : null, vsI = ipe ? m.pe / ipe - 1 : null;
      const cmp = (r, what, val) => (Math.abs(r) < 0.1 ? 'in line with ' : r < 0 ? r0(-r * 100) + '% below ' : r0(r * 100) + '% above ') + what + ' (' + r1(val) + ')';
      const parts = [];
      if (hpe) parts.push(cmp(vsH, 'its own 5-year median', hpe));
      if (ipe) parts.push(cmp(vsI, 'the industry median', ipe));
      const ref = vsH != null ? vsH : vsI;
      add('Valuation', ref == null ? 'neu' : ref <= -0.15 ? 'pos' : ref >= 0.25 ? 'neg' : 'neu', 'P/E of ' + r1(m.pe) + (parts.length ? ', ' + parts.join(' and ') : '') + '.');
    } else if (ok(m.pe) || (ok(m.np) && m.np < 0)) add('Valuation', 'neg', 'Loss-making over the last 12 months, so P/E does not apply' + (ok(m.pb) && m.pb > 0 ? '; price to book is ' + r1(m.pb) + 'x' : '') + '.');

    // 4. business quality
    const roce = fin ? m.roe : m.roce, rl = fin ? 'ROE' : 'ROCE';
    if (ok(roce)) {
      const g = ok(m.profitGrowth5) ? m.profitGrowth5 : m.profitGrowth3, gy = ok(m.profitGrowth5) ? 5 : 3;
      add('Quality', roce >= 20 && (!ok(g) || g >= 10) ? 'pos' : roce < 10 || (ok(g) && g < 0) ? 'neg' : 'neu',
        rl + ' of ' + r1(roce) + '%' + (ok(g) ? ' with profit growing ' + r1(g) + '% a year over ' + gy + ' years' : '') + (!fin && ok(m.de) ? (m.de < 0.1 ? '; almost debt free' : m.de > 1 ? '; debt is ' + r1(m.de) + 'x equity' : '') : '') + '.');
    }

    // 5. forensic checks
    const rf = redFlags(c);
    if (rf.flags.length) {
      const top = rf.flags.slice().sort((a, b) => SEV[b.sev] - SEV[a.sev])[0];
      add('Red flags', rf.band === 'Low' ? 'neu' : 'neg', rf.flags.length + ' warning sign' + (rf.flags.length > 1 ? 's' : '') + ' (' + rf.band.toLowerCase() + ' risk), the most serious: ' + top.title.toLowerCase() + '.');
    } else add('Red flags', 'pos', 'Clean on every forensic check: cash conversion, debt, receivables, dilution' + (rf.checked ? ', auditor exits, pledges and regulatory action' : '') + '.');

    // credit rating and the annual report's audit
    const F = c._filings;
    const cr = F && creditRatings(F);
    if (cr && cr.head) {
      const when = d => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      const last = cr.changes[0];
      const rk = ratingRank(cr.head.rt);
      add('Credit rating', cr.down ? 'neg' : cr.up ? 'pos' : rk >= 0 && rk <= 3 ? 'pos' : rk >= 10 ? 'neg' : 'neu',
        'Rated ' + ratingText(cr.head) + (last ? '; ' + RATING_ACT[last.act].toLowerCase() + (last.from ? ' from ' + last.from : '') + ' in ' + when(last.d) : cr.head.act === 'reaffirm' ? ', reaffirmed in ' + when(cr.head.d) : ' as of ' + when(cr.head.d)) +
        (cr.latest.length > 1 ? ' (' + cr.latest.length + ' agencies)' : '') + '.');
    }
    const ar = F && annualReportCheck(F);
    if (ar) {
      const serious = (ar.flags || []).filter(x => x.sev !== 'low');
      add('Annual report', serious.some(x => x.sev === 'high') ? 'neg' : serious.length ? 'neu' : 'pos',
        (ar.year ? ar.year + ': ' : '') + (serious.length ? serious.length + ' issue' + (serious.length > 1 ? 's' : '') + ' flagged, the most serious: ' + serious[0].t.replace(/ \(CARO\)$/, '').toLowerCase() + ' (page ' + serious[0].p + ')'
          : (ar.opinion === 'Unmodified' ? 'clean audit opinion' : 'no audit qualification found') + (ar.auditor ? ' from ' + ar.auditor : '') + '; no adverse remarks in the auditor\'s CARO checklist') + '.');
    }

    // 6. management: guidance delivery, then concall tone, then order wins
    const gd = guidance(c), w = whatChanged(c), act = c._activity;
    const orders = act ? act.orders.filter(x => x.s === c.symbol) : [];
    if (gd.score != null) add('Management', gd.score >= 70 ? 'pos' : gd.score < 40 ? 'neg' : 'neu', 'Delivered ' + gd.score + '% of the targets it set on concalls (' + gd.judged + ' checked).');
    else if (w.concall && w.concall.tone) {
      const t = w.concall.tone, pt = w.concall.prevTone;
      add('Management', /positive|confident|optimistic/i.test(t) ? 'pos' : /cautious|negative|weak/i.test(t) ? 'neg' : 'neu',
        'Latest concall tone was ' + t.toLowerCase() + (pt && pt !== t ? ' (previous call: ' + pt.toLowerCase() + ')' : '') + (w.concall.guidance.length ? '; ' + w.concall.guidance.length + ' guidance update' + (w.concall.guidance.length > 1 ? 's' : '') : '') + '.');
    }
    if (orders.length) {
      const tot = orders.reduce((a, x) => a + (x.amt || 0), 0);
      add('Orders', 'pos', orders.length + ' order win' + (orders.length > 1 ? 's' : '') + ' announced in 12 months' + (tot ? ' worth ₹ ' + r0(tot) + ' Cr' + (ok(m.sales) && m.sales > 0 ? ' (' + r0(tot / m.sales * 100) + '% of annual sales)' : '') : '') + '.');
    }

    // 7. price trend
    if (ok(m.price) && ok(m.high52) && m.high52 > 0) {
      const off = (1 - m.price / m.high52) * 100, above = ok(m.dma200) ? m.price >= m.dma200 : null;
      add('Price', above === false && off > 20 ? 'neg' : above && off < 10 ? 'pos' : 'neu',
        (off < 2 ? 'At its 52-week high' : r0(off) + '% below its 52-week high') + (ok(m.ret1y) ? ', ' + (m.ret1y >= 0 ? 'up ' : 'down ') + r1(Math.abs(m.ret1y)) + '% over the past year' : '') + (above == null ? '' : above ? ', above its 200-day average' : ', below its 200-day average') + '.');
    }
    return out;
  }
  // one sentence on why the quarter got its verdict
  function resultsWhy(v) {
    if (!v) return '';
    const g = v.yago ? v.yoy : v.qoq, basis = v.yago ? 'a year ago' : 'the previous quarter';
    const good = [], bad = [];
    const fmt = x => r1(Math.abs(x)) + '%';
    if (ok(g.sales)) (g.sales >= 5 ? good : g.sales <= -5 ? bad : good).push(g.sales >= 0 ? 'revenue ' + (g.sales < 5 ? 'edged up ' : 'grew ') + fmt(g.sales) : 'revenue ' + (g.sales > -5 ? 'slipped ' : 'fell ') + fmt(g.sales));
    const base = v.yago || v.prev;
    const ex = v.raw && v.raw.exceptional;
    if (ok(v.cur.np) && v.cur.np < 0) bad.push('it posted a net loss of ₹ ' + r0(-v.cur.np) + ' Cr' + (ok(ex) && ex < 0 ? ' after a one-off charge of ₹ ' + r0(-ex) + ' Cr' : '') + (base && ok(base.np) && base.np > 0 ? ' (vs a profit of ₹ ' + r0(base.np) + ' Cr ' + (v.yago ? 'a year ago' : 'last quarter') + ')' : ''));
    else if (base && ok(base.np) && base.np < 0 && ok(v.cur.np)) good.push('it swung to a net profit of ₹ ' + r0(v.cur.np) + ' Cr from a loss');
    else if (ok(g.np)) {
      if (g.np >= 5 && !(ok(g.sales) && g.sales >= 10 && g.np < g.sales / 2)) good.push('net profit rose ' + fmt(g.np));
      else if (g.np >= 1.5) bad.push('net profit rose only ' + fmt(g.np));
      else if (g.np > -1.5) bad.push('net profit was flat');
      else bad.push('net profit fell ' + fmt(g.np));
    }
    if (ok(g.opm) && !v.bank && Math.abs(g.opm) >= 0.5) (g.opm > 0 ? good : bad).push('operating margin ' + (g.opm > 0 ? 'widened ' : 'narrowed ') + r1(Math.abs(g.opm)) + ' pts');
    if (v.verdict === 'New') return v.label + ' is its first reported quarter as a listed company, so there is nothing to compare with yet.';
    const head = v.label + ' was ' + (v.verdict === 'Mixed' ? 'a mixed' : 'a ' + v.verdict.toLowerCase()) + ' quarter compared with ' + basis;
    if (!good.length && !bad.length) return head + '.';
    const list = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0]);
    return head + ': ' + (good.length && bad.length ? list(good) + ', but ' + list(bad) : list(good.length ? good : bad)) + '.';
  }

  window.Insights = { creditRatings, annualReportCheck, ratingRank, RATING_ACT, ratingText, quickRead, resultsWhy, computeScores, scoreOf, scoreBand, PILLARS, redFlags, guidance, whatChanged, redFlagsMd, guidanceMd, whatChangedMd, METRIC_LABEL, resultsVerdict, holdingStats, quarterLabel };
})();
