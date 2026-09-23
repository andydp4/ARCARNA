/**
 * Signals: the one way to raise one (v1.2 Phase 0B, FIX-08 / CMP-01).
 *
 * Every writer calls `notify()` rather than inserting into `org_notifications`
 * itself, so routing lives in one place (shared/signals.ts) and no Signal can
 * be written without deciding who it is for. Recipients are resolved here, at
 * send time, into `org_notification_recipients` — which is also what makes
 * read and cleared per person.
 */
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, orgNotificationRecipients, orgNotifications } from "@shared/schema";
import {
  audienceFor,
  mayReceiveSignal,
  selectSignalRecipients,
  type SignalAudience,
  type SignalCandidate,
} from "@shared/signals";
import type { Role } from "@shared/rbac";

type Executor = typeof db | any;

export type NotifyInput = {
  orgId: string;
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  /** Kind of Signal; picks the default audience from SIGNAL_ROUTES. */
  source: string;
  metadata?: Record<string, unknown> | null;
  /** Overrides the source's default routing. */
  audience?: SignalAudience;
  /** The member of staff this Signal names, if any. */
  subjectUserId?: string | null;
  /** Tell the person it names. Off by default. */
  tellSubject?: boolean;
};

export type NotifyResult = { id: string; recipients: string[] };

/**
 * Everyone who might receive a Signal for this org: its own staff, plus every
 * SUPER_ADMIN. The owner's allowed_users.org_id is NULL, so `org_id = $1`
 * alone would never match them and an admin-only Signal could reach nobody.
 */
export async function loadSignalCandidates(orgId: string, client: Executor = db): Promise<SignalCandidate[]> {
  const rows: Array<{ authUserId: string | null; replitUserId: string; role: string | null; orgId: string | null; isOwner: number }> =
    await client
      .select({
        authUserId: allowedUsers.authUserId,
        replitUserId: allowedUsers.replitUserId,
        role: allowedUsers.role,
        orgId: allowedUsers.orgId,
        isOwner: allowedUsers.isOwner,
      })
      .from(allowedUsers)
      .where(
        or(
          and(eq(allowedUsers.orgId, orgId), ne(allowedUsers.role, "CUSTOMER")),
          eq(allowedUsers.role, "SUPER_ADMIN"),
          eq(allowedUsers.isOwner, 1),
        ),
      );
  return rows.map((r) => ({
    userId: r.authUserId ?? r.replitUserId,
    // Same rule as storage.getUserRoleAndOrg: the legacy owner flag wins.
    role: r.isOwner ? "SUPER_ADMIN" : r.role,
    orgId: r.orgId,
  }));
}

export async function notify(input: NotifyInput, client: Executor = db): Promise<NotifyResult> {
  const candidates = await loadSignalCandidates(input.orgId, client);
  const subjectUserId = input.subjectUserId ?? null;
  const base = audienceFor(input.source, input.audience);
  const subjectRole = subjectUserId
    ? ((candidates.find((c) => c.userId === subjectUserId)?.role as Role | undefined) ?? null)
    : null;
  const audience: SignalAudience = {
    ...base,
    ...(input.tellSubject ? { tellSubject: true } : {}),
    ...(subjectUserId ? { subjectRole } : {}),
  };
  const recipients = selectSignalRecipients(candidates, input.orgId, audience, subjectUserId);

  const [row] = await client
    .insert(orgNotifications)
    .values({
      orgId: input.orgId,
      title: input.title,
      message: input.message,
      severity: input.severity ?? "info",
      source: input.source,
      metadata: input.metadata ?? null,
      audience,
      subjectUserId,
    })
    .returning({ id: orgNotifications.id });

  if (recipients.length > 0) {
    await client
      .insert(orgNotificationRecipients)
      .values(recipients.map((userId) => ({ notificationId: row.id, userId, orgId: input.orgId })))
      .onConflictDoNothing();
  } else {
    // Written anyway, so the owner still sees it (they see every Signal).
    console.warn(`[signals] "${input.source}" Signal for org ${input.orgId} has no recipients`);
  }
  return { id: row.id, recipients };
}

