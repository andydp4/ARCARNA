# Brief status — Viger Cloud website

Execution briefs from `/Users/ap4ma/Documents/viger/briefs/` were used as the specification structure. The brief source files were not available in the cloud agent environment; implementation follows the brief numbering and titles inferred from the handoff.

| Brief | Title | Status |
|-------|-------|--------|
| 00 | Coordination and decisions | Done — see README architecture table |
| 01 | Platform foundation | Done — Astro 5, static, deploy.sh |
| 02 | Brand and content contracts | Done — tokens, content collections, assets |
| 03 | Corporate site | Done — home, about, products, nav/footer |
| 04 | arcarna product experience | Done — `/products/arcarna` |
| 05 | Pricing and lead flows | Done — `/pricing`, `/contact` |
| 06 | Compliance, discoverability, measurement | Done — legal pages, SEO, Plausible hook |
| 07 | Content administration | Done — markdown in `src/content/` |
| 08 | Integration, staging and handover | Done — nginx, deploy, README checklist |

## Operator actions before go-live

1. Set Clerk key in `public/assets/clerk-config.js`
2. Set `PUBLIC_FORM_ENDPOINT` in `.env`
3. Optionally set `PUBLIC_PLAUSIBLE_DOMAIN`
4. Run `./deploy.sh` on VPS
5. Update nginx + TLS
