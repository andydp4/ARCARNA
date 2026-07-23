/*
 * Viger Cloud portal — Clerk configuration.
 *
 * ONE login across everything. The portal uses the SAME Clerk application as
 * Arcarna (the app that owns viger.cloud as its primary Clerk domain). Clerk
 * shares that session across viger.cloud and every *.viger.cloud subdomain
 * (portal home, arcarna., mail., vault., ...), so a user signs in once and is
 * recognised everywhere.
 *
 * Set this to the ARCARNA app's *publishable* key — the same value as the
 * Arcarna deployment's VITE_CLERK_PUBLISHABLE_KEY (Clerk Dashboard -> the
 * Arcarna application -> API Keys -> Publishable key). Use the production
 * key (pk_live_...) so the shared session works on the real subdomains.
 *
 * Do NOT use a separate Clerk app's key here — that would create a second,
 * independent login instead of the shared one.
 *
 * The publishable key is NOT a secret; it is safe to expose and commit.
 * NEVER put a secret key (sk_...) in this file.
 *
 * The portal stays locked until this is a real key.
 */
window.__VIGER_CLERK_PUBLISHABLE_KEY__ = "pk_live_Y2xlcmsudmlnZXIuY2xvdWQk";
