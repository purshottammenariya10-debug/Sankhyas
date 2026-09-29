// Welcome email for new Sankhyas users: three first steps (watchlist, alerts, install the app).
//
// Called two ways, and each user gets it once (profiles.welcome_sent_at is claimed before sending):
//   - by the site right after a user signs in (Authorization: Bearer <that user's token>): just that user
//   - by the data update after every refresh (x-dispatch-secret header): everyone still waiting
// Only users with a confirmed email who joined in the last 3 days are sent it (pending_welcomes()).
// Without RESEND_API_KEY nothing is sent and nobody is marked, so they get it once the key is set.
//
// Secrets: RESEND_API_KEY, WELCOME_FROM (default: Sankhyas <hello@sankhyas.com>), SITE_URL, DISPATCH_SECRET.
// Deployed with verify_jwt off: the caller is identified from its token, or trusted by the secret.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const SITE = env('SITE_URL', 'https://sankhyas.com/').replace(/\/?$/, '/');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const trusted = !!env('DISPATCH_SECRET') && req.headers.get('x-dispatch-secret') === env('DISPATCH_SECRET');

  let only: string | null = null;
  if (!trusted) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!data?.user) return json({ error: 'sign in first' }, 401);
    only = data.user.id;
  }
  if (!env('RESEND_API_KEY')) return json({ skipped: 'RESEND_API_KEY not set; nobody marked, they will get it later' });

  const { data: pending, error } = await db.rpc('pending_welcomes', { uid: only });
  if (error) return json({ error: error.message }, 500);
  let sent = 0;
  for (const u of pending || []) {
    // claim first, so two callers at once cannot both send
    const { data: claimed } = await db.from('profiles').update({ welcome_sent_at: new Date().toISOString() }).eq('id', u.id).is('welcome_sent_at', null).select('id');
    if (!claimed?.length) continue;
    try {
      await send(u.email, u.name);
      sent++;
    } catch (e) {
      console.error('welcome email failed for', u.id, (e as Error).message);
      await db.from('profiles').update({ welcome_sent_at: null }).eq('id', u.id);   // try again next time
    }
  }
  return json({ pending: (pending || []).length, sent });
});

function step(n: number, title: string, text: string, href: string, button: string) {
  return `<tr><td style="padding:0 0 18px"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #e4e6ee;border-radius:10px">
    <tr><td style="padding:16px 18px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#6056ff;text-transform:uppercase">Step ${n}</div>
      <div style="font-size:16px;font-weight:700;color:#1c1d22;margin:4px 0 6px">${title}</div>
      <div style="font-size:14px;line-height:1.5;color:#4a4f5c;margin:0 0 12px">${text}</div>
      <a href="${href}" style="display:inline-block;background:#6056ff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:9px 16px;border-radius:8px">${button}</a>
    </td></tr></table></td></tr>`;
}

async function send(to: string, name: string) {
  const first = esc((name || '').split(/\s+/)[0] || 'there');
  const html = `<div style="background:#f5f6fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px">
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:20px;font-weight:800;color:#103d48">Sankhyas</div>
      <h1 style="font-size:22px;color:#1c1d22;margin:18px 0 8px">Welcome, ${first}!</h1>
      <p style="font-size:15px;line-height:1.55;color:#4a4f5c;margin:0 0 20px">Your account is ready. Three quick steps get you the most out of Sankhyas. Each takes under a minute.</p>
    </td></tr>
    <tr><td style="padding:0 28px"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">
      ${step(1, 'Add your stocks to a watchlist', 'Search any NSE or BSE company and tap Watchlist. You will see results verdicts, red flags and ratings for all of them in one place.', SITE + '#/watchlist', 'Open my watchlist')}
      ${step(2, 'Turn on alerts', 'Get told when a company you follow files results, gets a credit rating change, wins an order or shows a new red flag.', SITE + '#/alerts', 'Set up alerts')}
      ${step(3, 'Install the app on your phone', 'Open sankhyas.com on your phone. On Android tap More, then Install app. On iPhone tap Share, then Add to Home Screen.', SITE, 'Open Sankhyas')}
    </table></td></tr>
    <tr><td style="padding:4px 28px 26px">
      <p style="font-size:14px;line-height:1.55;color:#4a4f5c;margin:0 0 14px">Questions or ideas? Just reply to this email.</p>
      <p style="font-size:12px;line-height:1.5;color:#7a8090;margin:0">You are receiving this because you created a Sankhyas account. Sankhyas shares research from exchange filings and financial data; nothing here is investment advice.</p>
    </td></tr>
  </table></div>`;
  const text = `Welcome to Sankhyas, ${(name || '').split(/\s+/)[0] || 'there'}!\n\n` +
    `1. Add your stocks to a watchlist: ${SITE}#/watchlist\n2. Turn on alerts: ${SITE}#/alerts\n` +
    `3. Install the app: open sankhyas.com on your phone. Android: More > Install app. iPhone: Share > Add to Home Screen.\n\n` +
    `Questions? Just reply to this email.\nNothing on Sankhyas is investment advice.`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('WELCOME_FROM', 'Sankhyas <hello@sankhyas.com>'), to: [to], reply_to: env('REPLY_TO', 'connect@sankhyas.com'),
      subject: 'Welcome to Sankhyas: 3 things to do first', html, text }),
  });
  if (!r.ok) throw new Error('email ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
