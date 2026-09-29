/* Sankhyas accounts and Pro payments.
 *
 * Cloud mode (js/config.js has a Supabase project): real accounts with Supabase Auth (email and
 * password, email sign-in link, Google / GitHub / Microsoft / Apple when switched on in Supabase,
 * password reset), watchlist/screens/notes/portfolio synced across devices, alerts, the plan stored in the database, and Pro bought with
 * Razorpay Checkout. Orders are created and payments verified by Supabase Edge Functions
 * (supabase/functions), so the Razorpay secret never reaches the browser.
 *
 * Local mode (no Supabase configured): accounts stay in this browser and Pro is free for everyone.
 */
(function () {
  const cfg = window.SANKHYAS_CONFIG || {};
  const cloud = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const RAZORPAY_JS = 'https://checkout.razorpay.com/v1/checkout.js';
  const PLANS = { pro_monthly: { price: 299, per: 'month' }, pro_yearly: { price: 2499, per: 'year' } };

  const listeners = [];
  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('sankhyas_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sankhyas_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res;
        s.onerror = () => { delete scripts[src]; s.remove(); rej(new Error('Could not load ' + new URL(src).hostname + '. Check your connection or ad blocker.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }
  const siteUrl = () => location.origin + location.pathname;

  let client = null, session = null, profile = null, recovery = false, providersP = null;
  const state = { user: null };

  /* ---------- local mode (browser-only accounts, as before) ---------- */
  const hashPw = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const local = {
    init() { const u = ls.get('user', null); state.user = u ? { id: u.email, name: u.name, email: u.email } : null; },
    async signIn(email, pw) {
      const a = ls.get('accounts', {})[email];
      if (!a || a.pw !== hashPw(pw)) return { error: 'Invalid email or password.' };
      ls.set('user', { name: a.name, email }); local.init(); emit(); return {};
    },
    async signUp(name, email, pw) {
      const accounts = ls.get('accounts', {});
      if (accounts[email]) return { error: 'An account with this email already exists.' };
      accounts[email] = { name, pw: hashPw(pw) };
      ls.set('accounts', accounts);
      return local.signIn(email, pw);
    },
    async signOut() { ls.set('user', null); state.user = null; emit(); }
  };

  /* ---------- cloud mode (Supabase) ---------- */
  function setSession(s) {
    session = s;
    const u = s && s.user;
    state.user = u ? { id: u.id, email: u.email, name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || '').split('@')[0] } : null;
  }
  async function loadProfile() {
    if (!client || !state.user) { profile = null; return null; }
    const { data } = await client.from('profiles').select('plan, pro_until, full_name, email_alerts, telegram_chat_id, whatsapp_number, whatsapp_opt_in').eq('id', state.user.id).maybeSingle();
    profile = data || { plan: 'free', pro_until: null };
    if (profile.full_name) state.user.name = profile.full_name;
    return profile;
  }
  async function initCloud() {
    await loadScript(SUPABASE_JS);
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
    });
    client.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      const before = state.user && state.user.id;
      setSession(s);
      if ((state.user && state.user.id) !== before || event === 'USER_UPDATED') {
        // outside the callback: Supabase warns against awaiting its own calls inside it
        setTimeout(() => loadProfile().then(emit, emit));
        if (state.user) setTimeout(() => welcomeOnce(state.user.id), 1500);
      } else emit();
    });
    const { data } = await client.auth.getSession();
    setSession(data.session);
    await loadProfile().catch(() => null);
    // drop ?code=... left by the email-link / Google sign-in redirect
    if (/[?&](code|error)=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  }
  // the welcome email (three first steps) goes out on a new user's first sign-in; the server sends
  // it at most once, this only saves asking again from the same browser
  function welcomeOnce(uid) {
    try {
      const k = 'sankhyas_welcomed_' + uid;
      if (localStorage.getItem(k)) return;
      callFunction('welcome-email', {}).then(r => { if (r && (r.sent != null || r.pending === 0)) localStorage.setItem(k, '1'); }, () => {});
    } catch (e) { /* storage blocked: the data update's sweep still sends it */ }
  }

  async function callFunction(name, body) {
    const { data } = await client.auth.getSession();
    if (!data.session) throw Object.assign(new Error('Please log in first.'), { code: 'login' });
    const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token, apikey: cfg.supabaseAnonKey },
      body: JSON.stringify(body || {})
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('Server error ' + res.status));
    return j;
  }
  const friendly = e => {
    const m = (e && e.message) || String(e || '');
    if (/invalid login/i.test(m)) return 'Invalid email or password.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first: open the link we sent you.';
    if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Try logging in.';
    if (/password should be|weak/i.test(m)) return 'Please choose a stronger password (at least 8 characters).';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    return m || 'Something went wrong. Please try again.';
  };

  const ready = (cloud ? initCloud() : Promise.resolve(local.init())).catch(e => {
    console.error('Account service unavailable:', e);
    Account.error = friendly(e);
  });

  const trackLast = { key: '', at: 0 };
  const Account = {
    cloud, ready, PLANS, error: null,
    config: cfg,
    user: () => state.user,
    profile: () => profile,
    proUntil: () => (profile && profile.pro_until ? new Date(profile.pro_until) : null),
    isPro() {
      if (!cloud || cfg.proFreeDuringBeta) return true;
      return !!(profile && profile.plan === 'pro' && profile.pro_until && new Date(profile.pro_until) > new Date());
    },
    paymentsEnabled: () => cloud && !!client,
    inRecovery: () => recovery,
    onChange(fn) { listeners.push(fn); },

    async signIn(email, password) {
      if (!cloud) return local.signIn(email, password);
      if (!client) return { error: Account.error || 'Login is unavailable right now.' };
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? { error: friendly(error) } : {};
    },
    async signUp(name, email, password) {
      if (!cloud) return local.signUp(name, email, password);
      if (!client) return { error: Account.error || 'Sign-up is unavailable right now.' };
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: siteUrl() } });
      if (error) return { error: friendly(error) };
      return { needsConfirm: !data.session };
    },
    /** Social logins switched on in the Supabase dashboard, e.g. { google: true, github: false }. */
    providers() {
      if (!cloud) return Promise.resolve({});
      if (!providersP) {
        providersP = fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey } })
          .then(r => (r.ok ? r.json() : {})).then(j => j.external || {}).catch(() => ({}));
      }
      return providersP;
    },
    async oauth(provider) {
      if (!client) return { error: 'This login is unavailable right now.' };
      const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: siteUrl(), scopes: provider === 'azure' ? 'email' : undefined } });
      return error ? { error: friendly(error) } : {};
    },
    google() { return Account.oauth('google'); },
    /** Passwordless: email a one-time sign-in link (creates the account on first use). */
    async magicLink(email) {
      if (!client) return { error: 'Email login is unavailable right now.' };
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: siteUrl() } });
      return error ? { error: friendly(error) } : {};
    },
    async resetPassword(email) {
      if (!client) return { error: 'Password reset is unavailable right now.' };
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
      return error ? { error: friendly(error) } : {};
    },
    async setPassword(password) {
      if (!client) return { error: 'Unavailable right now.' };
      const { error } = await client.auth.updateUser({ password });
      if (!error) recovery = false;
      return error ? { error: friendly(error) } : {};
    },
    async signOut() {
      if (!cloud) return local.signOut();
      if (client) await client.auth.signOut();
      setSession(null); profile = null; emit();
    },
    async refresh() { if (cloud) { await loadProfile(); emit(); } },
    async updateProfile(fields) {
      if (!client || !state.user) return { error: 'Please log in first.' };
      const { error } = await client.from('profiles').update(fields).eq('id', state.user.id);
      if (!error) await loadProfile();
      return error ? { error: friendly(error) } : {};
    },

    /* ---------- sync across devices: one JSON value per key in public.user_data ---------- */
    canSync: () => cloud && !!client && !!state.user,
    async pullData() {
      if (!Account.canSync()) return null;
      const { data, error } = await client.from('user_data').select('key, value, updated_at');
      if (error) throw error;
      const out = {};
      (data || []).forEach(r => { out[r.key] = { value: r.value, at: r.updated_at }; });
      return out;
    },
    async pushData(key, value) {
      if (!Account.canSync()) return;
      const { error } = await client.from('user_data').upsert({ user_id: state.user.id, key, value, updated_at: new Date().toISOString() });
      if (error) throw error;
    },

    /* ---------- alerts (rules in public.alerts, delivered by the dispatch-alerts function) ---------- */
    alerts: {
      async list() {
        if (!client || !state.user) return [];
        const { data } = await client.from('alerts').select('*').order('created_at', { ascending: false });
        return data || [];
      },
      async add(rule) {
        if (!client || !state.user) return { error: 'Please log in first.' };
        const { error } = await client.from('alerts').insert(Object.assign({ user_id: state.user.id }, rule));
        return error ? { error: friendly(error) } : {};
      },
      async update(id, fields) {
        const { error } = await client.from('alerts').update(fields).eq('id', id);
        return error ? { error: friendly(error) } : {};
      },
      async remove(id) {
        const { error } = await client.from('alerts').delete().eq('id', id);
        return error ? { error: friendly(error) } : {};
      },
      async log() {
        if (!client || !state.user) return [];
        const { data } = await client.from('alert_log').select('message, channels, sent_at').order('sent_at', { ascending: false }).limit(30);
        return data || [];
      },
      async telegramLink() {
        const { data, error } = await client.rpc('create_telegram_link');
        return error ? { error: friendly(error) } : { token: data };
      },
      async unlinkTelegram() {
        const { error } = await client.rpc('unlink_telegram');
        if (!error) await loadProfile();
        return error ? { error: friendly(error) } : {};
      }
    },
    /* Visit counting for the owners' dashboard: one row per page, an anonymous visitor id kept in
       this browser (no IP address, no cookie). Skipped when the browser asks not to be tracked. */
    trackView(path, symbol) {
      Account.ready.then(() => {
        try {
          // only the real site counts (not previews or local copies)
          if (!client || !/(^|\.)sankhyas\.com$/.test(location.hostname) || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
          const rnd = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 36);
          let vid = localStorage.getItem('sankhyas_vid');
          if (!vid) { vid = rnd(); localStorage.setItem('sankhyas_vid', vid); }
          let sid = sessionStorage.getItem('sankhyas_sid');
          const first = !sid;
          if (!sid) { sid = rnd(); sessionStorage.setItem('sankhyas_sid', sid); }
          const key = path + '|' + (symbol || '');
          if (key === trackLast.key && Date.now() - trackLast.at < 15000) return;
          trackLast.key = key; trackLast.at = Date.now();
          let ref = null;
          if (first && document.referrer) { try { const h = new URL(document.referrer).host; if (h && h !== location.host) ref = h.slice(0, 120); } catch (e) { /* ignore */ } }
          const w = window.innerWidth;
          client.from('page_views').insert({
            visitor: vid, session: sid, path: String(path).slice(0, 120), symbol: symbol ? String(symbol).slice(0, 30) : null, ref,
            device: w < 700 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop',
            app: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
            user_id: state.user && cloud ? state.user.id : null
          }).then(() => {}, () => {});
        } catch (e) { /* private mode or storage blocked: not counted */ }
      });
    },
    async isAdmin() {
      if (!client || !state.user) return false;
      const { data } = await client.rpc('is_admin');
      return data === true;
    },
    async adminStats(days) {
      if (!client || !state.user) throw new Error('Please log in first.');
      const { data, error } = await client.rpc('admin_stats', { days });
      if (error) throw new Error(error.message === 'not allowed' ? 'This page is only for the Sankhyas team.' : friendly(error));
      return data;
    },
    async payments() {
      if (!client || !state.user) return [];
      const { data } = await client.from('payments').select('order_id, payment_id, plan, amount, status, created_at, paid_at').order('created_at', { ascending: false }).limit(50);
      return data || [];
    },

    /* Buy Pro: create the order on the server, open Razorpay Checkout, verify the payment. */
    async checkout(plan, hooks) {
      hooks = hooks || {};
      if (!cloud || !client) throw new Error('Payments are not switched on yet.');
      if (!state.user) throw Object.assign(new Error('Please log in first.'), { code: 'login' });
      const [order] = await Promise.all([callFunction('create-order', { plan }), loadScript(RAZORPAY_JS)]);
      return new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: order.key_id || cfg.razorpayKeyId,
          order_id: order.order_id,
          amount: order.amount,
          currency: order.currency || 'INR',
          name: (cfg.business && cfg.business.name) || 'Sankhyas',
          description: order.description || 'Sankhyas Pro',
          image: new URL('assets/logo-192.png', siteUrl()).href,
          prefill: { name: state.user.name || '', email: state.user.email || '' },
          notes: { plan },
          theme: { color: '#6056ff' },
          handler: async resp => {
            if (hooks.onVerifying) hooks.onVerifying();
            try {
              const v = await callFunction('verify-payment', resp);
              await loadProfile(); emit();
              resolve(v);
            } catch (e) {
              // the webhook still activates Pro if the browser check fails
              reject(Object.assign(new Error('Payment received, but we could not confirm it yet. Pro will switch on within a few minutes; refresh this page. Payment ID: ' + resp.razorpay_payment_id), { code: 'verify' }));
            }
          },
          modal: { ondismiss: () => reject(Object.assign(new Error('Payment cancelled.'), { code: 'dismissed' })) }
        });
        rz.on('payment.failed', r => { if (hooks.onFailed) hooks.onFailed((r && r.error && r.error.description) || 'Payment failed. You can try again.'); });
        rz.open();
      });
    }
  };
  window.Account = Account;
})();
