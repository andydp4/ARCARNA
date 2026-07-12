# WM Supplies Website Domain Deployment

The WM Supplies customer website should live at `https://wmsupplies.com`.

Arcana remains the backend/admin app at `https://arcarna.viger.cloud`. The WM Supplies website uses Arcana for live stock data, approved customer access, website content, and order submission.

Recommended production shape:

- keep `wmsupplies.com` registered at its current registrar unless there is a separate reason to move it
- point `wmsupplies.com` and `www.wmsupplies.com` at the customer website host with DNS
- keep `arcarna.viger.cloud` as the Arcana app/backend endpoint
- keep Clerk in front of the customer website, with Arcana account approval required before any website content loads
- submit website orders into Arcana so staff manage them in the Arcana order tray

## DNS

Add DNS records for the customer website domain.

For the current target:

| Customer URL | DNS host | DNS value |
| --- | --- | --- |
| `https://wmsupplies.com` | `@` | Website host public IPv4 |
| `https://www.wmsupplies.com` | `www` | Website host public IPv4 or CNAME |

Use a low TTL while cutting over. DNS can appear quickly, but allow up to 48 hours globally.

Do not point `wmsupplies.com` at `arcarna.viger.cloud` as the customer URL. Arcana is the backend/admin system; customers should interact with `wmsupplies.com`.

## Arcana Backend Link

Arcana is the live operations app:

```text
https://arcarna.viger.cloud
```

The website should pull approved website content, live stock/product data, and order settings from Arcana APIs. Website orders should submit back into Arcana and appear in the existing order tray with channel `Website`.

## Customer Website URL

The customer-facing website target is:

```text
https://wmsupplies.com/
https://wmsupplies.com/order
https://wmsupplies.com/order/success
```

If the website is hosted on the same VPS as Arcana, run it as a separate customer-site process rather than exposing the Arcana app mount as the public shop URL.

Customer-site process target:

```env
NODE_ENV=production
PORT=5001
WM_SUPPLIES_CUSTOMER_SITE=1
VITE_WM_SUPPLIES_CUSTOMER_SITE=1
VITE_BASE_PATH=
APP_BASE_PATH=
VITE_APP_URL=https://wmsupplies.com
WORKERS_ENABLED=0
AUTH_PROVIDER=clerk
```

Use the same production database as Arcana so website orders, products, stock, website content, and customer approvals are shared with the backend/admin app.

## VPS Load Steps

These steps assume the Arcana app already runs from its own folder on the VPS. Create a second folder for the customer website so the two builds do not overwrite each other.

1. Open the VPS terminal.
2. Create a new folder such as `/var/www/wm-supplies-website`.
3. Clone the same GitHub repo into that folder.
4. Copy `.env.wm-supplies.example` to `.env`.
5. Fill in the same production `DATABASE_URL`, Clerk keys, and `SESSION_SECRET`.
6. Confirm these website-only values are present:

```env
PORT=5001
WM_SUPPLIES_CUSTOMER_SITE=1
VITE_WM_SUPPLIES_CUSTOMER_SITE=1
VITE_APP_URL=https://wmsupplies.com
VITE_BASE_PATH=
APP_BASE_PATH=
WORKERS_ENABLED=0
```

7. Install dependencies.
8. Build the app.
9. Start it with `ecosystem.wm-supplies.config.cjs`.
10. Add the Nginx config from `deploy/nginx-wm-supplies-domain.conf.example`.
11. Add HTTPS with Certbot once DNS points at the VPS.

The one-command deploy path for the website folder is:

```bash
npm run deploy:wm-supplies
```

Success looks like this in the terminal:

```text
OK: WM Supplies website process is responding.
SUCCESS: Deploy finished.
```

## Clerk URLs

Add the final customer URL in Clerk before the domain is made live:

```text
https://wmsupplies.com/
https://wmsupplies.com/sign-in
https://wmsupplies.com/pending-approval
```

Keep public sign-up invite-only in Clerk and continue approving accounts inside Arcana before assigning the `CUSTOMER` role.

## Nginx

Use the example in:

```text
deploy/nginx-wm-supplies-domain.conf.example
```

The example includes:

- a customer website server block for `wmsupplies.com`
- proxying to a separate website process on port `5001`

## Smoke Test

Before giving the URL to customers:

1. Confirm `wmsupplies.com` DNS resolves to the website host.
2. Confirm Certbot has issued HTTPS for `wmsupplies.com`.
3. Open the website signed out and confirm no products/content are visible.
4. Sign in with an unapproved test account and confirm it lands on pending approval.
5. Approve that account as `CUSTOMER` in Arcana.
6. Sign in again and confirm the customer homepage appears.
7. Submit a small website order and confirm it appears in the Arcana order tray with channel `Website`.
