/**
 * InvoiceWorker — no longer writes invoices (v1.2 Phase 1C).
 *
 * It used to write an invoice for EVERY order on OrderCreated, with a random
 * number and a flat 30 days, so every till sale sat on the Invoices page
 * "awaiting payment" that had been paid at the till. A till sale now gets a
 * receipt. An invoice is issued, numbered and on the org's terms, when a sale
 * goes on a tab (server/services/creditLedger.ts, inside the completion
 * transaction) or when a customer asks for one (POST
 * /api/invoices/for-order/:orderId). See server/services/invoices.ts.
 *
 * The worker stays registered so events already routed to it (the
 * OrderCreated / PaymentCaptured fan-out in shared/schema.ts) complete
 * cleanly instead of failing and retrying.
 *
 * @module server/workers/invoiceWorker
 */

import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

export class InvoiceWorker implements IWorker {
  name: WorkerName = "InvoiceWorker";

  supports(eventType: EventType): boolean {
    return ["OrderCreated", "PaymentCaptured"].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: "success",
      summary: "Receipt only: invoices are issued when a sale goes on a tab or a customer asks",
    };
  }
}
