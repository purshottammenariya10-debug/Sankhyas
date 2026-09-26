/*
 * Query engine for stock screens.
 * Queries look like:  Market Capitalization > 500 AND Price to earning < 15
 */
(function () {
  'use strict';

  // name, key, unit, short label (for table columns), description
  const RATIOS = [
    ['Current price', 'price', 'Rs.', 'CMP Rs.', 'Current market price'],
    ['Market Capitalization', 'marketCap', 'Rs.Cr.', 'Mar Cap Rs.Cr.', 'Current price x number of shares'],
    ['Price to Earning', 'pe', '', 'P/E', 'Current price / TTM earnings per share'],
    ['Industry PE', 'industryPE', '', 'Ind PE', 'Median P/E of the sector'],
    ['Dividend yield', 'divYield', '%', 'Div Yld %', 'Dividend per share / current price'],
    ['Price to book value', 'pb', '', 'CMP / BV', 'Current price / book value per share'],
    ['Book value', 'bookValue', 'Rs.', 'BV Rs.', 'Net worth / number of shares'],
    ['Face value', 'faceValue', 'Rs.', 'FV Rs.', 'Face value per share'],
    ['Return on capital employed', 'roce', '%', 'ROCE %', 'EBIT / capital employed for the last year'],
    ['Return on equity', 'roe', '%', 'ROE %', 'Net profit / average net worth for the last year'],
    ['Average return on equity 3Years', 'avgRoe3', '%', 'ROE 3Yr %', ''],
    ['Average return on equity 5Years', 'avgRoe5', '%', 'ROE 5Yr %', ''],
    ['Average return on equity 10Years', 'avgRoe10', '%', 'ROE 10Yr %', ''],
    ['Average return on capital employed 5Years', 'avgRoce5', '%', 'ROCE 5Yr %', ''],
    ['Debt to equity', 'de', '', 'Debt / Eq', 'Borrowings / net worth'],
    ['Debt', 'debt', 'Rs.Cr.', 'Debt Rs.Cr.', 'Total borrowings'],
    ['Interest Coverage Ratio', 'interestCoverage', '', 'Int Coverage', 'EBIT / interest'],
    ['Sales', 'sales', 'Rs.Cr.', 'Sales Rs.Cr.', 'Trailing twelve months sales'],
    ['Net profit', 'np', 'Rs.Cr.', 'NP 12M Rs.Cr.', 'Trailing twelve months net profit'],
    ['Operating profit', 'op', 'Rs.Cr.', 'OP 12M Rs.Cr.', 'Trailing twelve months operating profit'],
    ['OPM', 'opm', '%', 'OPM %', 'Operating profit margin (TTM)'],
    ['EPS', 'eps', 'Rs.', 'EPS 12M Rs.', 'Trailing twelve months EPS'],
    ['Sales latest quarter', 'qtrSales', 'Rs.Cr.', 'Sales Qtr Rs.Cr.', ''],
    ['Net Profit latest quarter', 'qtrProfit', 'Rs.Cr.', 'NP Qtr Rs.Cr.', ''],
    ['YOY Quarterly sales growth', 'qtrSalesVar', '%', 'Qtr Sales Var %', ''],
    ['YOY Quarterly profit growth', 'qtrProfitVar', '%', 'Qtr Profit Var %', ''],
    ['Sales growth 3Years', 'salesGrowth3', '%', 'Sales Var 3Yrs %', ''],
    ['Sales growth 5Years', 'salesGrowth5', '%', 'Sales Var 5Yrs %', ''],
    ['Sales growth 10Years', 'salesGrowth10', '%', 'Sales Var 10Yrs %', ''],
    ['Profit growth 3Years', 'profitGrowth3', '%', 'Profit Var 3Yrs %', ''],
    ['Profit growth 5Years', 'profitGrowth5', '%', 'Profit Var 5Yrs %', ''],
    ['Profit growth 10Years', 'profitGrowth10', '%', 'Profit Var 10Yrs %', ''],
    ['PEG Ratio', 'peg', '', 'PEG', 'P/E / 5 year profit growth'],
    ['EVEBITDA', 'evEbitda', '', 'EV / EBITDA', 'Enterprise value / EBITDA'],
    ['Earnings yield', 'earningsYield', '%', 'Earnings Yield %', 'EPS / price'],
    ['Price to Sales', 'priceToSales', '', 'Mcap / Sales', ''],
    ['Promoter holding', 'promoter', '%', 'Prom. Hold. %', ''],
    ['Change in promoter holding 3Years', 'promoterChange3y', '%', 'Chg in Prom Hold 3Yr %', ''],
    ['FII holding', 'fii', '%', 'FII Hold %', ''],
    ['DII holding', 'dii', '%', 'DII Hold %', ''],
    ['Public holding', 'public', '%', 'Public Hold %', ''],
    ['Pledged percentage', 'pledged', '%', 'Pledged %', ''],
    ['Number of Shareholders', 'shareholders', '', 'No. Eq. Shareholders', ''],
    ['Free cash flow last year', 'fcf', 'Rs.Cr.', 'Free Cash Flow Rs.Cr.', 'CFO - capex'],
    ['Cash from operations last year', 'cfo', 'Rs.Cr.', 'CF Opr Rs.Cr.', ''],
    ['Debtor days', 'debtorDays', '', 'Debtor Days', ''],
    ['Working Capital Days', 'wcDays', '', 'WC Days', ''],
    ['Return over 1month', 'ret1m', '%', '1mth return %', ''],
    ['Return over 3months', 'ret3m', '%', '3mth return %', ''],
    ['Return over 6months', 'ret6m', '%', '6mth return %', ''],
    ['Return over 1year', 'ret1y', '%', '1Yr return %', ''],
    ['Return over 3years', 'ret3y', '%', '3Yrs return %', ''],
    ['Return over 5years', 'ret5y', '%', '5Yrs return %', ''],
    ['DMA 50', 'dma50', 'Rs.', '50 DMA Rs.', '50 day moving average'],
    ['DMA 200', 'dma200', 'Rs.', '200 DMA Rs.', '200 day moving average'],
    ['High price', 'high52', 'Rs.', '52w High Rs.', '52 week high'],
    ['Low price', 'low52', 'Rs.', '52w Low Rs.', '52 week low'],
    ['Volume', 'volume', '', 'Volume', 'Latest day volume'],
    ['Number of equity shares', 'shares', 'Cr.', 'No. Eq. Shares Cr.', ''],
    ['SME listed', 'sme', '', 'SME', '1 if listed on the NSE Emerge SME platform, else 0'],
    ['Red flag score', 'riskScore', '', 'Red flags', 'Sankhyas forensic score 0-100 from the financials and exchange filings (higher = more warning signs)'],
    ['Guidance delivery', 'guidanceScore', '%', 'Guidance %', 'Share of concall guidance that management delivered']
  ].map(r => ({ name: r[0], key: r[1], unit: r[2], label: r[3], desc: r[4] }));

  const BY_KEY = {};
  RATIOS.forEach(r => { BY_KEY[r.key] = r; });

  const ALIASES = {
    'price to earnings': 'pe', 'pe': 'pe', 'p/e': 'pe', 'market cap': 'marketCap', 'mcap': 'marketCap',
    'roce': 'roce', 'roe': 'roe', 'cmp': 'price', 'price': 'price', 'pb': 'pb', 'eps': 'eps',
    'debt to equity ratio': 'de', 'dividend yield': 'divYield', 'opm %': 'opm'
  };

  const NAME_MAP = {};
  RATIOS.forEach(r => { NAME_MAP[r.name.toLowerCase()] = r.key; });
  Object.keys(ALIASES).forEach(a => { if (!NAME_MAP[a]) NAME_MAP[a] = ALIASES[a]; });
  const NAMES = Object.keys(NAME_MAP).sort((a, b) => b.length - a.length);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const NAME_RE = new RegExp('(^|[^a-z0-9])(' + NAMES.map(esc).join('|') + ')(?![a-z0-9])', 'gi');

  function compile(query) {
    const src = String(query || '').trim();
    if (!src) throw new Error('Query is empty. Try something like: Market Capitalization > 500 AND Price to earning < 20');
    const used = [];
    let expr = src.replace(/\r?\n/g, ' ');
    expr = expr.replace(NAME_RE, (m, pre, name) => {
      const key = NAME_MAP[name.toLowerCase()];
      if (used.indexOf(key) < 0) used.push(key);
      return pre + ' m.' + key + ' ';
    });
    expr = expr.replace(/\bAND\b/gi, ' && ').replace(/\bOR\b/gi, ' || ').replace(/\bNOT\b/gi, ' ! ');
    expr = expr.replace(/([^<>!=])=(?!=)/g, '$1==');
    expr = expr.replace(/<>/g, '!=');
    const stripped = expr.replace(/m\.[A-Za-z0-9]+/g, '');
    const bad = stripped.match(/[A-Za-z_][A-Za-z0-9_ ]*/);
    if (bad) throw new Error('Unknown ratio: "' + bad[0].trim() + '". Pick a ratio from the list on the right.');
    if (!/^[\s\d.<>=!&|()+\-*\/%]*$/.test(stripped)) throw new Error('Query contains unsupported characters.');
    if (!used.length) throw new Error('Query must use at least one ratio.');
    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function('m', '"use strict"; return (' + expr + ');');
    } catch (e) {
      throw new Error('Could not understand the query. Check brackets and operators near: ' + src.slice(0, 60));
    }
    return { fn, used };
  }

  function run(query, companies) {
    const { fn, used } = compile(query);
    const results = companies.filter(c => {
      const m = c.metrics;
      try {
        for (const k of used) if (m[k] == null || !isFinite(m[k])) return false;
        return !!fn(m);
      } catch (e) { return false; }
    });
    return { results, used };
  }

  const PRESETS = [
    { slug: 'the-bull-cartel', name: 'The Bull Cartel', desc: 'Stocks with consistent returns over the past years with low debt.', query: 'Return over 3years > 15 AND Debt to equity < 0.5 AND Market Capitalization > 10000' },
    { slug: 'magic-formula', name: 'Magic Formula', desc: 'Stocks with high return on capital and high earnings yield, inspired by Joel Greenblatt.', query: 'Return on capital employed > 20 AND Earnings yield > 3 AND Market Capitalization > 5000' },
    { slug: 'coffee-can-portfolio', name: 'Coffee Can Portfolio', desc: 'Companies with 10% revenue growth and 15% ROCE over long periods.', query: 'Sales growth 10Years > 10 AND Average return on capital employed 5Years > 15 AND Market Capitalization > 5000' },
    { slug: 'bluest-of-the-blue-chips', name: 'Bluest of the Blue Chips', desc: 'Large, profitable companies with low leverage.', query: 'Market Capitalization > 200000 AND Return on equity > 15 AND Debt to equity < 1' },
    { slug: 'growth-stocks', name: 'Growth Stocks', desc: 'Companies growing profits and sales rapidly.', query: 'Sales growth 5Years > 12 AND Profit growth 5Years > 12 AND OPM > 10' },
    { slug: 'low-pe-high-roe', name: 'Low P/E, High ROE', desc: 'Value stocks with good return ratios.', query: 'Price to Earning < 25 AND Return on equity > 18' },
    { slug: 'debt-free-companies', name: 'Debt Free Companies', desc: 'Companies with no debt and healthy profitability.', query: 'Debt to equity < 0.05 AND Return on capital employed > 15' },
    { slug: 'high-dividend-yield', name: 'High Dividend Yield', desc: 'Companies paying good dividends consistently.', query: 'Dividend yield > 2 AND Market Capitalization > 1000' },
    { slug: 'quarterly-growers', name: 'Quarterly Growers', desc: 'Strong YoY growth in latest quarter results.', query: 'YOY Quarterly sales growth > 10 AND YOY Quarterly profit growth > 10' },
    { slug: 'undervalued-growth', name: 'Undervalued Growth (PEG < 1.5)', desc: 'Stocks with PEG ratio below 1.5.', query: 'PEG Ratio < 1.5 AND PEG Ratio > 0 AND Profit growth 5Years > 10' },
    { slug: 'high-promoter-holding', name: 'High Promoter Holding', desc: 'Companies where promoters hold more than 60%.', query: 'Promoter holding > 60 AND Pledged percentage < 1' },
    { slug: 'near-52-week-low', name: 'Near 52 Week Low', desc: 'Quality stocks trading close to their 52 week low.', query: 'Current price < Low price * 1.2 AND Return on equity > 12' },
    { slug: 'golden-crossover', name: 'Golden Crossover', desc: 'Stocks where 50 DMA is above 200 DMA.', query: 'DMA 50 > DMA 200 AND Current price > DMA 50' },
    { slug: 'clean-compounders', name: 'Clean Compounders', desc: 'Growing, high-return companies with few forensic red flags.', query: 'Red flag score < 15 AND Return on capital employed > 18 AND Sales growth 5Years > 12' },
    { slug: 'sme-stocks', name: 'SME Stocks', desc: 'Profitable, growing companies listed on the NSE Emerge SME platform.', query: 'SME listed = 1 AND Return on capital employed > 15 AND Sales growth 3Years > 15' },
    { slug: 'psu-stocks', name: 'Cash Rich Companies', desc: 'Companies generating strong free cash flow.', query: 'Free cash flow last year > 2000 AND Debt to equity < 0.3' }
  ];

  window.Screener = { RATIOS, BY_KEY, compile, run, PRESETS };
})();
