# Scoped-by-Default Route Template

**Use this for any new API endpoint.** Default to org-scoped middleware; exempt only auth routes.

## Snippet

```ts
// At top of routes.ts, scoped is already defined:
const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

// New route - ALWAYS use scoped unless auth/explicitly public
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

app.post("/api/your-resource", ...scoped, async (req: any, res) => {
  try {
    const ctx = req.orgContext as { orgId: string | null };
    const created = await storage.createYourResource({
      ...req.body,
      orgId: ctx?.orgId ?? undefined,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
```

## With Role Restriction

```ts
// Admin-only (SUPER_ADMIN or ADMIN)
app.delete("/api/your-resource/:id", ...scoped, requireRole("SUPER_ADMIN", "ADMIN"), async (req: any, res) => {
  // ...
});
```

## Exempt Routes (Do NOT use scoped)

- `/api/login`, `/api/callback` – Auth
- `/api/auth/user` – Session check (uses `isAuthenticated` only)
- `/api/logout` – Session

## Checklist for New Routes

- [ ] Uses `...scoped` (or explicit `isAuthenticated` + `requireOrgContext` + `requireOrgScope`)
- [ ] Passes `ctx?.orgId` to storage/engine for org-scoped ops
- [ ] Adds `requireRole(...)` only if stricter than org-scope
