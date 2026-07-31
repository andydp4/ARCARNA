# Viger Cloud website

The corporate marketing site and app portal for **viger.cloud** lives in [`website/`](../website/) in this monorepo (also published to [andydp4/VigerCloudWebsite](https://github.com/andydp4/VigerCloudWebsite) when that repo is wired up).

## Quick start

```bash
cd website
npm ci
npm run dev    # http://localhost:4321
```

## Deploy

See [`website/README.md`](../website/README.md) for VPS deploy (`./deploy.sh`), Clerk config, and the brief status checklist.

## Relationship to VigerPortal

The legacy [VigerPortal](https://github.com/andydp4/VigerPortal) auth-gated launcher is superseded by this site:

- **Public pages** — home, about, products, pricing, contact, legal
- **`/apps`** — Clerk-gated app grid (same shared login as Arcarna)

Arcarna EPOS remains at `https://arcarna.viger.cloud/`.
