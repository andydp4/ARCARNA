# RBAC (Role-Based Access Control)

## Role Model

| Role | Description | Org scope | Admin access |
|------|-------------|-----------|--------------|
| **SUPER_ADMIN** | Platform owner, first user or legacy Owner | Must pass `X-Org-Id` or `?orgId=` to scope; no global view | Full |
| **ADMIN** | Organisation administrator | Scoped to their org | Yes (org-level) |
| **MANAGER** | Store manager | Scoped to their org | No admin; can do stock, price overrides |
| **CASHIER** | Point-of-sale operator | Scoped to their org | No |

## Role Matrix

| Action | SUPER_ADMIN | ADMIN | MANAGER | CASHIER |
|--------|-------------|-------|---------|---------|
| Place order | ✓ | ✓ | ✓ | ✓ |
| View orders | ✓ (all) | ✓ (org) | ✓ (org) | ✓ (org) |
| Stock adjustment | ✓ | ✓ | ✓ | ✗ |
| Price override | ✓ | ✓ | ✓ | ✗ |
| Product CRUD | ✓ | ✓ | ✓ | ✗ |
| Admin: allowed users | ✓ | ✓ | ✗ | ✗ |
| Admin: approve users | ✓ | ✓ | ✗ | ✗ |
| Admin: worker logs, dead letters | ✓ only | ✗ | ✗ | ✗ |
| Reports, analytics | ✓ | ✓ | ✓ | ✓ |
| Settings | ✓ | ✓ | ✓ | ✗ |

## Org/Store Scoping Rules

- **Locations = stores** – One org can have many locations.
- **No cross-org access** – A user in Org A cannot query or modify Org B data.
- **SUPER_ADMIN** – Must explicitly pass `X-Org-Id` or `?orgId=` to scope. No global view (prevents data breach).
- **Other roles** – Must have `orgId` assigned. Requests are always scoped to their org.
- **Locations CRUD** – SUPER_ADMIN and ADMIN only.
- **Locations list (`GET /api/locations`)** – Readable by every org role, because opening a
  POS shift requires picking a location. MANAGER and CASHIER get the trimmed picker shape
  (`id`, `name`, `isActive`, `isDefault`); only SUPER_ADMIN/ADMIN get the payload with
  per-location revenue and order stats.

## Request Context

After `requireOrgContext`, `req.orgContext` contains:

- `orgId` – Current org scope (required for all scoped routes; SUPER_ADMIN must pass header/query)
- `locationId` – Optional store scope from `X-Location-Id` or user default
- `role` – User’s role

Headers (SUPER_ADMIN only):

- `X-Org-Id` – Scope to a specific org
- `X-Location-Id` – Scope to a specific store

## Promote/Demote Users

1. **Allowed users** – Stored in `allowed_users` with `replit_user_id`, `org_id`, `role`.
2. **Promote** – Update `role` (e.g. CASHIER → MANAGER) and optionally `org_id`.
3. **Demote** – Update `role` to a lower level.
4. **SUPER_ADMIN** – Only one platform owner; `org_id` is null.
5. **Admin UI** – `/api/admin/allowed-users` (ADMIN/SUPER_ADMIN only) to manage users.

## Migration from Legacy Owner

- `isOwner = 1` in `allowed_users` maps to `role = 'SUPER_ADMIN'`.
- First user to log in becomes SUPER_ADMIN if no owner exists.
- Run `npm run seed` after `npm run db:push` to create org, location, roles, and sample products.
