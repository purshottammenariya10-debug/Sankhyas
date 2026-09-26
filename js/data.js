/*
 * Sankhyas data layer.
 *
 * All figures here are SAMPLE data generated deterministically from a small set
 * of seed parameters per company. They are shaped like real financial statements
 * so every page works end-to-end, but they are NOT actual reported numbers.
 * Replace `Data.getCompany()` / `Data.listCompanies()` with calls to a real
 * market-data API to go live.
 */
(function () {
  'use strict';

  // sym, name, sector, industry, price, sharesCr, revenueCr(FY26), growth, opm%, promoter%, debt/equity, payout, faceValue, bseCode, psu, website
  const SEED = [
    ['RELIANCE', 'Reliance Industries Ltd', 'Energy', 'Refineries & Petrochemicals', 1410, 1353, 985000, 0.09, 17, 50.1, 0.40, 0.10, 10, 500325, 0, 'ril.com'],
    ['TCS', 'Tata Consultancy Services Ltd', 'Information Technology', 'IT Services & Consulting', 3120, 361.8, 262000, 0.10, 26, 71.8, 0.05, 0.85, 1, 532540, 0, 'tcs.com'],
    ['HDFCBANK', 'HDFC Bank Ltd', 'Financials', 'Private Sector Bank', 980, 1530, 360000, 0.17, 30, 0, 6.5, 0.22, 1, 500180, 0, 'hdfcbank.com'],
    ['INFY', 'Infosys Ltd', 'Information Technology', 'IT Services & Consulting', 1520, 415, 168000, 0.12, 24, 14.6, 0.03, 0.85, 5, 500209, 0, 'infosys.com'],
    ['ICICIBANK', 'ICICI Bank Ltd', 'Financials', 'Private Sector Bank', 1380, 713, 190000, 0.13, 32, 0, 5.5, 0.15, 2, 532174, 0, 'icicibank.com'],
    ['HINDUNILVR', 'Hindustan Unilever Ltd', 'FMCG', 'Personal Care', 2450, 235, 64000, 0.09, 23.5, 61.9, 0.02, 0.95, 1, 500696, 0, 'hul.co.in'],
    ['ITC', 'ITC Ltd', 'FMCG', 'Cigarettes & Diversified FMCG', 405, 1251, 78000, 0.08, 36, 0, 0.0, 0.85, 1, 500875, 0, 'itcportal.com'],
    ['SBIN', 'State Bank of India', 'Financials', 'Public Sector Bank', 860, 892.5, 510000, 0.10, 25, 57.4, 12, 0.18, 1, 500112, 1, 'sbi.co.in'],
    ['BHARTIARTL', 'Bharti Airtel Ltd', 'Telecom', 'Telecom Services', 1920, 598, 188000, 0.10, 54, 53.3, 1.3, 0.25, 5, 532454, 0, 'airtel.in'],
    ['KOTAKBANK', 'Kotak Mahindra Bank Ltd', 'Financials', 'Private Sector Bank', 2080, 199, 68000, 0.15, 35, 25.9, 4, 0.05, 5, 500247, 0, 'kotak.com'],
    ['LT', 'Larsen & Toubro Ltd', 'Industrials', 'Engineering & Construction', 3650, 137.5, 258000, 0.11, 13, 0, 1.1, 0.30, 2, 500510, 0, 'larsentoubro.com'],
    ['ASIANPAINT', 'Asian Paints Ltd', 'Consumer Durables', 'Paints', 2380, 95.9, 34000, 0.10, 19, 52.6, 0.1, 0.65, 1, 500820, 0, 'asianpaints.com'],
    ['AXISBANK', 'Axis Bank Ltd', 'Financials', 'Private Sector Bank', 1180, 310, 128000, 0.14, 30, 8.2, 6, 0.02, 2, 532215, 0, 'axisbank.com'],
    ['MARUTI', 'Maruti Suzuki India Ltd', 'Automobile', 'Passenger Cars', 12800, 31.4, 158000, 0.11, 12, 58.2, 0.0, 0.35, 5, 532500, 0, 'marutisuzuki.com'],
    ['SUNPHARMA', 'Sun Pharmaceutical Industries Ltd', 'Healthcare', 'Pharmaceuticals', 1640, 240, 54000, 0.10, 28, 54.5, 0.05, 0.35, 1, 524715, 0, 'sunpharma.com'],
    ['TITAN', 'Titan Company Ltd', 'Consumer Durables', 'Jewellery & Watches', 3480, 88.8, 62000, 0.18, 11, 52.9, 0.6, 0.30, 1, 500114, 0, 'titancompany.in'],
    ['BAJFINANCE', 'Bajaj Finance Ltd', 'Financials', 'NBFC', 980, 620, 70000, 0.25, 64, 54.7, 3.8, 0.15, 1, 500034, 0, 'bajajfinserv.in'],
    ['WIPRO', 'Wipro Ltd', 'Information Technology', 'IT Services & Consulting', 255, 1047, 90000, 0.07, 20, 72.7, 0.2, 0.5, 2, 507685, 0, 'wipro.com'],
    ['ULTRACEMCO', 'UltraTech Cement Ltd', 'Materials', 'Cement', 11800, 29.5, 78000, 0.11, 18, 59.2, 0.3, 0.15, 10, 532538, 0, 'ultratechcement.com'],
    ['NESTLEIND', 'Nestle India Ltd', 'FMCG', 'Packaged Foods', 1190, 96.4, 20500, 0.09, 23, 62.8, 0.2, 0.9, 1, 500790, 0, 'nestle.in'],
    ['HCLTECH', 'HCL Technologies Ltd', 'Information Technology', 'IT Services & Consulting', 1600, 271, 122000, 0.11, 22, 60.8, 0.05, 0.85, 2, 532281, 0, 'hcltech.com'],
    ['TATAMOTORS', 'Tata Motors Ltd', 'Automobile', 'Commercial & Passenger Vehicles', 690, 368, 440000, 0.09, 13, 42.6, 1.0, 0.1, 2, 500570, 0, 'tatamotors.com'],
    ['POWERGRID', 'Power Grid Corporation of India Ltd', 'Utilities', 'Power Transmission', 290, 930, 47000, 0.06, 86, 51.3, 1.4, 0.55, 10, 532898, 1, 'powergrid.in'],
    ['NTPC', 'NTPC Ltd', 'Utilities', 'Power Generation', 335, 970, 190000, 0.09, 28, 51.1, 1.4, 0.40, 10, 532555, 1, 'ntpc.co.in'],
    ['ONGC', 'Oil & Natural Gas Corporation Ltd', 'Energy', 'Oil Exploration & Production', 245, 1258, 660000, 0.08, 14, 58.9, 0.5, 0.35, 5, 500312, 1, 'ongcindia.com'],
    ['TATASTEEL', 'Tata Steel Ltd', 'Materials', 'Iron & Steel', 160, 1248, 225000, 0.07, 12, 33.2, 1.0, 0.3, 1, 500470, 0, 'tatasteel.com'],
    ['JSWSTEEL', 'JSW Steel Ltd', 'Materials', 'Iron & Steel', 1050, 244, 175000, 0.14, 14, 45.3, 1.1, 0.12, 1, 500228, 0, 'jsw.in'],
    ['ADANIENT', 'Adani Enterprises Ltd', 'Industrials', 'Trading & Infrastructure', 2450, 115, 98000, 0.20, 14, 72.6, 1.6, 0.05, 1, 512599, 0, 'adanienterprises.com'],
    ['COALINDIA', 'Coal India Ltd', 'Energy', 'Coal Mining', 385, 616, 143000, 0.06, 28, 63.1, 0.05, 0.60, 10, 533278, 1, 'coalindia.in'],
    ['DRREDDY', "Dr. Reddy's Laboratories Ltd", 'Healthcare', 'Pharmaceuticals', 1260, 83.4, 34000, 0.10, 27, 26.6, 0.1, 0.2, 1, 500124, 0, 'drreddys.com'],
    ['CIPLA', 'Cipla Ltd', 'Healthcare', 'Pharmaceuticals', 1520, 80.8, 28500, 0.09, 25, 30.9, 0.02, 0.25, 2, 500087, 0, 'cipla.com'],
    ['DIVISLAB', "Divi's Laboratories Ltd", 'Healthcare', 'Pharmaceuticals', 6300, 26.5, 10500, 0.12, 32, 51.9, 0.0, 0.4, 2, 532488, 0, 'divislabs.com'],
    ['BRITANNIA', 'Britannia Industries Ltd', 'FMCG', 'Packaged Foods', 5700, 24.1, 18500, 0.09, 18, 50.5, 0.5, 0.75, 1, 500825, 0, 'britannia.co.in'],
    ['PIDILITIND', 'Pidilite Industries Ltd', 'Materials', 'Specialty Chemicals', 1480, 101.7, 13800, 0.11, 23, 69.6, 0.05, 0.5, 1, 500331, 0, 'pidilite.com'],
    ['HAVELLS', 'Havells India Ltd', 'Consumer Durables', 'Electrical Equipment', 1560, 62.7, 22500, 0.14, 10, 59.4, 0.0, 0.45, 1, 517354, 0, 'havells.com'],
    ['DMART', 'Avenue Supermarts Ltd', 'Retail', 'Supermarkets', 4300, 65.1, 64000, 0.22, 8, 74.6, 0.02, 0.0, 10, 540376, 0, 'dmartindia.com'],
    ['BAJAJ-AUTO', 'Bajaj Auto Ltd', 'Automobile', 'Two & Three Wheelers', 8900, 27.9, 53000, 0.08, 20, 55.0, 0.0, 0.6, 10, 532977, 0, 'bajajauto.com'],
    ['HEROMOTOCO', 'Hero MotoCorp Ltd', 'Automobile', 'Two & Three Wheelers', 5300, 20.0, 42000, 0.05, 14.5, 34.7, 0.0, 0.7, 2, 500182, 0, 'heromotocorp.com'],
    ['EICHERMOT', 'Eicher Motors Ltd', 'Automobile', 'Two & Three Wheelers', 6900, 27.4, 20500, 0.13, 25, 49.1, 0.0, 0.35, 1, 505200, 0, 'eicher.in'],
    ['TECHM', 'Tech Mahindra Ltd', 'Information Technology', 'IT Services & Consulting', 1480, 88.2, 54000, 0.07, 13, 35.0, 0.1, 0.8, 5, 532755, 0, 'techmahindra.com'],
    ['DABUR', 'Dabur India Ltd', 'FMCG', 'Personal Care', 520, 177, 13000, 0.07, 19, 66.2, 0.1, 0.6, 1, 500096, 0, 'dabur.com'],
    ['MARICO', 'Marico Ltd', 'FMCG', 'Personal Care', 720, 129.4, 11500, 0.07, 20, 59.0, 0.1, 0.85, 1, 531642, 0, 'marico.com'],
    ['IRCTC', 'Indian Railway Catering & Tourism Corporation Ltd', 'Consumer Services', 'Railway Catering & Tourism', 740, 80, 4800, 0.15, 34, 62.4, 0.0, 0.45, 2, 542830, 1, 'irctc.co.in'],
    ['PAGEIND', 'Page Industries Ltd', 'Textiles', 'Innerwear & Apparel', 45000, 1.115, 5100, 0.12, 20, 45.0, 0.0, 0.6, 10, 532827, 0, 'pageind.com'],
    ['POLYCAB', 'Polycab India Ltd', 'Industrials', 'Cables & Wires', 7200, 15.04, 26000, 0.20, 13, 63.0, 0.0, 0.2, 10, 542652, 0, 'polycab.com'],
    ['HAL', 'Hindustan Aeronautics Ltd', 'Industrials', 'Aerospace & Defence', 4600, 66.9, 33000, 0.09, 30, 71.6, 0.0, 0.3, 5, 541154, 1, 'hal-india.co.in'],
    ['BEL', 'Bharat Electronics Ltd', 'Industrials', 'Aerospace & Defence', 390, 731, 24500, 0.11, 27, 51.1, 0.0, 0.4, 1, 500049, 1, 'bel-india.in'],
    ['TRENT', 'Trent Ltd', 'Retail', 'Apparel Retail', 5200, 35.5, 20500, 0.32, 16, 37.0, 0.3, 0.15, 1, 500251, 0, 'trentlimited.com'],
    ['APOLLOHOSP', 'Apollo Hospitals Enterprise Ltd', 'Healthcare', 'Hospitals', 7400, 14.4, 24500, 0.14, 14, 29.3, 0.6, 0.2, 5, 508869, 0, 'apollohospitals.com'],
    ['GRASIM', 'Grasim Industries Ltd', 'Materials', 'Diversified', 2750, 68.0, 150000, 0.14, 13, 43.1, 1.5, 0.1, 2, 500300, 0, 'grasim.com']
  ];

  const TODAY = new Date(2026, 8, 25);
  const YEARS = [];
  for (let y = 2015; y <= 2026; y++) YEARS.push('Mar ' + y);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // 13 quarters: Jun 2023 .. Jun 2026
  const QUARTERS = [];
  (function () {
    let m = 5, y = 2023;
    for (let i = 0; i < 13; i++) {
      QUARTERS.push({ label: MONTHS[m] + ' ' + y, fy: m <= 2 ? y : y + 1, q: [5, 8, 11, 2].indexOf(m) });
      m += 3;
      if (m > 11) { m -= 12; y++; }
    }
  })();
  // Shareholding quarters: Sep 2023 .. Jun 2026 (12)
  const SH_QUARTERS = QUARTERS.slice(1).map(q => q.label);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const round = (x, d = 0) => { const p = Math.pow(10, d); return Math.round(x * p) / p; };
  const sum = a => a.reduce((s, x) => s + x, 0);
  const median = a => {
    const s = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const cagr = (a, b, n) => (a > 0 && b > 0 ? (Math.pow(b / a, 1 / n) - 1) * 100 : null);

  const base = SEED.map(s => ({
    symbol: s[0], name: s[1], sector: s[2], industry: s[3], price: s[4], shares: s[5],
    revenue: s[6], growth: s[7], opm: s[8], promoter: s[9], de: s[10], payout: s[11],
    faceValue: s[12], bseCode: s[13], psu: !!s[14], website: s[15]
  }));
  const bySymbol = {};
  base.forEach(c => { bySymbol[c.symbol] = c; });

  function buildPL(c, r, scale) {
    const rows = { sales: [], expenses: [], op: [], opm: [], otherIncome: [], interest: [], depreciation: [], pbt: [], tax: [], np: [], eps: [], payout: [],
      material: [], employee: [], power: [], otherExp: [] };
    const bs = { equity: [], reserves: [], borrowings: [], otherLiab: [], total: [], fixedAssets: [], cwip: [], investments: [], otherAssets: [] };
    let reserves = null;
    for (let i = 0; i < YEARS.length; i++) {
      const yrsBack = YEARS.length - 1 - i;
      const sales = c.revenue * scale / Math.pow(1 + c.growth, yrsBack) * (1 + gauss(r) * 0.035);
      const opm = Math.max(3, c.opm + gauss(r) * 2);
      const op = sales * opm / 100;
      const exp = sales - op;
      const other = sales * (0.01 + r() * 0.025);
      const dep = sales * (0.025 + r() * 0.02) * (c.opm > 60 ? 0.3 : 1);
      const eq = c.shares * c.faceValue;
      if (reserves === null) reserves = Math.max(eq * 2, sales * (0.25 + r() * 0.2));
      const nwPrev = eq + reserves;
      const borrow = Math.max(0, nwPrev * c.de * (0.85 + r() * 0.3));
      const interest = borrow * (c.de > 3 ? 0.055 : 0.085) * (0.9 + r() * 0.2);
      const pbt = op + other - interest - dep;
      const taxPct = 24 + gauss(r) * 2.5;
      const np = pbt * (1 - taxPct / 100);
      const payout = Math.max(0, Math.min(1, c.payout + gauss(r) * 0.05));
      reserves += np * (1 - payout);

      rows.sales.push(sales); rows.expenses.push(exp); rows.op.push(op); rows.opm.push(opm);
      rows.otherIncome.push(other); rows.interest.push(interest); rows.depreciation.push(dep);
      rows.pbt.push(pbt); rows.tax.push(taxPct); rows.np.push(np); rows.eps.push(np / c.shares);
      rows.payout.push(payout * 100);
      const mat = 0.35 + r() * 0.3, emp = 0.15 + r() * 0.2, pow = 0.03 + r() * 0.05;
      const tot = mat + emp + pow + 0.12;
      rows.material.push(exp * mat / tot / sales * 100);
      rows.employee.push(exp * emp / tot / sales * 100);
      rows.power.push(exp * pow / tot / sales * 100);
      rows.otherExp.push(exp * 0.12 / tot / sales * 100);

      const otherLiab = sales * (0.18 + r() * 0.12) * (c.de > 3 ? 3 : 1);
      const total = eq + reserves + borrow + otherLiab;
      const fa = total * (c.de > 3 ? 0.03 : 0.28 + r() * 0.12);
      const cwip = total * (c.de > 3 ? 0.002 : 0.02 + r() * 0.04);
      const inv = total * (0.12 + r() * 0.15);
      bs.equity.push(eq); bs.reserves.push(reserves); bs.borrowings.push(borrow);
      bs.otherLiab.push(otherLiab); bs.total.push(total); bs.fixedAssets.push(fa);
      bs.cwip.push(cwip); bs.investments.push(inv); bs.otherAssets.push(total - fa - cwip - inv);
    }
    return { rows, bs };
  }

  function buildQuarters(c, pl, r) {
    const season = [0.96, 0.99, 1.01, 1.04];
    const q = { sales: [], expenses: [], op: [], opm: [], otherIncome: [], interest: [], depreciation: [], pbt: [], tax: [], np: [], eps: [] };
    QUARTERS.forEach(Q => {
      let yi = YEARS.indexOf('Mar ' + Q.fy);
      let annual, grow = 1;
      if (yi < 0) { yi = YEARS.length - 1; grow = 1 + c.growth; }
      annual = pl.rows.sales[yi] * grow;
      const sales = annual / 4 * season[Q.q] * (1 + gauss(r) * 0.03);
      const opm = Math.max(2, pl.rows.opm[yi] + gauss(r) * 1.8);
      const op = sales * opm / 100;
      const other = pl.rows.otherIncome[yi] / pl.rows.sales[yi] * sales * (0.8 + r() * 0.4);
      const interest = pl.rows.interest[yi] / 4 * (0.9 + r() * 0.2);
      const dep = pl.rows.depreciation[yi] / pl.rows.sales[yi] * sales;
      const pbt = op + other - interest - dep;
      const taxPct = pl.rows.tax[yi] + gauss(r) * 1.5;
      const np = pbt * (1 - taxPct / 100);
      q.sales.push(sales); q.expenses.push(sales - op); q.op.push(op); q.opm.push(opm);
      q.otherIncome.push(other); q.interest.push(interest); q.depreciation.push(dep);
      q.pbt.push(pbt); q.tax.push(taxPct); q.np.push(np); q.eps.push(np / c.shares);
    });
    return q;
  }

  function businessDays(n) {
    const out = [];
    const d = new Date(TODAY);
    while (out.length < n) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) out.push(new Date(d));
      d.setDate(d.getDate() - 1);
    }
    return out.reverse();
  }
  const PRICE_DAYS = businessDays(252 * 11);

  function buildPrices(c, r) {
    const n = PRICE_DAYS.length;
    const drift = Math.log(1 + c.growth * 1.1) / 252;
    const vol = 0.016 + r() * 0.008;
    const prices = new Array(n);
    prices[n - 1] = c.price;
    for (let i = n - 1; i > 0; i--) {
      const ret = drift + vol * gauss(r) + (r() < 0.002 ? gauss(r) * 0.06 : 0);
      prices[i - 1] = Math.max(1, prices[i] / Math.exp(ret));
    }
    const baseVol = (c.shares * 1e7) * (0.0015 + r() * 0.003);
    const volume = prices.map((p, i) => {
      const chg = i ? Math.abs(p / prices[i - 1] - 1) : 0;
      return Math.round(baseVol * (0.5 + r()) * (1 + chg * 25));
    });
    return { prices: prices.map(p => round(p, 2)), volume };
  }

  function buildShareholding(c, r) {
    const n = SH_QUARTERS.length;
    const gov = c.psu ? 0.5 : 0;
    const prom = c.promoter, rem = 100 - prom - (c.psu ? 0.5 : 0);
    let fii = rem * (0.3 + r() * 0.25);
    let dii = rem * (0.2 + r() * 0.15);
    const out = { promoters: [], fiis: [], diis: [], government: [], public: [], holders: [] };
    let holders = Math.round((c.shares * 1e7) / (2000 + r() * 8000));
    for (let i = 0; i < n; i++) {
      const p = Math.max(0, prom + (i - n + 1) * (r() < 0.3 ? 0.08 : 0) * (r() < 0.5 ? -1 : 1));
      fii = Math.max(1, fii + gauss(r) * 0.03 * rem / 10);
      dii = Math.max(1, dii + gauss(r) * 0.03 * rem / 10 + 0.05);
      const pub = Math.max(0.5, 100 - p - fii - dii - gov);
      holders = Math.round(holders * (1.01 + r() * 0.05));
      out.promoters.push(p); out.fiis.push(fii); out.diis.push(dii); out.government.push(gov);
      out.public.push(pub); out.holders.push(holders);
    }
    // normalise to 100
    for (let i = 0; i < n; i++) {
      const t = out.promoters[i] + out.fiis[i] + out.diis[i] + out.government[i] + out.public[i];
      ['promoters', 'fiis', 'diis', 'government', 'public'].forEach(k => { out[k][i] = round(out[k][i] * 100 / t, 2); });
    }
    return out;
  }

  function buildDocuments(c, r) {
    const ann = [
      'Board Meeting Intimation for approval of quarterly results',
      'Outcome of Board Meeting - financial results for the quarter ended June 30, 2026',
      'Analysts/Institutional Investor Meet/Con. Call Updates',
      'Disclosure under Regulation 30 of SEBI (LODR)',
      'Closure of Trading Window',
      'Intimation of record date for dividend',
      'Newspaper publication of financial results',
      'Shareholding pattern for the quarter ended June 30, 2026',
      'Compliance certificate under Regulation 74(5) of SEBI (DP) Regulations',
      'Press release on business update',
      'Allotment of equity shares under ESOP scheme',
      'Notice of Annual General Meeting'
    ];
    const d = new Date(TODAY);
    const announcements = ann.map((t, i) => {
      d.setDate(d.getDate() - (1 + Math.floor(r() * 9)));
      return { title: t, date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) };
    });
    const reports = [];
    for (let y = 2026; y >= 2016; y--) reports.push({ title: 'Financial Year ' + y, source: r() < 0.5 ? 'from bse' : 'from nse' });
    const agencies = ['CRISIL', 'ICRA', 'CARE', 'India Ratings'];
    const ratings = [];
    const rd = new Date(TODAY);
    for (let i = 0; i < 6; i++) {
      rd.setMonth(rd.getMonth() - (2 + Math.floor(r() * 5)));
      ratings.push({ title: 'Rating update', agency: agencies[Math.floor(r() * agencies.length)], date: rd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) });
    }
    const concalls = QUARTERS.slice(-8).reverse().map(q => ({ period: q.label, transcript: true, ppt: r() < 0.9, rec: r() < 0.5, notes: r() < 0.4 }));
    return { announcements, reports, ratings, concalls };
  }

  const cache = {};
  function getCompany(sym, standalone) {
    sym = String(sym || '').toUpperCase();
    const c = bySymbol[sym];
    if (!c) return null;
    const key = sym + (standalone ? ':s' : ':c');
    if (cache[key]) return cache[key];
    const r = rng(hash(sym));
    const scale = standalone ? 0.82 : 1;
    const pl = buildPL(c, r, scale);
    const quarters = buildQuarters(c, pl, r);
    const px = buildPrices(c, rng(hash(sym + 'px')));
    const sh = buildShareholding(c, rng(hash(sym + 'sh')));
    const docs = buildDocuments(c, rng(hash(sym + 'doc')));
    const R = pl.rows, B = pl.bs;

    // Cash flows
    const cf = { cfo: [], cfi: [], cff: [], net: [] };
    for (let i = 0; i < YEARS.length; i++) {
      const cfo = R.np[i] + R.depreciation[i] + gauss(r) * 0.18 * Math.abs(R.np[i]);
      const cfi = -(R.depreciation[i] * (1.1 + r() * 0.8) + Math.abs(gauss(r)) * 0.1 * R.np[i]);
      const cff = -(R.np[i] * R.payout[i] / 100) - R.interest[i] + (i ? B.borrowings[i] - B.borrowings[i - 1] : 0);
      cf.cfo.push(cfo); cf.cfi.push(cfi); cf.cff.push(cff); cf.net.push(cfo + cfi + cff);
    }
    // Ratios
    const ratios = { debtor: [], inventory: [], payable: [], ccc: [], wc: [], roce: [], roe: [] };
    const dBase = 20 + r() * 60, iBase = 20 + r() * 80, pBase = 30 + r() * 60;
    for (let i = 0; i < YEARS.length; i++) {
      const d = Math.max(1, dBase + gauss(r) * 6), inv = Math.max(0, iBase + gauss(r) * 8), p = Math.max(5, pBase + gauss(r) * 8);
      ratios.debtor.push(d); ratios.inventory.push(inv); ratios.payable.push(p); ratios.ccc.push(d + inv - p);
      ratios.wc.push(d + inv - p * 0.6 + gauss(r) * 5);
      const ce = (i ? (B.equity[i - 1] + B.reserves[i - 1] + B.borrowings[i - 1] + B.equity[i] + B.reserves[i] + B.borrowings[i]) / 2 : B.equity[i] + B.reserves[i] + B.borrowings[i]);
      ratios.roce.push((R.pbt[i] + R.interest[i]) / ce * 100);
      const nw = i ? (B.equity[i - 1] + B.reserves[i - 1] + B.equity[i] + B.reserves[i]) / 2 : B.equity[i] + B.reserves[i];
      ratios.roe.push(R.np[i] / nw * 100);
    }


    const out = Object.assign({}, c, {
      standalone: !!standalone, live: false,
      years: YEARS, quarters: QUARTERS.map(q => q.label), shQuarters: SH_QUARTERS,
      pl: R, bs: B, cf, ratios, q: quarters, sh, docs,
      prices: px.prices, volume: px.volume, dates: PRICE_DAYS
    });
    out.ttm = computeTTM(out);
    out.metrics = computeMetrics(out, {
      pledged: c.promoter > 0 ? round(Math.max(0, gauss(rng(hash(sym + 'pl'))) * 2), 2) : 0
    });
    out.metrics.sme = 0;
    if (window.Insights) out.metrics.riskScore = window.Insights.redFlags(out).score;
    cache[key] = out;
    return out;
  }

  /* ---------- shared calculations (sample and live data) ---------- */
  const at = (arr, i) => (arr && i >= 0 && i < arr.length && arr[i] != null && isFinite(arr[i]) ? arr[i] : null);
  const lastOf = arr => (arr && arr.length ? at(arr, arr.length - 1) : null);
  const sumN = arr => { const v = arr.filter(x => x != null && isFinite(x)); return v.length === arr.length && v.length ? sum(v) : null; };
  const avgN = arr => { const v = arr.filter(x => x != null && isFinite(x)); return v.length ? sum(v) / v.length : null; };
  const div = (a, b) => (a != null && b != null && isFinite(a) && isFinite(b) && b !== 0 ? a / b : null);

  function computeTTM(c) {
    const q = c.q, p = c.pl;
    const keys = ['sales', 'expenses', 'op', 'otherIncome', 'interest', 'depreciation', 'pbt', 'np'];
    const t = {};
    const useQ = q && q.sales && q.sales.length >= 4;
    keys.forEach(k => { t[k] = useQ ? sumN(q[k].slice(-4)) : lastOf(p[k]); if (t[k] == null) t[k] = lastOf(p[k]); });
    t.opm = div(t.op, t.sales) != null ? t.op / t.sales * 100 : null;
    t.tax = div(t.np, t.pbt) != null ? (1 - t.np / t.pbt) * 100 : null;
    t.eps = c.shares ? div(t.np, c.shares) : lastOf(p.eps);
    return t;
  }

  function computeMetrics(c, extra) {
    extra = extra || {};
    const quote = extra.quote || {};
    const R = c.pl, B = c.bs, cf = c.cf, ratios = c.ratios, quarters = c.q, sh = c.sh, ttm = c.ttm;
    const prices = c.prices, vol = c.volume, n = prices.length;
    const last = quote.price || prices[n - 1];
    const prev = quote.prevClose || prices[n - 2] || last;
    const yr = prices.slice(-252);
    const L = R.sales.length - 1;
    const nwLast = at(B.equity, L) != null && at(B.reserves, L) != null ? B.equity[L] + B.reserves[L] : null;
    const bookValue = quote.bookValue || div(nwLast, c.shares);
    const marketCap = quote.marketCap || (c.shares ? last * c.shares : null);
    const pe = quote.pe || (ttm.eps > 0 ? last / ttm.eps : null);
    const dps = quote.dividendRate != null ? quote.dividendRate : (at(R.eps, L) != null && at(R.payout, L) != null ? R.eps[L] * R.payout[L] / 100 : null);
    const qN = quarters.sales.length - 1;
    const ret = days => (n > days ? (last / prices[n - 1 - days] - 1) * 100 : null);
    const retCagr = years => { const d = 252 * years; return n > d ? (Math.pow(last / prices[n - 1 - d], 1 / years) - 1) * 100 : null; };
    const growth = (arr, yrs) => cagr(at(arr, L - yrs), at(arr, L), yrs);
    const q4 = k => (quarters[k].length >= 8 ? div(sumN(quarters[k].slice(-4)), sumN(quarters[k].slice(-8, -4))) : null);
    const avgLast = (arr, k) => (arr.length >= k ? avgN(arr.slice(-k)) : null);
    const pctVar = (a, b) => (a != null && b != null && b > 0 ? (a / b - 1) * 100 : null);

    const m = {
      price: last,
      change: last - prev,
      changePct: (last / prev - 1) * 100,
      marketCap,
      high52: quote.high52 || Math.max.apply(null, yr),
      low52: quote.low52 || Math.min.apply(null, yr),
      pe,
      bookValue,
      pb: div(last, bookValue),
      divYield: dps != null ? dps / last * 100 : null,
      dps,
      roce: lastOf(ratios.roce),
      roe: quote.roe != null ? quote.roe : lastOf(ratios.roe),
      faceValue: c.faceValue != null ? c.faceValue : null,
      sales: ttm.sales, np: ttm.np, op: ttm.op, opm: ttm.opm, eps: ttm.eps,
      de: div(at(B.borrowings, L), nwLast),
      debt: at(B.borrowings, L),
      promoter: lastOf(sh.promoters),
      fii: lastOf(sh.fiis),
      dii: lastOf(sh.diis),
      public: lastOf(sh.public),
      promoterChange3y: sh.promoters.length > 1 ? lastOf(sh.promoters) - sh.promoters[0] : null,
      shareholders: lastOf(sh.holders),
      pledged: extra.pledged != null ? extra.pledged : null,
      qtrSales: at(quarters.sales, qN),
      qtrProfit: at(quarters.np, qN),
      qtrOp: at(quarters.op, qN), qtrOpm: at(quarters.opm, qN), qtrEps: at(quarters.eps, qN),
      qtrSalesVar: pctVar(at(quarters.sales, qN), at(quarters.sales, qN - 4)),
      qtrProfitVar: pctVar(at(quarters.np, qN), at(quarters.np, qN - 4)),
      salesGrowth3: growth(R.sales, 3), salesGrowth5: growth(R.sales, 5), salesGrowth10: growth(R.sales, 10),
      profitGrowth3: growth(R.np, 3), profitGrowth5: growth(R.np, 5), profitGrowth10: growth(R.np, 10),
      salesGrowthTTM: q4('sales') != null ? (q4('sales') - 1) * 100 : null,
      profitGrowthTTM: q4('np') != null ? (q4('np') - 1) * 100 : null,
      avgRoe3: avgLast(ratios.roe, 3), avgRoe5: avgLast(ratios.roe, 5), avgRoe10: avgLast(ratios.roe, 10),
      avgRoce5: avgLast(ratios.roce, 5),
      ret1m: ret(21), ret3m: ret(63), ret6m: ret(126), ret1y: ret(252),
      ret3y: retCagr(3), ret5y: retCagr(5), ret10y: retCagr(10),
      interestCoverage: at(R.interest, L) > 0 && at(R.pbt, L) != null ? (R.pbt[L] + R.interest[L]) / R.interest[L] : (at(R.interest, L) === 0 ? 999 : null),
      fcf: at(cf.cfo, L) != null && at(cf.cfi, L) != null ? cf.cfo[L] + cf.cfi[L] : null,
      cfo: at(cf.cfo, L),
      debtorDays: lastOf(ratios.debtor),
      wcDays: lastOf(ratios.wc),
      volume: vol[n - 1],
      avgVolume: avgN(vol.slice(-21)),
      dma50: n >= 50 ? sum(prices.slice(-50)) / 50 : null,
      dma200: n >= 200 ? sum(prices.slice(-200)) / 200 : null,
      evEbitda: marketCap != null && ttm.op > 0 ? (marketCap + (at(B.borrowings, L) || 0) - (at(B.investments, L) || 0) * 0.3) / ttm.op : null,
      earningsYield: ttm.eps > 0 ? ttm.eps / last * 100 : 0,
      shares: c.shares,
      reserves: at(B.reserves, L),
      totalAssets: at(B.total, L)
    };
    m.peg = pe && m.profitGrowth5 > 0 ? pe / m.profitGrowth5 : null;
    m.priceToSales = div(marketCap, ttm.sales);
    return m;
  }

  /* ---------- live data (Yahoo Finance JSON produced by scripts/fetch_yahoo.py) ---------- */
  const live = {};
  let liveMeta = null;

  function buildLive(j) {
    const known = bySymbol[j.symbol] || {};
    const a = j.annual || { periods: [] }, qq = j.quarterly || { periods: [] }, qt = j.quote || {};
    const col = (src, k) => (src[k] || src.periods.map(() => null)).map(v => (v == null ? null : v));
    const shares = qt.shares || known.shares || null;
    const pl = {};
    ['sales', 'expenses', 'op', 'otherIncome', 'interest', 'depreciation', 'pbt', 'tax', 'np', 'eps'].forEach(k => { pl[k] = col(a, k); });
    const sharesOut = col(a, 'sharesOut');
    pl.opm = pl.op.map((v, i) => div(v, pl.sales[i]) != null ? v / pl.sales[i] * 100 : null);
    pl.payout = col(a, 'dividendsPaid').map((d, i) => (d != null && pl.np[i] > 0 ? Math.abs(d) / pl.np[i] * 100 : null));
    pl.eps = pl.eps.map((v, i) => (v != null ? v : div(pl.np[i], shares)));
    const q = {};
    ['sales', 'expenses', 'op', 'otherIncome', 'interest', 'depreciation', 'pbt', 'tax', 'np', 'eps'].forEach(k => { q[k] = col(qq, k); });
    q.opm = q.op.map((v, i) => div(v, q.sales[i]) != null ? v / q.sales[i] * 100 : null);
    q.eps = q.eps.map((v, i) => (v != null ? v : div(q.np[i], shares)));
    const bs = {};
    ['equity', 'reserves', 'borrowings', 'otherLiab', 'total', 'fixedAssets', 'cwip', 'investments', 'otherAssets'].forEach(k => { bs[k] = col(a, k); });
    const cf = { cfo: col(a, 'cfo'), cfi: col(a, 'cfi'), cff: col(a, 'cff'), net: col(a, 'net') };
    const days = (arr, i) => (arr[i] != null && pl.sales[i] ? arr[i] / pl.sales[i] * 365 : null);
    const rec = col(a, 'receivables'), inv = col(a, 'inventory'), pay = col(a, 'payables');
    const ratios = { debtor: [], inventory: [], payable: [], ccc: [], wc: [], roce: [], roe: [] };
    a.periods.forEach((_, i) => {
      const d = days(rec, i), iv = days(inv, i), p = days(pay, i);
      ratios.debtor.push(d); ratios.inventory.push(iv); ratios.payable.push(p);
      ratios.ccc.push(d != null && iv != null && p != null ? d + iv - p : null);
      ratios.wc.push(bs.otherAssets[i] != null && bs.otherLiab[i] != null && pl.sales[i] ? (bs.otherAssets[i] - bs.otherLiab[i]) / pl.sales[i] * 365 : null);
      const ceOf = k => (bs.equity[k] != null && bs.reserves[k] != null ? bs.equity[k] + bs.reserves[k] + (bs.borrowings[k] || 0) : null);
      const nwOf = k => (bs.equity[k] != null && bs.reserves[k] != null ? bs.equity[k] + bs.reserves[k] : null);
      const ce = i && ceOf(i - 1) != null && ceOf(i) != null ? (ceOf(i - 1) + ceOf(i)) / 2 : ceOf(i);
      const nw = i && nwOf(i - 1) != null && nwOf(i) != null ? (nwOf(i - 1) + nwOf(i)) / 2 : nwOf(i);
      ratios.roce.push(pl.pbt[i] != null && ce ? (pl.pbt[i] + (pl.interest[i] || 0)) / ce * 100 : null);
      ratios.roe.push(pl.np[i] != null && nw ? pl.np[i] / nw * 100 : null);
    });
    const ins = qt.insiders, inst = qt.institutions;
    const sh = {
      promoters: [ins != null ? ins : null], fiis: [inst != null ? inst : null], diis: [null], government: [null],
      public: [ins != null && inst != null ? Math.max(0, 100 - ins - inst) : null], holders: [null]
    };
    const px = j.prices || { dates: [], close: [], volume: [] };
    const out = {
      symbol: j.symbol, name: j.name || known.name || j.symbol,
      // with Yahoo data, prefer Yahoo's classification so every company uses the same sector names
      sector: j.sector || known.sector || 'Others', industry: j.industry || known.industry || '',
      website: (j.website || known.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
      bseCode: j.bse || known.bseCode || '', exchange: /\.BO$/i.test(j.yahoo || '') ? 'BSE' : 'NSE', yahoo: j.yahoo || '', isin: j.isin || '', faceValue: known.faceValue != null ? known.faceValue : null,
      psu: !!known.psu, promoter: ins || 0, shares, about: j.about || '',
      standalone: false, live: true, updated: j.updated,
      years: a.periods, quarters: qq.periods, shQuarters: ['Latest'],
      pl, bs, cf, ratios, q, sh, sharesOut,
      docs: { announcements: [], reports: [], ratings: [], concalls: [] },
      prices: px.close, volume: px.volume.map(v => v || 0), dates: px.dates.map(d => new Date(d + 'T00:00:00'))
    };
    out.ttm = computeTTM(out);
    out.metrics = computeMetrics(out, { quote: qt });
    out.metrics.sme = j.sme ? 1 : 0;
    out.sme = !!j.sme;
    const sm = (typeof summaries !== 'undefined' && summaries[j.symbol]) || {};
    out.listed = sm.listed || j.listed || ''; out.listPrice = sm.listPrice != null ? sm.listPrice : null; out.listPriceDate = sm.listPriceDate || '';
    if (window.Insights) out.metrics.riskScore = window.Insights.redFlags(out).score;
    out.lastQuarter = out.quarters[out.quarters.length - 1] || '';
    return out;
  }

  /*
   * Data modes, picked by init():
   *   summary: data/yahoo/metrics.json lists every company with precomputed metrics (built by
   *            scripts/build_index.mjs); a company's full file loads when its page opens.
   *   live:    data/yahoo/index.json only (small symbol lists): every company file loads at startup.
   *   sample:  no data files; generated sample data for the built-in list.
   */
  let mode = 'sample';
  const summaries = {};
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }

  async function init() {
    try {
      const idx = await getJSON('data/yahoo/metrics.json');
      liveMeta = { updated: idx.updated, liveOnly: idx.liveOnly !== false, source: idx.source };
      if (liveMeta.liveOnly) { base.length = 0; Object.keys(bySymbol).forEach(k => delete bySymbol[k]); }
      (idx.companies || []).forEach(e => {
        const c = {
          symbol: e.s, name: e.n || e.s, sector: e.sec || 'Others', industry: e.ind || '', bseCode: e.bse || '', exchange: e.ex || 'NSE', sme: !!(e.m && e.m.sme), isin: e.isin || '',
          live: true, summary: true, lastQuarter: e.q || '', updated: idx.updated, metrics: e.m || {},
          listed: e.lst || '', listPrice: e.lp != null ? e.lp : null, listPriceDate: e.lpd || ''
        };
        summaries[c.symbol] = c;
        if (!bySymbol[c.symbol]) base.push(c);
        bySymbol[c.symbol] = c;
      });
      mode = 'summary';
      return;
    } catch (e) { /* fall through */ }
    try {
      liveMeta = await getJSON('data/yahoo/index.json');
      const syms = liveMeta.symbols || [];
      const files = await Promise.all(syms.map(s => getJSON('data/yahoo/' + encodeURIComponent(s) + '.json').catch(() => null)));
      files.forEach(j => {
        if (!j || !j.prices || !j.prices.close || j.prices.close.length < 2) return;
        live[j.symbol] = j;
        if (!bySymbol[j.symbol]) {
          const meta = { symbol: j.symbol, name: j.name || j.symbol, sector: j.sector || 'Others', industry: j.industry || '', bseCode: j.bse || '' };
          base.push(meta);
          bySymbol[j.symbol] = meta;
        }
      });
      mode = 'live';
    } catch (e) { liveMeta = null; mode = 'sample'; }
  }

  function getAny(sym, standalone) {
    sym = String(sym || '').toUpperCase();
    if (cache[sym + ':live']) return cache[sym + ':live'];
    if (live[sym]) return (cache[sym + ':live'] = buildLive(live[sym]));
    if (summaries[sym]) return summaries[sym];
    if (liveMeta && liveMeta.liveOnly) return null;
    return getCompany(sym, standalone);
  }

  /** Full company data (statements, prices). Resolves null when the company is unknown. */
  async function loadCompany(sym, standalone) {
    sym = String(sym || '').toUpperCase();
    if (summaries[sym] && !cache[sym + ':live']) {
      const j = await getJSON('data/yahoo/' + encodeURIComponent(sym) + '.json');
      const full = buildLive(j);
      full.metrics.industryPE = summaries[sym].metrics.industryPE;
      cache[sym + ':live'] = full;
    }
    return getAny(sym, standalone);
  }

  /** Exchange filings for one company, or null when none have been fetched. */
  function loadFilings(sym) {
    if (mode === 'sample') return Promise.resolve(null);
    return getJSON('data/filings/' + encodeURIComponent(String(sym).toUpperCase()) + '.json').catch(() => null);
  }
  /** Upcoming board meetings (results calendar) built by scripts/build_index.mjs. */
  function loadCalendar() {
    if (mode === 'sample') return Promise.resolve(null);
    return getJSON('data/yahoo/calendar.json').catch(() => null);
  }
  function latestFilings() {
    if (mode === 'sample') return Promise.resolve(null);
    return getJSON('data/filings/latest.json').catch(() => null);
  }

  let _all = null;
  function listCompanies() {
    if (_all) return _all;
    _all = base.map(c => getAny(c.symbol)).filter(Boolean);
    // industry P/E: median of the industry when it has 5+ companies, else of the sector
    const groups = {};
    const add = (k, v) => { (groups[k] = groups[k] || []).push(v); };
    _all.forEach(c => { add('i:' + c.industry, c.metrics.pe); add('s:' + c.sector, c.metrics.pe); });
    _all.forEach(c => {
      const ind = groups['i:' + c.industry];
      c.metrics.industryPE = median(c.industry && ind && ind.length >= 5 ? ind : groups['s:' + c.sector]);
    });
    return _all;
  }

  function search(q, limit) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    base.forEach(c => {
      if (liveMeta && liveMeta.liveOnly && !live[c.symbol] && !summaries[c.symbol]) return;
      const s = c.symbol.toLowerCase(), n = c.name.toLowerCase();
      let score = -1;
      if (s === q) score = 100;
      else if (s.startsWith(q)) score = 80;
      else if (n.startsWith(q)) score = 70;
      else if (n.split(/\s+/).some(w => w.startsWith(q))) score = 50;
      else if (n.includes(q) || s.includes(q)) score = 30;
      else if (String(c.bseCode).startsWith(q)) score = 20;
      if (score >= 0) scored.push({ c, score });
    });
    scored.sort((a, b) => b.score - a.score || (b.c.metrics && b.c.metrics.marketCap || 0) - (a.c.metrics && a.c.metrics.marketCap || 0) || a.c.name.localeCompare(b.c.name));
    return scored.slice(0, limit || 8).map(x => x.c);
  }

  window.Data = {
    TODAY, YEARS, QUARTERS: QUARTERS.map(q => q.label), SH_QUARTERS,
    init, getCompany: getAny, loadCompany, loadFilings, loadCalendar, latestFilings, listCompanies, search, median, cagr,
    mode: () => mode,
    liveInfo: () => ({
      count: mode === 'summary' ? Object.keys(summaries).length : Object.keys(live).length,
      total: listCompanies().length, updated: liveMeta && liveMeta.updated
    }),
    sectors: () => {
      const m = {};
      listCompanies().forEach(c => { (m[c.sector] = m[c.sector] || []).push(c.symbol); });
      return m;
    },
    exists: sym => {
      sym = String(sym || '').toUpperCase();
      return !!live[sym] || !!summaries[sym] || (!!bySymbol[sym] && !(liveMeta && liveMeta.liveOnly));
    },
    // used by scripts/build_index.mjs to compute metrics with exactly the site's logic
    _buildLive: j => buildLive(j)
  };
})();
