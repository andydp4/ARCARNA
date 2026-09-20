/**
 * A SUPER_ADMIN's `allowed_users.org_id` is `null` by design — their org is
 * resolved per request (server/auth/commonAuth.ts's header/query/single-org
 * fallback), never stored on their own row. `loadStaff` (server/services/
 * opsBoard.ts) used to build its roster with `eq(allowedUsers.orgId, orgId)`
 * alone, which SQL `NULL` can never satisfy — so that account silently
 * vanished from `board.staff`, and everything derived from it: "Pass to…"'s
 * candidates, the "who's on" strip, and `board.me` (itself `staff.find(s =>
 * s.userId === userId)`), which made "Your station" read as permanently
 * unset for that account too.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { allowedUsers, opsStaff, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getOpsBoard } from "../services/opsBoard";

const SUFFIX = Date.now().toString(36);
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `super-admin-staff-${SUFFIX}` }).returning();
  orgId = org.id;
  const [otherOrg] = await db
    .insert(organizations)
    .values({ name: `super-admin-staff-other-${SUFFIX}` })
    .returning();
  otherOrgId = otherOrg.id;
});

afterEach(async () => {
  await db.delete(opsStaff).where(eq(opsStaff.orgId, orgId));
  await db.delete(allowedUsers).where(eq(allowedUsers.orgId, orgId));
  await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, `owner-${SUFFIX}`));
  await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, `stranger-${SUFFIX}`));
});

afterAll(async () => {
  await db.delete(opsStaff).where(eq(opsStaff.orgId, otherOrgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(organizations).where(eq(organizations.id, otherOrgId));
});

describe("getOpsBoard includes the viewing SUPER_ADMIN even when their own org_id is null", () => {
  it("lists a SUPER_ADMIN with org_id null in staff, and their own me.userId resolves", async () => {
    await db.insert(allowedUsers).values({
      replitUserId: `owner-${SUFFIX}`,
      authUserId: `owner-${SUFFIX}`,
      name: "Shop Owner",
      role: "SUPER_ADMIN",
      orgId: null,
    });

    const board = await getOpsBoard(orgId, `owner-${SUFFIX}`);

    expect(board.staff.map((s) => s.userId)).toContain(`owner-${SUFFIX}`);
    expect(board.me.userId).toBe(`owner-${SUFFIX}`);
  });

  it("reflects that SUPER_ADMIN's own station and break state once they set one, instead of reverting to null", async () => {
    await db.insert(allowedUsers).values({
      replitUserId: `owner-${SUFFIX}`,
      authUserId: `owner-${SUFFIX}`,
      name: "Shop Owner",
      role: "SUPER_ADMIN",
      orgId: null,
    });
    await db.insert(opsStaff).values({
      orgId,
      userId: `owner-${SUFFIX}`,
      station: "collection",
      onBreak: false,
      lastSeenAt: new Date(),
    });

    const board = await getOpsBoard(orgId, `owner-${SUFFIX}`);

    expect(board.me.station).toBe("collection");
    const ownRow = board.staff.find((s) => s.userId === `owner-${SUFFIX}`);
    expect(ownRow?.station).toBe("collection");
    expect(ownRow?.present).toBe(true);
  });

  it("does not pull in an unrelated org's own SUPER_ADMIN when they aren't the one viewing", async () => {
    await db.insert(allowedUsers).values({
      replitUserId: `stranger-${SUFFIX}`,
      authUserId: `stranger-${SUFFIX}`,
      name: "Other Org's Owner",
      role: "SUPER_ADMIN",
      orgId: null,
    });

    // Viewed by someone else entirely — the stranger must not leak in just
    // because their org_id is also null.
    const board = await getOpsBoard(orgId, "some-cashier-not-in-allowed-users");

    expect(board.staff.map((s) => s.userId)).not.toContain(`stranger-${SUFFIX}`);
  });

  it("still scopes normally by org for an ordinary org-bound viewer (no regression on the common case)", async () => {
    await db.insert(allowedUsers).values({
      replitUserId: `owner-${SUFFIX}`,
      authUserId: `owner-${SUFFIX}`,
      name: "Regular Manager",
      role: "MANAGER",
      orgId,
    });

    const board = await getOpsBoard(orgId, `owner-${SUFFIX}`);

    expect(board.staff.map((s) => s.userId)).toContain(`owner-${SUFFIX}`);

    const otherBoard = await getOpsBoard(otherOrgId, `owner-${SUFFIX}`);
    // Their own row belongs to `orgId`, not `otherOrgId` — the widened match
    // is keyed to the viewer's OWN user id, not a blanket "let them see
    // anyone's roster"; viewing a different org they have no row in at all
    // must not somehow surface them there.
    expect(otherBoard.staff.map((s) => s.userId)).not.toContain(`owner-${SUFFIX}`);
  });
});
