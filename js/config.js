/* Sankhyas site settings. All values here are public (safe to ship to the browser).
 * Leave supabaseUrl empty to run without real accounts: logins then stay in the visitor's
 * browser and every Pro feature is free. On GitHub Pages the deploy workflow fills these
 * in from the repository variables SUPABASE_URL, SUPABASE_ANON_KEY and RAZORPAY_KEY_ID. */
window.SANKHYAS_CONFIG = {
  supabaseUrl: '',          // https://<project>.supabase.co
  supabaseAnonKey: '',      // Supabase "anon public" key
  razorpayKeyId: '',        // rzp_live_... (or rzp_test_... while testing)
  proFreeDuringBeta: false, // true = Pro features stay free for everyone even with payments on
  business: {               // shown on the Contact, Terms, Privacy and Refund pages (Razorpay requires these)
    name: 'Sankhyas',
    email: '',
    phone: '',
    address: ''
  }
};
