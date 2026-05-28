# Architecture Domain Map

Classifies product areas so new work does not treat every feature as equally critical. Maintained alongside [ARCHITECTURAL_PRINCIPLES.md](./ARCHITECTURAL_PRINCIPLES.md).

## Rules

- **New features default to Supporting** unless they directly change order, inventory, or customer truth (then Core).
- **Experimental** features require a feature flag and must **not** be added to `REQUIRED_WORKERS` until promoted.
- Changes to **Core platform** (auth, events, tenancy) require explicit review against the principles doc.

---

## Domain classification

| Area | Classification | Code / routes | Notes |
|------|----------------|---------------|-------|
| POS / checkout | **Core** | `client/src/pages/pos.tsx`, `POST /api/orders` | Revenue path |
| Orders | **Core** | `server/routes.ts`, engine via `apps/server` | Unify write path (see stabilise briefs) |
| Inventory / locations / transfers | **Core** | `server/services/productLocationStock.ts`, `server/routes/inventoryTransfers.ts` | Stock truth must be reliable |
| Customers / CRM-lite | **Core** | `client/src/pages/customers.tsx`, contacts import | Growing CRM surface |
| Products / catalog | **Core** | `client/src/pages/product-management.tsx` | |
| Loyalty / promotions | **Supporting** | loyalty routes, workers | Side effects via events |
| Analytics / insights / reports | **Supporting** | analytics routes, analytics aggregation | Not on critical path for a single sale |
| Imports (products + contacts) | **Supporting** | `shared/productImport.ts`, `ContactsImport.tsx` | Client-parse for large files |
| Viger portal (Files / Backups) | **Supporting** (infra UX) | `portal/` | Placeholders; not production file store yet |
| Auth / org / user access | **Core platform** | Clerk, `server/auth/` | |
| Event bus + workers | **Core platform** | `server/eventBus.ts`, `server/workers/` | Inventory, loyalty, invoices depend on it |
| Automation rules | **Supporting** | `server/routes/automation.ts`, `AutomationWorker` | Event-triggered |
| Purchase drafts / receiving / suppliers / replenishment | **Supporting → Core ops** | `server/routes/purchaseDrafts.ts`, etc. | B2B-adjacent |
| WhatsApp order ingest | **Experimental** (future) | — | Not in repo; use channel adapter pattern when built |
| AI tooling | **Experimental** (future) | — | When added |
| Public API + webhooks | **Supporting** (in flight) | Reserved in `SCHEMA_EVOLUTION.md` | Channel readiness phase |

---

## Locked decisions

| Decision | Value | Implication |
|----------|-------|-------------|
| **Vertical** | General retail (clothing, gifts, electronics) | Prioritise barcode, receipts, loyalty, shifts; defer hospitality-only features (tips, kitchen view) unless requested |
| **External channels** | Expected within **6 months** | Reserve `orders.channel`, API keys, webhooks; ingest via `engine.placeOrder` only |
| **Deployment shape** | Modular monolith on single VPS (PM2 + Nginx) | No second API process; workers in-process until load requires split |
| **App URL** | EPOS at `/midnight`, portal at `/` | All routes and assets stay base-path aware |

---

## Product direction (12-month horizon)

Pick one primary identity when staffing grows; architecture does not block any option, but **event + tenant hardening** is prerequisite for all:

- **A)** Retail EPOS + inventory (defer deep B2B portal)
- **B)** Multi-location ops (transfers, receiving, suppliers first)
- **C)** CRM-heavy retail (customers, loyalty, imports first)

**Current default:** A with elements of C (contacts import, loyalty).

---

## See also

- [ARCHITECTURAL_PRINCIPLES.md](./ARCHITECTURAL_PRINCIPLES.md)
- [SCHEMA_EVOLUTION.md](./SCHEMA_EVOLUTION.md)
- [../ARCHITECTURE.md](../ARCHITECTURE.md)
