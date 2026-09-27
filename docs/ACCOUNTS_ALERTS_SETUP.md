# Accounts, sync and alerts: what is set up and what is left

The Supabase project **sankhyas** (`kbtbhzjotoxayrkivwzx`, Mumbai region) is live, and the site
uses it (`js/config.js`).

## Already done

- Database: `profiles`, `payments`, `user_data` (sync across devices), `alerts`, `alert_log` and
  `dispatch_state`. Row level security is on for every table, and each user can only see their own rows.
  The migrations are in `supabase/migrations`.
- Edge Functions: `create-order`, `verify-payment`, `razorpay-webhook`, `dispatch-alerts` and
  `telegram-webhook`.
- The deploy workflow calls `dispatch-alerts` after every data refresh (about every 2 hours).
- Pro stays free for everyone (`proFreeDuringBeta: true`) until Razorpay is connected.

## Left for you (dashboard settings no tool can change)

### 0. Point sankhyas.com at the site
Right now sankhyas.com resolves to Cloudflare, not GitHub Pages. In the DNS settings where the domain is managed (Cloudflare, it appears), make these changes:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | DNS only |
| A | `@` | `185.199.109.153` | DNS only |
| A | `@` | `185.199.110.153` | DNS only |
| A | `@` | `185.199.111.153` | DNS only |
| CNAME | `www` | `purshottammenariya10-debug.github.io` | DNS only |

- Delete any other A, AAAA or CNAME records for `@` and `www`.
- In Cloudflare, set the proxy to **DNS only** (grey cloud) so GitHub can issue the HTTPS certificate.

The next deploy notices the change and switches the site to https://sankhyas.com automatically. That run adds the `CNAME` file, and the old github.io address then redirects to the domain.

Then:
1. In GitHub, open **Settings → Pages** and tick **Enforce HTTPS** once it becomes available. The certificate takes up to about an hour.
2. In Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to `https://sankhyas.com/`.
   - Add `https://sankhyas.com/` and `https://www.sankhyas.com/` to **Redirect URLs**.
3. Set up Google Search Console:
   - Add the property `https://sankhyas.com`. Verify it with a DNS TXT record.
   - Submit `https://sankhyas.com/sitemap.xml`.

Keeping Cloudflare's proxy (orange cloud) also works, but then the DNS check can't see GitHub, so it can't switch the domain on by itself. In that case add the repository variable `CUSTOM_DOMAIN_FORCE` = `1`, and set SSL/TLS to **Full**.

### 1. Login redirects (required: email links and Google return here)
In Supabase, open **Authentication → URL Configuration**:
- **Site URL:** `https://purshottammenariya10-debug.github.io/Sankhyas/` (or your own domain later).
- **Redirect URLs:** add the same URL. Add `https://sankhyas.com/` too if you move to that domain.

### 2. Google login
1. In Google Cloud Console, go to **APIs & Services → Credentials** and create an **OAuth client ID** (type: Web application).
   - Authorised redirect URI: `https://kbtbhzjotoxayrkivwzx.supabase.co/auth/v1/callback`
2. In Supabase, open **Authentication → Sign In / Providers → Google**. Paste the client ID and secret, then Enable.

Other logins work the same way and appear on the login page automatically once enabled. Each uses the
same callback URL above:

| Provider | Where to create the app |
| --- | --- |
| **GitHub** | github.com → Settings → Developer settings → OAuth Apps |
| **Microsoft** (Azure) | portal.azure.com → App registrations |
| **Apple** | developer.apple.com → Sign in with Apple |
| **X / Twitter** | developer.x.com |

The **Email me a one-time login link** option works already.

For more than a few sign-ups an hour, set your own SMTP under **Authentication → Emails → SMTP
Settings**. The built-in mailer is rate limited. Resend (below) works as the SMTP provider.

### 3. Email alerts (Resend, free for 3,000 emails a month)
1. Sign up at resend.com and add and verify the domain `sankhyas.com`.
2. Create an API key.
3. In Supabase, open **Edge Functions → Secrets** and add:
   - `RESEND_API_KEY` = the key
   - `ALERTS_FROM` = `Sankhyas Alerts <alerts@sankhyas.com>`

### 4. Telegram alerts (free)
1. In Telegram, message **@BotFather** and send `/newbot`. Name it, for example `SankhyasAlertsBot`, and copy the token.
2. Add these Supabase secrets:
   - `TELEGRAM_BOT_TOKEN` = the token
   - `TELEGRAM_WEBHOOK_SECRET` = any long random string
3. Point the bot at Sankhyas. Open this link once in a browser, with your values filled in:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://kbtbhzjotoxayrkivwzx.supabase.co/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
4. Set `telegramBot: 'SankhyasAlertsBot'` in `js/config.js`, without the @. The **Connect** button then appears on the Alerts page.

### 5. WhatsApp alerts (Meta WhatsApp Cloud API, paid per message)
1. In Meta Business Suite, set up WhatsApp: add and verify a phone number, then get a permanent access token.
2. Create a **utility** message template named `sankhyas_alert` whose body is just `{{1}}`, and wait for approval.
3. Add these Supabase secrets:
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_ID`
   - `WHATSAPP_TEMPLATE` = `sankhyas_alert`
4. Set `whatsappAlerts: true` in `js/config.js`.

Users can already save their number and give consent on the Alerts page.

### 6. Optional: a dispatch secret
Without a secret, anyone can trigger `dispatch-alerts`, but it runs at most once every 5 minutes and
each alert is sent only once. To let the workflow skip that limit:
1. Add a random `DISPATCH_SECRET` both as a Supabase secret and as a GitHub Actions secret.

### 7. Razorpay
Follow `docs/PAYMENTS_SETUP.md` from step 2. The functions are already deployed, so only the
secrets and the key are needed. Then set `proFreeDuringBeta: false`.

## How alerts work
- Users create rules on `#/alerts`, for one company, their whole watchlist, a price level or a saved screen.
- After each data refresh, `dispatch-alerts` reads the site's public data:
  - `activity.json`: order wins, insider/SAST trades and bulk/block deals
  - `data/filings/latest.json`: results filings and concalls
  - `metrics.json`: prices, red-flag scores and screens
- Events from the last 3 days that happened after the rule was created are recorded once in
  `alert_log` and sent grouped, one message per user and channel.
- Price alerts switch themselves off after firing.
- Screen alerts report companies that newly match.
