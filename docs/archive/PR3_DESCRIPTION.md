# PR3: Orders Screen Cleanup

**Focus:** `client/src/pages/orders.tsx` only  
**Rules:** No backend, new routes, schema, or RBAC changes.

## Summary
Orders list, filters, detail dialog, and edit/delete flows are easier to scan and safer to use on desktop and mobile.

## Scope & changes

### 1. Order list
- **Scan order:** Customer (bold) → total → payment (formatted) → placed time; order ID as monospace secondary.
- **Status:** Group headers use icon + colored badge; each row has a **left accent border** matching status for at-a-glance scan.
- **Group order:** Urgent → on hold → awaiting customer → pending → completed (then any other statuses alphabetically).
- **Primary action:** **View** button always visible (44px min); secondary actions in **⋯** menu.

### 2. Filters & search
- **Card** groups **Status** (labeled select, clearer option copy) and **Search** (customer, order ID, payment — client-side only).
- Full-width controls on small screens; 44px touch targets.

### 3. Order details dialog
- **Summary strip:** Customer, placed time, payment, large status badge, prominent total.
- **Line items:** Bordered list with dividers; less box-on-box clutter.
- Title: `Order #shortId`.

### 4. Safer actions
- **Menu:** Delete separated by `DropdownMenuSeparator`; label **Delete order…**; destructive styling.
- **Delete dialog:** Destructive framing, order recap, **checkbox** “I understand…” required before **Delete permanently** is enabled; resets on close.
- **Edit dialog:** Clear copy; **Remove line** as outlined destructive-style button with label (not icon-only).

### 5. Mobile
- Order rows stack; actions row with border-top; View + menu remain reachable.
- Edit grid stacks on narrow screens.

## Files changed
- `client/src/pages/orders.tsx`

## Acceptance
- [x] Easier to scan list; status obvious (badge + border).
- [x] Clearer detail layout.
- [x] Delete/edit safer; no accidental delete without checkbox.
- [x] `npm run check` green.

## CI / gate
- Run `npm run check` locally ✓  
- `npm run gate` in CI (needs `DATABASE_URL` for full seed/tests).

## Screenshots / GIFs
_Add:_ list with status groups and View buttons; filter card + search; detail dialog summary; delete dialog with checkbox; edit with Remove line.

## Blockers
None. Search is client-side filtering on already-fetched orders (no API change).

## Next in sequence
PR4 Admin screens → PR5 Reporting (avoid scope creep into analytics before workflow screens).
