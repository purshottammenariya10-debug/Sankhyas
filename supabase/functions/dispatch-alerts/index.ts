// Sends Sankhyas alerts. Called after every data refresh (the deploy workflow POSTs here).
// Reads the public site data (activity, latest filings, metrics), works out which alert rules have
// a new event, records each event once in public.alert_log and delivers it by email (Resend),
// Telegram (bot), WhatsApp (Meta Cloud API template) and phone / browser notifications (Web Push,
// to every device the user turned them on for). Channels without credentials are skipped.
//
// Secrets: SITE_URL (default: the GitHub Pages site), RESEND_API_KEY, ALERTS_FROM,
// TELEGRAM_BOT_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE, DISPATCH_SECRET.
// Deployed with verify_jwt off: runs are rate limited (one per 5 minutes) unless the caller sends
// the x-dispatch-secret header, and every event is sent at most once.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { evaluateScreen, loadScreener } from './screener.ts';
import { sendPush, vapidKeys, type Keys } from '../_shared/webpush.ts';

type Rule = { id: number; user_id: string; kind: string; symbol: string | null; params: Record<string, any>; channels: string[]; created_at: string };
type Ev = { key: string; text: string; sym: string };

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const SITE = env('SITE_URL', 'https://purshottammenariya10-debug.github.io/Sankhyas/').replace(/\/?$/, '/');
const cr = (v: number) => '₹ ' + (v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2)) + ' Cr';

