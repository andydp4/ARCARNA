# Midnight EPOS — Agent Task List (Sequential, TDD)

## Phase 1: Install & Boot
1. `npm i` in `packages/domain` then `npm run build`
2. `cd apps/server && npm i`
3. Ensure `DATABASE_URL` is set (Postgres/Neon).
4. `npm run dev` → `/healthz` returns `{ ok: true }`

## Phase 2: Migrate/Seed (temporary)
- Use the provided Drizzle schema in `apps/server/src/db/schema.ts`.
- Create the tables in the target DB (can use `drizzle-kit` later).
- Run `npm run seed` to add sample data (placeholder prints).

## Phase 3: Engine Wiring Check
- `POST /api/orders` with body:
```json
{ "customerId": "C1", "lines":[{"productId":"P1","quantity":1,"unitPrice":35}], "paymentMethod":"card" }
```
- Expect `201` with `{ "orderId": "<uuid>" }`

## Phase 4: Invoice PDF
- `GET /api/invoices/<any>/pdf` should return `application/pdf` bytes.

## Phase 5: Tests (must pass to proceed)
- `npm run test:integration` (includes health + order flow tests)

## Phase 6: Replace Stubs With Real Repos
- Implement real Drizzle repos for: orders, order_items, products, customers.
- Implement invoice data lookup (read order + lines + customer), pass to Puppeteer.
- Implement analytics projector: write to outbox on order; add worker to aggregate day/week/month and RFM/CLV.
- Implement audit writes to `audit_logs` on each business action (orders save, stock reserve, tick debt).

## Phase 7: Security & Auth
- Swap `requireAuth` to Replit OIDC adapter.
- Add role checks for admin invoice/report endpoints.

## Rule: After each phase, re-run ALL tests and `scripts/guard-naming.sh`.

Deliverables per phase:
- Code + tests green
- Short note of what changed and which modules depend on it (update annotation block at top of each module)