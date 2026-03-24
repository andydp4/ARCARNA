# Phase 3 Rules (UI Overhaul)

Non-negotiables for Phase 3 kickoff. No UI work merges unless these are satisfied.

## 1. Gate must be green

**No UI work merges unless `npm run gate` is green in CI.**

## 2. New routes use scoped middleware by default

Any new route must use `scoped` middleware:

```ts
const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
app.get("/api/your-route", ...scoped, handler);
```

Exempt only auth routes (`/api/login`, `/api/callback`, `/api/auth/user`).

## 3. New tables include orgId

Any new table must include `orgId` and be `NOT NULL` unless explicitly "platform/global" by design (e.g. `sessions`, `allowed_users` for SUPER_ADMIN).

---

*Release-ready backend with guardrails. The remaining risk is humans doing human things.*