async function getJSON(path: string) {
  const r = await fetch(SITE + path + '?t=' + Date.now());
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const trusted = !!env('DISPATCH_SECRET') && req.headers.get('x-dispatch-secret') === env('DISPATCH_SECRET');

  // ---- rate limit and state ----
  const { data: stRows } = await db.from('dispatch_state').select('key, value');
  const state: Record<string, any> = {};
  (stRows || []).forEach((r: any) => (state[r.key] = r.value));
  const last = state.last_run ? Date.parse(state.last_run.at) : 0;
  if (!trusted && Date.now() - last < 5 * 60e3) return json({ skipped: 'ran less than 5 minutes ago' });
  await db.from('dispatch_state').upsert({ key: 'last_run', value: { at: new Date().toISOString() }, updated_at: new Date().toISOString() });

  // data health (scripts/health_check.py): tell the site's admins once when an update looks broken
  let health = 'ok';
  try {
    const h = await getJSON('data/yahoo/health.json');
    health = h.status;
    if (h.status === 'alert' && state.health_seen !== h.at) {
      const { data: adm } = await db.from('admins').select('user_id');
      const ids = (adm || []).map((a: any) => a.user_id);
      const { data: subs } = ids.length ? await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids) : { data: [] };
      const line = 'Sankhyas data check: ' + h.warnings[0] + (h.warnings.length > 1 ? ' (and ' + (h.warnings.length - 1) + ' more)' : '') + '. ' + SITE + '#/admin';
      if (subs && subs.length) await sendNotifications(db, subs, await vapidKeys(db), [line]);
      if (env('RESEND_API_KEY') && ids.length) {
        const { data: ps } = await db.from('profiles').select('email').in('id', ids);
        for (const p of ps || []) if (p.email) await sendEmail(p.email, h.warnings.concat([SITE + '#/admin'])).catch(() => {});
      }
      await db.from('dispatch_state').upsert({ key: 'health_seen', value: h.at, updated_at: new Date().toISOString() });
    }
  } catch (e) { console.error('health', (e as Error).message); }

  const { data: rules } = await db.from('alerts').select('id, user_id, kind, symbol, params, channels, created_at').eq('active', true);
  if (!rules || !rules.length) return json({ rules: 0, health });

  const [activity, latest, metrics, resultsList, ratings] = await Promise.all([
    getJSON('data/yahoo/activity.json').catch(() => ({ orders: [], disclosures: [], deals: [] })),
    getJSON('data/filings/latest.json').catch(() => ({ items: [] })),
    getJSON('data/yahoo/metrics.json').catch(() => ({ companies: [] })),
    getJSON('data/yahoo/results.json').catch(() => ({ results: [] })),
    getJSON('data/yahoo/ratings.json').catch(() => ({ ratings: [] })),
  ]);
  // 30-minute prices in market hours (live.yml), when newer than the daily data
  const livePx = await getJSON('data/yahoo/live.json').catch(() => null);
  const liveP: Record<string, number[]> = livePx?.p && Date.parse(livePx.t) > Date.parse(metrics.updated || 0) ? livePx.p : {};
  // latest quarterly results with the Sankhyas verdict, by symbol
  const RES: Record<string, any> = {};
  for (const r of resultsList.results || []) RES[r.s] = r;
  const filedAt = (f: string) => { const t = Date.parse(String(f || '').replace(/-/g, ' ')); return Number.isFinite(t) ? t : 0; };
  const pctTxt = (v: number | null) => (v == null ? '' : (v >= 0 ? 'up ' : 'down ') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + '%');
  const M: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const c of metrics.companies || []) { M[c.s] = c.m || {}; names[c.s] = c.n || c.s; }
  const recent = Date.now() - 3 * 864e5;
  const fresh = (d: string, r: Rule) => { const t = Date.parse(d); return t >= recent && t >= Date.parse(r.created_at) - 864e5; };
  const nm = (s: string) => (names[s] || s) + ' (' + s + ')';

  // watchlists for rules that follow the watchlist
  const wlUsers = [...new Set(rules.filter((r: Rule) => r.params?.scope === 'watchlist').map((r: Rule) => r.user_id))];
  const watch: Record<string, string[]> = {};
  if (wlUsers.length) {
    const { data } = await db.from('user_data').select('user_id, value').eq('key', 'watchlist').in('user_id', wlUsers);
    (data || []).forEach((r: any) => (watch[r.user_id] = Array.isArray(r.value) ? r.value : []));
  }
  const symsOf = (r: Rule) => (r.symbol ? [r.symbol] : r.params?.scope === 'watchlist' ? watch[r.user_id] || [] : []);

  // red-flag scores seen last run
  const prevRisk: Record<string, number> = state.risk || {};
  const nextRisk: Record<string, number> = {};
  for (const s in M) if (M[s].riskScore != null) nextRisk[s] = M[s].riskScore;
  const band = (v: number) => (v >= 45 ? 'High' : v >= 20 ? 'Moderate' : 'Low');

  const out: { rule: Rule; ev: Ev }[] = [];
  const stateWrites: Record<string, any> = { risk: nextRisk };
  for (const r of rules as Rule[]) {
    const syms = new Set(symsOf(r));
    const evs: Ev[] = [];
    const items = latest.items || [];
    switch (r.kind) {
      case 'results':
        for (const s of syms) {
          const x = RES[s];
          if (x && filedAt(x.f) && fresh(new Date(filedAt(x.f)).toISOString(), r)) {
            const parts = [`Revenue ${pctTxt(x.sy)} YoY to ₹ ${Math.round(x.sales).toLocaleString('en-IN')} Cr`, x.np != null ? `net profit ${pctTxt(x.py)} YoY to ₹ ${Math.round(x.np).toLocaleString('en-IN')} Cr` : ''].filter(Boolean);
            evs.push({ key: `res|${s}|${x.qe}`, sym: s, text: `${nm(s)} ${x.q} results: ${x.v}. ${parts.join(', ')}. ${SITE}#/company/${encodeURIComponent(s)}` });
          }
        }
        // companies without parsed results yet: the filing itself
        for (const a of items) if (syms.has(a.s) && !RES[a.s] && a.k === 'results' && fresh(a.d, r)) evs.push({ key: a.u, sym: a.s, text: `${nm(a.s)} filed its financial results. ${a.u}` });
        break;
      case 'concall':
        for (const a of items) if (syms.has(a.s) && ['transcript', 'ppt', 'audio'].includes(a.k) && fresh(a.d, r))
          evs.push({ key: a.u, sym: a.s, text: `${nm(a.s)}: new ${a.k === 'ppt' ? 'investor presentation' : a.k === 'audio' ? 'concall recording' : 'concall transcript'}. ${SITE}#/company/${encodeURIComponent(a.s)}` });
        break;
      case 'order_win':
        for (const o of activity.orders || []) if (syms.has(o.s) && fresh(o.d, r))
          evs.push({ key: o.u, sym: o.s, text: `${nm(o.s)} won an order${o.amt ? ' worth ' + cr(o.amt) : ''}${o.cust ? ' from ' + o.cust : ''}. ${o.u}` });
        break;
      case 'rating_change':
        for (const a of ratings.ratings || []) if (syms.has(a.s) && !a.sub && ['upgrade', 'downgrade', 'outlook_up', 'outlook_down', 'watch'].includes(a.act) && fresh(a.d, r))
          evs.push({ key: a.u, sym: a.s, text: `${nm(a.s)}: ${a.ag || 'a rating agency'} ${({ upgrade: 'upgraded', downgrade: 'downgraded', outlook_up: 'raised the outlook on', outlook_down: 'cut the outlook on', watch: 'put on watch' } as Record<string, string>)[a.act]} its rating${a.from ? ' from ' + a.from : ''} to ${a.rt}${a.ol ? ' (' + a.ol + ')' : ''}. ${a.u}` });
        break;
      case 'insider_buy':
        for (const x of activity.disclosures || []) if (syms.has(x.s) && x.dir === 'buy' && fresh(x.d, r))
          evs.push({ key: x.u, sym: x.s, text: `${nm(x.s)}: ${x.who || (x.k === 'sast' ? 'a substantial shareholder' : 'an insider')}${x.cat ? ' (' + x.cat + ')' : ''} bought${x.q ? ' ' + x.q.toLocaleString('en-IN') + ' shares' : ''}${x.pr ? ' at ₹ ' + x.pr : ''}. ${x.u}` });
        break;
      case 'bulk_deal':
        for (const x of activity.deals || []) if (syms.has(x.s) && fresh(x.d + 'T18:00:00', r))
          evs.push({ key: [x.d, x.c, x.side, x.q, x.t].join('|'), sym: x.s, text: `${nm(x.s)}: ${x.t} deal, ${x.c} ${x.side === 'B' ? 'bought' : 'sold'} ${x.q.toLocaleString('en-IN')} shares at ₹ ${x.p} (${cr(x.v)}).` });
        break;
      case 'red_flags':
        for (const s of syms) {
          const now = nextRisk[s], before = prevRisk[s];
          if (now == null || before == null) continue;
          if (Math.abs(now - before) >= 10 || band(now) !== band(before))
            evs.push({ key: `risk|${s}|${before}|${now}`, sym: s, text: `${nm(s)}: red-flag score ${now > before ? 'rose' : 'fell'} from ${before} to ${now} (${band(now)} risk). ${SITE}#/company/${encodeURIComponent(s)}` });
        }
        break;
      case 'price_above':
      case 'price_below': {
        const s = r.symbol || '', p = liveP[s]?.[0] ?? M[s]?.price, t = +r.params?.price;
        if (p != null && t > 0 && (r.kind === 'price_above' ? p >= t : p <= t))
          evs.push({ key: `price|${t}`, sym: s, text: `${nm(s)} is at ₹ ${p}, ${r.kind === 'price_above' ? 'above' : 'below'} your alert price of ₹ ${t}.` });
        break;
      }
      case 'screen': {
        let matches: string[] | null = null;
        try { matches = evaluateScreen(await loadScreener(SITE), String(r.params?.query || ''), metrics.companies || []); } catch (_) { matches = null; }
        if (!matches) break;
        const key = 'screen:' + r.id, before: string[] | undefined = state[key];
        stateWrites[key] = matches;
        if (before) {
          const added = matches.filter(s => !before.includes(s));
          if (added.length) evs.push({ key: `screen|${new Date().toISOString().slice(0, 10)}|${added.join(',')}`.slice(0, 500), sym: '',
            text: `New in your screen "${r.params?.name || 'screen'}": ${added.slice(0, 15).map(nm).join(', ')}${added.length > 15 ? ' and ' + (added.length - 15) + ' more' : ''}.` });
        }
        break;
      }
    }
    for (const ev of evs) out.push({ rule: r, ev });
  }

  // ---- record once, then deliver grouped per user ----
  type Msg = { id: number; rule: Rule; text: string; channels: Set<string> };
  const byUser: Record<string, Msg[]> = {};
  for (const { rule, ev } of out) {
    const key = ev.key.slice(0, 500);
    const { data, error } = await db.from('alert_log').insert({ alert_id: rule.id, user_id: rule.user_id, event_key: key, message: ev.text.slice(0, 1000), channels: rule.channels }).select('id');
    let id = data?.length ? data[0].id : null;
    if (!id) {
      // already recorded: send again only if no channel could take it before (up to 3 days back)
      const { data: old } = await db.from('alert_log').select('id, delivered, sent_at').eq('alert_id', rule.id).eq('event_key', key).maybeSingle();
      if (!old || !Array.isArray(old.delivered) || old.delivered.length || Date.now() - Date.parse(old.sent_at) > 3 * 864e5) continue;
      id = old.id;
    }
    (byUser[rule.user_id] = byUser[rule.user_id] || []).push({ id, rule, text: ev.text, channels: new Set(rule.channels) });
  }
  for (const k in stateWrites) await db.from('dispatch_state').upsert({ key: k, value: stateWrites[k], updated_at: new Date().toISOString() });

  // which channels this server can send on (keys set), and for each user which they can receive on
  const can = { email: !!env('RESEND_API_KEY'), telegram: !!env('TELEGRAM_BOT_TOKEN'), whatsapp: !!(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID')) };
  const users = Object.keys(byUser);
  let sent = 0, undelivered = 0;
  const priceDone: number[] = [];
  if (users.length) {
    const { data: profs } = await db.from('profiles').select('id, email, full_name, email_alerts, telegram_chat_id, whatsapp_number, whatsapp_opt_in').in('id', users);
    // devices with notifications on: every alert also goes there
    const { data: subRows } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', users);
    const subsOf: Record<string, any[]> = {};
    (subRows || []).forEach((r: any) => (subsOf[r.user_id] = subsOf[r.user_id] || []).push(r));
    let keys: Keys | null = null;
    if ((subRows || []).length) {
      try { keys = await vapidKeys(db); } catch (e) { console.error('push keys', (e as Error).message); }
    }
    for (const p of profs || []) {
      const msgs = byUser[p.id];
      const ready: Record<string, boolean> = {
        email: can.email && !!p.email && p.email_alerts !== false,
        telegram: can.telegram && !!p.telegram_chat_id,
        whatsapp: can.whatsapp && !!p.whatsapp_opt_in && !!p.whatsapp_number,
        push: !!keys && !!(subsOf[p.id] || []).length,
      };
      // each alert goes on the channels it asked for that work; when none of them does, it falls back to
      // email, then Telegram, so an alert is never silently lost
      const why: Record<number, string[]> = {}, route: Record<number, string[]> = {};
      for (const m of msgs) {
        const asked = [...m.channels], ok = asked.filter(c => ready[c]);
        why[m.id] = asked.filter(c => !ready[c] && c !== 'push').map(c => c === 'whatsapp' ? (can.whatsapp ? 'WhatsApp number not saved' : 'WhatsApp sending is not switched on yet')
          : c === 'telegram' ? (can.telegram ? 'Telegram not connected' : 'Telegram is not switched on yet') : (can.email ? 'email alerts are off' : 'email sending is not switched on yet'));
        route[m.id] = ok.length ? ok : ready.email ? ['email'] : ready.telegram ? ['telegram'] : [];
        if (ready.push && !route[m.id].includes('push')) route[m.id].push('push');
      }
      const done: Record<number, string[]> = {};
      const pick = (ch: string) => msgs.filter(m => route[m.id].includes(ch));
      for (const ch of ['email', 'telegram', 'whatsapp', 'push']) {
        const list = pick(ch);
        if (!list.length) continue;
        try {
          if (ch === 'email') await sendEmail(p.email, list.map(m => m.text));
          else if (ch === 'telegram') await sendTelegram(p.telegram_chat_id, list.map(m => m.text));
          else if (ch === 'push') { if (!(await sendNotifications(db, subsOf[p.id], keys!, list.map(m => m.text)))) throw new Error('no device took it'); }
          else for (const m of list.slice(0, 5)) await sendWhatsApp(p.whatsapp_number, m.text);
          list.forEach(m => (done[m.id] = (done[m.id] || []).concat(ch)));
          sent++;
        } catch (e) {
          console.error('delivery failed for', p.id, ch, (e as Error).message);
          list.forEach(m => why[m.id].push(ch + ' failed, will not retry'));
        }
      }
      for (const m of msgs) {
        const d = done[m.id] || [];
        const note = d.length ? (why[m.id].length ? why[m.id].join('; ') + ' (sent by ' + d.join(' and ') + ' instead)' : '') : (why[m.id].join('; ') || 'no channel to send on');
        await db.from('alert_log').update({ delivered: d, note: note || null }).eq('id', m.id);
        if (d.length && m.rule.kind.startsWith('price_')) priceDone.push(m.rule.id);
        if (!d.length) undelivered++;
      }
    }
  }
  // a price alert switches off once it has reached the user; an undelivered one stays on
  if (priceDone.length) await db.from('alerts').update({ active: false }).in('id', priceDone);
  return json({ rules: rules.length, events: out.length, users: users.length, deliveries: sent, undelivered, channels: can, health });
});

