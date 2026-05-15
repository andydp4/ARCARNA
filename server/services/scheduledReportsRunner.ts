import { db } from "../db";
import { scheduledReports, scheduledReportRuns, orgNotifications } from "@shared/schema";
import { and, eq, lte, desc } from "drizzle-orm";
import { getBusinessHealth, getSmartStock } from "./operationalIntelligence";

export type ReportType =
  | "revenue_summary"
  | "order_summary"
  | "inventory_health"
  | "smart_stock_summary"
  | "business_health_snapshot";

function utcDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function utcMonth(d: Date) {
  return d.toISOString().slice(0, 7);
}

function isoWeekKey(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function periodKey(reportId: string, frequency: string, at: Date): string {
  if (frequency === "daily") return `${reportId}_${utcDay(at)}`;
  if (frequency === "weekly") return `${reportId}_${isoWeekKey(at)}`;
  if (frequency === "monthly") return `${reportId}_${utcMonth(at)}`;
  return `${reportId}_${at.getTime()}`;
}

function nextRunAfter(frequency: string, from: Date): Date {
  const d = new Date(from.getTime());
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function buildSnapshot(orgId: string, reportType: ReportType): Promise<Record<string, unknown>> {
  switch (reportType) {
    case "business_health_snapshot":
      return { type: reportType, data: await getBusinessHealth(orgId) };
    case "smart_stock_summary":
      return { type: reportType, data: await getSmartStock(orgId, 30) };
    case "revenue_summary":
    case "order_summary":
    case "inventory_health": {
      const health = await getBusinessHealth(orgId);
      return {
        type: reportType,
        revenueToday: health.revenueToday,
        revenueRange: health.revenueRange,
        orderCountToday: health.orderCountToday,
        orderCountRange: health.orderCountRange,
        averageOrderValue: health.averageOrderValue,
        highRiskStockCount: health.highRiskStockCount,
        deadStockCount: health.deadStockCount,
      };
    }
    default:
      return { type: reportType, data: null };
  }
}

export async function processScheduledReports(): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(scheduledReports)
    .where(and(eq(scheduledReports.isEnabled, 1), lte(scheduledReports.nextRunAt, now)))
    .limit(20);

  let ran = 0;
  for (const report of due) {
    const key = periodKey(report.id, report.frequency, now);
    try {
      const inserted = await db
        .insert(scheduledReportRuns)
        .values({
          reportId: report.id,
          orgId: report.orgId,
          executionKey: key,
          status: "running",
          startedAt: now,
        })
        .onConflictDoNothing({ target: scheduledReportRuns.executionKey })
        .returning({ id: scheduledReportRuns.id });

      if (!inserted.length) {
        continue;
      }

      const snapshot = await buildSnapshot(report.orgId, report.reportType as ReportType);
      const methods = (report.deliveryMethods as string[]) || ["notification_center"];

      if (methods.includes("notification_center")) {
        await db.insert(orgNotifications).values({
          orgId: report.orgId,
          title: `Report: ${report.name}`,
          message: `Scheduled ${report.reportType} (${report.frequency}) is ready.`,
          severity: "info",
          source: "scheduled_report",
          metadata: { reportId: report.id, runKey: key, snapshot },
        });
      }

      if (methods.includes("email_placeholder")) {
        snapshot.emailPlaceholder = "email delivery not configured";
      }

      await db
        .update(scheduledReportRuns)
        .set({
          status: "completed",
          snapshotJson: snapshot,
          completedAt: new Date(),
        })
        .where(eq(scheduledReportRuns.executionKey, key));

      const next = nextRunAfter(report.frequency, now);
      await db
        .update(scheduledReports)
        .set({
          lastRunAt: new Date(),
          nextRunAt: next,
          updatedAt: new Date(),
        })
        .where(eq(scheduledReports.id, report.id));

      ran++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .insert(scheduledReportRuns)
        .values({
          reportId: report.id,
          orgId: report.orgId,
          executionKey: `${key}_err_${Date.now()}`,
          status: "failed",
          errorMessage: msg,
          completedAt: new Date(),
        })
        .catch(() => undefined);
    }
  }
  return ran;
}

export async function listReportRuns(reportId: string, orgId: string, limit = 30) {
  return db
    .select()
    .from(scheduledReportRuns)
    .where(and(eq(scheduledReportRuns.reportId, reportId), eq(scheduledReportRuns.orgId, orgId)))
    .orderBy(desc(scheduledReportRuns.completedAt), desc(scheduledReportRuns.startedAt))
    .limit(limit);
}
