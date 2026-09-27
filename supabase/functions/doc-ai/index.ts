// On-demand documents and AI summaries for any NSE company page.
//
// POST { action: "filings", symbol }  -> the company's last 3 years of NSE filings (concall
//     transcripts, presentations, recordings, results...) and annual reports, fetched live from NSE
//     (which answers Supabase's Mumbai region, not GitHub), cached for 12 hours, plus any saved
//     summaries for them.
// POST { action: "summary", url, kind, d, symbol } -> reads a transcript / presentation PDF from
//     the exchange and returns a rule-based summary. Each document is read once: the summary is
//     saved in public.doc_notes and served to every later visitor (and merged into the site data).
// Called from the website with the public anon key; only exchange hosts are ever fetched.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';
import { classify, summarize, summarizePpt } from './summarize.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DOC_HOSTS = /^https:\/\/(nsearchives\.nseindia\.com|archives\.nseindia\.com|www\.nseindia\.com|www\.bseindia\.com)\//i;
const NOTE_VERSION = 2;
let cookie = '';

async function nse(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://www.nseindia.com' + path, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/', ...(cookie ? { Cookie: cookie } : {}) } });
    if (r.ok) return r.json();
    await r.body?.cancel();
    if (r.status === 401 || r.status === 403) {
      const h = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      cookie = (h.headers.getSetCookie ? h.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
      await h.body?.cancel();
    } else if (r.status !== 429 && r.status < 500) throw new Error('NSE ' + r.status);
    await new Promise(res => setTimeout(res, 700 * (attempt + 1)));
  }
  throw new Error('NSE unavailable');
}

const pad = (n: number) => String(n).padStart(2, '0');
const nseDate = (d: Date) => `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function isoOf(r: Record<string, string>) {
  const s = r.sort_date || '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace(' ', 'T').slice(0, 19);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*(\d{2}:\d{2}:\d{2})?/.exec(r.an_dt || '');
  return m ? `${m[3]}-${MON[m[2].toLowerCase()]}-${pad(+m[1])}T${m[4] || '00:00:00'}` : null;
}
function fiscalLabel(y: string) {
  const [a = '', b = ''] = String(y).match(/\d{4}|\d{2}/g) || [];
  if (a.length === 4 && b) return `${a}-${b.slice(-2)}`;
  if (a.length === 4) return `${+a - 1}-${a.slice(-2)}`;
  return String(y);
}

async function filings(db: any, symbol: string) {
  const ck = 'f:' + symbol;
  const { data: cached } = await db.from('doc_cache').select('value, updated_at').eq('key', ck).maybeSingle();
  let out = cached && Date.now() - Date.parse(cached.updated_at) < 12 * 3600e3 ? cached.value : null;
  if (!out) {
    const to = new Date(), from = new Date(Date.now() - 3 * 365 * 864e5);
    const q = (p: string) => `/api/${p}?index=equities&symbol=${encodeURIComponent(symbol)}`;
    const [anns, ars] = await Promise.all([
      nse(q('corporate-announcements') + `&from_date=${nseDate(from)}&to_date=${nseDate(to)}`).catch(() => []),
      nse(q('annual-reports')).catch(() => ({ data: [] })),
    ]);
    const rows = Array.isArray(anns) ? anns : (anns && anns.data) || [];
    const announcements = [];
    for (const r of rows) {
      const u = r.attchmntFile, d = isoOf(r);
      if (!u || !d) continue;
      const t = String(r.attchmntText || r.desc || 'Announcement').replace(/\s+/g, ' ').trim().slice(0, 300), c = String(r.desc || '').trim().slice(0, 80);
      announcements.push({ d, t, c, u, x: 'nse', k: classify(t + ' ' + c) });
    }
    announcements.sort((a, b) => b.d.localeCompare(a.d));
    // keep every concall / result / rating / order / insider filing, and the newest routine ones
    let others = 0;
    const kept = announcements.filter(a => a.k !== 'other' || ++others <= 120).slice(0, 600);
    const annualReports = ((Array.isArray(ars) ? ars : ars && ars.data) || []).filter((r: any) => r.fileName)
      .map((r: any) => ({ y: fiscalLabel(`${r.fromYr || ''}-${r.toYr || ''}`), u: r.fileName, x: 'nse' }));
    out = { symbol, announcements: kept, annualReports, updated: new Date().toISOString(), source: 'live' };
    if (kept.length || annualReports.length) await db.from('doc_cache').upsert({ key: ck, value: out, updated_at: new Date().toISOString() });
  }
  const urls = out.announcements.filter((a: any) => a.k === 'transcript' || a.k === 'ppt').map((a: any) => a.u);
  const notes: Record<string, unknown> = {};
  for (let i = 0; i < urls.length; i += 100) {
    const { data } = await db.from('doc_notes').select('url, note').in('url', urls.slice(i, i + 100));
    (data || []).forEach((r: any) => (notes[r.url] = r.note));
  }
  return { ...out, notes };
}

async function summary(db: any, b: Record<string, string>) {
  const url = String(b.url || ''), kind = b.kind === 'ppt' ? 'ppt' : 'transcript';
  if (!DOC_HOSTS.test(url) || !/\.pdf(\?|$)/i.test(url)) return json({ error: 'Only exchange PDF filings can be summarised.' }, 400);
  const { data: have } = await db.from('doc_notes').select('note').eq('url', url).maybeSingle();
  if (have) return json({ note: have.note, cached: true });
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.nseindia.com/' } });
  if (!r.ok) return json({ error: 'The exchange did not return the document (' + r.status + ').' }, 502);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 25e6) return json({ error: 'The document is too large to summarise here.' }, 413);
  const pdf = await getDocumentProxy(buf);
  if (pdf.numPages > 90) return json({ error: 'The document is too long to summarise here.' }, 413);
  const { text } = await extractText(pdf, { mergePages: true });
  const body = Array.isArray(text) ? text.join('\n') : String(text || '');
  const n = body.split(/\s+/).filter(Boolean).length;
  if (n < (kind === 'ppt' ? 80 : 300)) return json({ error: 'This PDF has too little text to read (it may be a scanned image).' }, 422);
  const note = { ...(kind === 'ppt' ? summarizePpt(body) : summarize(body)), d: String(b.d || new Date().toISOString()).slice(0, 19), kind, v: NOTE_VERSION, src: 'on-demand' };
  if (!Object.keys(note.sections).length) return json({ error: 'Nothing to summarise in this document.' }, 422);
  await db.from('doc_notes').upsert({ url, symbol: String(b.symbol || '').slice(0, 20) || null, kind, note });
  return json({ note });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const b = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    if (b.action === 'filings') {
      const symbol = String(b.symbol || '').toUpperCase();
      if (!/^[A-Z0-9&\-]{1,20}$/.test(symbol)) return json({ error: 'Bad symbol' }, 400);
      return json(await filings(db, symbol));
    }
    if (b.action === 'summary') return await summary(db, b);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Failed' }, 500);
  }
});
