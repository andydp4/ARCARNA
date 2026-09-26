import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminAuditLogs, orgTruthsLayouts, type InsertAdminAuditLog } from "@shared/schema";
import { DEFAULT_TRUTHS_LAYOUT, parseTruthsLayout, type TruthsLayout } from "@shared/truthsLayout";

export type StoredTruthsLayout = {
  widgets: TruthsLayout;
  /** True when no admin has saved a layout yet and the default is shown. */
  isDefault: boolean;
  updatedAt: string | null;
};

/**
 * The org's saved layout, or the default. A stored layout is re-checked on
 * read: a widget retired from the catalogue since it was saved is dropped
 * rather than breaking the page.
 */
export async function getTruthsLayout(orgId: string): Promise<StoredTruthsLayout> {
  const [row] = await db.select().from(orgTruthsLayouts).where(eq(orgTruthsLayouts.orgId, orgId)).limit(1);
  if (!row) return { widgets: DEFAULT_TRUTHS_LAYOUT, isDefault: true, updatedAt: null };
  const stored = Array.isArray(row.widgets) ? row.widgets : [];
  const kept = stored.filter((w) => parseTruthsLayout([w]).ok);
  const parsed = parseTruthsLayout(kept);
  return {
    widgets: parsed.ok ? parsed.layout : [],
    isDefault: false,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Saves an already-validated layout. The audit record is written in the same
 * transaction, so a layout change is never saved without its log line; it is
 * built from what was there before.
 */
export async function saveTruthsLayout(
  orgId: string,
  widgets: TruthsLayout,
  userId: string,
  auditRow: (previous: TruthsLayout | null) => InsertAdminAuditLog,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ widgets: orgTruthsLayouts.widgets })
      .from(orgTruthsLayouts)
      .where(eq(orgTruthsLayouts.orgId, orgId))
      .for("update")
      .limit(1);
    await tx
      .insert(orgTruthsLayouts)
      .values({ orgId, widgets, updatedBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: orgTruthsLayouts.orgId,
        set: { widgets, updatedBy: userId, updatedAt: new Date() },
      });
    await tx.insert(adminAuditLogs).values(auditRow((before?.widgets as TruthsLayout | undefined) ?? null));
  });
}
