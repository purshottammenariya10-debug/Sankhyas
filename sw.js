/* Sankhyas service worker: makes the site installable and usable offline.
 *
 * Everything is fetched from the network first, so a new deploy or a data update shows at once;
 * the copy kept here is only used when the phone is offline (or the network fails). Pages and
 * code keep their last copy; data files (prices, results, filings) keep the most recent 250.
 * Other sites (fonts, sign-in, payments) are never touched.
 */
const VERSION = 'v1';
const SHELL = 'sankhyas-shell-' + VERSION;
const DATA = 'sankhyas-data-' + VERSION;
const DATA_MAX = 250;
const PRECACHE = ['./', 'index.html', 'css/style.css', 'js/vendor/chart.umd.js', 'js/config.js', 'js/account.js', 'js/data.js', 'js/screener.js',
  'js/insights.js', 'js/themes.js', 'js/cards.js', 'js/ai.js', 'js/app.js', 'assets/logo.svg', 'assets/logo-192.png', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sankhyas-') && k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - DATA_MAX; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isData = url.pathname.includes('/data/');
  const store = isData ? DATA : SHELL;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(store).then(c => c.put(req, copy).then(() => (isData ? trim(c) : null))).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      // an app page opened offline: the app shell renders it from whatever data is kept
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html') || await caches.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
