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

## Data: every Indian listed company + NSE/BSE filings

The GitHub Actions workflow `.github/workflows/deploy.yml` builds the data and deploys the site to GitHub Pages. It runs every weekday at 5 pm IST, and whenever you push to `main` or start it by hand.

1. **Company list** (`scripts/fetch_universe.py`): the NSE equity list plus BSE's active scrip list, matched by ISIN. NSE companies use `SYMBOL.NS` on Yahoo; BSE-only companies use `CODE.BO`, and their BSE code is the Sankhyas symbol.
2. **Yahoo Finance** (`scripts/fetch_yahoo.py --universe`): each run fully refreshes the 1,200 stalest companies (large caps first on the first pass). That covers 10 years of prices, quote and valuation, about 4 years of statements and about 5 quarters. Every other company gets the day's price in one bulk request. The ~2,600 NSE companies are fully covered within 3 runs and then refreshed about weekly.
3. **Filings** (`scripts/fetch_filings.py`): a daily sweep of all BSE announcements (plus NSE when it allows access). A backfill adds 3 years of announcements and all annual reports for 150 companies per run, largest first.
   - Filings are grouped into announcements, annual reports, credit ratings, and concalls: transcripts, investor presentations (PPT), recordings (REC) and call notices.
   - Links point to the PDFs on the exchanges' own sites.
4. **Index** (`scripts/build_index.mjs`): writes `data/yahoo/metrics.json`, one row per company with every screen metric, computed by the site's own code. The site loads only this file at startup. A company's full data and filings load when its page is opened.

The data is kept between runs in the Actions cache, not committed to git, so the repo stays small.

**One-time setup:** the workflow publishes to the `gh-pages` branch. In Settings → Pages, set Source to **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**. Then Actions → "Update data and deploy" → Run workflow.

**Running the data job from India (needed for NSE/BSE filings):** NSE and BSE block GitHub's own servers (403). To fetch filings, run the job on a machine with an Indian IP address:

1. Get a machine: a small Ubuntu 22.04/24.04 VM in a Mumbai or Hyderabad region (AWS Lightsail, DigitalOcean Bangalore, Azure Central India, and similar, roughly ₹400–800 a month), or WSL on a Windows PC that stays on.
2. Open Settings → Actions → Runners → **New self-hosted runner** and copy the token from the "Configure" step.
3. On the machine, run:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/purshottammenariya10-debug/Sankhyas/claude/sankyas-website-build-f3o5tw/scripts/setup-india-runner.sh
   bash setup-india-runner.sh <TOKEN>
   ```
   The script checks that NSE and BSE answer from that machine, then installs the runner as a service.
4. Open Settings → Secrets and variables → Actions → **Variables** and add `DATA_RUNNER` = `self-hosted`.

From then on, the daily job runs on that machine. Delete the variable to go back to GitHub's servers.

**Local run:**

```bash
pip install yfinance requests
python scripts/fetch_universe.py
python scripts/fetch_yahoo.py --universe --max-full 50   # or: python scripts/fetch_yahoo.py TCS INFY
python scripts/fetch_filings.py --max-backfill 20
node scripts/build_index.mjs
python3 -m http.server 8000
```

**Caveats:**
- The NSE, BSE and Yahoo endpoints are unofficial website APIs. They can change or throttle without notice.
- NSE often refuses requests from cloud servers, so filings may come from BSE only.
- Every step is best-effort: a failure keeps the previous data.
- Yahoo's terms allow personal use only. A commercial site should license data from an authorised vendor.
- Without any data files, the site falls back to deterministic **sample** data for 50 companies, and the top banner says so.

## Structure

```
index.html          shell: navbar, footer, script tags
css/style.css       all styles, including light and dark themes
js/data.js          data layer (Yahoo JSON loader + sample data fallback)
scripts/            company list, Yahoo and NSE/BSE filings fetchers, index builder
data/               fetched data (created by the workflow; not in git)
js/screener.js      ratio catalogue, query compiler, preset screens
js/app.js           hash router, pages and UI components
js/ai.js            free built-in AI: analysis engine, plain-English parser, chat widget
js/vendor/          Chart.js 4.4.1 (MIT)
```
