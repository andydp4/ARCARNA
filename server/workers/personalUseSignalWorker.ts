/**
 * Tells the business when staff take stock for themselves.
 *
 * Personal use is allowed and is not blocked at the till. The control is that
 * it cannot happen quietly: every instance raises a Signal naming the cashier,
 * what they took, what it cost and why. That is the difference between a
 * recorded perk and unexplained shrinkage.
 *
 * It rides the outbox like every other event, so a Signal that fails to write
 * is retried and ends up in the dead-letter queue rather than silently not
 * happening — an alert nobody can rely on is worse than no alert.
 */
import { db } from "../db";
import { orgNotifications, processedEvents } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "@shared/schema";

type PersonalUsePayload = {
  orgId?: string;
  orderId?: string;
  cashierName?: string;
  reason?: string;
  stockCost?: number;
  items?: Array<{ name?: string; qty?: number }>;
};

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

function describeItems(items: PersonalUsePayload["items"]): string {
  if (!items?.length) return "";
  return items
    .map((i) => `${i.qty ?? 1} × ${i.name ?? "item"}`)
    .join(", ");
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

    const cost = Number(payload.stockCost ?? 0);
    const who = payload.cashierName ?? "A member of staff";
    const what = describeItems(payload.items);

    await db.insert(orgNotifications).values({
      orgId,
      title: `Personal use — ${money(cost)}`,
      // Everything a manager needs to judge it without opening anything.
      message: [
        `${who} took stock for personal use${what ? `: ${what}` : ""}.`,
        `Cost to the business: ${money(cost)}.`,
        payload.reason ? `Reason given: ${payload.reason}` : "No reason was given.",
      ].join(" "),
      severity: "warning",
      source: "personal_use",
      metadata: {
        orderId: payload.orderId,
        stockCost: cost,
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
      summary: `Personal use of ${money(cost)} signalled to the org`,
    };
  }
}
