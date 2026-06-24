# Migrating ARCARNA to arcarna.viger.cloud

Moves the EPOS app off the path-mounted `https://viger.cloud/arcarna` URL
onto its own subdomain, `https://arcarna.viger.cloud`, served at root (`/`).

Runs as a **second** PM2 process (`arcarna-epos-sub`) on its own port,
alongside the existing process — the old URL keeps working untouched until
you explicitly retire it in Phase 3. Both processes share one checkout, one
database, one set of secrets.

## Why a second process, not an in-place switch

The current process serves the **portal** (static landing page) at `/` and
mounts the EPOS app at `/arcarna`. Flipping `APP_BASE_PATH` to root on that
same process would make the EPOS app's own root route collide with the
portal's — the portal would win and the SPA would never load. A second
process, root-mounted from the start with no portal, avoids that and keeps
the existing deployment as a safety net during cutover.

## Prerequisites (already true in this repo)

- `server/index.ts` only registers the portal when `APP_BASE_PATH` is set —
  a root-mounted process skips it.
- `vite.config.ts` / `server/static.ts` honor `DIST_PUBLIC_DIR`, so the two
  processes' client builds (one based at `/arcarna/`, one at `/`) live in
  separate output folders instead of overwriting each other.
- `client/src/lib/authConfig.ts`'s `usesClerkSatelliteDomain()` already
  treats any `*.viger.cloud` host as the same registrable domain as
  `accounts.viger.cloud` — Clerk sessions share across the new subdomain
  automatically. **No Clerk satellite-domain dashboard config needed.**

## Phase 0 — DNS + Cloudflare

1. Add an `arcarna` DNS record (A or CNAME, proxied through Cloudflare same
   as `viger.cloud`) pointing at the VPS IP.
2. If using Cloudflare Origin CA certs (see `docs/ops/CLOUDFLARE.md`),
   reissue/extend the origin cert to cover `arcarna.viger.cloud`, or issue a
   new one for it.

## Phase 1 — Build and run the subdomain process

On the VPS, in the existing checkout (e.g. `/root/ARCARNA`):

```bash
cd /root/ARCARNA
cp .env.arcarna-subdomain.example .env.arcarna-subdomain
# Edit .env.arcarna-subdomain: fill in DATABASE_URL, SESSION_SECRET, Clerk
# keys, etc. — same values as the existing .env (same DB, same Clerk app).

# Build a second, root-mounted client bundle (doesn't touch dist/public):
DIST_PUBLIC_DIR=dist/public-arcarna VITE_BASE_PATH=/ npx vite build

# Server bundle and portal build are shared (not base-path-sensitive) —
# only rebuild them if they're missing or stale:
npm run build:portal
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Start the second PM2 process (defined automatically once .env.arcarna-subdomain exists):
pm2 start ecosystem.config.cjs --only arcarna-epos-sub
pm2 save
```

Add the nginx vhost:

```bash
cp deploy/nginx-arcarna.viger.cloud.conf.example /etc/nginx/sites-available/arcarna.viger.cloud
ln -s /etc/nginx/sites-available/arcarna.viger.cloud /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d arcarna.viger.cloud   # HTTPS + HSTS
```

## Phase 2 — Verify before telling anyone

```bash
curl -sI http://127.0.0.1:5001/api/health          # process is up
curl -sI https://arcarna.viger.cloud/api/health     # nginx + DNS + TLS wired up
```

In a browser, on `arcarna.viger.cloud`:
- App loads at `/` (not redirected to `/arcarna`), service worker registers
  at root scope, PWA install prompt offers the right icon/name.
- Sign-in works and lands back on `arcarna.viger.cloud` (not `viger.cloud`).
- Place a test order, confirm it's the same data as the path-mounted app
  (same DB) — both URLs should show it.

In the **Clerk dashboard**, add `https://arcarna.viger.cloud` to the
application's allowed origins/redirect URLs (the existing
`https://viger.cloud/arcarna` entry can stay for now).

## Phase 3 — Retire the old path (once verified)

This is a deliberate, separate step — don't do it until Phase 2 has been
running clean for a while:

1. In `nginx-viger.cloud.conf`, replace the `/arcarna` proxy `location`
   block with the redirect snippet at the bottom of
   `deploy/nginx-arcarna.viger.cloud.conf.example` (301s old links to the
   new subdomain).
2. Remove `https://viger.cloud/arcarna` from the Clerk dashboard's allowed
   origins.
3. Optionally stop bothering to rebuild/redeploy the `dist/public`
   (path-mounted) bundle going forward — `arcarna-epos-sub` is now the only
   one serving real traffic. The original `arcarna-epos` process keeps
   running just to own the redirect + the portal at `viger.cloud/`.

## Rollback

Nothing about Phase 0–2 touches the existing process or its nginx config —
stop `arcarna-epos-sub` and remove its nginx vhost to fully back out with
zero impact on `viger.cloud/arcarna`. Phase 3 is the only step that isn't
instantly reversible (a DNS/nginx revert plus re-adding the Clerk origin
gets you back, but isn't a one-command undo) — that's why it's gated behind
Phase 2 working cleanly first.
