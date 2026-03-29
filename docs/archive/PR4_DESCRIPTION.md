# PR4: Admin Screens Cleanup

**Scope:** Admin-facing client screens only — no backend, new routes, schema, or RBAC changes.

## Files changed
| File | Summary |
|------|---------|
| `client/src/pages/locations.tsx` | List/table clarity, default/active badges, separated destructive actions, safer delete dialog, form sections |
| `client/src/pages/user-access.tsx` | Org scope callouts, pending/allowed copy, approval layout, role badges, remove confirmation |
| `client/src/pages/settings.tsx` | Section grouping/separators, labels/help text, sticky save bar, users tab actions |

**Release gate (DB-optional check-only):** `server/workers/phase2dForceFailGuard.ts`, `server/workers/businessInsightsWorker.ts`, `scripts/assert-production-hooks-off.ts` — production-hooks assert no longer imports `BusinessInsightsWorker` (which loaded `server/db.ts`). `npm run gate` passes without `DATABASE_URL`.

## Locations
- **Mobile cards:** Default store + Active/Inactive badges on one row; **Set as default** + **Delete…** in a separated destructive block; Stock/Edit stay primary.
- **Desktop table:** Default store badge on name; status column keeps Active/Inactive badges; actions split into primary row (Stock, Edit, Set default) vs bordered **Delete…** row.
- **Delete:** Checkbox acknowledgment required; recap uses location name; resets on close.
- **Form:** “Contact” / “Address” section labels + `Separator`; responsive grids (`sm:`); **Active location** uses `Checkbox` + short help text.

## User access / approvals
- **Header:** Subtitle “this organization” + outline badge **Scope: this workspace / org**.
- **Pending:** Clearer copy; `Separator` between identity and actions; full-width buttons on small screens; **Approve access** / **Deny request** (deny is outline destructive-style, not competing green/red equally).
- **Allowed users:** Owner badge with crown + amber; members as **Member**; **Remove…** labeled button; remove dialog requires checkbox acknowledgment.
- **Role/org:** API still exposes owner vs member only; org is communicated via copy + scope badge (no new fields).

## Settings
- **Intro:** Note that values save to this browser unless the deployment syncs server-side.
- **Tabs:** Taller tab list; `TabsContent` uses `space-y-6` with **`Separator`** between major cards (General, Payment, System).
- **Payment:** Clearer bank/collection descriptions; `min-h-[44px]` on key bank inputs.
- **Save:** Sticky footer bar with **Save settings** (full width on mobile).
- **Users tab:** Clarified as demo UI; points to **User Access** for real org access; role badges monospace; Approve / Suspend / **Remove** separated (destructive grouped).

## Acceptance
- [x] Easier to scan; role/org context clearer where data exists
- [x] Destructive flows safer (checkbox + separated UI)
- [x] Mobile/desktop improved where practical
- [x] `npm run check` green

## CI / gate
- `npm run check` ✓  
- `npm run gate` ✓ with no `DATABASE_URL` (check + production-hooks only; Phase 2D skipped)  
- With a real `DATABASE_URL`, full seed + Phase 2D tests run as before

## Screenshots / GIFs
_Add:_ locations table + delete dialog; user access pending card + remove dialog; settings with separators + sticky save.

## Blockers
None. No API contract changes.

## Next sequence
- **PR5** — Reporting screens  
- **Hygiene PR** — remove duplicate nested `client/client/` if unused  
