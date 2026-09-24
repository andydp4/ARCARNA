/**
 * Contact-details requests and the 24-hour grant (v1.2 Phase 6, PRV-09).
 *
 * The rules are in shared/contactAccess.ts; this file holds them against the
 * database. Every step is written to the customer data access log in the same
 * transaction as the change, so a request, a decision, a revoke or an early
 * end never happens without its row. Nothing here lets anyone grant
 * themselves access (Q9): only an admin or the owner approves, never the
 * person who asked, and there is no other way to open a grant.
 */
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { contactRequests, customers, orderCredit, orders } from "@shared/schema";
import {
  CONTACT_FIELD_LABELS,
  CONTACT_REASON_LABELS,
  canApproveContact,
  canRequestContact,
  decideVerdict,
  effectiveStatus,
  grantExpiryFrom,
  mayReveal,
  pendingExpiryFrom,
  type ContactField,
  type ContactReason,
  type ContactRequestInput,
} from "@shared/contactAccess";
import { orderRefOf } from "@shared/pricing/priceGuard";
import { recordCustomerAccess, type AccessEntry } from "./customerAccessLog";
import { notify } from "./signals";
import { resolveUserNames } from "./userDisplayName";
import { readContactField } from "./customerView";

type Executor = typeof db | any;
export type Viewer = { userId: string; role: string };
type Where = { ipAddress?: string; userAgent?: string };

export class ContactAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Pending requests past 48 hours become "expired", so the one-pending rule frees up. */
export async function expireStaleRequests(orgId: string, now: Date = new Date(), client: Executor = db): Promise<number> {
  const rows = await client
    .update(contactRequests)
    .set({ status: "expired" })
    .where(and(eq(contactRequests.orgId, orgId), eq(contactRequests.status, "pending"), lte(contactRequests.expiresAt, now)))
    .returning({ id: contactRequests.id });
  return rows.length;
}

async function customerName(orgId: string, customerId: string, client: Executor = db): Promise<string | null> {
  const [row] = await client
    .select({ name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  return row ? row.name : null;
}

function entry(viewer: Viewer, orgId: string, customerId: string, action: AccessEntry["action"], extra: Partial<AccessEntry> = {}): AccessEntry {
  return { orgId, customerId, actorUserId: viewer.userId, actorRole: viewer.role, action, ...extra };
}

/** A manager asks for one customer's details. */
export async function createContactRequest(args: {
  orgId: string;
  customerId: string;
  viewer: Viewer;
  input: ContactRequestInput;
  where?: Where;
  now?: Date;
}) {
  const { orgId, customerId, viewer, input } = args;
  const now = args.now ?? new Date();
  if (!canRequestContact(viewer.role)) {
    if (canApproveContact(viewer.role)) {
      throw new ContactAccessError("Admins see contact details already; there is nothing to ask for.", 409, "NOT_NEEDED");
    }
    throw new ContactAccessError("Only a manager can ask for a customer's contact details.", 403, "NOT_A_MANAGER");
  }
  return db.transaction(async (tx: Executor) => {
    const name = await customerName(orgId, customerId, tx);
    if (name == null) throw new ContactAccessError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
    if (input.orderId) {
      const [order] = await tx
        .select({ id: orders.id, customerId: orders.customerId })
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.orgId, orgId)))
        .limit(1);
      if (!order || order.customerId !== customerId) {
        throw new ContactAccessError("That order is not this customer's.", 400, "ORDER_NOT_THEIRS");
      }
    }
    await expireStaleRequests(orgId, now, tx);
    const active = await activeGrantFor(orgId, customerId, viewer.userId, now, tx);
    if (active) {
      throw new ContactAccessError("You already have access to this customer's details.", 409, "ALREADY_GRANTED");
    }
    let row: typeof contactRequests.$inferSelect | undefined;
    try {
      [row] = await tx
        .insert(contactRequests)
        .values({
          orgId,
          customerId,
          orderId: input.orderId ?? null,
          requesterUserId: viewer.userId,
          requesterRole: viewer.role,
          reasonCode: input.reason,
          note: input.note,
          fields: input.fields,
          status: "pending",
          expiresAt: pendingExpiryFrom(now),
          createdAt: now,
        })
        .returning();
    } catch (error: any) {
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        throw new ContactAccessError("You already have a request waiting for this customer.", 409, "ALREADY_PENDING");
      }
      throw error;
    }
    await recordCustomerAccess(
      entry(viewer, orgId, customerId, "request", {
        requestId: row!.id,
        orderId: row!.orderId,
        metadata: { reason: input.reason, fields: input.fields },
      }),
      args.where,
      tx,
    );
    const [requester] = [...(await resolveUserNames([viewer.userId])).values()];
    const fields = input.fields.map((f) => CONTACT_FIELD_LABELS[f as ContactField].toLowerCase()).join(", ");
    await notify(
      {
        orgId,
        title: "Contact details requested",
        message: `${requester ?? "A manager"} asks for ${name}'s ${fields}: ${CONTACT_REASON_LABELS[input.reason as ContactReason]}. "${input.note}" Approve or decline in Needs a look.`,
        severity: "warning",
        source: "contact_request",
        subjectUserId: viewer.userId,
        metadata: { entityId: row!.id, customerId, href: "/needs-a-look" },
      },
      tx,
    );
    return row!;
  });
}

