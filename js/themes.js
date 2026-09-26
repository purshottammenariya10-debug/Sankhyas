/* Investment themes: hand-picked baskets of listed companies. Symbols that are not in the
 * current data set are skipped, so a theme only ever shows companies Sankhyas has data for.
 * `match` optionally adds companies whose Yahoo industry fits the theme. */
(function () {
  const THEMES = [
    { slug: 'defence', name: 'Defence', icon: '🛡️', desc: 'Defence manufacturing, shipbuilding and electronics riding on indigenisation and exports.',
      symbols: ['HAL', 'BEL', 'BDL', 'MAZDOCK', 'COCHINSHIP', 'GRSE', 'BEML', 'DATAPATTNS', 'ASTRAMICRO', 'PARAS', 'MTARTECH', 'SOLARINDS', 'ZENTEC', 'MIDHANI', 'DCXINDIA', 'APOLLO', 'IDEAFORGE', 'HBLENGINE'],
      match: /aerospace & defense/i },
    { slug: 'railways', name: 'Railways', icon: '🚆', desc: 'Rail financing, construction, wagons, coaches, signalling and rail services.',
      symbols: ['IRFC', 'RVNL', 'IRCON', 'IRCTC', 'RAILTEL', 'RITES', 'CONCOR', 'TITAGARH', 'TEXRAIL', 'JWL', 'BEML', 'HBLENGINE', 'KERNEX', 'RKFORGE', 'OLECTRA'],
      match: /railroads/i },
    { slug: 'ev', name: 'Electric Vehicles', icon: '⚡', desc: 'EV makers, batteries, components and charging.',
      symbols: ['TATAMOTORS', 'M&M', 'OLAELEC', 'TVSMOTOR', 'BAJAJ-AUTO', 'OLECTRA', 'JBMA', 'GREAVESCOT', 'SONACOMS', 'UNOMINDA', 'EXIDEIND', 'ARE&M', 'TATAPOWER', 'HEG', 'GRAPHITE', 'SERVOTECH', 'EXICOM'] },
    { slug: 'psu-banks', name: 'PSU Banks', icon: '🏦', desc: 'Government-owned banks.',
      symbols: ['SBIN', 'BANKBARODA', 'PNB', 'CANBK', 'UNIONBANK', 'INDIANB', 'BANKINDIA', 'CENTRALBK', 'UCOBANK', 'IOB', 'MAHABANK', 'PSB'] },
    { slug: 'renewable-energy', name: 'Renewable Energy', icon: '☀️', desc: 'Solar, wind and green-power producers, equipment makers and financiers.',
      symbols: ['ADANIGREEN', 'NTPCGREEN', 'TATAPOWER', 'SUZLON', 'INOXWIND', 'WAAREEENER', 'PREMIERENE', 'IREDA', 'SJVN', 'NHPC', 'KPIGREEN', 'BORORENEW', 'ACMESOLAR', 'INOXGREEN', 'JSWENERGY', 'GENUSPOWER', 'WEBELSOLAR', 'KPEL'],
      match: /solar|renewable/i },
    { slug: 'electronics-manufacturing', name: 'Electronics Manufacturing', icon: '🔌', desc: 'EMS, components and semiconductor plays benefiting from PLI schemes.',
      symbols: ['DIXON', 'KAYNES', 'SYRMA', 'AMBER', 'AVALON', 'CGPOWER', 'MOSCHIP', 'CENTUM', 'SPEL', 'ELIN', 'PGEL', 'CYIENTDLM', 'SAHASRA', 'HCLTECH'],
      match: /semiconductor|electronic components/i },
    { slug: 'capital-markets', name: 'Capital Markets', icon: '📈', desc: 'Exchanges, depositories, brokers, registrars and asset managers.',
      symbols: ['BSE', 'MCX', 'CDSL', 'CAMS', 'KFINTECH', 'ANGELONE', 'MOTILALOFS', 'NUVAMA', '360ONE', 'HDFCAMC', 'NAM-INDIA', 'UTIAMC', 'ABSLAMC', 'IIFLCAPS', 'GEOJITFSL'],
      match: /capital markets|asset management|financial data & stock exchanges/i },
    { slug: 'infrastructure', name: 'Infrastructure & Capex', icon: '🏗️', desc: 'Engineering, construction and capital-goods companies tied to India\'s capex cycle.',
      symbols: ['LT', 'SIEMENS', 'ABB', 'CUMMINSIND', 'THERMAX', 'KEC', 'KPIL', 'NCC', 'PNCINFRA', 'KNRCON', 'HGINFRA', 'IRB', 'GMRAIRPORT', 'ADANIPORTS', 'ULTRACEMCO', 'POLYCAB', 'KEI', 'APARINDS', 'TIINDIA'],
      match: /engineering & construction|infrastructure operations/i },
    { slug: 'hospitals-healthcare', name: 'Hospitals & Healthcare', icon: '🏥', desc: 'Hospital chains, diagnostics and health services.',
      symbols: ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS', 'NH', 'MEDANTA', 'KIMS', 'RAINBOW', 'ASTERDM', 'YATHARTH', 'LALPATHLAB', 'METROPOLIS', 'VIJAYA', 'THYROCARE'],
      match: /medical care facilities|diagnostics & research/i },
    { slug: 'travel-hospitality', name: 'Travel & Hospitality', icon: '🏨', desc: 'Hotels, airlines, travel and leisure.',
      symbols: ['INDHOTEL', 'EIHOTEL', 'CHALET', 'LEMONTREE', 'JUNIPER', 'SAMHI', 'INDIGO', 'IRCTC', 'EASEMYTRIP', 'THOMASCOOK', 'MHRIL', 'WONDERLA'],
      match: /lodging|airlines|travel services|resorts & casinos/i },
    { slug: 'specialty-chemicals', name: 'Specialty Chemicals', icon: '🧪', desc: 'Specialty and fluoro-chemical makers serving global supply chains.',
      symbols: ['PIDILITIND', 'SRF', 'NAVINFLUOR', 'DEEPAKNTR', 'AARTIIND', 'ATUL', 'VINATIORGA', 'CLEAN', 'FINEORG', 'GALAXYSURF', 'ALKYLAMINE', 'BALAMINES', 'TATACHEM', 'GUJFLUORO', 'PCBL', 'ROSSARI'],
      match: /specialty chemicals/i },
    { slug: 'digital-consumer', name: 'New-age Digital', icon: '📱', desc: 'Internet platforms and new-age consumer tech listed in India.',
      symbols: ['ETERNAL', 'SWIGGY', 'NYKAA', 'PAYTM', 'POLICYBZR', 'NAUKRI', 'INDIAMART', 'JUSTDIAL', 'CARTRADE', 'MAPMYINDIA', 'IXIGO', 'FIRSTCRY', 'HONASA', 'DELHIVERY', 'LENSKART'] }
  ];
  const BY = {};
  THEMES.forEach(t => { BY[t.slug] = t; });

  /** Companies in a theme, from a list of company objects (Data.listCompanies()). */
  function members(theme, all) {
    const bySym = {};
    all.forEach(c => { bySym[c.symbol] = c; });
    const out = [], seen = {};
    theme.symbols.forEach(s => { if (bySym[s] && !seen[s]) { seen[s] = 1; out.push(bySym[s]); } });
    if (theme.match) {
      all.forEach(c => {
        if (!seen[c.symbol] && theme.match.test(c.industry || '') && (c.metrics.marketCap || 0) >= 500) { seen[c.symbol] = 1; out.push(c); }
      });
    }
    return out;
  }
  window.Themes = { list: THEMES, get: slug => BY[slug], members };
})();