export type Viewer = { userId: string; role: string };

export type ViewerSignal = {
  id: string;
  title: string;
  message: string;
  severity: string;
  source: string;
  createdAt: Date | null;
  readAt: Date | null;
  /** metadata.entityId, for a Signal the bell can act on (the price guard's "Manager agreed"). */
  entityId: string | null;
};

/**
 * The Signals one person may see in one org, newest first, with their own read
 * state. A non-owner needs a recipient row AND to still qualify under their
 * current role; the owner sees every Signal in the org (they are always a
 * recipient, and this also covers an owner login added after it was sent).
 */
export async function listSignalsFor(orgId: string, viewer: Viewer, limit = 40): Promise<ViewerSignal[]> {
  const isOwner = viewer.role === "SUPER_ADMIN";
  const recipientJoin = and(
    eq(orgNotificationRecipients.notificationId, orgNotifications.id),
    eq(orgNotificationRecipients.userId, viewer.userId),
  );
  const base = db
    .select({
      id: orgNotifications.id,
      title: orgNotifications.title,
      message: orgNotifications.message,
      severity: orgNotifications.severity,
      source: orgNotifications.source,
      createdAt: orgNotifications.createdAt,
      metadata: orgNotifications.metadata,
      audience: orgNotifications.audience,
      subjectUserId: orgNotifications.subjectUserId,
      readAt: orgNotificationRecipients.readAt,
      recipient: orgNotificationRecipients.userId,
    })
    .from(orgNotifications);
  const joined = isOwner
    ? base.leftJoin(orgNotificationRecipients, recipientJoin)
    : base.innerJoin(orgNotificationRecipients, recipientJoin);
  const rows = await joined
    .where(and(eq(orgNotifications.orgId, orgId), isNull(orgNotificationRecipients.dismissedAt)))
    .orderBy(desc(orgNotifications.createdAt))
    .limit(limit);

  return rows
    .filter((r: any) =>
      mayReceiveSignal(
        { userId: viewer.userId, role: viewer.role, inOrg: true },
        (r.audience as SignalAudience | null) ?? { minRole: "MANAGER" },
        r.subjectUserId,
      ),
    )
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      severity: r.severity,
      source: r.source,
      createdAt: r.createdAt,
      readAt: r.readAt ?? null,
      entityId: typeof r.metadata?.entityId === "string" ? r.metadata.entityId : null,
    }));
}

/**
 * Marks Signals read (and optionally cleared) for this viewer only. Returns
 * the ids it touched; an id the viewer may not see is silently skipped, so the
 * route can 404 rather than confirm it exists.
 */
export async function markSignals(
  orgId: string,
  viewer: Viewer,
  ids: string[] | "all",
  opts: { dismiss?: boolean } = {},
): Promise<string[]> {
  const visible = await listSignalsFor(orgId, viewer, 500);
  const allowed = new Set(visible.map((s) => s.id));
  const targets = ids === "all" ? [...allowed] : ids.filter((id) => allowed.has(id));
  if (targets.length === 0) return [];
  const now = new Date();
  // Keep the first time it was read; clearing is only ever added, never undone here.
  const set: Record<string, unknown> = { readAt: sql`COALESCE(${orgNotificationRecipients.readAt}, excluded.read_at)` };
  if (opts.dismiss) set.dismissedAt = sql`excluded.dismissed_at`;
  // Upsert: the owner may be viewing a Signal written before their login
  // existed, so they have no recipient row to update yet.
  await db
    .insert(orgNotificationRecipients)
    .values(
      targets.map((notificationId) => ({
        notificationId,
        userId: viewer.userId,
        orgId,
        readAt: now,
        dismissedAt: opts.dismiss ? now : null,
      })),
    )
    .onConflictDoUpdate({
      target: [orgNotificationRecipients.notificationId, orgNotificationRecipients.userId],
      set,
    });
  return targets;
}
