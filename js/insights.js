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
  function redFlags(c, filings) {
    const flags = numberFlags(c).concat(filingFlags(filings || c._filings));
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

  window.Insights = { computeScores, scoreOf, scoreBand, PILLARS, redFlags, guidance, whatChanged, redFlagsMd, guidanceMd, whatChangedMd, METRIC_LABEL };
})();
