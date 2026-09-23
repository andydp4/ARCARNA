/**
 * Tells the business when staff take stock for themselves.
 *
 * Personal use is allowed and is not blocked at the till. The control is that
 * it cannot happen quietly: every instance raises a Signal naming the member
 * of staff, the products they took and why. That is the difference between a
 * recorded perk and unexplained shrinkage.
 *
 * The Signal names products, never cost (v1.2 Phase 0B): the goods are what a
 * manager judges, and the cost is on the day's expenses for whoever may see
 * it. It names a member of staff, so it goes to people who outrank them only
 * (shared/signals.ts) — never team-wide, and never to the person themselves.
 *
 * It rides the outbox like every other event, so a Signal that fails to write
 * is retried and ends up in the dead-letter queue rather than silently not
 * happening — an alert nobody can rely on is worse than no alert.
 */
import { db } from "../db";
import { orderItems, processedEvents, products } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { notify } from "../services/signals";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "@shared/schema";

type PersonalUseItem = { name?: string | null; qty?: number };

type PersonalUsePayload = {
  orgId?: string;
  orderId?: string;
  cashierName?: string;
  cashierUserId?: string | null;
  reason?: string;
  items?: PersonalUseItem[];
};

export function describePersonalUseItems(items: PersonalUseItem[] | undefined): string {
  if (!items?.length) return "";
  return items
    .map((i) => `${i.qty ?? 1} × ${i.name?.trim() || "unnamed item"}`)
    .join(", ");
}

/**
 * Events queued before the till started sending product names carry only
 * quantities; read the names from the order so those Signals still say what
 * was taken.
 */
async function itemsFromOrder(orderId: string): Promise<PersonalUseItem[]> {
  const rows = await db
    .select({ qty: orderItems.quantity, name: products.name })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));
  return rows.map((r: { qty: number; name: string | null }) => ({ qty: Number(r.qty), name: r.name }));
}

export class PersonalUseSignalWorker implements IWorker {
  name: WorkerName = "PersonalUseSignalWorker";

  supports(eventType: EventType): boolean {
    return eventType === "PersonalUseRecorded";
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const already = await db
      .select({ id: processedEvents.eventId })
      .from(processedEvents)
      .where(
        and(eq(processedEvents.eventId, event.eventId), eq(processedEvents.workerName, this.name)),
      )
      .limit(1);
    if (already.length > 0) {
      return {
        status: "already_processed",
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        summary: "Personal-use Signal already raised for this event",
      };
    }

    const payload = (event.payload ?? {}) as PersonalUsePayload;
    const orgId = payload.orgId;
    if (!orgId) {
      return {
        status: "skipped",
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        summary: "No organisation on the event, so there is nobody to signal",
      };
    }

    const who = payload.cashierName ?? "A member of staff";
    let items = payload.items;
    if (payload.orderId && (!items?.length || items.some((i) => !i.name))) {
      items = await itemsFromOrder(payload.orderId);
    }
    const what = describePersonalUseItems(items);

    await notify({
      orgId,
      title: `Personal use — ${who}`,
      // Everything a manager needs to judge it without opening anything.
      message: [
        `${who} took stock for personal use${what ? `: ${what}` : ""}.`,
        payload.reason ? `Reason given: ${payload.reason}` : "No reason was given.",
      ].join(" "),
      severity: "warning",
      source: "personal_use",
      subjectUserId: payload.cashierUserId ?? null,
      metadata: {
        orderId: payload.orderId,
        reason: payload.reason ?? null,
      },
    });

    await db.insert(processedEvents).values({
      eventId: event.eventId,
      workerName: this.name,
    });

    return {
      status: "success",
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      summary: "Personal use signalled to managers",
    };
  }
}
