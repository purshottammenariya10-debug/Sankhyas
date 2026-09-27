// Relay for NSE's public website APIs. NSE refuses GitHub's servers, but answers from Supabase's
// Mumbai region, so the data job (scripts/exchange.py) fetches filing history through here.
// Call with the header x-region: ap-south-1 so the function runs in Mumbai.
//
// POST { "paths": ["/api/corporate-announcements?index=equities&symbol=TCS&from_date=..&to_date=.."] }
// -> [{ "path", "status", "data" }]   (up to 10 paths per call)
// Only the read-only NSE paths in ALLOWED are relayed. If the PROXY_SECRET secret is set, callers
// must also send it in the x-proxy-secret header.
const ALLOWED = /^\/api\/(corporate-announcements|annual-reports|corporates-pit|corporate-sast-reg29|corporates-corporateActions|corporate-board-meetings|event-calendar)\?[\w\-.=&%,]*$/;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/' };
let cookie = '';

async function refreshCookie() {
  const r = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  cookie = set.map(c => c.split(';')[0]).join('; ');
  await r.body?.cancel();
}

async function nse(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://www.nseindia.com' + path, { headers: cookie ? { ...HEADERS, Cookie: cookie } : HEADERS });
    if (r.ok) {
      const text = await r.text();
      try { return { status: 200, data: JSON.parse(text) }; } catch (_) { return { status: 502, data: null }; }
    }
    await r.body?.cancel();
    if (r.status === 401 || r.status === 403) await refreshCookie();
    else if (r.status !== 429 && r.status < 500) return { status: r.status, data: null };
    await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
  }
  return { status: 503, data: null };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const secret = Deno.env.get('PROXY_SECRET');
  if (secret && req.headers.get('x-proxy-secret') !== secret) return new Response('forbidden', { status: 401 });
  const body = await req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body.paths) ? body.paths.slice(0, 10) : [];
  if (!paths.length || !paths.every(p => typeof p === 'string' && ALLOWED.test(p))) {
    return new Response(JSON.stringify({ error: 'paths must be allowed NSE /api/ paths' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const out = [];
  for (const p of paths) out.push({ path: p, ...(await nse(p)) });   // one at a time: NSE rate-limits bursts
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'x-served-region': Deno.env.get('SB_REGION') ?? '' } });
});
