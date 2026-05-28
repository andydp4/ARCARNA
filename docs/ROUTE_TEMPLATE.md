# Scoped-by-Default Route Template

**Use this for any new API endpoint.** Default to org-scoped middleware; exempt only auth routes.

## Where routes live (M2)

- **Composition root:** [`server/routes.ts`](../server/routes.ts) — mounts domain registrars only (< 200 lines).
- **Domain modules:** [`server/routes/<domain>.ts`](../server/routes/) — export `register<Domain>Routes(app, scoped)` (or `registerHealthRoutes(app)` for public probes).

Example registrar:

```ts
// server/routes/example.ts
import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { requireRole } from "../auth";

export function registerExampleRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/example", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const data = await storage.getYourResource(ctx.orgId);
      res.json(data);
    } catch (error) {
      console.error("[example] list:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
```

Wire it in `server/routes.ts` after `const scoped = [...]`.

## Snippet (inline handler)

```ts
const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

app.get("/api/your-resource", ...scoped, async (req: any, res) => {
  try {
    const ctx = req.orgContext as { orgId: string | null };
    const data = await storage.getYourResource(ctx?.orgId ?? undefined);
    res.json(data);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

## With Role Restriction

```ts
app.delete("/api/your-resource/:id", ...scoped, requireRole("SUPER_ADMIN", "ADMIN"), async (req: any, res) => {
  // ...
});
```

## Exempt Routes (Do NOT use scoped)

- `/api/health`, `/api/health/metrics` — public probes (`registerHealthRoutes`)
- `/api/auth/runtime` — public auth metadata
- `/api/auth/user` — Session check (`isAuthenticated` only)
- Channel public API — `registerChannelPublicRoutes`

## Checklist for New Routes

- [ ] Handler lives in the correct `server/routes/<domain>.ts` file
- [ ] Registered from `server/routes.ts`
- [ ] Uses `...scoped` (or explicit `isAuthenticated` + `requireOrgContext` + `requireOrgScope`)
- [ ] Passes `ctx.orgId` to storage/engine for org-scoped ops
- [ ] Adds `requireRole(...)` only if stricter than org-scope
- [ ] Dynamic imports use `../` paths relative to `server/routes/` (e.g. `../db`, `../../apps/server/src/db`)

## Business logic

Route handlers do auth, validation, and delegation only. Domain logic belongs in `server/services/<domain>/` (introduce services when a route file grows complex).
