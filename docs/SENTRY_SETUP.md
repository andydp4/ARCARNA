# Sentry setup (Arcarna) — simple steps

The app **already includes** `@sentry/react`. You do **not** need to paste Sentry’s “install SDK” code from the wizard.

In Sentry’s project wizard, choose **React** → then **Skip** install steps → copy the **DSN** only.

---

## Step 1 — Create project in Sentry

1. [sentry.io](https://sentry.io) → **Create project**
2. Platform: **React**
3. Skip “Add the SDK” instructions — already in this repo
4. Copy **DSN** from **Settings → Client Keys (DSN)**

---

## Step 2 — Add to VPS `.env`

```bash
cd /root/ARCARNA
nano .env
```

Add (paste your real DSN):

```bash
VITE_SENTRY_DSN=https://YOUR_KEY@oXXXX.ingest.sentry.io/XXXX
SENTRY_DSN=https://YOUR_KEY@oXXXX.ingest.sentry.io/XXXX
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Optional (readable stack traces in Sentry — create auth token in Sentry → Settings → Auth Tokens):

```bash
SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

Save: Ctrl+O, Enter, Ctrl+X.

---

## Step 3 — Rebuild and restart (required)

```bash
source .env
npm run build
# delete+start (not `pm2 restart`) so the changed .env is actually re-read
pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save
```

`VITE_*` values are baked in at **build** time. Server-side keys (e.g. `SENTRY_DSN`)
are read from `.env` by PM2 at process creation — `pm2 restart --update-env` keeps the
old value, so use the delete+start above after editing `.env`.

---

## What you get

- **Errors** in the browser. Every page has its own error boundary: a crash
  shows staff a plain message and a **reference code** (e.g. `K7QM-3XPA`);
  search `ref:K7QM-3XPA` in Sentry Issues to find that exact crash.
- **Stale files after a deploy** reload the page once instead of crashing.
- **Performance** traces (sampled, `VITE_SENTRY_TRACES_SAMPLE_RATE`, default 10%).
- **Session replay only around an error** (up to about 60 s before it), with all
  text masked and media blocked. Whole sessions are **not** recorded
  (`VITE_SENTRY_REPLAY_SESSION_RATE` defaults to 0). Replay is **never** loaded
  on the shop site build (`VITE_WM_SUPPLIES_CUSTOMER_SITE=1`) and is stopped for
  shop pages and CUSTOMER accounts on the staff build.
- **Server errors** if `SENTRY_DSN` is set (restart only, no rebuild): uncaught
  errors, plus an `http_5xx` event for every 5xx response (tagged with the
  path, status and `request_id`), including routes that catch their own errors.

Before relying on this, check on the VPS whether `VITE_SENTRY_DSN` and
`VITE_SENTRY_REPLAY_SESSION_RATE` were set at build time for the staff build and
for the shop build (`grep SENTRY .env .env.wm-supplies` on the server). If the
DSN is not set, nothing is sent to Sentry at all.

## Server logs

The request log records method, path (ids replaced by `:id`), status, duration
and request id. It never writes response bodies; for 4xx/5xx it logs only the
error `code` and a redacted `message`. PM2 logs rotate daily and are kept for
**14 days** (`pm2-logrotate`, configured by `scripts/deploy-production.sh`).

---

## Test

Open the site → browser console (F12) → run: `throw new Error("Sentry test")`  
Check Sentry **Issues** within a minute.

---

## Reference

Implementation follows [Sentry’s React SDK skill](https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-react-sdk/SKILL.md): `client/src/instrument.ts` imported first in `main.tsx`.
