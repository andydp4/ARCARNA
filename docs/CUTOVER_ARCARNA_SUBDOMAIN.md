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

## 9. Viger portal — the shop window at viger.cloud  (≈10 min)
With Arcarna on its own subdomain, **viger.cloud** becomes a standalone launcher that links out
to each app. It is now **decoupled** from the Arcarna app:
- The Arcarna Node app no longer serves the portal in subdomain mode (handled in code).
- nginx serves the static portal files directly — no Node, no build step.

The portal lives in the repo at `portal/` (`index.html` + `portal-assets/`). Set up nginx:
```bash
sudo cp /root/ARCARNA/deploy/nginx-viger.cloud.conf.example \
        /etc/nginx/sites-available/viger.cloud
sudo ln -s /etc/nginx/sites-available/viger.cloud /etc/nginx/sites-enabled/   # if not already linked
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d viger.cloud -d www.viger.cloud
```
That config serves `/root/ARCARNA/portal` at the root and 301-redirects old
Arcarna URLs to the subdomain while preserving deep links and query strings:
`viger.cloud/arcarna/pos` and `viger.cloud/midnight/pos` → `https://arcarna.viger.cloud/pos`.
It also sends old root-level app bookmarks such as `viger.cloud/pos` to the same route on
`https://arcarna.viger.cloud`.

**The shop window** lists every app with its colour and target subdomain:
| App | Colour | Subdomain | Status |
|-----|--------|-----------|--------|
| Arcarna | Truth Blue | arcarna.viger.cloud | **Live** |
| Vault (backups) | Stone Grey | vault.viger.cloud | Coming soon |
| Sanctum (files) | Deep Purple | sanctum.viger.cloud | Coming soon |
| Email Assistant | Teal Blue | email.viger.cloud | Coming soon |
| Receipt Maker | Rainforest Green | receipts.viger.cloud | Coming soon |
| Invoice Generator | Lava Orange | invoice.viger.cloud | Coming soon |
| Finance Hub | Navy Blue | finance.viger.cloud | Coming soon |

**To take a new app live:** in `portal/index.html`, change that tile's
`<div class="card card-soon" …>` to `<a class="card" href="https://SUBDOMAIN/">`, swap the
"Coming soon" tag for "Live", commit, `git pull` on the VPS. (No rebuild — it's static.)

> ⚠️ Confirm the subdomains: you wrote `invoice.arcarna.cloud` once — I used
> `invoice.viger.cloud` for consistency with the others. Change the table + `portal/index.html`
> hrefs if you want a different domain.

---

## Optional — send the old URLs to the new one
If anyone bookmarked the old path, add redirects in the **viger.cloud** nginx block
(`deploy/nginx-viger.cloud.conf.example`): `/arcarna/*`, `/midnight/*`, and root-level
app routes such as `/pos` → the matching route on `https://arcarna.viger.cloud/`.
(Commented example at the bottom of `deploy/nginx-arcarna.viger.cloud.conf.example`.)

## Follow-ups
- ✅ `docs/DEPLOY_HOSTINGER_VPS.md` updated to the subdomain (URLs, env table, health checks).
- ✅ e2e / a11y / visual tests updated to the root model (`playwright.config.ts`,
  `tests/e2e/smoke.spec.ts`, `tests/a11y/critical-paths.spec.ts`, `tests/visual/pos-tablet.spec.ts`,
  `tests/helpers/e2eTenant.ts`). The `/midnight`→`/arcarna` smoke assertion was removed — at root
  the app doesn't register that redirect (it's handled at nginx on the old domain).
- ⏳ **Your action:** point UptimeRobot / any monitor at `https://arcarna.viger.cloud/api/health`.
