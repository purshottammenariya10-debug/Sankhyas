// Rule-based summaries of concall transcripts and investor presentations: a TypeScript copy of
// scripts/summarize_concalls.py (summarize, summarize_ppt) so the site can summarise any document
// on demand. Keep the two in step.

const TOPICS: [string, RegExp][] = [
  ['Guidance & outlook', /guidance|outlook|going forward|expect|anticipat|visibility|target|aim to|next (year|quarter|fiscal)|fy ?2\d|medium term|long term|confident/gi],
  ['Growth & demand', /growth|grew|demand|volume|order ?book|order inflow|pipeline|market share|new (customers?|clients?|products?)|deal wins?|revenue (was|grew|increased|rose)|launch/gi],
  ['Margins & costs', /margin|ebitda|operating profit|cost|pricing|price (hike|increase)|raw material|input|inflation|realisation|realization|wage|utili[sz]ation/gi],
  ['Capex & expansion', /capex|capacity|expansion|plant|commission|greenfield|brownfield|acquisition|acquire|invest(ment|ing)? in|new facility|capital expenditure/gi],
  ['Balance sheet & cash', /\bdebt\b|net cash|cash flow|free cash|working capital|receivable|inventory days|dividend|buyback|borrowing|leverage|deleverag/gi],
  ['Risks & challenges', /challeng|headwind|pressure|declin|slowdown|uncertain|\brisk|weak|subdued|delay|disruption|volatil|competition|soft/gi],
];
const BOILERPLATE = new RegExp('forward[- ]looking|safe harbo|ladies and gentlemen|thank you|thanks|good (morning|afternoon|evening)|welcome to|' +
  'question[- ]and[- ]answer|press (star|\\*)|touch[- ]tone|next question|line of|moderator|operator|' +
  'conference call|this call|disclaimer|transcript|recording|please go ahead|hand over|over to you|' +
  'i would like to|let me|may i|can you|could you|you mentioned|joining us|introduc', 'i');
