// Web Push (phone and browser notifications) with the Web Crypto API only: the site's VAPID key pair
// (RFC 8292) signs who is sending, and each message is encrypted for the device (RFC 8291, aes128gcm).
//
// The key pair is made on first use and kept in public.push_config, which only the service role can
// read, so the private key never leaves the server.

const enc = new TextEncoder();
// deno-lint-ignore no-explicit-any
const buf = (b: Uint8Array) => b as any as BufferSource;
export const b64u = (b: ArrayBuffer | Uint8Array) => {
  const a = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string) => {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, c => c.charCodeAt(0));
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

export type Keys = { publicKey: string; privateKey: CryptoKey };
// deno-lint-ignore no-explicit-any
export async function vapidKeys(db: any): Promise<Keys> {
  const { data } = await db.from('push_config').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (data) {
    return { publicKey: data.public_key, privateKey: await crypto.subtle.importKey('jwk', data.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  // a parallel first call may have saved its own pair: keep whichever is stored
  await db.from('push_config').insert({ id: 1, public_key: publicKey, private_jwk: jwk });
  const { data: saved } = await db.from('push_config').select('public_key, private_jwk').eq('id', 1).single();
  return { publicKey: saved.public_key, privateKey: await crypto.subtle.importKey('jwk', saved.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
}

async function vapidAuth(endpoint: string, keys: Keys, subject: string) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, buf(enc.encode(header + '.' + body)));
  return 'vapid t=' + header + '.' + body + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/** The message body encrypted for one device (RFC 8291 / RFC 8188 aes128gcm, one record). */
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey('raw', buf(ua), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(cat(payload, new Uint8Array([2])))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([as.length]), as, sealed);
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
/** Sends one notification. Returns the push service's status: 201 sent; 404 / 410 the device is gone. */
export async function sendPush(sub: Sub, message: Record<string, unknown>, keys: Keys, subject = 'mailto:connect@sankhyas.com') {
  const body = await encrypt(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, keys, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body: buf(body),
  });
  await r.body?.cancel();
  return r.status;
}
