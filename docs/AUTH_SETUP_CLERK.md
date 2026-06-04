# Clerk login setup (for Andy / site owner)

This guide explains how to turn on **Clerk** login for MidnightEPOS on your Hostinger VPS. You do not need to write code.

---

## What you are setting up

- Users sign in with **email** (or Google, if you enable it in Clerk).
- The app still uses your **allowed users** list — new sign-ins may need approval unless you pre-approved their email.
- **Replit login** stays in the software as a backup (`AUTH_PROVIDER=replit`) but production should use Clerk.

---

## Step 1 — Create a Clerk account

1. Open [https://clerk.com](https://clerk.com) and sign up (free tier is fine to start).
2. Create an **Application** named e.g. `Midnight EPOS Production`.
3. Stay on the Clerk dashboard — you will copy keys from here.

**Success:** You see a dashboard with **API Keys** in the sidebar.

**Failure:** If email verification blocks you, check spam or try another browser.

---

## Step 2 — Copy your keys into `.env.production`

On the **server**, edit `/root/MidnightEPOS/.env.production` (see [DEPLOYMENT_HOSTINGER_VPS.md](./DEPLOYMENT_HOSTINGER_VPS.md)).

Add or update these lines:

| Variable | Where to find it in Clerk |
|----------|---------------------------|
| `AUTH_PROVIDER=clerk` | You type this exactly |
| `CLERK_PUBLISHABLE_KEY=` | Dashboard → **API Keys** → Publishable key (`pk_live_...` or `pk_test_...`) |
| `CLERK_SECRET_KEY=` | Dashboard → **API Keys** → Secret key (`sk_live_...`) — **never share publicly** |

Also keep:

| Variable | Notes |
|----------|--------|
| `SESSION_SECRET=` | Still required (long random string, 32+ chars) |
| `DEV_AUTH_BYPASS=0` | Must stay `0` on production |
| `NODE_ENV=production` | Leave as-is in Docker |

**Remove or leave blank for Clerk production:** `REPL_ID`, `REPLIT_DOMAINS` (only needed if you switch back to Replit).

**Success:** File saved; no typos in key names.

**Failure:** App will not start if `CLERK_SECRET_KEY` or `CLERK_PUBLISHABLE_KEY` is missing when `AUTH_PROVIDER=clerk`.

---

## Step 3 — Set redirect URLs in Clerk

In Clerk → **Configure** → **Paths** (or **Domains / URLs** depending on Clerk UI version):

| Setting | Value for viger.cloud |
|---------|------------------------|
| Sign-in URL | `https://accounts.viger.cloud/sign-in` |
| Sign-up URL | `https://accounts.viger.cloud/sign-up` |
| After sign-in (fallback) | `https://viger.cloud/midnight/` |
| After sign-out | `https://viger.cloud/` |
| Home URL | `https://viger.cloud/midnight/` |

For **IP-only testing** before a domain:

- `http://YOUR-VPS-IP:5000/sign-in`
- `http://YOUR-VPS-IP:5000/`

Also add these under **Allowed redirect URLs** / **Authorized origins** if Clerk asks.

**Success:** Clerk shows no warning about invalid redirect URLs when you test login.

**Failure:** Browser shows Clerk error “redirect url mismatch” → add the exact URL from the address bar to Clerk settings.

### Account Portal DNS (`accounts.viger.cloud`)

Production uses **Clerk Account Portal** on `https://accounts.viger.cloud` (not embedded forms on `viger.cloud`).

1. Clerk Dashboard → **Configure → Domains** → copy DNS records for `accounts.viger.cloud`.
2. Add those records in Hostinger (DNS only — do not proxy through Cloudflare orange-cloud).
3. Wait until Clerk shows the domain as verified.

Add to server `.env` and rebuild:

```env
CLERK_ACCOUNTS_URL=https://accounts.viger.cloud
VITE_CLERK_ACCOUNTS_URL=https://accounts.viger.cloud
VITE_APP_URL=https://viger.cloud/midnight
VITE_BASE_PATH=/midnight
APP_BASE_PATH=/midnight
```

The app redirects sign-in to `https://accounts.viger.cloud/sign-in?redirect_url=https://viger.cloud/midnight/`.

`/sign-in` on `viger.cloud` auto-redirects to the Account Portal.

### Satellite domain (required for Account Portal on a subdomain)

When sign-in runs on `accounts.viger.cloud` but the app runs on `viger.cloud/midnight`, Clerk treats `viger.cloud` as a **satellite** domain.

1. Clerk Dashboard → **Configure → Domains** → add **`viger.cloud`** as a satellite / allowed origin (follow Clerk’s DNS steps if prompted).
2. Rebuild after env changes (`VITE_CLERK_*` keys are baked into the client bundle).
3. The app sends your Clerk session token on every API call and enables `isSatellite` on `ClerkProvider` automatically when `CLERK_ACCOUNTS_URL` is on a different host than the app.

If you see **“Signed in with Clerk, but the server session is not ready”**, check:

- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` are from the **same** Clerk application
- `VITE_CLERK_PUBLISHABLE_KEY` matches `CLERK_PUBLISHABLE_KEY` (rebuild after changing)
- Clerk dashboard lists `https://viger.cloud/midnight/` under allowed redirect URLs
- Your email is on the **allowed users** list (or approve yourself as super admin via database — see developer)

---

## Step 4 — Deploy and run database migration

On the server:

```bash
cd /root/MidnightEPOS
git pull
./scripts/hostinger-deploy.sh update
```

Migration `008_auth_subject.sql` adds `auth_user_id` / `auth_provider` columns. Existing users keep their old Replit id until linked.

**Success:** `./scripts/hostinger-deploy.sh status` shows `OK: App is responding.`

**Failure:** See deploy logs: `./scripts/hostinger-deploy.sh logs`

---

## Step 5 — Link existing staff by email (phased migration)

When someone had a Replit account, their row in `allowed_users` may still use the old id. After they sign in with Clerk once, the app tries to **match by email** automatically.

For manual linking (developer or you with SSH):

```bash
cd /root/MidnightEPOS
docker compose exec app npm run auth:link-clerk -- --email staff@shop.com --clerk-user-id user_xxxxxxxx
```

Use `--dry-run` first to preview.

**Success:** User signs in with Clerk and sees the dashboard (not “pending” if already approved).

**Failure — same email in two organisations:** Script refuses to merge; contact your developer to link each org explicitly.

---

## What success looks like

1. Open `https://your-domain/` (or `http://IP:5000`).
2. Click **Sign in** → Clerk login page.
3. After login, dashboard loads; org switching still works for super admin.
4. `GET /api/health` returns `{"ok":true}`.

---

## What failure looks like

| Symptom | Likely cause |
|---------|----------------|
| Blank page after login | Wrong `CLERK_PUBLISHABLE_KEY` or migration 008 not applied |
| “Could not open dashboard” / server session not ready | Account Portal on `accounts.*` — add `viger.cloud` as Clerk satellite domain; rebuild so API sends Bearer token; verify keys match |
| “Access pending approval” | Email not on allowed list — approve in **User access** as super admin |
| App crashes on start | Missing Clerk keys with `AUTH_PROVIDER=clerk` |
| Redirect error from Clerk | Redirect URLs not added in Clerk dashboard |
| Still shows “Login with Replit” | `AUTH_PROVIDER` not set to `clerk` or app not rebuilt after env change |

---

## Rollback to Replit (emergency)

In `.env.production`:

```env
AUTH_PROVIDER=replit
REPL_ID=your_replit_client_id
REPLIT_DOMAINS=your.domain.com
```

Then `./scripts/hostinger-deploy.sh update`.

---

## Local development (developers only)

| Variable | Value |
|----------|--------|
| `DEV_AUTH_BYPASS=1` | Skips login on laptop (`npm run dev`) |
| `AUTH_PROVIDER=clerk` | Test Clerk locally with keys in `.env` |

Production **never** uses `DEV_AUTH_BYPASS=1` — the app refuses to start.
