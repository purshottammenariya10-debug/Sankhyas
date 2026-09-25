# Sankhyas

Stock analysis and screening website for Indian equities, modelled on Screener's layout and features.
It is a static single-page app: no build step and no backend.

## Run locally

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
# open http://localhost:8000
```

The Node server serves the site and the AI endpoint, and it keeps your API key on the server.
Without it, any static host works (`python3 -m http.server`, GitHub Pages, Netlify, S3). Everything except AI keeps working, and the AI panels explain how to turn AI on.

## AI features

Sankhyas AI uses Claude (`claude-opus-5`; override with `SANKHYAS_MODEL`).

- **AI Analyst tab** on every company page: a chat grounded in that company's financials, with one-click prompts for a full research report, latest-quarter explanation, valuation check, bull/bear case and balance-sheet health.
- **Plain-English screens:** describe a screen ("debt free companies with ROE above 20%") and AI writes the query. The query is checked before it runs, so you can review or edit it first.
- **Ask AI page** (`#/ai`): questions across every company covered, like sector comparisons, screening ideas and trends.
- **AI comparison** on the Compare page.

How it works:
- **Data sent with each question:** the browser sends a compact data snapshot of what's on screen. The server wraps it in a fixed system prompt (`server/server.mjs`) and streams Claude's answer back.
- **Grounding rules:** the prompt tells Claude to use only the numbers provided and to say when the figures are sample data. It also stops Claude giving buy/sell calls or price targets.
- **Server safeguards:** the server limits request size and conversation length and rate-limits each IP (`SANKHYAS_RATE_LIMIT`, default 40 per 10 minutes). It turns on Claude's server-side refusal fallback.
- **In a claude.ai artifact:** with no server, the site uses the artifact's built-in Claude access instead, and each viewer approves usage once.


## Features

- **Home**: company search with autocomplete (press `/` to focus it), quick links, top gainers and losers, largest companies, popular screens
- **Company page** with sticky section tabs: Summary · Chart · Analysis · Peers · Quarters · Profit & Loss · Balance Sheet · Cash Flow · Ratios · Investors · Documents
  - Top ratios box with **Edit ratios** (add any of 60+ ratios)
  - Consolidated / Standalone toggle
  - Price chart (1m to Max) with 50/200 DMA and volume, plus PE Ratio and Sales & Margin charts
  - Machine-generated pros and cons
  - Peer comparison with a median row
  - 13 quarters and 12 years of statements; expandable Expenses, Borrowings and Other Assets rows
  - Compounded sales and profit growth, stock CAGR and ROE boxes
  - Quarterly and yearly shareholding pattern
  - Announcements, annual reports, credit ratings and concalls
  - Export to Excel (CSV), Follow (watchlist), private notes
- **Screens**: popular screens plus a query builder (`Market Capitalization > 500 AND Price to earning < 15`) with a ratio picker, sortable and paginated results, a median row, editable columns, CSV export and saved screens
- **Feed**: latest results and announcements, personalised from your watchlist
- **Tools**: latest results, compare companies (table plus a rebased price chart), sectors explorer, watchlist
- Login and register (demo accounts stored in the browser), Premium page, dark mode, responsive layout

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
js/ai.js            AI client: transport, data context, chat widget, NL screens
server/server.mjs   static server + /api/ai endpoint (Anthropic SDK)
js/vendor/          Chart.js 4.4.1 (MIT)
```
