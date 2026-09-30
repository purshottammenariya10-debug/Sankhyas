#!/usr/bin/env node
// Writes the published site's js/config.js from the repository variables (Settings > Secrets and
// variables > Actions > Variables). Used by both deploy workflows. Without SUPABASE_URL the file is
// left as it is and the site runs without real accounts.
//
//   node scripts/site_config.mjs _site/js/config.js
import fs from 'node:fs';

const e = process.env, out = process.argv[2] || '_site/js/config.js';
if (!e.SUPABASE_URL) {
  console.log('Accounts and payments: off (set the SUPABASE_URL repository variable to switch them on)');
  process.exit(0);
}
const cfg = {
  supabaseUrl: e.SUPABASE_URL, supabaseAnonKey: e.SUPABASE_ANON_KEY, razorpayKeyId: e.RAZORPAY_KEY_ID,
  proFreeDuringBeta: /^(1|true|yes)$/i.test(e.PRO_FREE_DURING_BETA || ''),
  business: { name: e.BUSINESS_NAME || 'Sankhyas', email: e.BUSINESS_EMAIL || 'connect@sankhyas.com', phone: e.BUSINESS_PHONE || '', address: e.BUSINESS_ADDRESS || '', instagram: e.BUSINESS_INSTAGRAM || 'sankhyas.co' }
};
fs.writeFileSync(out, 'window.SANKHYAS_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
console.log('Accounts and payments: on (' + e.SUPABASE_URL + ')');
