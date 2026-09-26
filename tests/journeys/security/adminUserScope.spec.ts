/**
 * v1.2.1 sec — organisation scope on the User Access admin routes.
 *
 * `PATCH /api/admin/allowed-users/:id` already re-checks `canManageUser`, so an
 * admin of org A cannot re-role a user in org B. Its sibling routes on the same
 * global `allowed_users` table were audited here and one of them was NOT
 * scoped:
 *
 *   - DELETE /api/admin/allowed-users/:replitUserId  — removes ANY user in ANY
 *     org. It sits behind `requireRole('SUPER_ADMIN','ADMIN')` and a
 *     "cannot remove the owner" guard, but nothing ties the target to the
 *     actor's org. An org-A admin can therefore permanently remove an org-B
 *     cashier's access (a destructive cross-tenant IDOR). `requireSuperAdminMfa`
 *     does not help: it returns next() for a plain ADMIN.
 *
 * Both halves of every check matter: the request must be refused (403/404), and
 * the target row must still be there afterwards. A 403 that still deleted is the
 * failure a status-only assertion cannot see.
 *
 * How to run (the DELETE guard, like the rest of this directory, is vacuous
 * under DEV_AUTH_BYPASS=1 because requireRole waves everything through — see
 * roleEnforcement.spec.ts's header for the gates-on command). Against a
 * bypass-on server the destructive assertions are skipped and one recorded
 * instead, so the gap stays visible.
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../server/db";
import { allowedUsers } from "@shared/schema";
import { apiAs } from "../fixtures";
import { authMode, createOrgB, resolveOrgAId, SEC_PREFIX } from "./tenants";

let orgAId: string;
let orgBId: string;
let bypassOn: boolean;
/** replit_user_id of a real org-B staff member, the delete target. */
let bCashierId: string;

test.beforeAll(async () => {
  bypassOn = (await authMode()).devAuthBypass;
  orgAId = await resolveOrgAId();
  const createdB = await createOrgB();
  orgBId = createdB.orgId;
  await createdB.api.dispose();

  bCashierId = `${SEC_PREFIX}-bcashier-${randomUUID().slice(0, 8)}`;
  await db.insert(allowedUsers).values({
    replitUserId: bCashierId,
    authProvider: "replit",
    email: `sec-bcashier-${randomUUID().slice(0, 8)}@example.invalid`,
    name: `${SEC_PREFIX} B Cashier`,
    isOwner: 0,
    orgId: orgBId,
    role: "CASHIER",
  });
});

test.afterAll(async () => {
  // Best-effort cleanup; createOrgB's org row is swept by destroyProvisioned in
  // the sibling specs' teardown, but this file owns the extra allowed_users row.
  await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, bCashierId)).catch(() => {});
});

test("an org-A admin cannot DELETE an org-B user's access", async () => {
  test.skip(
    bypassOn,
    "DEV_AUTH_BYPASS=1: requireRole() returns next() unconditionally, so this route " +
      "answers 200 to everyone and the cross-org guard cannot be asserted. Run with the " +
      "bypass off (see roleEnforcement.spec.ts).",
  );

  const adminA = await apiAs("ADMIN"); // seeded admin, org A
  const res = await adminA.delete(`/api/admin/allowed-users/${bCashierId}`);
  await adminA.dispose();

  // A cross-org target must be refused: 404 (not visible in your scope) or 403.
  expect([403, 404]).toContain(res.status());

  // And, crucially, the row is still there — the refusal wrote nothing.
  const [row] = await db
    .select()
    .from(allowedUsers)
    .where(eq(allowedUsers.replitUserId, bCashierId));
  expect(row, "org-B user must still exist after an org-A admin's delete attempt").toBeTruthy();
  expect(row?.orgId).toBe(orgBId);
});

test("an admin CAN still delete a user inside their own org (control)", async () => {
  test.skip(bypassOn, "gates open under the bypass — see the sibling test");

  const ownId = `${SEC_PREFIX}-acashier-${randomUUID().slice(0, 8)}`;
  await db.insert(allowedUsers).values({
    replitUserId: ownId,
    authProvider: "replit",
    email: `sec-acashier-${randomUUID().slice(0, 8)}@example.invalid`,
    name: `${SEC_PREFIX} A Cashier`,
    isOwner: 0,
    orgId: orgAId,
    role: "CASHIER",
  });

  const adminA = await apiAs("ADMIN");
  const res = await adminA.delete(`/api/admin/allowed-users/${ownId}`);
  await adminA.dispose();

  expect(res.ok(), `deleting an own-org user should succeed, got ${res.status()}`).toBeTruthy();
  const [row] = await db
    .select()
    .from(allowedUsers)
    .where(eq(allowedUsers.replitUserId, ownId));
  // Clean up if the guard (once fixed) happened to refuse it.
  await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, ownId)).catch(() => {});
  expect(row, "own-org user should be gone after a successful delete").toBeFalsy();
});

test("recorded: with DEV_AUTH_BYPASS=1 the DELETE route is ungated", async () => {
  test.skip(!bypassOn, "only meaningful on a bypass-on server");
  // Documented, not asserted away: on a dev-bypass server every admin route is
  // open, so this cross-org delete would succeed. The guard is enforced with the
  // bypass off, which is how CI's gates-on security run executes this file.
  expect(bypassOn).toBe(true);
});
