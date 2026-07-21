/*
 * Viger Cloud portal — Clerk configuration.
 *
 * The portal has its OWN, SEPARATE Clerk application from Arcarna. Signing in
 * to viger.cloud is independent of arcarna.viger.cloud — different Clerk apps
 * issue different sessions, so the two never share a login.
 *
 * Use the publishable key of the PORTAL's Clerk app
 * (app_3GLEBLVvvcv8m5KJxFuEfsZy6PP) — Clerk Dashboard -> that application ->
 * API Keys -> Publishable key. It starts with `pk_live_` (production) or
 * `pk_test_`.
 *
 * DO NOT use the Arcarna app's key here — that would merge the two logins.
 *
 * The publishable key is NOT a secret; it is safe to expose and commit.
 * NEVER put a secret key (sk_...) in this file.
 *
 * The portal stays locked (grid hidden) until this is a real key.
 */
window.__VIGER_CLERK_PUBLISHABLE_KEY__ = "pk_live_CHANGE_ME";
