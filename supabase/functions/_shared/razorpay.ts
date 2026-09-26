// Shared helpers for the Sankhyas payment functions (Supabase Edge Functions, Deno).
// Prices are fixed here on the server so the browser cannot change what is charged.

export const PLANS: Record<string, { amount: number; label: string }> = {
  pro_monthly: { amount: 29900, label: 'Sankhyas Pro - 1 month' },   // Rs 299, in paise
  pro_yearly: { amount: 249900, label: 'Sankhyas Pro - 1 year' },    // Rs 2,499
};

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Hex HMAC-SHA256 of message with secret (Web Crypto: works in Deno and Node). */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Razorpay checkout signature: HMAC(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqual(await hmacHex(keySecret, orderId + '|' + paymentId), signature);
}

/** Razorpay webhook signature: HMAC(raw request body, webhook secret). */
export async function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): Promise<boolean> {
  if (!signature || !webhookSecret) return false;
  return safeEqual(await hmacHex(webhookSecret, rawBody), signature);
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error('Missing secret ' + name);
  return v;
}