// up to five notifications per device a run (the rest summed up in one), each opening its link;
// devices the push service no longer knows are forgotten. Returns how many devices took them.
// deno-lint-ignore no-explicit-any
async function sendNotifications(db: any, subs: any[], keys: Keys, lines: string[]) {
  const msgs = lines.slice(0, 5).map(t => {
    const url = (t.match(/https?:\/\/\S+/) || [SITE + '#/alerts'])[0];
    const text = t.replace(/\s*https?:\/\/\S+/g, '').trim();
    const i = text.indexOf(': ');
    return { title: i > 0 && i < 60 ? text.slice(0, i) : 'Sankhyas alert', body: (i > 0 && i < 60 ? text.slice(i + 2) : text).slice(0, 220), url, tag: 'a' + Math.abs(hash(t)) };
  });
  if (lines.length > 5) msgs.push({ title: 'Sankhyas alerts', body: (lines.length - 5) + ' more alerts. Tap to see them all.', url: SITE + '#/alerts', tag: 'more' });
  let ok = 0;
  for (const sub of subs) {
    let took = false;
    for (const m of msgs) {
      const st = await sendPush(sub, m, keys);
      if (st === 404 || st === 410) { await db.from('push_subscriptions').delete().eq('id', sub.id); break; }
      if (st >= 200 && st < 300) took = true;
      else console.error('push', st, new URL(sub.endpoint).host);
    }
    if (took) { ok++; await db.from('push_subscriptions').update({ last_ok: new Date().toISOString() }).eq('id', sub.id); }
  }
  return ok;
}
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

