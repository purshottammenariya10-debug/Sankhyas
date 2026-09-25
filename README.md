# Sankhyas

Stock analysis and screening website for Indian equities, modelled on Screener's layout and features.
It is a static single-page app: no build step and no backend.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

It can be deployed to any static host (GitHub Pages, Netlify, Vercel, S3). No API keys and no paid services are needed.

## AI features (free, built in)

Sankhyas AI runs entirely in the visitor's browser (`js/ai.js`). It is a rule-based engine, not a large language model. There's no API key, no server, no usage cost and no rate limit.

- **AI Analyst tab** on every company page: a full research report, plus answers on growth, profitability, balance sheet, cash flow, valuation (including P/E against its own history and industry), latest quarter, ownership, price trend, peers, and the bull/bear case. Questions are matched to these topics by keyword.
- **Plain-English screens:** "debt free companies with ROE above 20%", "large caps with low debt", "between 20 and 40 PE", "near 52 week low with high ROE" are all turned into screen queries you can review and edit.
- **Ask AI page** (`#/ai`): rankings ("top 5 cheapest IT stocks by P/E"), filters ("high ROCE with low debt"), sector overviews and sector comparisons across all covered companies.
- **AI comparison** on the Compare page: which company leads on growth, returns, margins, leverage, valuation and momentum.

Answers are written from templates and thresholds applied to the same data the page shows, so they can't invent numbers. They also can't handle open-ended questions outside those topics. They never give buy/sell recommendations.

## Data: Yahoo Finance

Browsers can't call Yahoo Finance directly because Yahoo blocks cross-origin requests.
So `scripts/fetch_yahoo.py` downloads the data server-side and saves it as static JSON in `data/yahoo/`.
The site loads that JSON on startup.

```bash
pip install yfinance
python scripts/fetch_yahoo.py              # every symbol in scripts/symbols.txt
python scripts/fetch_yahoo.py TCS INFY     # just these NSE symbols
python scripts/fetch_yahoo.py --live-only  # hide companies that have no Yahoo data
```

- **Automatic updates:** `.github/workflows/update-data.yml` runs the script every weekday at 5 pm IST and commits the new JSON. You can also run it by hand from the **Actions** tab. GitHub only runs scheduled workflows on the repository's default branch.
- **Adding companies:** add NSE symbols to `scripts/symbols.txt`, one per line. Symbols that aren't in the built-in list show up in search and screens automatically.
- **What Yahoo provides:** about 10 years of daily prices, the latest quote and valuation, about 4 years of annual P&L, balance sheet and cash flow, about 5 quarters of results, and the latest insider and institutional holding.
- **What Yahoo doesn't provide:** 10-year statement history, quarterly shareholding with a promoter/FII/DII split, pledges, filings and concalls. Those sections show what's available and link out to NSE.
- **Fallback:** if `data/yahoo/index.json` is missing, the site uses deterministic **sample** data, which is not real. Companies that failed to fetch also use sample figures, and the top banner says so.

## Structure

```
index.html          shell: navbar, footer, script tags
css/style.css       all styles, including light and dark themes
js/data.js          data layer (Yahoo JSON loader + sample data fallback)
scripts/            Yahoo Finance fetcher and symbol list
data/yahoo/         fetched JSON (created by the script / workflow)
js/screener.js      ratio catalogue, query compiler, preset screens
js/app.js           hash router, pages and UI components
js/ai.js            free built-in AI: analysis engine, plain-English parser, chat widget
js/vendor/          Chart.js 4.4.1 (MIT)
```
