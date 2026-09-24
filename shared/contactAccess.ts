import { z } from "zod";
import { isAtLeast } from "./accessPolicy";
import type { Role } from "./rbac";

/**
 * Contact-details requests and 24-hour access (v1.2 Phase 6, PRV-09/10/11).
 *
 * Pure rules shared by the server (which enforces them) and the app (which
 * lays them out). In the owner's words:
 *  - a manager asks for one customer's contact details with a reason and a
 *    note of at least 15 characters, naming the fields wanted, optionally for
 *    an order; one pending request per customer per manager;
 *  - admins and the owner approve (Q13a); a pending request lapses after 48
 *    hours, and an approval gives 24 hours from the moment it is approved;
 *  - admins can revoke, the manager can end it early;
 *  - there is no emergency self-grant (Q9): nobody approves their own request,
 *    and there is no other way in;
 *  - "Message the customer instead" is offered first.
 */

export const CONTACT_REASONS = [
  "complaint",
  "refund_return",
  "delivery_problem",
  "lost_property",
  "debt_chase",
  "other",
] as const;
export type ContactReason = (typeof CONTACT_REASONS)[number];

export const CONTACT_REASON_LABELS: Record<ContactReason, string> = {
  complaint: "Complaint",
  refund_return: "Refund or return",
  delivery_problem: "Delivery problem",
  lost_property: "Lost property",
  debt_chase: "Debt chase",
  other: "Other",
};

export const CONTACT_FIELDS_REQUESTABLE = ["phone", "email", "address"] as const;
export type ContactField = (typeof CONTACT_FIELDS_REQUESTABLE)[number];

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  phone: "Phone",
  email: "Email",
  address: "Saved address",
};

export const CONTACT_NOTE_MIN = 15;
export const CONTACT_NOTE_MAX = 1000;
export const PENDING_EXPIRY_HOURS = 48;
export const GRANT_HOURS = 24;

export const CONTACT_REQUEST_STATUSES = ["pending", "approved", "declined", "expired", "revoked", "ended"] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

/** Who may ask: managers. Admins and the owner see contact details already; cashiers never ask. */
export const CONTACT_REQUEST_ROLE: Role = "MANAGER";
/** Who may approve, decline and revoke (Q13a). */
export const CONTACT_APPROVE_MIN_ROLE: Role = "ADMIN";
/** The org-wide access log page is the owner's alone (Q13a); admins get each customer's Access history. */
export const ACCESS_LOG_ORG_ROLE: Role = "SUPER_ADMIN";
export const ACCESS_HISTORY_MIN_ROLE: Role = "ADMIN";
/** "Message the customer instead" and the Credit List's payment reminder: managers and above (Q11). */
export const MESSAGE_CUSTOMER_MIN_ROLE: Role = "MANAGER";

export function canRequestContact(role: string | null | undefined): boolean {
  return role === CONTACT_REQUEST_ROLE;
}

export function canApproveContact(role: string | null | undefined): boolean {
  return isAtLeast(role, CONTACT_APPROVE_MIN_ROLE);
}

export const contactRequestSchema = z.object({
  reason: z.enum(CONTACT_REASONS),
  note: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(CONTACT_NOTE_MIN, `Write at least ${CONTACT_NOTE_MIN} characters saying why.`)
        .max(CONTACT_NOTE_MAX),
    ),
  fields: z
    .array(z.enum(CONTACT_FIELDS_REQUESTABLE))
    .min(1, "Pick the details you need.")
    .transform((f) => [...new Set(f)].sort() as ContactField[]),
  orderId: z.string().uuid().nullable().optional(),
});
export type ContactRequestInput = z.infer<typeof contactRequestSchema>;

export function pendingExpiryFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PENDING_EXPIRY_HOURS * 3_600_000);
}

export function grantExpiryFrom(approvedAt: Date): Date {
  return new Date(approvedAt.getTime() + GRANT_HOURS * 3_600_000);
}

export type RequestState = {
  status: string;
  expiresAt: Date | string;
  grantExpiresAt: Date | string | null;
  endedAt?: Date | string | null;
};

const at = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());

