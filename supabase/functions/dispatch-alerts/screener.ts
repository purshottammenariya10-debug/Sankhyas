// Screen alerts use the website's own query engine (js/screener.js), loaded from the site so the
// query language always matches what users typed on Sankhyas.
let engine: any = null;

export async function loadScreener(site: string) {
  if (engine) return engine;
  const src = await (await fetch(site + 'js/screener.js?t=' + Date.now())).text();
  const win: Record<string, any> = {};
  new Function('window', src)(win);
  engine = win.Screener;
  return engine;
}

/** Symbols in metrics.json rows ({ s, m }) that match a screen query. */
export function evaluateScreen(screener: any, query: string, companies: { s: string; m?: Record<string, number> }[]): string[] {
  const { results } = screener.run(query, companies.map(c => ({ symbol: c.s, metrics: c.m || {} })));
  return results.map((r: { symbol: string }) => r.symbol);
}
