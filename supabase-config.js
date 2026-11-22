
/*
 * SIFA Global Institute — Supabase configuration
 * Browser-safe publishable key only.
 * NEVER put a secret/service_role key here.
 */

(function () {
  "use strict";

  window.SIFA_SUPABASE_CONFIG = {
    url: "https://pdzspvwhkxdmuynvpjsy.supabase.co",
    anonKey: "sb_publishable_BDKUviKyHZl10Yf07jInLw_NSbw_moh"
  };

  
  // SIFA browser authentication settings.
  // Keep sessions across pages in the same tab,
  // but do not use persistent localStorage.
  window.SIFA_AUTH_OPTIONS = {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  };
window.SIFA_SETTINGS = {
    // Admissions are currently closed.
    // Reopen a program only when SIFA is ready to accept applications.
    applicationsOpen: false,
    openPrograms: [],
    supportEmail: "sifaglobalinstitute12@gmail.com"
  };
})();
