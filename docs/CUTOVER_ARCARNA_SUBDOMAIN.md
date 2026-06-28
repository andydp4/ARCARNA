# Cutover to arcarna.viger.cloud — plain-English checklist

Goal: serve the app at **https://arcarna.viger.cloud/** (its own subdomain, at the root —
no `/arcarna` in the URL). No one is using the app yet, so this is a clean switch.

**What's already done in the code** (you don't need to touch this):
- The app supports running at the site root.
- PWA `manifest.json` updated to root paths.
- `.env.production.example` updated to the subdomain values.
- An nginx example added: `deploy/nginx-arcarna.viger.cloud.conf.example`.

You do the steps below (in order). Each says *where* to go and *what* to type/click.
None require writing code.

---

## 1. DNS — point the subdomain at the server  (≈5 min, then wait)
Where: your DNS provider for **viger.cloud** (e.g. Cloudflare / registrar dashboard).

- Add a record:
  - **Type:** `A`  ·  **Name:** `arcarna`  ·  **Value:** your VPS IP address.
  - (If you also use IPv6, add an `AAAA` record the same way.)
  - If Cloudflare: set the proxy to **DNS only (grey cloud)** first; you can turn the orange
    cloud back on after TLS works.
- Save. DNS can take a few minutes to an hour to propagate.

## 2. Server `.env` — set the web address  (≈2 min)
Where: on the VPS, the file `/root/ARCARNA/.env`.

Change these three lines to:
```
VITE_APP_URL=https://arcarna.viger.cloud
VITE_BASE_PATH=/
APP_BASE_PATH=/
```
Leave everything else (database, Clerk keys, etc.) as-is. Save the file.

## 3. Nginx — route the subdomain to the app + add HTTPS  (≈10 min)
Where: on the VPS, terminal. A ready-made config is in the repo.

```bash
sudo cp /root/ARCARNA/deploy/nginx-arcarna.viger.cloud.conf.example \
        /etc/nginx/sites-available/arcarna.viger.cloud
sudo ln -s /etc/nginx/sites-available/arcarna.viger.cloud /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d arcarna.viger.cloud      # gets the HTTPS certificate
```
(`certbot` will ask a couple of yes/no questions; choose to redirect HTTP→HTTPS.)

## 4. Clerk (login) — allow the new address  (≈5 min)
Where: https://dashboard.clerk.com → your ARCARNA application.

- **Domains / Allowed origins:** add `https://arcarna.viger.cloud`.
- **Paths** (sign-in / after sign-in / after sign-up / home): set the base to
  `https://arcarna.viger.cloud/`.
- The keys in `.env` (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `VITE_CLERK_PUBLISHABLE_KEY`) **stay the same** — only the URLs change.
- (Account portal `accounts.viger.cloud` can stay as-is; only update it if you want a
  matching `accounts.arcarna.viger.cloud`.)

## 5. Neon (database) — nothing to change  ✅
The database doesn't care about the web address. Just make sure `DATABASE_URL` in `.env`
is set to your Neon **pooled** connection string (`...-pooler...neon.tech`). No action needed
for the move.

## 6. Sentry (error reporting) — optional, no change needed  ✅
The domain move doesn't require Sentry changes.
- If you *want* error reporting on, ensure `.env` has `VITE_SENTRY_DSN` (browser) and/or
  `SENTRY_DSN` (server). If they're unset, Sentry is simply off — that's fine.
- Optional: in the Sentry project settings you can add `arcarna.viger.cloud` to allowed
  domains, but it's not required for basic reporting.

## 7. Build & start the app  (≈3 min)
Where: on the VPS, terminal.

```bash
cd /root/ARCARNA
git pull origin main
unset NODE_ENV                 # so the build can use dev tools
npm ci --include=dev
npm run build                  # bakes VITE_BASE_PATH=/ into the build
pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save
```
> Note: `npm run build` must see `VITE_BASE_PATH=/` from your `.env`. If your current deploy
> already builds with the right base path, this works the same way.

## 8. Check it worked  ✅
```bash
curl -sS https://arcarna.viger.cloud/api/health      # expect: {"ok":true}
```
Then open **https://arcarna.viger.cloud/** in a browser and sign in.

---

## Optional — send the old URLs to the new one
If anyone bookmarked the old path, add redirects in the **viger.cloud** nginx block
(`deploy/nginx-viger.cloud.conf.example`): `/arcarna/` and `/midnight/` → `https://arcarna.viger.cloud/`.
(Commented example at the bottom of `deploy/nginx-arcarna.viger.cloud.conf.example`.)

## Follow-ups (not blocking — for whoever picks this up)
- Update `docs/DEPLOY_HOSTINGER_VPS.md` health-check URLs from `…/arcarna/api/health` to
  `https://arcarna.viger.cloud/api/health`.
- The e2e/smoke tests (`tests/e2e/smoke.spec.ts`, `playwright.config.ts`) still assume the
  old path-based setup; update them to the subdomain when convenient (they don't affect the build).
- UptimeRobot / monitors → point at `https://arcarna.viger.cloud/api/health`.
