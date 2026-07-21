/*
 * Viger Cloud portal — Clerk configuration.
 *
 * Set this to your Clerk *publishable* key (starts with `pk_live_` in
 * production or `pk_test_` for testing). This is the SAME key the Arcarna app
 * uses (Clerk Dashboard -> API Keys -> Publishable key, i.e. the value in
 * VITE_CLERK_PUBLISHABLE_KEY). Using the same key means a session created here
 * is shared with arcarna.viger.cloud automatically (same Clerk app, and
 * viger.cloud is the primary domain).
 *
 * The publishable key is NOT a secret — it is safe to expose in the browser
 * and to commit. NEVER put the secret key (sk_live_...) in this file.
 *
 * The portal stays locked (grid hidden) until this is a real key.
 */
window.__VIGER_CLERK_PUBLISHABLE_KEY__ = "pk_live_CHANGE_ME";
