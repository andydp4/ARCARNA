# WM Supplies Domain Deployment

The WM Supplies website can run on the same VPS as `viger.cloud`. The domain does not need to move away from GoDaddy just to host the site.

Recommended production shape:

- keep the domain registered at GoDaddy for now
- point a WM Supplies domain or subdomain at the VPS IP with DNS
- terminate HTTPS in Nginx on the VPS
- proxy traffic to the existing Node/PM2 app
- keep Clerk in front of the customer website, with Arcana account approval required before any website content loads

## GoDaddy DNS

Add an `A` record for the domain or subdomain that customers should use.

Examples:

| Customer URL | DNS host | DNS value |
| --- | --- | --- |
| `https://orders.example.co.uk` | `orders` | VPS public IPv4 |
| `https://www.example.co.uk` | `www` | VPS public IPv4 |
| `https://example.co.uk` | `@` | VPS public IPv4 |

Use a low TTL while cutting over. DNS can appear quickly, but allow up to 48 hours globally.

Do not point the domain to GoDaddy hosting unless GoDaddy is also hosting the Node app. In this setup, GoDaddy is only the registrar/DNS provider and the VPS is the host.

## Current App Mount

The current production app is built and mounted at:

```env
VITE_BASE_PATH=/arcarna
APP_BASE_PATH=/arcarna
```

Because of that, the customer website currently works inside the Arcana app mount:

```text
https://viger.cloud/arcarna/
https://viger.cloud/arcarna/order
https://viger.cloud/arcarna/order/success
```

The same mount can be exposed on the WM Supplies domain first:

```text
https://orders.example.co.uk/arcarna/
```

That is the lowest-risk first deployment because it uses the same PM2 process, the same build, the same database, and the same Clerk configuration pattern.

## Clean Customer Domain

For the polished customer URL:

```text
https://orders.example.co.uk/
```

use a separate production build/process for the website domain, or add host-aware routing. Do not simply proxy `/` to the `/arcarna` build and assume it is complete: the React router and generated asset/API paths are base-path aware.

Clean-root target process:

```env
NODE_ENV=production
PORT=5001
VITE_BASE_PATH=
APP_BASE_PATH=
VITE_APP_URL=https://orders.example.co.uk
AUTH_PROVIDER=clerk
```

Keep it connected to the same production database only if the WM Supplies website is intended to share Arcana products, customers, approval state, website content, and order tray.

## Clerk URLs

Add the final customer URL in Clerk before the domain is made live.

Required values depend on whether the first launch uses the `/arcarna` mount or the clean root domain.

Current mount launch:

```text
https://orders.example.co.uk/arcarna/
https://orders.example.co.uk/arcarna/sign-in
https://orders.example.co.uk/arcarna/pending-approval
```

Clean root launch:

```text
https://orders.example.co.uk/
https://orders.example.co.uk/sign-in
https://orders.example.co.uk/pending-approval
```

Keep public sign-up invite-only in Clerk and continue approving accounts inside Arcana before assigning the `CUSTOMER` role.

## Nginx

Use the example in:

```text
deploy/nginx-wm-supplies-domain.conf.example
```

The example includes:

- a same-process `/arcarna` launch block
- a clean-root launch block for a second PM2 process on port `5001`

## Smoke Test

Before giving the URL to customers:

1. Confirm the GoDaddy DNS record resolves to the VPS IP.
2. Confirm Certbot has issued HTTPS for the WM Supplies domain.
3. Open the website signed out and confirm no products/content are visible.
4. Sign in with an unapproved test account and confirm it lands on pending approval.
5. Approve that account as `CUSTOMER` in Arcana.
6. Sign in again and confirm the customer homepage appears.
7. Submit a small website order and confirm it appears in the Arcana order tray with channel `Website`.

