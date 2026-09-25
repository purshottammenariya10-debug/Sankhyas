# Sankhyas

Stock analysis and screening website for Indian equities, modelled on Screener's layout and features.
It is a static single-page app: no build step and no backend.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

It can be deployed to any static host (GitHub Pages, Netlify, Vercel, S3).

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

## Data

`js/data.js` generates **sample** financials for 50 large Indian companies. The generation is deterministic, so the numbers are the same on every load. They are **not real reported figures**. To go live, replace `Data.getCompany()` and `Data.listCompanies()` with calls to a market-data API that return the same shape.

## Structure

```
index.html          shell: navbar, footer, script tags
css/style.css       all styles, including light and dark themes
js/data.js          data layer (sample data generator)
js/screener.js      ratio catalogue, query compiler, preset screens
js/app.js           hash router, pages and UI components
js/vendor/          Chart.js 4.4.1 (MIT)
```
