# arcarna — current state

**As of 3 October 2026.** This is the page to trust for where the product is. Older briefs, wave plans and the September audit register are history. They record what was asked or found on that date. They do not describe production.

## Production

| | |
|---|---|
| App | [https://arcarna.viger.cloud/](https://arcarna.viger.cloud/) served at the **site root** (`APP_BASE_PATH=/`, `VITE_BASE_PATH=/`) |
| Health | `GET https://arcarna.viger.cloud/api/health` → `{"ok":true,"nodeEnv":"production","authProvider":"clerk"}` |
| Metrics | `GET https://arcarna.viger.cloud/api/health/metrics` |
| Portal | [https://viger.cloud/](https://viger.cloud/) is the static shop window, not the till |
| Auth | Clerk. Account portal `https://accounts.viger.cloud`. Dev auth bypass is off in production |
| Process | PM2 `arcarna-epos`, app dir `/root/ARCARNA`, Node on `127.0.0.1:5000` |
| Repo | `andydp4/arcarna`, branch `main` |
| Deployed commit | `70e27bf` — merge of pull request **#230**, 28 September 2026. GitHub deployment “Deploy to production” completed successfully at 21:51 UTC. The live `index.html` was last modified 21:50:35 UTC the same minute. The service worker on the live site is cache version `10`, the same as `client/public/sw.js` at that commit |

Live read on 3 October 2026, 01:43 UTC: database connected, outbox pending `0`, one job queued, `583` dead letters still stored (old failures, not a growing backlog).

**Do not monitor** `https://viger.cloud/arcarna/api/health` or `https://viger.cloud/midnight/api/health`. On 3 October the first redirected to `https://arcarna.viger.cloud/arcarna/api/health`, which returns `404`. The second redirected to the app home, not the health route. The app does not mount under `/arcarna` or `/midnight` on the subdomain.

Local development is different. `npm run dev` still mounts the app at `http://localhost:5000/arcarna/` when `APP_BASE_PATH=/arcarna`. See `AGENTS.md`.

## What is shipped

Release notes for staff: [`RELEASE_NOTES_1.2.md`](./RELEASE_NOTES_1.2.md).

On `main`, and in the 28 September production deploy:

- **v1.1** (14 September): one revenue definition, shift and drawer controls, purchase-order PDF.
- **v1.2** (23–24 September), phases 0A–10: shop accounts refused on staff APIs, role lock-down, money truth, minimum price, Centres, price guard (admin switch, default off for a new shop), customer data by role, 24-hour contact grants, staff performance, Friction Truths, release notes and tours, three training manuals. Plus Stripe payment links, Niimbot labels, driver My run, and Ask arcarna.
- **v1.2.1** (24–26 September): figure checks, security sweep, delivery fee, “this customer already owes”, voice folded into Ask arcarna.
- **After that** (pull requests #229 and #230): rota, Order Audit, a longer Done tray, Profit Truths fixes, label templates and one-tap printing. Migrations continue through `232_label_settings.sql`.

Pull request **#225** (purchase drafts, `usableCost()`, per-account tutorials) and **#227** (split payment) merged on 23 September. The v1.2 plan’s “start once #227 merges” line is finished.

## Confirmed on the live shop (3 October 2026)

Andrew Purchase confirmed, after the public health read could not see org settings:

- The invoice **tax** setting is fine. Do not change it from the old “set VAT to 0” note in the September plan.
- The **price guard** is working.
- **Customer data** is secure as far as the shop knows. That is not a forensic review of logs from before the 23 September shop-account hotfix.

## Rules that still bind

- Write the product name **arcarna**, lowercase, in staff-facing copy. Sentence case. Say Control Centre, Evidence, Truths, Signals.
- Commission is a pool (about 10% of profit by default, set per person) then split 90% to the person who completed the order and 10% to the person who entered it. The same person, or a web-order completer, gets the whole pool. Do not redesign this.
- Cashiers do not see cost. Managers and admins do.
- Never run `npm run db:push` on the production database. Apply `migrations/*.sql` with `scripts/apply-migrations-pm2.sh`. The highest file on `main` is `232_label_settings.sql`. Numbers in the September v1.2 plan were guesses (`071` in that plan is not Signal audience; `071_vat_default_zero.sql` is).

## Old URLs on viger.cloud

`deploy/nginx-viger.cloud.conf.example` now strips `/arcarna` and `/midnight` before sending the browser to `https://arcarna.viger.cloud/…`, so `/arcarna/api/health` becomes `/api/health`.

The **live** nginx on 3 October 2026 had not picked that up yet: `/arcarna/…` was still redirected with the prefix left on, and the API then 404’d. Copy the example into the viger.cloud site and reload nginx when you next touch the server. Until then, monitors and bookmarks must use `https://arcarna.viger.cloud/api/health` directly.

## Where not to start

| Document | Why |
|---|---|
| `docs/briefs/BRIEF_STATUS.md` and `WAVE*_NEXT.md` | Status tracker last written for June 2026 waves. Phase N in that file is later and is accurate for the Operations Centre. The wave queue is not the next job |
| `docs/REBRAND_ARCARNA.md`, `docs/ops/VPS_MIGRATION_KVM2_TO_KVM4.md` | Plans. The URL and host they tell you to deploy are not production now |
| `CHANGELOG.md` sections dated 2025 | Early notes. Ignore the old “pre-production” list |
| `Cursor-arcarna-handover` (1 October 2026) | Recovery pack. Claims in it were checked against `main`; this page is the result |
