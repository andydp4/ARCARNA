# Viger Cloud portal (viger.cloud)

Standalone static "shop window" served at the `viger.cloud` root (no Node app —
see `deploy/nginx-viger.cloud.conf.example`). It is gated by Clerk: the sign-in
card is the first thing a visitor sees, and the app grid is revealed only after
they sign in.

## How the auth gate works

- `portal-assets/clerk-config.js` — set your Clerk **publishable** key here.
- `portal-assets/auth-gate.js` — loads Clerk (browser SDK, from your Clerk
  Frontend API host), shows the sign-in card, and reveals the page once a
  session exists. Sessions are shared with `arcarna.viger.cloud` automatically
  (same Clerk app; `viger.cloud` is the primary Clerk domain).
- Every page starts with `<body class="gate-locked">`, so there is no flash of
  the grid before auth resolves.

This is a **UX gate for the launcher, not a security boundary** — real access
control is enforced server-side on each app subdomain. Do not put secrets in the
static portal.

### Configure the key

Edit `portal-assets/clerk-config.js` and set the **same** publishable key the
Arcarna app uses (Clerk Dashboard → API Keys → Publishable key, i.e.
`VITE_CLERK_PUBLISHABLE_KEY`):

```js
window.__VIGER_CLERK_PUBLISHABLE_KEY__ = "pk_live_xxxxxxxxxxxxxxxxxxxx";
```

The publishable key is public and safe to commit. **Never** put the secret key
(`sk_live_...`) here. Until a real key is set, the portal stays locked and shows
a "not configured" message.

In the Clerk Dashboard, make sure `https://viger.cloud/` and
`https://www.viger.cloud/` are allowed redirect origins.

## Branding assets

Drop these image files into `portal-assets/` (PNG with transparent background).
The portal references them by these exact names and falls back gracefully if a
file is missing:

| File | Used for | Notes |
|------|----------|-------|
| `viger-v-mark.png` | Favicon + gate icon fallback | The gradient **V** mark (square) |
| `viger-cloud-wordmark.png` | Sign-in card + home hero | The **Viger Cloud** wordmark; falls back to the V mark, then to `arcarna-wordmark.png` |

Per-tile app logos can be added later — the current cards use a coloured accent
bar + text and do not require an image.

## Deploy

The portal is static files. After a `git pull` that changes anything under
`portal/`, re-copy to the web root (see the nginx example):

```bash
sudo cp -r /root/ARCARNA/portal/* /var/www/viger.cloud/
sudo chmod -R a+rX /var/www/viger.cloud
```
