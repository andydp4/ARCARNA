/**
 * Signal routing rules (v1.2 Phase 0B, FIX-08 / CMP-01), pure — no database.
 * The DB-backed end-to-end version is signals.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  audienceFor,
  mayReceiveSignal,
  selectSignalRecipients,
  type SignalCandidate,
} from "@shared/signals";

const ORG = "org-1";
const people: SignalCandidate[] = [
  { userId: "owner", role: "SUPER_ADMIN", orgId: null },
  { userId: "admin", role: "ADMIN", orgId: ORG },
  { userId: "manager", role: "MANAGER", orgId: ORG },
  { userId: "manager2", role: "MANAGER", orgId: ORG },
  { userId: "cashier", role: "CASHIER", orgId: ORG },
  { userId: "cashier2", role: "CASHIER", orgId: ORG },
  { userId: "shopper", role: "CUSTOMER", orgId: ORG },
  { userId: "elsewhere", role: "ADMIN", orgId: "org-2" },
];

const to = (audience: Parameters<typeof selectSignalRecipients>[2], subject?: string | null) =>
  selectSignalRecipients(people, ORG, audience, subject).sort();

describe("who a Signal reaches", () => {
  it("always includes the owner, whose login has no fixed organisation", () => {
    expect(to({ minRole: "ADMIN" })).toEqual(["admin", "owner"]);
    expect(to({ userIds: ["cashier"] })).toEqual(["cashier", "owner"]);
  });

  it("sends existing Signals to managers and above, never cashiers, customers or another org", () => {
    expect(to(audienceFor("daily_close"))).toEqual(["admin", "manager", "manager2", "owner"]);
    expect(to(audienceFor("some_new_source"))).toEqual(["admin", "manager", "manager2", "owner"]);
  });

  it("sends commission paid to admins only", () => {
    expect(to(audienceFor("cashier_commission"))).toEqual(["admin", "owner"]);
  });

  it("supports a list of roles", () => {
    expect(to({ roles: ["CASHIER"] })).toEqual(["cashier", "cashier2", "owner"]);
  });

  it("never sends a Signal that names a cashier team-wide, nor to the cashier", () => {
    expect(to({ roles: ["CASHIER", "MANAGER"], subjectRole: "CASHIER" }, "cashier")).toEqual([
      "manager",
      "manager2",
      "owner",
    ]);
  });

  it("sends a Signal that names a manager to admins, not to other managers", () => {
    expect(to({ minRole: "MANAGER", subjectRole: "MANAGER" }, "manager")).toEqual(["admin", "owner"]);
  });

  it("treats an unknown subject as a cashier, which still keeps it off the team", () => {
    expect(to({ minRole: "CASHIER", subjectRole: null }, "someone")).toEqual([
      "admin",
      "manager",
      "manager2",
      "owner",
    ]);
  });

  it("tells the subject only when asked to", () => {
    expect(to({ minRole: "MANAGER", subjectRole: "CASHIER", tellSubject: true }, "cashier")).toContain("cashier");
  });

  it("does not tell the owner about themselves unless asked", () => {
    expect(to({ minRole: "MANAGER", subjectRole: "SUPER_ADMIN" }, "owner")).toEqual([]);
  });
});

describe("the read-time check uses the viewer's current role", () => {
  it("drops a Signal for someone demoted below its audience since it was sent", () => {
    const audience = { minRole: "MANAGER" as const };
    expect(mayReceiveSignal({ userId: "x", role: "MANAGER", inOrg: true }, audience, null)).toBe(true);
    expect(mayReceiveSignal({ userId: "x", role: "CASHIER", inOrg: true }, audience, null)).toBe(false);
  });

  it("never lets a customer account see a Signal, even if addressed", () => {
    expect(mayReceiveSignal({ userId: "shopper", role: "CUSTOMER", inOrg: true }, { userIds: ["shopper"] }, null)).toBe(
      false,
    );
  });
});
