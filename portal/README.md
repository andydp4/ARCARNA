# Viger Cloud portal (viger.cloud)

Standalone static "shop window" served at the `viger.cloud` root (no Node app —
see `deploy/nginx-viger.cloud.conf.example`). It is gated by Clerk: the sign-in
card is the first thing a visitor sees, and the app grid is revealed only after
they sign in.

## How the auth gate works

- `portal-assets/clerk-config.js` — set the portal's Clerk **publishable** key.
- `portal-assets/auth-gate.js` — loads Clerk (browser SDK, from your Clerk
  Frontend API host), shows the sign-in card, and reveals the page once a
  session exists.
- Every page starts with `<body class="gate-locked">`, so there is no flash of
  the grid before auth resolves.

The portal uses the **same Clerk application as Arcarna** (the app that owns
`viger.cloud` as its primary Clerk domain). Clerk shares that session across
`viger.cloud` and every `*.viger.cloud` subdomain, so a user signs in **once**
and is recognised on the portal, `arcarna.`, `mail.`, `vault.`, etc.

This is a **UX gate for the launcher, not a security boundary** — real access
control is enforced server-side on each app subdomain. Do not put secrets in the
static portal.

### Configure the key

Edit `portal-assets/clerk-config.js` and set the **Arcarna** Clerk application's
publishable key — the same value as the Arcarna deployment's
`VITE_CLERK_PUBLISHABLE_KEY` (Clerk Dashboard → the Arcarna application → API
Keys → Publishable key). Use the production key so the shared session works on
the real subdomains:

```js
window.__VIGER_CLERK_PUBLISHABLE_KEY__ = "pk_live_xxxxxxxxxxxxxxxxxxxx";
```

**Do not** use a separate Clerk app's key — that would create a second,
independent login instead of the shared one. The publishable key is public and
safe to commit. **Never** put the secret key (`sk_live_...`) here. Until a real
key is set, the portal stays locked and shows a "not configured" message.

Make sure `https://viger.cloud/` and `https://www.viger.cloud/` are allowed
origins in the Arcarna Clerk application (its primary domain is `viger.cloud`,
so subdomains are already covered).

### Per-user access (which tiles a user sees)

Each app tile has a `data-app` key (`arcarna`, `vault`, `sanctum`, `mail`,
`receipts`, `invoice`, `finance`). After sign-in the portal reads the user's
Clerk `publicMetadata` and shows only the tiles they are allowed:

- `publicMetadata.apps` — array of allowed app keys, e.g. `["arcarna","mail"]`.
  Only those tiles are shown.
- `publicMetadata.role === "SUPER_ADMIN"` (or `superAdmin: true`) — sees every
  tile.
- No `apps` array set → **all** tiles shown (access control is opt-in, so it
  never accidentally hides everything).

Set this per user in the Clerk Dashboard (Users → a user → Metadata → Public),
or from an Arcarna admin screen via the Clerk API later. This is a **UX filter**
— each app must still enforce access in its own backend (Arcarna already does
this via `allowed_users` + roles; see `RBAC.md`).

To make a **new** subdomain app (Mail, Vault, …) join this shared login and
enforce the same access rules, hand its developer/agent
`docs/VIGER_SSO_INTEGRATION.md` — copy-paste env + middleware snippets.

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