/** An admin or the owner approves (24 hours from now) or declines. */
export async function decideContactRequest(args: {
  orgId: string;
  id: string;
  viewer: Viewer;
  approve: boolean;
  note?: string | null;
  where?: Where;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx: Executor) => {
    const [row] = await tx
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.id, args.id), eq(contactRequests.orgId, args.orgId)))
      .for("update");
    if (!row) throw new ContactAccessError("Request not found", 404, "REQUEST_NOT_FOUND");
    const verdict = decideVerdict(args.viewer, row, now);
    if (!verdict.ok) {
      throw new ContactAccessError(verdict.reason, verdict.code === "NOT_AN_APPROVER" || verdict.code === "SELF_GRANT" ? 403 : 409, verdict.code);
    }
    const note = args.note?.trim() ? args.note.trim().slice(0, 1000) : null;
    const [updated] = await tx
      .update(contactRequests)
      .set({
        status: args.approve ? "approved" : "declined",
        decidedByUserId: args.viewer.userId,
        decidedAt: now,
        decisionNote: note,
        grantExpiresAt: args.approve ? grantExpiryFrom(now) : null,
      })
      .where(eq(contactRequests.id, row.id))
      .returning();
    await recordCustomerAccess(
      entry(args.viewer, args.orgId, row.customerId, args.approve ? "request_approved" : "request_declined", {
        requestId: row.id,
        orderId: row.orderId,
        metadata: { requesterUserId: row.requesterUserId, fields: row.fields, note },
      }),
      args.where,
      tx,
    );
    const name = (await customerName(args.orgId, row.customerId, tx)) ?? "the customer";
    await notify(
      {
        orgId: args.orgId,
        title: args.approve ? "Contact details approved" : "Contact details declined",
        message: args.approve
          ? `You can see ${name}'s details for 24 hours. Each one is shown when you tap it, and every look is logged.`
          : `Your request for ${name}'s details was declined${note ? `: ${note}` : "."} Try "Message the customer" instead.`,
        severity: "info",
        source: "contact_request_decided",
        audience: { userIds: [row.requesterUserId] },
        metadata: { entityId: row.id, customerId: row.customerId },
      },
      tx,
    );
    return updated;
  });
}

