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

- **Concall links for every company:** the Concalls panel has one row per results quarter (for example Jul 2026 · Q1 FY27) for the last 8 quarters.
  - Documents filed on the exchange link to the filing. For XBRL filings, the pipeline follows the XML to the actual PDF. **REC** opens the actual recording link, read out of the company's recording notice.
  - Documents not in Sankhyas yet show as dashed buttons that search the web for that company's transcript, presentation or recording for that exact quarter.
  - The workflow sweeps NSE's filing feeds **every 2 hours, every day**, so new transcripts, presentations and recordings are captured and summarised within hours of filing.
  - Older history needs the NSE/BSE history APIs, which refuse GitHub's servers. Use the self-hosted India runner for a full backfill.
- **Documents panel (like Screener):** four panels: **Announcements** (Recent / Important / Search / All ↗), **Annual reports**, **Credit ratings** (with the agency) and **Concalls**. Concalls have one row per month with **Transcript · AI Summary · PPT · REC**, and a greyed pill when a document isn't filed. Every item opens the filing on NSE/BSE. Without fetched filings, each item opens the company's NSE/BSE filing pages instead. **Add Missing** lets a visitor add a link to a concall document, saved in their browser.
- **IPO & new listings** (`#/ipo`): every mainboard and SME company listed on NSE in the last 3 months to 3 years. For each it shows the listing date (from NSE's equity and SME lists), the first-day close, the price now and the return since listing, plus median return, the share trading above first close, and the best and worst. It links to the exchanges' upcoming-issue pages.
- **Results calendar** (`#/calendar`): upcoming board meetings for results, dividends and fund raising. `build_index.mjs` parses these from exchange intimations into `data/yahoo/calendar.json`, dropping meetings that were later cancelled. There is a watchlist filter and one-click "+ Google Calendar".
- **Theme tracker** (`#/themes`, `js/themes.js`): Defence, Railways, EV, PSU Banks, Renewables, Electronics Manufacturing, Capital Markets, Infrastructure, Hospitals, Travel & Hospitality, Specialty Chemicals and New-age Digital. Each theme page shows its companies, total market cap, median P/E, ROCE and 1-year return, and the leaders and laggards.
- **Social post studio** (`#/studio`, `js/cards.js`): Instagram, X and WhatsApp images drawn in the browser, as a 1080×1080 post or a 1080×1920 story, with a ready caption and hashtags. Templates: results card, company snapshot, red-flag scan, new-listing performance and theme leaderboard. A "Share card" button is also on company pages, the latest-results table, the IPO hub and theme pages. Images can be downloaded, the caption copied, or both shared to phone apps.
- **Accounts and Sankhyas Pro payments** (`js/account.js`, `supabase/`): these use Supabase Auth (email and password, Google, password reset) and Razorpay Checkout for Pro, at ₹299 for 1 month or ₹2,499 for 1 year as one-time payments. Supabase Edge Functions create the orders and verify every payment by signature, and a Razorpay webhook activates Pro even if the buyer closes the tab. The database lets users read only their own plan and payments, and never change them. The site also has **My account**, **Contact**, **Terms**, **Privacy** and **Refund** pages, which Razorpay requires. To switch it on, follow **[docs/PAYMENTS_SETUP.md](docs/PAYMENTS_SETUP.md)**. Until then, logins stay in the browser and Pro is free for everyone.
- **Sankhyas Insights (Pro, free during beta)**, on every company page and in Sankhyas AI (`js/insights.js`):
  - **Red-flag scan**: a 0–100 forensic score. It checks cash conversion, negative free cash flow, rising debtor and inventory days, debt outrunning sales, interest cover, dependence on other income, low tax, dilution, losses and falling sales. It also reads the last 2 years of exchange filings for auditor resignations, defaults, pledge creation or invocation, rating downgrades, regulatory action and top-management exits. Screenable as `Red flag score`.
  - **Guidance tracker**: numeric targets management gives on concalls (revenue and profit growth, margins, volumes, capex, order inflow, with the fiscal year) are extracted by `summarize_concalls.py`. They are scored against reported results: Delivered, Beat, Nearly, Missed, or Pending with the current run-rate. Also shown: whether guidance was raised or lowered call to call. Screenable as `Guidance delivery`.
  - **What changed**: the latest quarter vs the previous quarter and a year ago, the concall tone vs the previous call, guidance raised, lowered or dropped, newly mentioned risks, and important filings since the last call.
  - Try the **Clean Compounders** preset (`Red flag score < 15 AND ROCE > 18 AND Sales growth 5Years > 12`).
- **Free AI summaries of concalls, PPTs and annual reports:** the data update (`scripts/summarize_concalls.py`) downloads each earnings-call transcript, investor presentation and the latest annual report as a PDF. It keeps the most informative lines, grouped into key numbers, guidance & outlook, growth & demand, margins & costs, capex, balance sheet and risks, and it rates the tone. **AI Summary** opens them: a concall row shows the transcript and presentation summaries together. The AI Analyst also answers "summarise the latest concall".

- **Ask Claude (free):** every AI panel has an **✳ Ask Claude (free) ↗** button. It opens [claude.ai](https://claude.ai) with the question and the page's Sankhyas data already filled in, so visitors can ask anything using their own free Claude account. Sankhyas needs no API key and pays nothing.
- **Sankhyas AI on-device (own AI, free and private):** pick **Sankhyas AI on-device · Lite (~1 GB)** or **· Pro (~2 GB)** in any AI panel's engine menu. An open-source model (Qwen2.5 1.5B / 3B, via [WebLLM](https://webllm.mlc.ai)) runs on the visitor's own GPU inside the browser, with the page's Sankhyas data as context. No AI service or API key is involved and questions never leave the browser. The model downloads once after the visitor confirms, is cached by the browser, and runs in a Web Worker. It needs WebGPU (recent Chrome/Edge on desktop or a newer Android phone). The option is hidden where WebGPU isn't available.
- **Free Claude in the page (public site):** pick **Free Claude (ask anything)** in any AI panel's engine menu to get answers right in the page, with the page's Sankhyas data as context. It runs through [Puter.js](https://puter.com): no API key, and Sankhyas pays nothing. Each visitor signs in to a free Puter account once, and Puter's free allowance applies. The Puter script loads only when a visitor picks this engine. Their question and the page's data then go to Puter.
- **Claude in the page (claude.ai preview):** when Sankhyas is opened as a claude.ai artifact, the AI panels also offer a **Claude (ask anything)** engine that answers in the page on the viewer's own Claude account. The built-in engine stays the default everywhere.

Answers are written from templates and thresholds applied to the same data the page shows, so they can't invent numbers. They also can't handle open-ended questions outside those topics. They never give buy/sell recommendations.

## Data: every Indian listed company + NSE/BSE filings

The GitHub Actions workflow `.github/workflows/deploy.yml` builds the data and deploys the site to GitHub Pages. It runs every weekday at 5 pm IST, and whenever you push to `main` or start it by hand.

1. **Company list** (`scripts/fetch_universe.py`): the NSE equity list plus BSE's active scrip list, matched by ISIN, plus NSE Emerge **SME** companies (`SME_EQUITY_L.csv`, flagged with an **SME** badge, the `SME listed` screen ratio and the **SME Stocks** preset), plus **every Indian company on Yahoo Finance's screener** (NSE and BSE, including BSE SME). The Yahoo screener adds the BSE-only companies when BSE blocks our server. NSE companies use `SYMBOL.NS` on Yahoo. BSE-only companies use their `.BO` ticker, and their BSE code or ticker is the Sankhyas symbol. BSE-only company pages link to BSE rather than NSE.
2. **Yahoo Finance** (`scripts/fetch_yahoo.py --universe`): each run fully refreshes the 1,200 stalest companies (large caps first on the first pass). That covers 10 years of prices, quote and valuation, about 4 years of statements and about 5 quarters. Every other company gets the day's price in one bulk request. All NSE and BSE companies (about 5,000+) are fully covered within a few runs and then refreshed regularly.
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
