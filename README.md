# Midnight EPOS

Point-of-sale and business management system. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [RBAC.md](./RBAC.md) for design details.

### Docs

- **[docs/ARCHITECTURAL_PRINCIPLES.md](docs/ARCHITECTURAL_PRINCIPLES.md)** — Architectural principles (repo constitution)
- **[docs/DEPLOY_HOSTINGER_VPS.md](docs/DEPLOY_HOSTINGER_VPS.md)** — Production VPS deploy (PM2 + Nginx)
- **[docs/ops/VPS_MIGRATION_KVM2_TO_KVM4.md](docs/ops/VPS_MIGRATION_KVM2_TO_KVM4.md)** — KVM2 → KVM4 server migration runbook

---

## Release

**Before any release or deployment:** Follow [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md).

### ⚠️ Database warning

**Do not run `npm run db:push` on existing databases without a sanity check and migration plan.** Existing analytics tables may have an old PK shape; blindly pushing can conflict with the org-scoped migration. Run:

```bash
DATABASE_URL=... npm run migration:sanity
```

Then follow the printed instructions. See [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md) for full details.

### Preflight

```bash
npm run release:preflight
```

Runs migration sanity check + gate. Requires `DATABASE_URL`.