/** Admins revoke a live grant; the manager who holds it can end it early. */
export async function closeGrant(args: {
  orgId: string;
  id: string;
  viewer: Viewer;
  how: "revoke" | "end";
  where?: Where;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx: Executor) => {
    const [row] = await tx
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.id, args.id), eq(contactRequests.orgId, args.orgId)))
      .for("update");
    if (!row) throw new ContactAccessError("Request not found", 404, "REQUEST_NOT_FOUND");
    if (args.how === "revoke" && !canApproveContact(args.viewer.role)) {
      throw new ContactAccessError("Only an admin or the owner can revoke access.", 403, "NOT_AN_APPROVER");
    }
    if (args.how === "end" && row.requesterUserId !== args.viewer.userId) {
      // Someone else's grant reads the same as none, like Needs a look.
      throw new ContactAccessError("Request not found", 404, "REQUEST_NOT_FOUND");
    }
    if (effectiveStatus(row, now) !== "approved") {
      throw new ContactAccessError("This access has already ended.", 409, "GRANT_NOT_ACTIVE");
    }
    const [updated] = await tx
      .update(contactRequests)
      .set({ status: args.how === "revoke" ? "revoked" : "ended", endedAt: now, endedByUserId: args.viewer.userId })
      .where(eq(contactRequests.id, row.id))
      .returning();
    await recordCustomerAccess(
      entry(args.viewer, args.orgId, row.customerId, args.how === "revoke" ? "grant_revoked" : "grant_ended", {
        requestId: row.id,
        orderId: row.orderId,
        metadata: { requesterUserId: row.requesterUserId },
      }),
      args.where,
      tx,
    );
    if (args.how === "revoke") {
      const name = (await customerName(args.orgId, row.customerId, tx)) ?? "the customer";
      await notify(
        {
          orgId: args.orgId,
          title: "Contact details access revoked",
          message: `Your access to ${name}'s details was ended by an admin.`,
          severity: "info",
          source: "contact_request_decided",
          audience: { userIds: [row.requesterUserId] },
          metadata: { entityId: row.id, customerId: row.customerId },
        },
        tx,
      );
    }
    return updated;
  });
}

/** This manager's live grant on this customer, if any. */
export async function activeGrantFor(
  orgId: string,
  customerId: string,
  userId: string,
  now: Date = new Date(),
  client: Executor = db,
) {
  const [row] = await client
    .select()
    .from(contactRequests)
    .where(
      and(
        eq(contactRequests.orgId, orgId),
        eq(contactRequests.customerId, customerId),
        eq(contactRequests.requesterUserId, userId),
        eq(contactRequests.status, "approved"),
        isNull(contactRequests.endedAt),
        gt(contactRequests.grantExpiresAt, now),
      ),
    )
    .orderBy(desc(contactRequests.grantExpiresAt))
    .limit(1);
  return row ?? null;
}

/** What the manager's contact panel shows: a live grant, a waiting request, or the form. */
export async function contactAccessState(orgId: string, customerId: string, viewer: Viewer, now: Date = new Date()) {
  const grant = canRequestContact(viewer.role) ? await activeGrantFor(orgId, customerId, viewer.userId, now) : null;
  const [pending] = canRequestContact(viewer.role)
    ? await db
        .select()
        .from(contactRequests)
        .where(
          and(
            eq(contactRequests.orgId, orgId),
            eq(contactRequests.customerId, customerId),
            eq(contactRequests.requesterUserId, viewer.userId),
            eq(contactRequests.status, "pending"),
            gt(contactRequests.expiresAt, now),
          ),
        )
        .limit(1)
    : [];
  return {
    canRequest: canRequestContact(viewer.role),
    // Admins and the owner see the details on the customer already.
    seesContact: canApproveContact(viewer.role),
    grant: grant
      ? { id: grant.id, fields: grant.fields, grantExpiresAt: grant.grantExpiresAt, reason: grant.reasonCode }
      : null,
    pending: pending
      ? { id: pending.id, fields: pending.fields, expiresAt: pending.expiresAt, reason: pending.reasonCode, createdAt: pending.createdAt }
      : null,
  };
}

/**
 * Click-to-reveal (PRV-09): one field, inside the grant, logged first. If the
 * log row cannot be written the value is never read, and the caller sends an
 * error instead.
 */
export async function revealContactField(args: {
  orgId: string;
  customerId: string;
  field: string;
  viewer: Viewer;
  where?: Where;
  now?: Date;
}): Promise<{ value: string | null; grantExpiresAt: Date }> {
  const now = args.now ?? new Date();
  const grant = canRequestContact(args.viewer.role) ? await activeGrantFor(args.orgId, args.customerId, args.viewer.userId, now) : null;
  if (!grant || !mayReveal(args.viewer, grant, args.field, now)) {
    throw new ContactAccessError("You do not have access to this detail now.", 403, "NO_GRANT");
  }
  try {
    await recordCustomerAccess(
      entry(args.viewer, args.orgId, args.customerId, "reveal", {
        field: args.field,
        requestId: grant.id,
        orderId: grant.orderId,
      }),
      args.where,
    );
  } catch (error) {
    console.error("[ContactAccess] reveal log failed; refusing the reveal:", error);
    throw new ContactAccessError("This could not be logged, so it is not shown. Try again in a moment.", 503, "LOG_FAILED");
  }
  const read = await readContactField(args.orgId, args.customerId, args.field as ContactField);
  if (!read.found) throw new ContactAccessError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  return { value: read.value, grantExpiresAt: grant.grantExpiresAt! };
}