/**
 * What a request is now. Time decides as well as the stored status: a pending
 * request past 48 hours has lapsed, an approved one past its 24 hours is over,
 * whether or not housekeeping has written that down yet.
 */
export function effectiveStatus(req: RequestState, now: Date = new Date()): ContactRequestStatus | "lapsed" {
  const t = now.getTime();
  if (req.status === "pending") return (at(req.expiresAt) ?? 0) <= t ? "expired" : "pending";
  if (req.status === "approved") {
    if (req.endedAt) return "ended";
    const until = at(req.grantExpiresAt);
    return until != null && until > t ? "approved" : "lapsed";
  }
  return req.status as ContactRequestStatus;
}

export function isGrantActive(req: RequestState, now: Date = new Date()): boolean {
  return effectiveStatus(req, now) === "approved";
}

/**
 * Whether this person may reveal this field of this customer now: a manager,
 * the one who asked, inside the 24 hours, for a field they asked for.
 */
export function mayReveal(
  viewer: { userId: string; role: string | null | undefined },
  grant: (RequestState & { requesterUserId: string; fields: readonly string[] }) | null | undefined,
  field: string,
  now: Date = new Date(),
): boolean {
  if (!grant || !canRequestContact(viewer.role)) return false;
  if (grant.requesterUserId !== viewer.userId) return false;
  if (!(CONTACT_FIELDS_REQUESTABLE as readonly string[]).includes(field)) return false;
  if (!grant.fields.includes(field)) return false;
  return isGrantActive(grant, now);
}

/**
 * Deciding a request: admins and the owner, never the person who asked (no
 * self-grant, Q9), only while it is pending and has not lapsed.
 */
