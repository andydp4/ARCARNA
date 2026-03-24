# MidnightEPOS Architecture

This document describes the architecture of the MidnightEPOS monorepo. See **RBAC.md** for role-based access control and org/store scoping.

---

## 1. Entry Points

### Frontend (Client)

| Item | Location | Purpose |
|------|----------|---------|
| HTML entry | `client/index.html` | Loads the app; `<script type="module" src="/src/main.tsx">` |
| JS entry | `client/src/main.tsx` | React root, PWA service worker, sync service |
| App router | `client/src/App.tsx` | Wouter routes, auth gate, layout |

**Build:** Vite builds from `client/` to `dist/public/` (see `vite.config.ts`).

### Backend (Server)

| Item | Location | Purpose |
|------|----------|---------|
| Process entry | `server/index.ts` | Express app, route registration, Vite dev / static serve |
| Routes | `server/routes.ts` | All `/api/*` HTTP endpoints |
| Auth setup | `server/replitAuth.ts` | Passport OIDC, session, allow-list |
| Event bus | `server/eventBus.ts` | Transactional outbox, job queue, workers |

**Dev:** `npm run dev` → `tsx server/index.ts`  
**Prod:** `npm run build` then `npm run start` → `node dist/index.js`

---

## 2. Folder Responsibilities

```
MidnightEPOS/
├── client/                 # Main SPA (React, Vite, PWA)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx        # Entry
│   │   ├── App.tsx         # Router + layout
│   │   ├── pages/          # Route components
│   │   ├── components/     # Reusable UI
│   │   ├── hooks/          # useAuth, useToast, etc.
│   │   ├── lib/            # queryClient, offline-storage, sync-service
│   │   └── contexts/
│   └── sw.js               # Service worker for offline/PWA
│
├── server/                 # Main HTTP server (Express)
│   ├── index.ts            # App bootstrap, port listen
│   ├── routes.ts           # API route handlers
│   ├── replitAuth.ts       # Auth + session + allow-list
│   ├── storage.ts          # Data access (products, orders, customers, etc.)
│   ├── db.ts               # Drizzle + Neon (shared schema)
│   ├── eventBus.ts         # Outbox, job queue, dispatch
│   ├── vite.ts             # Dev: Vite middleware; Prod: serve static
│   ├── services/           # pdfGenerator, googleDrive
│   └── workers/            # Event-driven workers (inventory, invoice, etc.)
│
├── apps/
│   ├── server/             # Domain engine + Drizzle-backed repos
│   │   └── src/
│   │       ├── engine.wiring.ts   # DomainEngine, repos, ports
│   │       ├── db/               # Drizzle schema (snake_case), repos
│   │       ├── routes/           # Analytics, auth, invoices (used elsewhere)
│   │       ├── workers/          # Analytics worker
│   │       └── adapters/, pdf/, ports/
│   └── web/                # Separate smaller web app (not main SPA)
│
├── shared/
│   └── schema.ts           # Canonical Drizzle schema + Zod (camelCase types)
│
├── packages/
│   └── domain/             # Domain logic (engine, events, ports, types)
│       └── src/
│           ├── engine.ts   # placeOrder, createProduct, etc.
│           ├── schemas.ts  # PlaceOrderInput, UpdateOrderInput
│           ├── ports.ts    # Interfaces (OrdersRepo, ProductsRepo, etc.)
│           └── bus.ts      # In-memory event bus
│
├── drizzle.config.ts       # Drizzle Kit config (schema: shared, out: ./migrations)
└── vite.config.ts          # Vite (root: client, build: dist/public)
```

---

