/* Sankhyas site settings. All values here are public (safe to ship to the browser).
 * Leave supabaseUrl empty to run without real accounts: logins then stay in the visitor's
 * browser and every Pro feature is free. On GitHub Pages the deploy workflow fills these
 * in from the repository variables SUPABASE_URL, SUPABASE_ANON_KEY and RAZORPAY_KEY_ID. */
window.SANKHYAS_CONFIG = {
  supabaseUrl: 'https://kbtbhzjotoxayrkivwzx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtidGJoempvdG94YXlya2l2d3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0ODMyNDgsImV4cCI6MjEwNjA1OTI0OH0.oj88ESizlLqV_JLTpPdo3Evx0lNrZPajkQoQFi_PKnQ',
  razorpayKeyId: '',        // rzp_live_... (or rzp_test_... while testing)
  proFreeDuringBeta: true,  // true = Pro features stay free for everyone even with payments on
  telegramBot: '',          // Telegram bot username for alerts (without @), e.g. SankhyasAlertsBot
  whatsappAlerts: false,    // true once WhatsApp Cloud API credentials are set on the alerts function
  business: {               // shown on the Contact, Terms, Privacy and Refund pages (Razorpay requires these)
    name: 'Sankhyas',
    email: 'connect@sankhyas.com',
    phone: '',
    address: '',
    instagram: 'sankhyas.co'   // Instagram handle
  }
};
