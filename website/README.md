# Viger Cloud Website

Corporate marketing site and authenticated app portal for **viger.cloud**.

Built with [Astro](https://astro.build/) (static output). Replaces the legacy [VigerPortal](https://github.com/andydp4/VigerPortal) launcher with a full public site plus `/apps` for signed-in users.

## Architecture decisions (brief 00)

| Decision | Choice |
|----------|--------|
| Framework | Astro 5, static output |
| Hosting | nginx on VPS (`/var/www/viger.cloud`) |
| Auth (app portal) | Clerk — same application as Arcarna |
| Content | Markdown content collections (brief 07) |
| Analytics | Plausible (optional, env-gated) |
| Lead capture | Formspree or similar (env-configured endpoint) |
| App subdomain | `arcarna.viger.cloud` (separate nginx vhost) |

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Home — suite overview and hero |
| `/about` | Company story and principles |
| `/products` | Full product grid |
| `/products/arcarna` | arcarna product experience |
| `/pricing` | Starter / Growth / Enterprise tiers |
| `/contact` | Lead form + contact details |
| `/apps` | Clerk-gated app launcher (replaces old portal home) |
| `/privacy`, `/terms`, `/cookies` | Compliance (brief 06) |

## Content administration (brief 07)

Edit markdown in `src/content/`:

- `pages/` — static page copy (e.g. about)
- `products/` — product cards and detail pages
- `pricing/` — pricing tiers

Run `npm run dev` to preview. Run `npm run build` before deploy.

## Local development

```bash
npm ci
cp .env.example .env   # optional: analytics + form endpoint
npm run dev            # http://localhost:4321
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PUBLIC_PLAUSIBLE_DOMAIN` | Enable Plausible analytics (e.g. `viger.cloud`) |
| `PUBLIC_FORM_ENDPOINT` | Contact form POST URL (e.g. Formspree) |

## Clerk configuration

Edit `public/assets/clerk-config.js` with the **Arcarna** Clerk publishable key (same as `VITE_CLERK_PUBLISHABLE_KEY` in the EPOS deployment). Never commit the secret key.

Allowed origins in Clerk Dashboard must include `https://viger.cloud` and `https://www.viger.cloud`.

See the Arcarna repo: `docs/VIGER_SSO_INTEGRATION.md`.

## Deploy (brief 08)

On the VPS:

```bash
cd /root/VigerCloudWebsite
git pull
# Optional: set PUBLIC_* in .env and source it before deploy
./deploy.sh              # builds and rsyncs to /var/www/viger.cloud
```

Nginx example: `deploy/nginx-viger.cloud.conf.example`

## Staging

Build locally or on a staging VPS with a different `DEST`:

```bash
./deploy.sh /var/www/staging.viger.cloud
```

Point a staging subdomain at the VPS and use a separate nginx `server_name`.

## Handover checklist

- [ ] Set Clerk publishable key in `public/assets/clerk-config.js`
- [ ] Configure `PUBLIC_FORM_ENDPOINT` for contact form
- [ ] Configure `PUBLIC_PLAUSIBLE_DOMAIN` for analytics
- [ ] Deploy nginx config + Certbot TLS
- [ ] Smoke test: home, products, pricing, contact, /apps sign-in
- [ ] Verify arcarna tile opens `https://arcarna.viger.cloud/`
- [ ] Submit sitemap to Search Console (`/sitemap-index.xml`)

## Related repos

- [andydp4/midnightepos](https://github.com/andydp4/midnightepos) — Arcarna EPOS
- [andydp4/VigerPortal](https://github.com/andydp4/VigerPortal) — legacy portal (superseded by this site)

## Brief mapping

This implementation covers the execution briefs:

1. **00-coordination** — architecture table above
2. **01-platform-foundation** — Astro, static deploy, nginx
3. **02-brand-content-contracts** — Liquid Metal tokens, content collections, brand assets in `public/assets/`
4. **03-corporate-site** — home, about, products, footer/nav
5. **04-arcarna-product-experience** — `/products/arcarna`
6. **05-pricing-and-lead-flows** — `/pricing`, `/contact` form
7. **06-compliance-discoverability-measurement** — legal pages, meta/OG tags, robots.txt, sitemap, Plausible hook
8. **07-content-administration** — markdown content collections
9. **08-integration-staging-and-handover** — deploy.sh, nginx example, this README