## 3. Dependency Map

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     client/                              │
                    │  (React, Wouter, TanStack Query, PWA)                    │
                    │  Alias: @ → client/src, @shared → shared                 │
                    └─────────────────────────────────────────────────────────┘
                                          │
                                          │ fetch /api/* (credentials: include)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      server/                                                 │
│  Express, Passport, session (connect-pg-simple), eventBus                                    │
│  - routes.ts → storage, replitAuth, eventBus, apps/server (engine, db)                       │
│  - db.ts (Neon + shared schema) → used by storage, eventBus                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
         │                    │                    │                    │
         │                    │                    │                    │
         ▼                    ▼                    ▼                    ▼
┌──────────────┐    ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────────────┐
│  storage.ts  │    │  replitAuth.ts  │   │   eventBus.ts    │   │   apps/server/            │
│  (IStorage)  │    │  (Passport OIDC │   │   (outbox,       │   │   engine.wiring →        │
│  Uses db.ts  │    │   + allow list) │   │   job_queue,     │   │   packages/domain engine  │
│  + shared    │    │   Uses storage  │   │   workers)       │   │   + db (node-pg)          │
└──────────────┘    └─────────────────┘   └──────────────────┘   └──────────────────────────┘
         │                    │                    │                    │
         │                    │                    │                    │
         └────────────────────┴────────────────────┴────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │   shared/schema.ts    │
                              │   (Drizzle + Zod)     │
                              └───────────────────────┘
                                          │
         ┌────────────────────────────────┼────────────────────────────────┐
         │                                │                                │
         ▼                                ▼                                ▼
┌──────────────────┐           ┌──────────────────┐           ┌──────────────────┐
│  server/db.ts    │           │ apps/server/db   │           │ drizzle.config   │
│  Neon + shared   │           │ node-pg +        │           │ (migrations)     │
│  schema          │           │ apps/server      │           │                  │
│                  │           │ schema           │           │                  │
└──────────────────┘           └──────────────────┘           └──────────────────┘
         │                                │
         │                                │  Same DATABASE_URL (PostgreSQL)
         └────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ packages/domain                                                               │
│ - DomainEngine (placeOrder, createProduct, updateOrder, etc.)                 │
│ - InMemoryBus (events)                                                        │
│ - Schemas: PlaceOrderInput, UpdateOrderInput                                  │
│ - No direct DB or HTTP deps; wired by apps/server                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Summary:**

- **client** → depends on nothing internal; calls `/api/*` only.
- **server** → depends on **shared**, **storage** (uses **db**), **replitAuth**, **eventBus**, **apps/server** (engine, db).
- **apps/server** → depends on **packages/domain**, **shared** (types), own **db**.
- **shared** → standalone; no deps on client/server/packages.

---

## 4. Database Schema & Migrations

### Schema Location

| Schema | Path | Convention | Used By |
|--------|------|------------|---------|
| Canonical | `shared/schema.ts` | camelCase JS types, snake_case DB columns | `server/db`, `server/storage`, `server/eventBus`, `drizzle.config` |
| Engine/repos | `apps/server/src/db/schema.ts` | snake_case | `apps/server` engine, repos |

Both schemas target the same physical tables; `shared` is the migration source.

### Migration Flow

- **Config:** `drizzle.config.ts` → `schema: "./shared/schema.ts"`, `out: "./migrations"`
- **Command:** `npm run db:push` → `drizzle-kit push` (applies schema directly; no migration files in default setup)
- **Manual SQL:** `apps/server/src/db/migrations/000_session_table.sql` exists for sessions; other tables are managed via `db:push` or equivalent.

### Tables (from shared/schema.ts)

Core: `locations`, `sessions`, `users`, `loyaltyTiers`, `promotions`, `customers`, `products`, `orders`, `orderItems`, `overheadExpenses`, `orderExpenses`, `invoices`  
Analytics: `analyticsDaily`, `analyticsWeekly`, `analyticsMonthly`, `customerMetrics`  
Auth: `allowedUsers`, `userApprovalRequests`  
Event system: `eventOutbox`, `jobQueue`, `processedEvents`, `workerRunLogs`, `deadLetters`  
Audit: `inventoryMovements`, `loyaltyLedger`

---

## 5. Authentication

### Flow

1. **Login:** `GET /api/login` → Passport OIDC (`replitauth:{hostname}`) → Replit IdP
2. **Callback:** `GET /api/callback` → `checkAndHandleAllowList()` → redirect to `/` or `/pending-approval`
3. **Session:** `express-session` + `connect-pg-simple` (PostgreSQL `sessions` table)
4. **Check:** `GET /api/auth/user` → `isAuthenticated` middleware → returns user or 401

### Roles/Permissions

| Role | Source | Middleware | Capability |
|------|--------|------------|------------|
| Authenticated | `req.isAuthenticated()` | `isAuthenticated` | All `/api/*` except auth endpoints |
| Owner | `user.isOwner` (first user or in `allowed_users`) | `isOwner` | `/api/admin/*` (allowed-users, pending-approvals, worker-logs, dead-letters, etc.) |

**Tables:** `allowed_users` (replit_user_id, email, name, is_owner), `user_approval_requests` (status: pending/approved/rejected).

**Logic (replitAuth.ts):**

- First user → becomes owner, added to `allowed_users`
- Later users → must request access; owner approves/rejects
- Pending users → redirected to `/pending-approval`; cannot access main app

### Development Bypass

- `NODE_ENV === 'development'` → `isAuthenticated` and `requireRole` bypass auth and treat request as dev SUPER_ADMIN.

### Roles and Org Scoping (Phase 2A)

- **Roles:** SUPER_ADMIN, ADMIN, MANAGER, CASHIER (see RBAC.md).
- **Locations = stores** – One org can have many locations. `locations.orgId` links to `organizations`.
- **Middleware:** `requireRole(...roles)`, `requireOrgContext`, `requireOrgScope`.

---

## 6. Order Flow (UI → API → DB)

### End-to-End

```
POS (client/src/pages/pos.tsx)
  │
  │  placeOrderMutation.mutate({ lines, paymentMethod, customerId? })
  │  POST /api/orders with credentials
  │  (Offline: queue via offlineStorage + service worker sync)
  │
  ▼
server/routes.ts  POST /api/orders
  │  isAuthenticated
  │
  │  1. engine.placeOrder(req.body)  ← apps/server engine.wiring
  │     - PlaceOrderInput.parse (Zod)
  │     - Transaction: OrdersRepoDrizzle.save, ProductsRepo.reserveStock,
  │       CustomersRepo.addTickDebt, InvoicesPort.createAndStore,
  │       AnalyticsSink.recordOrder, AuditPort.log, Bus.publish
  │     - Writes to: orders, order_items, products (stock), domain_outbox
  │
  │  2. Fetch created order from apps/server db
  │
  │  3. publishEvent('OrderCreated', orderId, payload)  ← eventBus
  │     - Inserts into event_outbox
  │
  │  4. Respond 201 { orderId, eventId, order }
  │
  ▼
eventBus (background)
  │  - dispatchPendingEvents() polls event_outbox
  │  - Creates jobs in job_queue per REQUIRED_WORKERS
  │  - Workers: InventoryWorker, CustomerWorker, InvoiceWorker,
  │    LoyaltyWorker, BusinessInsightsWorker, FinanceWorker
  │  - Writes to worker_run_logs, dead_letters on failure
  ▼
DB: orders, order_items, products (stock), invoices, analytics_*, etc.
```

### Order Data Shape

**Request (PlaceOrderInput):**

```ts
{ customerId?: string; lines: [{ productId, quantity, unitPrice }]; paymentMethod: 'cash'|'card'|'transfer'|'tick' }
```

**Engine:** Validates, computes subtotal/VAT/total, checks stock, reserves (or sets status `on-hold`), creates invoice if possible, records analytics, publishes events.

---

## 7. Apps/Web vs Client

- **client/**: Main production SPA (POS, orders, inventory, analytics, settings, etc.).
- **apps/web/**: Separate small app with `AuthGate`, `AnalyticsDashboard`; has its own `package.json` and Vite config. Not the default dev/prod entry.

---

## 8. Run Commands

| Command | Effect |
|---------|--------|
| `npm run dev` | Start server + Vite dev server for `client/` |
| `npm run build` | Vite build client → `dist/public`, esbuild server → `dist/` |
| `npm run start` | Run `node dist/index.js` (serves static from `dist/public`) |
| `npm run db:push` | Drizzle push schema to DB |
| `npm run check` | TypeScript check |

---

## 9. Environment Variables

- `DATABASE_URL` – PostgreSQL connection string
- `SESSION_SECRET` – Session signing
- `REPL_ID`, `REPLIT_DOMAINS`, `ISSUER_URL` – Replit OIDC (production)
- `PORT` – Server port (default 5000)
- `NODE_ENV` – `development` | `production`
