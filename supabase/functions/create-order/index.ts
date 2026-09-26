// POST { plan: "pro_monthly" | "pro_yearly" } with the user's access token.
// Creates a Razorpay order for the fixed plan price and records it in public.payments.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { PLANS, cors, env, json } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = env('SUPABASE_URL');
    const userClient = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Please log in first.' }, 401);

    const { plan } = await req.json().catch(() => ({}));
    const p = PLANS[plan as string];
    if (!p) return json({ error: 'Unknown plan.' }, 400);

    const keyId = env('RAZORPAY_KEY_ID');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(keyId + ':' + env('RAZORPAY_KEY_SECRET')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: p.amount, currency: 'INR', receipt: 'sk_' + Date.now().toString(36), notes: { user_id: user.id, plan } }),
    });
    const order = await res.json();
    if (!res.ok) return json({ error: (order.error && order.error.description) || 'Could not start the payment.' }, 502);

    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'));
    const { error } = await admin.from('payments').insert({ user_id: user.id, order_id: order.id, plan, amount: p.amount, currency: 'INR' });
    if (error) return json({ error: 'Could not record the order.' }, 500);

    return json({ order_id: order.id, amount: p.amount, currency: 'INR', key_id: keyId, description: p.label });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
