/**
 * Arcarna Voice alerts — short, spoken-friendly sentences built from the
 * existing operational-intelligence queries plus overdue invoices and
 * unprocessed goods receipts.
 */
import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { invoices, goodsReceipts } from "@shared/schema";
import { getSmartStock, getBusinessHealth } from "../services/operationalIntelligence";

export interface AssistantAlert {
  id: string;
  severity: "info" | "warning" | "error";
  text: string; // short, spoken-friendly
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

async function overdueInvoiceCount(orgId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "paid"), lt(invoices.dueDate, today)));
  return rows.length;
}

async function unprocessedReceiptCount(orgId: string): Promise<number> {
  const rows = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, orgId), eq(goodsReceipts.status, "pending")));
  return rows.length;
}

/** Spoken alerts: low stock, overdue invoices, unprocessed receipts. */
export async function getAssistantAlerts(orgId: string): Promise<AssistantAlert[]> {
  const alerts: AssistantAlert[] = [];

  const [smart, overdueInvoices, unprocessedReceipts] = await Promise.all([
    getSmartStock(orgId, 14),
    overdueInvoiceCount(orgId),
    unprocessedReceiptCount(orgId),
  ]);

  if (smart.summary.negativeStockCount > 0) {
    alerts.push({
      id: "stock-negative",
      severity: "error",
      text: `${plural(smart.summary.negativeStockCount, "product")} showing negative stock.`,
    });
  } else if (smart.summary.highRiskCount > 0) {
    alerts.push({
      id: "stock-risk",
      severity: "warning",
      text: `${plural(smart.summary.highRiskCount, "product")} running low on stock.`,
    });
  }

  if (overdueInvoices > 0) {
    alerts.push({
      id: "invoices-overdue",
      severity: "warning",
      text: `${plural(overdueInvoices, "invoice")} overdue.`,
    });
  }

  if (unprocessedReceipts > 0) {
    alerts.push({
      id: "receipts-unprocessed",
      severity: "info",
      text: `${plural(unprocessedReceipts, "goods receipt")} waiting to be processed.`,
    });
  }

  return alerts;
}

/** One short paragraph: today's headline numbers plus any active alerts. */
export async function getDailySummary(orgId: string): Promise<string> {
  const [health, alerts] = await Promise.all([getBusinessHealth(orgId), getAssistantAlerts(orgId)]);

  const parts = [
    `${plural(health.orderCountToday, "order")} today, revenue £${health.revenueToday.toFixed(2)}.`,
  ];
  if (health.topProduct) {
    parts.push(`Top seller: ${health.topProduct.name}.`);
  }
  if (alerts.length > 0) {
    parts.push(alerts.map((a) => a.text).join(" "));
  } else {
    parts.push("No alerts.");
  }
  return parts.join(" ");
}
