/**
 * ReceiptEmailWorker — sends branded HTML receipts via Resend on OrderCreated.
 */

import { db } from "../db";
import {
  processedEvents,
  customers,
  orders,
  orderItems,
  products,
  organizations,
} from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";
import { renderReceiptTemplate } from "../templates/receipt.html";
import { signUnsubscribeToken } from "../services/receiptSigning";
import { storage } from "../storage";
import { APP_BASE_PATH } from "../appBase";
import { apiPathWithBase } from "@shared/appPaths";

const POINTS_PER_UNIT = 1;

interface OrderPayload {
  order?: {
    orderId: string;
    customerId?: string;
    total?: number;
    paymentMethod?: string;
    sendEmailReceipt?: boolean;
  };
  orderId?: string;
  customerId?: string;
  total?: number;
  sendEmailReceipt?: boolean;
}

function formatMoney(amount: number, currency = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

function receiptFromEmail(): string {
  return (
    process.env.RECEIPT_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "receipts@arcarna.local"
  );
}

function unsubscribeUrlFor(customerId: string, email: string): string {
  const token = signUnsubscribeToken(customerId, email);
  const base =
    process.env.VITE_APP_URL?.trim()?.replace(/\/$/, "") || "http://localhost:5000";
  const path = apiPathWithBase(APP_BASE_PATH, `/api/receipts/unsubscribe?token=${encodeURIComponent(token)}`);
  return `${base}${path}`;
}

async function isEventProcessed(eventId: string, workerName: string): Promise<boolean> {
  const result = await db
    .select()
    .from(processedEvents)
    .where(
      and(eq(processedEvents.eventId, eventId), eq(processedEvents.workerName, workerName)),
    )
    .limit(1);
  return result.length > 0;
}

export class ReceiptEmailWorker implements IWorker {
  name: WorkerName = "ReceiptEmailWorker";

  supports(eventType: EventType): boolean {
    return eventType === "OrderCreated";
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;

    try {
      if (await isEventProcessed(event.eventId, this.name)) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "already_processed",
          summary: "Already processed (idempotent skip)",
        };
      }

      const sendRequested =
        payload.order?.sendEmailReceipt ?? payload.sendEmailReceipt ?? false;
      if (!sendRequested) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "Email receipt not requested for this order",
        };
      }

      const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
      const total = payload.order?.total ?? payload.total ?? 0;
      if (!total || total <= 0) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "Order total is zero — no receipt email",
        };
      }

      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) {
        console.log("[ReceiptEmailWorker] RESEND_API_KEY unset — skipping send (no-op)");
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "RESEND_API_KEY not configured — receipt email skipped",
        };
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: `Order ${orderId} not found — skipped`,
          data: { orderId, skipped: true },
        };
      }

      const customerId =
        payload.order?.customerId || payload.customerId || order.customerId;
      if (!customerId) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "No customer on order — no receipt email",
        };
      }

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      if (!customer?.email) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "Customer has no email — no receipt sent",
        };
      }
      if (customer.receiptEmailOptIn === false) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "Customer opted out of email receipts",
        };
      }

      const orgId = order.orgId;
      if (!orgId) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "failed",
          summary: "Order missing org context",
          error: "missing orgId",
        };
      }

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "failed",
          summary: "Organization not found",
          error: "org not found",
        };
      }

      const items = await db
        .select({
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          totalPrice: orderItems.totalPrice,
          productName: products.name,
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, orderId));

      const currency = org.currency || "GBP";
      const orderTotal = parseFloat(order.total || "0");
      const subtotal = +(orderTotal / 1.2).toFixed(2);
      const tax = +(orderTotal - subtotal).toFixed(2);
      const loyaltyEarned = Math.floor(orderTotal * POINTS_PER_UNIT);
      const paymentMethod =
        payload.order?.paymentMethod || order.paymentMethod || "unknown";
      const unsubUrl = unsubscribeUrlFor(customer.id, customer.email);

      const html = renderReceiptTemplate(org.receiptTemplateHtml || "", {
        org: {
          name: org.tradingName || org.name,
          logoUrl: org.logoUrl || "",
        },
        customer: { name: customer.name },
        order: {
          number: order.id.slice(0, 8).toUpperCase(),
          total: formatMoney(orderTotal, currency),
          subtotal: formatMoney(subtotal, currency),
          tax: formatMoney(tax, currency),
          paymentMethod,
          loyaltyEarned: String(loyaltyEarned),
          lines: items.map((item) => ({
            name: item.productName || "Item",
            qty: item.quantity,
            price: formatMoney(parseFloat(item.unitPrice || "0"), currency),
            lineTotal: formatMoney(parseFloat(item.totalPrice || "0"), currency),
          })),
        },
        unsubscribeUrl: unsubUrl,
        footer: org.receiptFooter || "Thank you for your purchase.",
      });

      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const from = receiptFromEmail();
      const sendResult = await resend.emails.send({
        from,
        to: customer.email,
        subject: `Receipt ${org.tradingName || org.name} — ${order.id.slice(0, 8).toUpperCase()}`,
        html,
      });

      if (sendResult.error) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "failed",
          summary: "Resend API error",
          error: sendResult.error.message,
        };
      }

      const messageId = sendResult.data?.id ?? "unknown";
      await storage.insertAdminAuditLog({
        orgId,
        actorUserId: "system",
        actorRole: "SYSTEM",
        action: "receipt.sent",
        targetType: "order",
        targetId: orderId,
        metadata: { customerId, orderId, messageId },
      });

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: "success",
        summary: `Receipt emailed to ${customer.email}`,
        data: { orderId, customerId, messageId },
      };
    } catch (error) {
      console.error("[ReceiptEmailWorker] Error:", error);
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: "failed",
        summary: "Receipt email failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
