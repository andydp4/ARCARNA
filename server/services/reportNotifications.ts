/**
 * Report red-flag notifications (ARC-RPT-SPEC-001 DEVELOPER NOTE):
 * "Every report that flags a red condition must also write an entry to the
 *  notifications table. The dashboard notification bell should never be silent
 *  when something needs attention."
 *
 * De-duplicated per (report ref + flag text) within a 12-hour window so
 * repeatedly opening a report does not spam the bell.
 */
import { db } from "../db";
import { orgNotifications } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { ReportPayload } from "./reportsEngine";

const DEDUP_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function notifyReportRedFlags(orgId: string, payload: ReportPayload): Promise<void> {
  if (!payload.redFlags.length) return;
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);

  for (const flag of payload.redFlags) {
    // Skip if an identical flag from this report already fired recently.
    const existing = await db
      .select({ id: orgNotifications.id })
      .from(orgNotifications)
      .where(
        and(
          eq(orgNotifications.orgId, orgId),
          eq(orgNotifications.source, "report_flag"),
          eq(orgNotifications.message, flag),
          gte(orgNotifications.createdAt, since),
          sql`${orgNotifications.metadata}->>'ref' = ${payload.ref}`,
        ),
      )
      .limit(1);
    if (existing.length) continue;

    await db.insert(orgNotifications).values({
      orgId,
      title: `${payload.title} — action required`,
      message: flag,
      severity: "error",
      source: "report_flag",
      metadata: { ref: payload.ref, generatedAt: payload.generatedAt },
    });
  }
}
