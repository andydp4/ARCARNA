import { describe, expect, it } from "vitest";
import {
  contactRequestSchema,
  decideVerdict,
  effectiveStatus,
  grantExpiryFrom,
  mayReveal,
  messageParams,
  pendingExpiryFrom,
  weeklyAccessLine,
  canRequestContact,
  canApproveContact,
} from "./contactAccess";
import { mayReceiveSignal, SIGNAL_ROUTES } from "./signals";

const T0 = new Date("2026-09-24T10:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe("the request (PRV-09)", () => {
  it("needs a reason, a note of at least 15 characters and at least one field", () => {
    expect(contactRequestSchema.safeParse({ reason: "complaint", note: "too short", fields: ["phone"] }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ reason: "complaint", note: "   fourteen chars   ", fields: ["phone"] }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ reason: "because", note: "Customer rang about a refund", fields: ["phone"] }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ reason: "complaint", note: "Customer rang about a refund", fields: [] }).success).toBe(false);
    expect(contactRequestSchema.safeParse({ reason: "complaint", note: "Customer rang about a refund", fields: ["fax"] }).success).toBe(false);
    const ok = contactRequestSchema.parse({ reason: "refund_return", note: "  Customer rang about a refund  ", fields: ["phone", "email", "phone"] });
    expect(ok).toMatchObject({ note: "Customer rang about a refund", fields: ["email", "phone"] });
  });

  it("lapses 48 hours after it is made; the grant runs 24 hours from approval", () => {
    expect(pendingExpiryFrom(T0).toISOString()).toBe(hours(48).toISOString());
    expect(grantExpiryFrom(T0).toISOString()).toBe(hours(24).toISOString());
    const pending = { status: "pending", expiresAt: hours(48), grantExpiresAt: null };
    expect(effectiveStatus(pending, hours(47))).toBe("pending");
    expect(effectiveStatus(pending, hours(48))).toBe("expired");
    const approved = { status: "approved", expiresAt: hours(48), grantExpiresAt: hours(24) };
    expect(effectiveStatus(approved, hours(23.9))).toBe("approved");
    expect(effectiveStatus(approved, hours(24))).toBe("lapsed");
    expect(effectiveStatus({ ...approved, endedAt: hours(1) }, hours(2))).toBe("ended");
  });

  it("only managers ask; admins and the owner approve", () => {
    expect(["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"].map(canRequestContact)).toEqual([false, true, false, false]);
    expect(["CASHIER", "MANAGER", "ADMIN", "SUPER_ADMIN"].map(canApproveContact)).toEqual([false, false, true, true]);
  });
});

describe("approval, and no self-grant (Q9, Q13a)", () => {
  const req = { status: "pending", expiresAt: hours(48), grantExpiresAt: null, requesterUserId: "mgr" };
  it("admins approve a pending request", () => {
    expect(decideVerdict({ userId: "adm", role: "ADMIN" }, req, hours(1))).toEqual({ ok: true });
    expect(decideVerdict({ userId: "own", role: "SUPER_ADMIN" }, req, hours(1))).toEqual({ ok: true });
  });
  it("managers cannot, and nobody approves their own", () => {
    expect(decideVerdict({ userId: "mgr2", role: "MANAGER" }, req, hours(1))).toMatchObject({ ok: false, code: "NOT_AN_APPROVER" });
    expect(decideVerdict({ userId: "mgr", role: "ADMIN" }, req, hours(1))).toMatchObject({ ok: false, code: "SELF_GRANT" });
  });
  it("a lapsed or decided request cannot be approved", () => {
    expect(decideVerdict({ userId: "adm", role: "ADMIN" }, req, hours(49))).toMatchObject({ ok: false, code: "REQUEST_EXPIRED" });
    expect(decideVerdict({ userId: "adm", role: "ADMIN" }, { ...req, status: "declined" }, hours(1))).toMatchObject({ ok: false, code: "REQUEST_DECIDED" });
  });
  it("the request Signal reaches admins and the owner, not the manager's peers", () => {
    const audience = { ...SIGNAL_ROUTES.contact_request, subjectRole: "MANAGER" as const };
    const person = (role: string, userId = role) => mayReceiveSignal({ userId, role, inOrg: true }, audience, "mgr");
    expect(person("MANAGER", "other-mgr")).toBe(false);
    expect(person("MANAGER", "mgr")).toBe(false);
    expect(person("ADMIN")).toBe(true);
    expect(person("SUPER_ADMIN")).toBe(true);
  });
});

describe("inside the grant", () => {
  const grant = { status: "approved", expiresAt: hours(48), grantExpiresAt: hours(24), requesterUserId: "mgr", fields: ["phone"] };
  it("the manager who asked may reveal the fields asked for, until it ends", () => {
    expect(mayReveal({ userId: "mgr", role: "MANAGER" }, grant, "phone", hours(1))).toBe(true);
    expect(mayReveal({ userId: "mgr", role: "MANAGER" }, grant, "email", hours(1))).toBe(false);
    expect(mayReveal({ userId: "mgr2", role: "MANAGER" }, grant, "phone", hours(1))).toBe(false);
    expect(mayReveal({ userId: "mgr", role: "CASHIER" }, grant, "phone", hours(1))).toBe(false);
    expect(mayReveal({ userId: "mgr", role: "MANAGER" }, grant, "phone", hours(24))).toBe(false);
    expect(mayReveal({ userId: "mgr", role: "MANAGER" }, { ...grant, status: "revoked" }, "phone", hours(1))).toBe(false);
    expect(mayReveal({ userId: "mgr", role: "MANAGER" }, null, "phone", hours(1))).toBe(false);
  });
});

describe("Message the customer instead (PRV-11)", () => {
  const ctx = {
    customerName: "Jane Smith",
    shopName: "Arcarna Store",
    shopPhone: "020 7946 0018",
    shopAddress: "1 High Street",
    orderRef: "AB12CD34",
    orderStatus: "out_for_delivery",
    amountOwed: 12.5,
  };
  it("please call us names the shop's number, never the customer's", () => {
    expect(messageParams("please_call_us", ctx)).toEqual({ ok: true, params: ["Jane", "020 7946 0018", "Arcarna Store"] });
    expect(messageParams("please_call_us", { ...ctx, shopPhone: null })).toMatchObject({ ok: false });
  });
  it("the payment reminder carries what they owe; nothing owed, nothing sent", () => {
    expect(messageParams("payment_reminder", ctx)).toMatchObject({ ok: true, params: ["Jane", "£12.50", "pay in store or call us on 020 7946 0018"] });
    expect(messageParams("payment_reminder", { ...ctx, amountOwed: 0 })).toMatchObject({ ok: false });
  });
  it("order messages need the order", () => {
    expect(messageParams("order_ready", { ...ctx, orderRef: null })).toMatchObject({ ok: false });
    expect(messageParams("delivery_update", ctx)).toMatchObject({ ok: true, params: ["Jane", "order AB12CD34 is out for delivery", "today"] });
  });
});

describe("the owner's weekly line", () => {
  it("says what happened in one sentence", () => {
    expect(weeklyAccessLine({})).toBe("Customer data last week: nobody looked at contact details.");
    expect(weeklyAccessLine({ request: 2, request_approved: 1, request_declined: 1, reveal: 3, driver_call: 1, export: 40, message_sent: 1 })).toBe(
      "Customer data last week: 2 requests (1 approved, 1 declined), 4 reveals, 40 customers exported, 1 message sent.",
    );
  });
});
