// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature } with the user's access token,
// straight from Razorpay Checkout's success handler. Verifies the signature and activates Pro.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { cors, env, json, verifyCheckoutSignature } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = env('SUPABASE_URL');
    const userClient = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Please log in first.' }, 401);

    const b = await req.json().catch(() => ({}));
    const ok = await verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature, env('RAZORPAY_KEY_SECRET'));
    if (!ok) return json({ error: 'Payment could not be verified.' }, 400);

    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: pay } = await admin.from('payments').select('user_id').eq('order_id', b.razorpay_order_id).maybeSingle();
    if (!pay || pay.user_id !== user.id) return json({ error: 'This order does not belong to your account.' }, 403);

    const { data: until, error } = await admin.rpc('activate_pro', { p_order_id: b.razorpay_order_id, p_payment_id: b.razorpay_payment_id, p_amount: null });
    if (error) return json({ error: 'Could not activate Pro.' }, 500);
    return json({ plan: 'pro', pro_until: until });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
