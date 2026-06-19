# VPS migration: Hostinger KVM2 → KVM4 (ARCARNA)

**Status:** Phase R merged — repo ready. **Next:** Phase 0 inventory on KVM2, then build KVM4 (`72.60.23.130` / `Live.Viger.Cloud`).

**Related:** [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) · [REBRAND_ARCARNA.md](../REBRAND_ARCARNA.md) · [ops/CLOUDFLARE.md](./CLOUDFLARE.md) · [ops/OPERATOR_CHECKLIST.md](./OPERATOR_CHECKLIST.md) · [DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) · [SECRET_ROTATION_RUNBOOK.md](../SECRET_ROTATION_RUNBOOK.md)

> To continue this work in a fresh chat session, just point it at this file — it's self-contained. No SSH access is available to the assistant; all VPS commands are run by the operator.

---

## Naming after the ARCARNA rebrand — read this first

The rebrand (PR #42) was **user-facing only by design**. This migration opts into the *infra* rename too, so the new box uses ARCARNA names everywhere. What's what:

| Thing | Old (KVM2 today) | New (KVM4) | Where it's set |
|---|---|---|---|
| Git repo | — | `github.com/andydp4/ARCARNA.git` | already renamed (remote) |
| Deploy dir | `/root/MidnightEPOS` | **`/root/ARCARNA`** | this migration |
| PM2 process | `midnight-epos` | **`arcarna-epos`** | `ecosystem.config.cjs` (Phase R) |
| URL mount / health | `/arcarna/api/health` | `/arcarna/api/health` | already live (`/midnight`→301) |
| Backup log | `/var/log/midnight-backup.log` | **`/var/log/arcarna-backup.log`** | `scripts/cron.example` (Phase R) |
| R2 bucket | `midnight-backups` | `midnight-backups` (**unchanged** — renaming a bucket = moving objects, out of scope) | `.env` `R2_BUCKET` |
| Domain | `viger.cloud` | `viger.cloud` (unchanged) | Cloudflare |

**Decisions locked in for this run:** deploy dir `/root/ARCARNA`; PM2 `arcarna-epos`; TLS = **Cloudflare Origin CA**; soak 48–72h before decommission.

---

## Why this is lower risk than a typical VPS move

The VPS holds almost no state:

- **Database** = Neon (external cloud Postgres) — not on the VPS, nothing to migrate
- **Sessions** = `connect-pg-simple` (Postgres-backed) — external
- **Auth** = Clerk (`accounts.viger.cloud`, `clerk.viger.cloud` are CNAMEs to Clerk's infra, not the VPS) — unaffected by VPS IP change
- **Backups** = Cloudflare R2 — external
- **File uploads/local storage** = none (PDFs generated on the fly, no persisted uploads dir)

So the VPS is really just: code (git) + `.env` secrets + PM2 config + nginx + SSL cert + cron + OS hardening. **Build the new box fully in parallel, test it completely, then flip one DNS record** — old box stays as instant rollback.

---

## Phase R — Repo infra-rename PR (do BEFORE Phase 1, no VPS access needed)

KVM4 is built from a fresh clone of `main`, so the rename must be in the repo first or the new box will come up as `midnight-epos` again. These functional files have been edited (review + merge as one PR, e.g. `feat/arcarna-infra-rename`):

- [`ecosystem.config.cjs`](../../ecosystem.config.cjs) — `name: "arcarna-epos"`
- [`scripts/deploy-production.sh`](../../scripts/deploy-production.sh) — all `pm2 …` calls → `arcarna-epos`; health-check fallback `${APP_BASE_PATH:-/arcarna}`
- [`package.json`](../../package.json) — `deploy:restart` → `pm2 delete arcarna-epos …`
- [`scripts/cron.example`](../../scripts/cron.example) — path fixed `/opt/midnight/...` → `/root/ARCARNA/scripts/backup-neon-to-r2.sh`, log → `/var/log/arcarna-backup.log`

**Rollback safety:** KVM2 keeps running its existing `midnight-epos` PM2 process. Merging this PR does **not** touch KVM2 unless someone redeploys there — and migration rollback is a DNS revert only (no KVM2 redeploy). Safe.

- [x] `feat/arcarna-infra-rename` PR reviewed + merged to `main`
- [x] Doc sweep (Phase 5a/5b) landed in the same PR — KVM4 builds from corrected docs

---

## Phase 0 — Inventory current KVM2 (≈20 min, zero risk)

Run on **KVM2** for a ground-truth snapshot. (KVM2 is still on the *old* names — `/root/MidnightEPOS`, `midnight-epos`.)

```bash
echo "--- repo location(s) ---"
ls -ld /root/MidnightEPOS /var/www/midnight-epos 2>/dev/null
echo "--- pm2 ---"
pm2 list
pm2 prettylist | grep -E "cwd|script"
echo "--- nginx sites ---"
ls /etc/nginx/sites-enabled/
sudo nginx -T 2>/dev/null | grep -E "server_name|listen|ssl_certificate "
echo "--- certs ---"
sudo certbot certificates 2>/dev/null
echo "--- cron ---"
crontab -l
echo "--- versions ---"
node -v; npm -v; pm2 -V
echo "--- disk/firewall ---"
df -h /
sudo ufw status
echo "--- confirm the /arcarna app + legacy 301 are live ---"
curl -s http://127.0.0.1:5000/arcarna/api/health
curl -sI http://127.0.0.1:5000/midnight/ | head -3   # expect 301 → /arcarna/
```

- [ ] Confirmed real repo path on KVM2 (`/root/MidnightEPOS`)
- [ ] Captured nginx config + cert details
- [ ] Confirmed backup cron is/isn't installed (and its current path/log)
- [ ] Noted Node/npm/PM2 versions for parity
- [ ] `/arcarna/api/health` returns ok and `/midnight/` 301s on KVM2

---

## Phase 1 — Build KVM4 in parallel (no impact on live KVM2)

### 1. Provision
Order KVM4 (Ubuntu 22.04/24.04 LTS), get its IP + root SSH key set up.

- [x] KVM4 provisioned — IP: **`72.60.23.130`** (hostname `Live.Viger.Cloud`, Ubuntu 22.04, KVM 4 / 16 GB)

### 2. OS baseline (the "fresh start") — run on KVM4
```bash
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
dpkg-reconfigure -plow unattended-upgrades
timedatectl set-timezone UTC
```
- [ ] Done

### 3. Runtime + tooling — run on KVM4
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs build-essential nginx postgresql-client-16 awscli
npm install -g pm2
```
(Certbot intentionally omitted — TLS is Cloudflare Origin CA, see step 8.)

- [ ] Done — `node -v` shows v20.x

### 4. Clone to the canonical path — run on KVM4
```bash
git clone https://github.com/andydp4/ARCARNA.git /root/ARCARNA
cd /root/ARCARNA && git checkout main && git log -1 --oneline
```
- [ ] Cloned; HEAD includes the `feat/arcarna-infra-rename` merge (Phase R)

### 5. Copy `.env` securely (KVM2 → your machine → KVM4, never through chat)
Source path is KVM2's **old** dir; destination is KVM4's **new** dir:
```bash
# from your LOCAL machine
scp root@KVM2_IP:/root/MidnightEPOS/.env ~/arcarna-env-backup
scp ~/arcarna-env-backup root@72.60.23.130:/root/ARCARNA/.env
shred -u ~/arcarna-env-backup   # don't leave secrets on your laptop
```
- [ ] Done

### 5b. Verify the copied `.env` has the post-rebrand vars — run on KVM4
The deploy script's health check reads `APP_BASE_PATH`; the build bakes in `VITE_*`. If these are missing/old the box silently serves the wrong base path.
```bash
cd /root/ARCARNA
grep -E '^(APP_BASE_PATH|VITE_BASE_PATH|VITE_APP_URL|DATABASE_URL|CLERK_SECRET_KEY|CLERK_ACCOUNTS_URL|R2_BUCKET|R2_ENDPOINT)=' .env
# Expect:
#   APP_BASE_PATH=/arcarna
#   VITE_BASE_PATH=/arcarna
#   VITE_APP_URL=https://viger.cloud/arcarna
#   CLERK_ACCOUNTS_URL=https://accounts.viger.cloud
#   R2_BUCKET=midnight-backups
```
- [ ] All three `/arcarna` vars present and correct (fix the `.env` before building if not)

### 6. First deploy — run on KVM4
`deploy-production.sh` handles "no existing PM2 process" gracefully, so the same hardened script does first-time setup. `unset NODE_ENV` so `npm install` keeps devDependencies (vite/esbuild are needed to build):
```bash
cd /root/ARCARNA
unset NODE_ENV
npm run deploy        # = bash scripts/deploy-production.sh (git pull, npm install, build, pm2 (re)start, health check)
```
- [ ] Build succeeded; script prints `OK: App is responding.` (`/arcarna/api/health` → `{"ok":true,...}`)
- [ ] `pm2 list` shows **`arcarna-epos`** online

### 7. Survive reboot (one-time)
```bash
pm2 startup   # run the printed sudo systemd command
pm2 save
```
- [ ] Done

### 8. Nginx + TLS via Cloudflare Origin CA

**8a. Issue the Origin cert (Cloudflare dashboard, do anytime — no DNS dependency):**
SSL/TLS → Origin Server → Create Certificate → hostnames `viger.cloud, *.viger.cloud` → copy the **cert** and **private key**.

**8b. Save cert + key on KVM4:**
```bash
mkdir -p /etc/ssl/cloudflare
nano /etc/ssl/cloudflare/viger.cloud.pem   # paste the Origin certificate
nano /etc/ssl/cloudflare/viger.cloud.key   # paste the private key
chmod 600 /etc/ssl/cloudflare/viger.cloud.key
```

**8c. Write the nginx site (includes the `/midnight`→`/arcarna` 301 at the edge — belt-and-braces with the app-level redirect):**
```bash
cat > /etc/nginx/sites-available/viger.cloud <<'NGINX'
# ARCARNA EPOS — viger.cloud (Cloudflare proxied, Full (strict) → Origin CA)
server {
    listen 80;
    server_name viger.cloud www.viger.cloud;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name viger.cloud www.viger.cloud;

    ssl_certificate     /etc/ssl/cloudflare/viger.cloud.pem;
    ssl_certificate_key /etc/ssl/cloudflare/viger.cloud.key;

    client_max_body_size 25m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Legacy path → 301 (app also does this; edge redirect saves a hop)
    location = /midnight { return 301 /arcarna/; }
    location /midnight/ { rewrite ^/midnight/(.*)$ /arcarna/$1 permanent; }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/viger.cloud /etc/nginx/sites-enabled/viger.cloud
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```
- [ ] `nginx -t` passes, nginx reloaded
- [ ] HSTS header present (verified in Phase 2)

### 9. Backup cron — run on KVM4
```bash
chmod +x /root/ARCARNA/scripts/backup-neon-to-r2.sh
crontab -e   # paste the line from scripts/cron.example:
# 15 2 * * * /root/ARCARNA/scripts/backup-neon-to-r2.sh >> /var/log/arcarna-backup.log 2>&1
```
Optional one-off test run (writes a real backup object to R2):
```bash
cd /root/ARCARNA && bash scripts/backup-neon-to-r2.sh && echo "backup OK"
```
- [ ] Cron installed with the `/root/ARCARNA` path
- [ ] Manual backup run succeeded (object visible in R2 `midnight-backups`)

### 10. Re-run [ops/OPERATOR_CHECKLIST.md](./OPERATOR_CHECKLIST.md) fresh on KVM4
- [ ] H1 HSTS header present
- [ ] O1 uptime monitor target added for KVM4 (don't point prod hostname at it yet)
- [ ] O3 reboot test passed (reboot, confirm `arcarna-epos` comes back online)

---

## Phase 2 — Validate KVM4 before touching DNS (zero risk)

Test KVM4 *as if* it were production, without moving traffic. Direct-to-origin over HTTP (CF not in front yet):
```bash
curl -s  -H "Host: viger.cloud" http://72.60.23.130/arcarna/api/health
curl -s  -H "Host: viger.cloud" http://72.60.23.130/arcarna/api/health/metrics
curl -sI -H "Host: viger.cloud" http://72.60.23.130/midnight/ | head -3   # expect 301 → /arcarna/
```
For a real browser test (sign-in, dashboard, Clerk flow) against the Origin CA TLS, temporarily add `72.60.23.130 viger.cloud` to your local machine's `/etc/hosts`, hit `https://viger.cloud/arcarna`. Remove the `/etc/hosts` line after.

- [ ] `/arcarna/api/health` returns ok, `/arcarna/api/health/metrics` shows `db:true`
- [ ] `/midnight/` 301s to `/arcarna/`
- [ ] Sign-in → dashboard loads via `/etc/hosts` override (HTTPS, no cert warning)
- [ ] HSTS header present on the HTTPS override test
- [ ] Created + deleted a throwaway product to confirm the Neon write path from KVM4

---

## Phase 3 — Cutover (minutes, fully reversible)

1. Cloudflare → DNS → edit the `A` record(s) for `viger.cloud` and `www` from KVM2_IP → **72.60.23.130** (check for an `AAAA`/IPv6 record too).
2. Cloudflare → SSL/TLS → set mode to **Full (strict)** (Origin CA cert already installed, so no gap).
3. Watch `pm2 logs arcarna-epos` on KVM4 for real traffic arriving.
4. Smoke test `https://viger.cloud/arcarna` for real, and `https://viger.cloud/midnight/` → 301.
5. **Leave KVM2 running, untouched** — rollback = revert the DNS record (near-instant, Cloudflare is proxied).

`accounts.viger.cloud` / Clerk redirect URLs / WhatsApp webhook URL all reference the **hostname**, not the IP — none need touching.

- [ ] DNS A (and AAAA if present) flipped to KVM4
- [ ] CF SSL mode confirmed **Full (strict)**
- [ ] Live smoke test passed on `https://viger.cloud/arcarna`
- [ ] `https://viger.cloud/midnight/` 301s in a real browser

---

## Phase 4 — Soak & decommission KVM2

Wait 48–72h, confirm: clean `pm2 logs arcarna-epos`, nightly R2 backup ran from KVM4 (check `/var/log/arcarna-backup.log` + object in `midnight-backups`), uptime monitor stayed green through cutover. Then cancel/downgrade KVM2.

- [ ] 48–72h soak complete, no issues
- [ ] First nightly backup from KVM4 confirmed in R2
- [ ] Uptime monitor green across cutover
- [ ] KVM2 cancelled/downgraded

---

## Phase 5 — Doc sweep (repo-only, fold into the Phase R PR if possible)

Pure repo changes — no VPS access. Now that the path is `/root/ARCARNA` + `arcarna-epos`, the old-path/old-name docs are actively misleading.

- [x] **5a.** Standardized deploy dir → `/root/ARCARNA`, PM2 → `arcarna-epos`, backup log → `/var/log/arcarna-backup.log` across all operational docs (70 replacements / 27 files). Stale `/var/www/midnight-epos` and `/opt/midnight` paths gone.
- [x] **5b.** Retired the dead Docker deploy path — removed `scripts/hostinger-deploy.sh` + `docs/DEPLOYMENT_HOSTINGER_VPS.md`, repointed 4 referring docs to `DEPLOY_HOSTINGER_VPS.md`, and converted `AUTH_SETUP_CLERK.md`'s deploy commands (`hostinger-deploy.sh …`, `docker compose exec`) to the PM2 path. `Dockerfile` / `docker-compose.yml` kept as an optional local build (not prod).
- [ ] **5c.** Archive `docs/briefs/WAVE{1..12}_NEXT.md` + completed `PHASE*.md` into `docs/archive/`. **Deferred to its own PR** — 20+ docs cross-link these (incl. non-brief docs), so mechanical archiving would dangle links; needs a focused pass with link fixes + per-phase "is it done?" judgment.
- [ ] **5d.** `.claude/settings.local.json` probe path → `/root/ARCARNA`. **Local-only / untracked** — not in version control, so out of PR scope; update on the operator's machine if desired.
- [x] **5e.** Audited: `server/replitAuth.ts` retained (still imported by `server/auth/index.ts` for the `AUTH_PROVIDER=replit` rollback path). The flagged unused deps (`react-router-dom`, `vite-plugin-pwa`, `workbox-window`, `@replit/*`) are **already absent** from `package.json` — nothing to remove. `scripts/` one-off audit left for a separate cleanup.

---

## Migration count / schema note

Schema is at **`037_rename_accent_style_default.sql`** (the rebrand's accent-style default flip). Neon is shared and external — KVM4 connects to the same `DATABASE_URL`, so there is **no schema migration as part of the box move**. Just confirm `/arcarna/api/health/metrics` shows `db:true` from KVM4.

---

## Open decisions (resolved for this run)

1. **Deploy dir** = `/root/ARCARNA` ✅
2. **PM2 process** = `arcarna-epos` ✅
3. **TLS** = Cloudflare Origin CA ✅
4. **Decommission timing** = 48–72h soak ✅
5. **R2 bucket** = stays `midnight-backups` (object move out of scope) ✅