const escHtml = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const linkify = (s: string) => escHtml(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');

async function sendEmail(to: string, lines: string[]) {
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1d22"><h2 style="color:#6056ff;margin:0 0 12px">Sankhyas alerts</h2><ul style="padding-left:18px">' +
    lines.map(l => '<li style="margin:0 0 10px">' + linkify(l) + '</li>').join('') +
    '</ul><p style="color:#7a8090;font-size:12px">You get these because you set up alerts on Sankhyas. Change them at ' + SITE + '#/alerts. Not investment advice.</p></div>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('ALERTS_FROM', 'Sankhyas Alerts <alerts@sankhyas.com>'), to: [to], subject: lines.length === 1 ? lines[0].replace(/\s+https?:\/\/\S+/g, '').slice(0, 110) : `Sankhyas: ${lines.length} new alerts`, html }),
  });
  if (!r.ok) throw new Error('email ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function sendTelegram(chat: string, lines: string[]) {
  const text = '🔔 Sankhyas alerts\n\n' + lines.map(l => '• ' + l).join('\n\n');
  for (let i = 0; i < text.length; i += 4000) {
    const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(i, i + 4000), disable_web_page_preview: true }),
    });
    if (!r.ok) throw new Error('telegram ' + r.status);
  }
}

// WhatsApp needs an approved message template with one body variable ({{1}}) for business-initiated messages.
async function sendWhatsApp(number: string, text: string) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('WHATSAPP_TOKEN'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'template',
      template: { name: env('WHATSAPP_TEMPLATE', 'sankhyas_alert'), language: { code: env('WHATSAPP_TEMPLATE_LANG', 'en') }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }] } }),
  });
  if (!r.ok) throw new Error('whatsapp ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