export type ContactRequestItem = {
  id: string;
  customerId: string;
  customerName: string;
  orderId: string | null;
  orderRef: string | null;
  requesterUserId: string;
  requesterName: string;
  reason: string;
  reasonLabel: string;
  note: string;
  fields: string[];
  status: string;
  expiresAt: Date;
  grantExpiresAt: Date | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

/**
 * The requests a viewer works with. Admins and the owner: the org's pending
 * requests and live grants (what Needs a look shows them). A manager: their own.
 */
export async function listContactRequests(orgId: string, viewer: Viewer, now: Date = new Date()): Promise<ContactRequestItem[]> {
  await expireStaleRequests(orgId, now);
  const approver = canApproveContact(viewer.role);
  const scope = approver
    ? or(
        eq(contactRequests.status, "pending"),
        and(eq(contactRequests.status, "approved"), isNull(contactRequests.endedAt), gt(contactRequests.grantExpiresAt, now)),
      )
    : eq(contactRequests.requesterUserId, viewer.userId);
  const rows = await db
    .select({ r: contactRequests, customerName: customers.name })
    .from(contactRequests)
    .innerJoin(customers, eq(customers.id, contactRequests.customerId))
    .where(and(eq(contactRequests.orgId, orgId), scope))
    .orderBy(desc(contactRequests.createdAt))
    .limit(approver ? 200 : 50);
  const ids = new Set<string>();
  for (const { r } of rows) {
    ids.add(r.requesterUserId);
    if (r.decidedByUserId) ids.add(r.decidedByUserId);
  }
  const names = await resolveUserNames([...ids]);
  return rows.map(({ r, customerName: cname }: any) => {
    const state = effectiveStatus(r, now);
    return {
      id: r.id,
      customerId: r.customerId,
      customerName: cname,
      orderId: r.orderId,
      orderRef: r.orderId ? orderRefOf(r.orderId) : null,
      requesterUserId: r.requesterUserId,
      requesterName: names.get(r.requesterUserId) ?? "Unknown",
      reason: r.reasonCode,
      reasonLabel: CONTACT_REASON_LABELS[r.reasonCode as ContactReason] ?? r.reasonCode,
      note: r.note,
      fields: r.fields,
      status: state === "lapsed" ? "expired" : state,
      expiresAt: r.expiresAt,
      grantExpiresAt: r.grantExpiresAt,
      decidedByName: r.decidedByUserId ? names.get(r.decidedByUserId) ?? "Unknown" : null,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  });
}

/** What a customer owes on the Credit List, for the payment reminder. */
export async function amountOwedBy(orgId: string, customerId: string): Promise<number> {
  const [row] = await db
    .select({ owed: sql<string>`COALESCE(SUM(${orderCredit.amountOutstanding}), 0)` })
    .from(orderCredit)
    .where(
      and(
        eq(orderCredit.orgId, orgId),
        eq(orderCredit.customerId, customerId),
        inArray(orderCredit.status, ["outstanding", "partial"]),
      ),
    );
  return Math.round(Number(row?.owed ?? 0) * 100) / 100;
}

/** The customer's recent orders, to name one in a request or a message. Refs and states only. */
export async function recentOrdersFor(orgId: string, customerId: string, limit = 10) {
  const rows = await db
    .select({ id: orders.id, status: orders.status, createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.customerId, customerId)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((o: { id: string; status: string | null; createdAt: Date | null }) => ({
    id: o.id,
    ref: orderRefOf(o.id),
    status: o.status,
    createdAt: o.createdAt,
  }));
}
