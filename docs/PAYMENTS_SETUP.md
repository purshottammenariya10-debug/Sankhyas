# Switching on login and Razorpay payments for Sankhyas Pro

Sankhyas runs on GitHub Pages, which can only serve files. Real accounts and payments need a small
backend, so Sankhyas uses **Supabase** (free tier) for:

- Accounts: email and password, Google login, password reset.
- The database: each user's plan and their payment history.
- Three small server functions in `supabase/functions`. They create Razorpay orders, verify
  payments and receive Razorpay webhooks, so the Razorpay **secret key never reaches the browser**.

Until you finish these steps the site keeps working as before: logins stay in the visitor's
browser and every Pro feature is free.

Allow about an hour, plus Razorpay's KYC review (usually 1–3 working days).

---

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> and click **New project**.
   - Region: **Mumbai (ap-south-1)**.
   - Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of
   `supabase/migrations/20260926000000_accounts_and_payments.sql` and click **Run**.
   This creates:
   - the `profiles` and `payments` tables, with row-level security;
   - the sign-up trigger;
   - the `activate_pro` function.
3. Open **Authentication → URL Configuration**:
   - **Site URL**: `https://purshottammenariya10-debug.github.io/Sankhyas/` (or your own domain)
   - **Redirect URLs**: add the same URL.
4. Open **Authentication → Sign In / Providers**:
   - **Email**: keep it on. "Confirm email" is recommended.
   - **Google** (optional, recommended):
     1. In Google Cloud Console, create an OAuth client of type *Web application*.
     2. Set its authorised redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
     3. Paste the client ID and client secret into Supabase.
5. Open **Project Settings → API** and copy:
   - the **Project URL**;
   - the **anon public** key.

## 2. Set up Razorpay

1. Sign up at <https://razorpay.com> and complete the KYC: PAN, bank account and business
   details. Razorpay reviews the website, which already has the pages it asks for:
   - Pricing: `#/premium`
   - Contact: `#/contact`
   - Terms: `#/terms`
   - Privacy: `#/privacy`
   - Refund & cancellation: `#/refunds`

   Fill in your business details (step 4) first so those pages show them.
2. Start in **Test mode**: **Account & Settings → API Keys → Generate key**. You get a
   `rzp_test_...` key ID and a key secret.
3. Add a webhook in **Account & Settings → Webhooks → Add new webhook**:
   - **URL**: `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   - **Secret**: any long random string. Keep it; it is needed in step 3.
   - **Events**: `payment.captured` and `order.paid`.

## 3. Deploy the payment functions

Install the Supabase CLI (<https://supabase.com/docs/guides/cli>). Then run from the repository
folder:

```bash
supabase login
supabase link --project-ref <project-ref>

supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=xxx

supabase functions deploy create-order
supabase functions deploy verify-payment
supabase functions deploy razorpay-webhook --no-verify-jwt
```

Supabase adds `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the
functions automatically.

Prices are set on the server in `supabase/functions/_shared/razorpay.ts`:
- ₹299 for 1 month
- ₹2,499 for 1 year

## 4. Connect the website

In GitHub, open **Settings → Secrets and variables → Actions → Variables** and add these
repository variables. They are public values, so variables are fine; don't use secrets.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from step 1 |
| `SUPABASE_ANON_KEY` | the anon public key from step 1 |
| `RAZORPAY_KEY_ID` | `rzp_test_...` (later `rzp_live_...`) |
| `BUSINESS_NAME` | your registered business name |
| `BUSINESS_EMAIL` | your support email (default connect@sankhyas.com) |
| `BUSINESS_INSTAGRAM` | Instagram handle (default sankhyas.co) |
| `BUSINESS_PHONE` | your support phone (optional) |
| `BUSINESS_ADDRESS` | your business address |
| `PRO_FREE_DURING_BETA` | optional: `true` keeps Pro free for everyone while accounts work |

Then run the **Update data and deploy** workflow (**Actions → Run workflow**). Its log shows
"Accounts and payments: on".

If you are not using the workflow, put the same values in `js/config.js`.

## 5. Test, then go live

1. On the site, create an account and open **Sankhyas Pro**, then **Buy 1 month**.
2. Pay with a Razorpay test method:
   - UPI ID `success@razorpay`, or
   - test card `4111 1111 1111 1111`, any future expiry, any CVV.
3. You should see "Welcome to Sankhyas Pro". **My account** then shows Pro and the payment.
   Company pages show the full Sankhyas Insights.
4. When Razorpay activates your account, switch to live mode:
   1. Generate **live** keys.
   2. Run `supabase secrets set ...` again with the live key ID and secret.
   3. Add the webhook again in live mode.
   4. Change the `RAZORPAY_KEY_ID` variable to `rzp_live_...` and run the workflow.

## Good to know

- **Refunds**: issue them from the Razorpay dashboard. To end Pro early, set that user's
  `pro_until` in Supabase **Table Editor → profiles**.
- **GST**: registration is needed once turnover passes ₹20 lakh a year. Razorpay can send invoices.
- **No auto-renewal**: Pro is a one-time purchase of 1 month or 1 year, and buying again extends
  it. Recurring subscriptions (Razorpay Subscriptions, UPI Autopay) can be added later.
- **Free vs Pro**: Pro unlocks the full red-flag scan, the guidance tracker, What changed, and
  Sankhyas AI's answers on them. The red-flag *score* stays free as a teaser.
- **Browser-only data**: watchlists, saved screens and notes are still stored in the browser, not
  in the account.
