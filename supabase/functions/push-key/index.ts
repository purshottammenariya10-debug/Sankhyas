// The site's public key for phone and browser notifications (Web Push). Browsers need it to sign a
// device up; the key pair is made on first use (supabase/functions/_shared/webpush.ts).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { vapidKeys } from '../_shared/webpush.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { publicKey } = await vapidKeys(db);
    return new Response(JSON.stringify({ publicKey }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  } catch (e) {
    console.error('push-key', (e as Error).message);
    return new Response(JSON.stringify({ error: 'Notifications are not available right now.' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
