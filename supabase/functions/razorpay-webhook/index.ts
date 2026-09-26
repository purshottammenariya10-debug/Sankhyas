// Razorpay webhook (events: payment.captured, order.paid). Activates Pro even if the buyer closed
// the browser before the success handler ran. Deploy with --no-verify-jwt: Razorpay signs the
// request with the webhook secret instead of a Supabase token.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { env, json, verifyWebhookSignature } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const ok = await verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature') ?? '', env('RAZORPAY_WEBHOOK_SECRET'));
  if (!ok) return json({ error: 'Bad signature' }, 401);

  const evt = JSON.parse(raw);
  if (evt.event !== 'payment.captured' && evt.event !== 'order.paid') return json({ ignored: evt.event });
  const payment = evt.payload?.payment?.entity;
  const orderId = payment?.order_id ?? evt.payload?.order?.entity?.id;
  if (!orderId || !payment?.id) return json({ ignored: 'no order' });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { error } = await admin.rpc('activate_pro', { p_order_id: orderId, p_payment_id: payment.id, p_amount: payment.amount ?? null });
  if (error) {
    // unknown orders (e.g. payments from another app on the same Razorpay account) are acknowledged
    if (/unknown order/.test(error.message)) return json({ ignored: 'unknown order' });
    return json({ error: error.message }, 500);   // Razorpay retries non-2xx responses
  }
  return json({ ok: true });
});
