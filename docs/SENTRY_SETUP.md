# Sentry setup (Midnight EPOS) — simple steps

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
cd /root/MidnightEPOS
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
pm2 restart midnight-epos --update-env
```

`VITE_*` values are baked in at **build** time.

---

## What you get

- **Errors** in the browser (React error boundary + crashes)
- **Performance** traces (sampled)
- **Session replay** on errors (text masked for privacy)
- **Server errors** if `SENTRY_DSN` is set (restart only, no rebuild)

---

## Test

Open the site → browser console (F12) → run: `throw new Error("Sentry test")`  
Check Sentry **Issues** within a minute.

---

## Reference

Implementation follows [Sentry’s React SDK skill](https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-react-sdk/SKILL.md): `client/src/instrument.ts` imported first in `main.tsx`.
