// Telegram bot webhook for Sankhyas alerts. A user presses "Connect" on the Alerts page, which
// opens t.me/<bot>?start=<one-time code>; Telegram then sends "/start <code>" here and we link the
// chat to their account. "/stop" unlinks it.
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (the secret_token given to setWebhook).
// Deployed with verify_jwt off: Telegram authenticates with the secret token header instead.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const env = (k: string) => Deno.env.get(k) ?? '';
const ok = () => new Response('ok');

async function reply(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const secret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 401 });
  const upd = await req.json().catch(() => null);
  const msg = upd?.message;
  if (!msg?.chat?.id || typeof msg.text !== 'string') return ok();
  const chat = msg.chat.id as number, text = msg.text.trim();
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  const start = /^\/start(?:@\w+)?\s+([a-f0-9]{24})$/i.exec(text);
  if (start) {
    const { data } = await db.from('profiles').update({ telegram_chat_id: String(chat), telegram_link_token: null })
      .eq('telegram_link_token', start[1].toLowerCase()).select('full_name');
    await reply(chat, data?.length
      ? `✅ Connected${data[0].full_name ? ', ' + data[0].full_name : ''}! Sankhyas alerts will arrive in this chat. Send /stop to turn them off.`
      : 'This link has expired. Open Sankhyas → Alerts and press Connect again.');
    return ok();
  }
  if (/^\/stop/i.test(text)) {
    await db.from('profiles').update({ telegram_chat_id: null }).eq('telegram_chat_id', String(chat));
    await reply(chat, 'Alerts in this chat are off. Connect again any time from Sankhyas → Alerts.');
    return ok();
  }
  await reply(chat, 'Hi! I send Sankhyas alerts: results, red-flag changes, insider buying, order wins and screen matches. Set them up at Sankhyas → Alerts.');
  return ok();
});
