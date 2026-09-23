import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { allowedUsers, organizations } from "@shared/schema";
import type { storage as StorageType } from "../storage";

/**
 * `getAllowedUsers(orgId)` had the same bug `loadStaff` did on the Ops
 * board (fixed separately): `org_id` is NULL by design for a SUPER_ADMIN row
 * (their org is resolved per request, never stored on their own row — see
 * server/auth/commonAuth.ts), so a strict `org_id = :orgId` filter hid every
 * SUPER_ADMIN from every org's own access list. That wasn't just a display
 * gap: `PATCH /api/admin/allowed-users/:id` (server/routes/admin.ts) looks
 * the target up in this same list before allowing an edit, so a SUPER_ADMIN's
 * own commission rate or default location could not be edited while viewing
 * a specific org's Team & Access screen — the lookup 404'd.
 */
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("storage.getAllowedUsers — SUPER_ADMIN visibility per org", () => {
  let db: (typeof import("../db"))["db"];
  let storage: typeof StorageType;
  let orgAId: string;
  let orgBId: string;
  let superAdminUserId: string;
  let orgAStaffUserId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ storage } = await import("../storage"));
    orgAId = randomUUID();
    orgBId = randomUUID();
    superAdminUserId = `test-super-admin-${randomUUID()}`;
    orgAStaffUserId = `test-org-a-staff-${randomUUID()}`;

    await db.insert(organizations).values([
      { id: orgAId, name: "Allowed-Users Test Org A" },
      { id: orgBId, name: "Allowed-Users Test Org B" },
    ]);
    await db.insert(allowedUsers).values([
      {
        replitUserId: superAdminUserId,
        email: "super@example.com",
        name: "Test Super Admin",
        isOwner: 1,
        orgId: null,
        role: "SUPER_ADMIN",
      },
      {
        replitUserId: orgAStaffUserId,
        email: "staff@example.com",
        name: "Org A Cashier",
        isOwner: 0,
        orgId: orgAId,
        role: "CASHIER",
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [superAdminUserId, orgAStaffUserId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  });

  it("includes a SUPER_ADMIN row alongside org A's own staff", async () => {
    const rows = await storage.getAllowedUsers(orgAId);
    const ids = rows.map((r) => r.replitUserId);
    expect(ids).toContain(superAdminUserId);
    expect(ids).toContain(orgAStaffUserId);
  });

  it("includes the same SUPER_ADMIN row for a completely different org, with no staff in common", async () => {
    const rows = await storage.getAllowedUsers(orgBId);
    const ids = rows.map((r) => r.replitUserId);
    expect(ids).toContain(superAdminUserId);
    expect(ids).not.toContain(orgAStaffUserId);
  });
});