const POSITIVE = /strong|robust|healthy|record|improv|grow|increase|higher|momentum|confident|optimis|upbeat|best|expand/gi;
const NEGATIVE = /weak|declin|lower|pressure|challeng|headwind|slow|subdued|soft|decrease|loss|uncertain|cautious|muted/gi;
const NUMBER = /\d+(\.\d+)?\s*(%|percent|per cent|bps|basis points|crore|cr\b|billion|million|lakh|mw|mtpa|x\b)|(rs\.?|inr|₹)\s*\d/i;
const SPEAKER = /^\s*([A-Z][A-Za-z.\-' ]{1,40}|Moderator|Management|Analyst|Participant)\s*:\s*/;
const KEY_METRIC = /revenue|sales|income|ebitda|\bpat\b|profit|margin|order ?book|order inflow|volume|\baum\b|deposits|advances|loan book|disbursement|\bnim\b|gnpa|nnpa|\beps\b|roce|roe|capacity|market share|guidance|dividend/gi;
const PPT_NOISE = /safe harbo|disclaimer|forward[- ]looking|thank you|agenda|contents|www\.|@|investor relations|this presentation|not an offer|confidential/i;

const count = (re: RegExp, s: string) => (s.match(re) || []).length;
const key = (s: string) => s.toLowerCase().replace(/\W+/g, '');
export type Note = { tone: string; sections: Record<string, string[]>; words: number };
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
function tone(text: string) {
  const pos = count(POSITIVE, text), neg = count(NEGATIVE, text);
  return pos > neg * 1.6 ? 'Positive' : neg > pos ? 'Cautious' : 'Neutral';
}

/** Investor presentations are bullet points, not prose: rank lines instead of sentences. */
export function summarizePpt(text: string, perTopic = 4): Note {
  const lines: [number, string][] = [], seen = new Set<string>();
  text.replace(/’/g, "'").split('\n').forEach((raw, i) => {
    const ln = raw.replace(/\s+/g, ' ').trim().replace(/^[\s•▪●○■\-–·*>]+|[\s•▪●○■\-–·*>]+$/g, '');
    const k = key(ln);
    if (ln.length < 25 || ln.length > 240 || seen.has(k) || PPT_NOISE.test(ln) || !/[a-z]{3}/.test(ln)) return;
    seen.add(k);
    lines.push([i, ln]);
  });
  const picked: Record<string, string[]> = {}, used = new Set<number>();
  const topics: [string, RegExp | null][] = [['Key numbers', null], ...TOPICS];
  for (const [topic, pat] of topics) {
    const cands: [number, number, string][] = [];
    for (const [i, ln] of lines) {
      if (used.has(i)) continue;
      if (!pat) { if (NUMBER.test(ln) && count(KEY_METRIC, ln)) cands.push([count(KEY_METRIC, ln) + 2, i, ln]); }
      else { const h = count(pat, ln); if (h) cands.push([h + (NUMBER.test(ln) ? 1 : 0), i, ln]); }
    }
    const best = cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, perTopic);
    best.forEach(c => used.add(c[1]));
    if (best.length) picked[topic] = best.sort((a, b) => a[1] - b[1]).map(c => c[2]);
  }
  return { tone: tone(text), sections: picked, words: words(text) };
}

function sentences(text: string): [string, boolean, boolean][] {
  text = text.replace(/’/g, "'").replace(/–/g, '-').replace(/—/g, '-');
  const lines = text.split('\n').filter(ln => ln.trim() && !/^\s*(page \d+( of \d+)?|\d+)\s*$/i.test(ln));
  const joined = lines.map(ln => ln.trim().replace(SPEAKER, '')).join(' ').replace(/\s+/g, ' ');
  const m = /question[- ]and[- ]answer|first question|begin the question/i.exec(joined);
  const qaAt = m ? m.index : null;
  const out: [string, boolean, boolean][] = [];
  let pos = 0;
  for (const s of joined.split(/(?<=[.!?])\s+(?=[A-Z0-9₹"'(])/)) {
    const start = joined.indexOf(s, pos);
    if (start >= 0) pos = start + s.length;
    out.push([s.trim(), qaAt !== null && start > qaAt, s.trim().endsWith('?')]);
  }
  return out;
}

export function summarize(text: string, perTopic = 3): Note {
  const sents = sentences(text);
  const scored: [number, number, string, string][] = [];
  sents.forEach(([s, inQa, isQ], i) => {
    if (s.length < 50 || s.length > 420 || isQ || BOILERPLATE.test(s)) return;
    const base = (NUMBER.test(s) ? 2 : 0) + (inQa ? 0 : 1);
    for (const [topic, pat] of TOPICS) { const h = count(pat, s); if (h) scored.push([base + h, i, topic, s]); }
  });
  const picked: Record<string, string[]> = {}, used = new Set<number>(), seenText = new Set<string>();
  for (const [topic] of TOPICS) {
    const cands: [number, number, string, string][] = [];
    for (const c of scored.filter(c => c[2] === topic && !used.has(c[1])).sort((a, b) => b[0] - a[0] || a[1] - b[1])) {
      const k = key(c[3]);
      if (seenText.has(k)) continue;
      seenText.add(k);
      cands.push(c);
      if (cands.length === perTopic) break;
    }
    cands.forEach(c => used.add(c[1]));
    if (cands.length) picked[topic] = cands.sort((a, b) => a[1] - b[1]).map(c => c[3].slice(0, 360) + (c[3].length > 360 ? '…' : ''));
  }
  const body = sents.filter(s => !s[1]).map(s => s[0]).join(' ');
  return { tone: tone(body), sections: picked, words: words(text) };
}

/** Filing kind used by the site: a copy of classify() in scripts/fetch_filings.py. */
export function classify(text: string): string {
  const t = text.toLowerCase();
  const agm = /annual general meeting|\bagm\b|general meeting|postal ballot|e-voting|proceedings/.test(t);
  if (t.includes('transcript') && !agm) return 'transcript';
  if (/audio|recording|webcast/.test(t) && /call|meet|earnings|conference/.test(t) && !agm && !t.includes('video conferenc')) return 'audio';
  if (/investor presentation|earnings presentation|analyst presentation|\bppt\b|presentation/.test(t) && !agm) return 'ppt';
  if (/credit rating|\brating/.test(t) && !/rating agenc(y|ies)'? ?meet/.test(t)) return 'rating';
  if (/bagging|receiving of orders|receipt of (an? |new )?(order|contract)|order (win|received|inflow)|letter of (award|acceptance|intent)|\bloa\b|work order|purchase order|(bags?|secures?|wins?|received?|awarded) (an? |new |the )?(orders?|contracts?)/.test(t)
      && !/orders? passed|in order to|court|tribunal|nclt/.test(t)) return 'order';
  if (/regulation\s*7\s*\(2\)|reg\.?\s*7\s*\(2\)|continual disclosure/.test(t) && !t.includes('trading window')) return 'insider';
  if (/regulation\s*(29|31|10)\s*\(|reg\.?\s*(29|31|10)\s*\(|substantial acquisition of shares|\bsast\b|(creation|release|invocation) of (pledge|encumbrance)/.test(t) && !t.includes('trading window')) return 'sast';
  if (/con\.? ?call|conference call|earnings call|analysts?[ /]+institutional investor meet|investor meet/.test(t)) return 'concall';
  if (/financial result|outcome of board/.test(t)) return 'results';
  return 'other';
}