export function decideVerdict(
  viewer: { userId: string; role: string | null | undefined },
  req: RequestState & { requesterUserId: string },
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string; code: string } {
  if (!canApproveContact(viewer.role)) return { ok: false, reason: "Only an admin or the owner can decide this.", code: "NOT_AN_APPROVER" };
  if (req.requesterUserId === viewer.userId) {
    return { ok: false, reason: "Nobody can approve their own request.", code: "SELF_GRANT" };
  }
  const state = effectiveStatus(req, now);
  if (state === "expired") return { ok: false, reason: "This request lapsed after 48 hours.", code: "REQUEST_EXPIRED" };
  if (state !== "pending") return { ok: false, reason: "This request has already been decided.", code: "REQUEST_DECIDED" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The customer data access log (PRV-10).
// ---------------------------------------------------------------------------

export const ACCESS_ACTIONS = [
  "reveal",
  "driver_call",
  "saved_address",
  "phone_replaced",
  "export",
  "request",
  "request_approved",
  "request_declined",
  "grant_revoked",
  "grant_ended",
  "message_sent",
  "invoice_emailed",
  "api_contact_read",
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const ACCESS_ACTION_LABELS: Record<AccessAction, string> = {
  reveal: "Revealed",
  driver_call: "Driver's call",
  saved_address: "Used saved address",
  phone_replaced: "Replaced number",
  export: "Exported",
  request: "Asked for details",
  request_approved: "Approved a request",
  request_declined: "Declined a request",
  grant_revoked: "Revoked access",
  grant_ended: "Ended access early",
  message_sent: "Messaged (number not shown)",
  invoice_emailed: "Emailed an invoice",
  api_contact_read: "API read contact details",
};

export type AccessCounts = Partial<Record<AccessAction, number>>;

/** The owner's weekly line: one sentence, what happened to customer data last week. */
export function weeklyAccessLine(c: AccessCounts): string {
  const n = (a: AccessAction) => c[a] ?? 0;
  const parts: string[] = [];
  const requests = n("request");
  if (requests) parts.push(`${requests} request${requests === 1 ? "" : "s"} (${n("request_approved")} approved, ${n("request_declined")} declined)`);
  const reveals = n("reveal") + n("driver_call");
  if (reveals) parts.push(`${reveals} reveal${reveals === 1 ? "" : "s"}`);
  if (n("phone_replaced")) parts.push(`${n("phone_replaced")} replaced number${n("phone_replaced") === 1 ? "" : "s"}`);
  if (n("export")) parts.push(`${n("export")} customer${n("export") === 1 ? "" : "s"} exported`);
  if (n("message_sent")) parts.push(`${n("message_sent")} message${n("message_sent") === 1 ? "" : "s"} sent`);
  if (n("api_contact_read")) parts.push(`${n("api_contact_read")} API contact read${n("api_contact_read") === 1 ? "" : "s"}`);
  if (n("grant_revoked")) parts.push(`${n("grant_revoked")} revoked`);
  if (parts.length === 0) return "Customer data last week: nobody looked at contact details.";
  return `Customer data last week: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// "Message the customer instead" (PRV-11). The server fills the template and
// sends it to the number on file; nobody sees the number.
// ---------------------------------------------------------------------------

export const CUSTOMER_MESSAGES = ["order_ready", "delivery_update", "payment_reminder", "please_call_us"] as const;
export type CustomerMessage = (typeof CUSTOMER_MESSAGES)[number];

export const CUSTOMER_MESSAGE_LABELS: Record<CustomerMessage, string> = {
  order_ready: "Order ready",
  delivery_update: "Delivery update",
  payment_reminder: "Payment reminder",
  please_call_us: "Please call us on the shop number",
};

/** Messages that are about one order and need it named. */
export const MESSAGES_NEEDING_ORDER: readonly CustomerMessage[] = ["order_ready", "delivery_update"];

/** From 1 October 2026 Meta charges per delivered UK utility message, inside the 24-hour window too. */
export const WHATSAPP_UTILITY_COST_NOTE = "Each message costs about £0.016 from 1 October 2026.";

export const customerMessageSchema = z.object({
  message: z.enum(CUSTOMER_MESSAGES),
  orderId: z.string().uuid().nullable().optional(),
});

/** The first name to greet someone by, or "there". */
export function greetingName(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export type MessageContext = {
  customerName: string | null;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  orderRef: string | null;
  orderStatus: string | null;
  amountOwed: number | null;
};

/**
 * The body parameters for each message, matching the approved templates'
 * {{n}} placeholders (server/whatsapp/templates.ts). Returns an error the
 * manager can act on when something the message needs is missing.
 */
export function messageParams(
  message: CustomerMessage,
  ctx: MessageContext,
): { ok: true; params: string[] } | { ok: false; reason: string } {
  const who = greetingName(ctx.customerName);
  switch (message) {
    case "order_ready":
      if (!ctx.orderRef) return { ok: false, reason: "Pick the order that is ready." };
      return { ok: true, params: [who, ctx.shopAddress?.trim() || ctx.shopName] };
    case "delivery_update": {
      if (!ctx.orderRef) return { ok: false, reason: "Pick the order this is about." };
      const update =
        ctx.orderStatus === "out_for_delivery"
          ? `order ${ctx.orderRef} is out for delivery`
          : ctx.orderStatus === "completed"
            ? `order ${ctx.orderRef} has been delivered`
            : `order ${ctx.orderRef} is being prepared`;
      return { ok: true, params: [who, update, ctx.orderStatus === "out_for_delivery" ? "today" : "we will let you know"] };
    }
    case "payment_reminder": {
      if (!ctx.amountOwed || ctx.amountOwed <= 0) return { ok: false, reason: "This customer owes nothing on the Credit List." };
      const how = ctx.shopPhone ? `pay in store or call us on ${ctx.shopPhone}` : "pay in store";
      return { ok: true, params: [who, `£${ctx.amountOwed.toFixed(2)}`, how] };
    }
    case "please_call_us":
      if (!ctx.shopPhone?.trim()) {
        return { ok: false, reason: "Add the shop's phone number in Settings first: the message tells them which number to ring." };
      }
      return { ok: true, params: [who, ctx.shopPhone.trim(), ctx.shopName] };
  }
}

/** Why "Email invoice" is off when email is not set up. */
export const EMAIL_NOT_SET_UP =
  "Email is not set up for this shop yet, so invoices cannot be sent from here. An admin can add it (Resend) in Settings.";
