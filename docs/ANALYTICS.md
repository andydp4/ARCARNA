# Product analytics (Plausible)

Midnight EPOS can send **privacy-conscious page analytics** to [Plausible](https://plausible.io) when configured. No third-party scripts load when env vars are unset (production builds remain no-op).

## Configuration

Set at **build time** (Vite):

| Variable | Example | Purpose |
|----------|---------|---------|
| `VITE_PLAUSIBLE_DOMAIN` | `epos.example.com` | Site ID in your Plausible project |

Add to `.env` before `npm run build` on the VPS, or in CI for staging.

## What is tracked

- Default Plausible script: page views on navigation (automatic).
- Optional custom events via `trackEvent()` in `client/src/lib/analytics.ts` — use coarse names only (`pos_open`, `report_export`). **Do not** pass customer names, emails, order IDs, or amounts in props.

## GDPR / operator notes

- Plausible is cookieless by default; confirm your Plausible plan and data region meet your policy.
- Operators can disable analytics by omitting `VITE_PLAUSIBLE_DOMAIN` and rebuilding.
- Usage analytics are separate from **operational** analytics (`/api/analytics/*` KPIs, RFM, etc.).

## Local verification

```bash
VITE_PLAUSIBLE_DOMAIN=localhost npm run dev
```

Open the app and confirm the Plausible script tag in DevTools → Network (script host `plausible.io`). Events appear in your Plausible project dashboard.
