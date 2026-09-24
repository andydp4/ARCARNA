/**
 * The weekly staff job (v1.2 Phase 7C): after Monday's 06:00 close, judge
 * last week's loss-prevention measures and send the weekly digest.
 *
 * Runs on the worker loop's housekeeping pass, like the daily close. It waits
 * for the close of Sunday's trading day (which happens at Monday 06:00), so
 * the week it reads is finished and totalled. Exactly once per org per week:
 * the `staff_weekly_runs` row is the key, taken under an advisory lock.
 *
 * The digest is built for each recipient at send time from live figures and
 * emailed when email is set up. What is stored is one Signal with no figures
 * ("last week's digest is ready") and the run row's counts — never a name
 * beside a number.
 */
import { and, eq, ne, or, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { allowedUsers, dailyCloseRuns, organizations, staffWeeklyRuns } from "@shared/schema";
import { currentTradingDay } from "@shared/time/tradingDay";
import { isAtLeast } from "@shared/accessPolicy";
import { raiseLossPreventionFlags } from "./lossPreventionFlags";
import { buildWeeklyDigest, lastWeekOf, loadDigestTeam, type WeeklyDigest } from "./myPerformance";
import { notify } from "./signals";

type Executor = typeof db | any;

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The digest as an email body. Built in memory and sent; never written anywhere. */
export function digestHtml(d: WeeklyDigest): string {
  const own = d.own
    ? `<p>You completed <b>${d.own.completed}</b> orders and brought in <b>${money(d.own.valueBroughtIn)}</b>. ${escapeHtml(d.own.kpisMet)}.</p>` +
      (d.own.badges.length ? `<p>Badges: ${d.own.badges.map(escapeHtml).join(", ")}</p>` : "")
    : "<p>No completed orders for you last week.</p>";
  const median = d.teamMedian
    ? `<p>Team median (${d.teamMedian.people} people): ${d.teamMedian.completed ?? "—"} orders, ${money(d.teamMedian.valueBroughtIn ?? 0)} brought in.</p>`
    : "";
  const rows = d.rows.length
    ? `<table cellpadding="4"><tr><th align="left">Person</th><th>Orders</th><th>Value brought in</th><th>KPIs</th></tr>${d.rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.name)}</td><td align="right">${r.completed}</td><td align="right">${money(r.valueBroughtIn)}</td><td>${escapeHtml(r.kpisMet)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  return `<div style="font-family:sans-serif"><h2>Your week, ${d.week.from} to ${d.week.to}</h2>${own}<p>Commission accrued: ${money(d.commission)}</p>${median}${rows}<p style="color:#666">These figures are a guide. No pay decision is made from them alone.</p></div>`;
}

async function sendDigestEmail(to: string, d: WeeklyDigest): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL?.trim() || process.env.RECEIPT_FROM_EMAIL?.trim() || "receipts@arcarna.local";
    const result = await resend.emails.send({ from, to, subject: `Your week at work, ${d.week.from} to ${d.week.to}`, html: digestHtml(d) });
    return !result.error;
  } catch (error) {
    console.error("[StaffWeekly] digest email failed:", error);
    return false;
  }
}

/** Everyone the digest goes to: the org's staff and the owner. */
async function recipients(orgId: string): Promise<Array<{ userId: string; role: string; email: string | null }>> {
  const rows = await db
    .select({
      authUserId: allowedUsers.authUserId,
      replitUserId: allowedUsers.replitUserId,
      role: allowedUsers.role,
      isOwner: allowedUsers.isOwner,
      email: allowedUsers.email,
    })
    .from(allowedUsers)
    .where(
      or(
        and(eq(allowedUsers.orgId, orgId), ne(allowedUsers.role, "CUSTOMER")),
        and(isNull(allowedUsers.orgId), eq(allowedUsers.role, "SUPER_ADMIN")),
      ),
    );
  return rows
    .map((r) => ({ userId: r.authUserId || r.replitUserId, role: r.isOwner ? "SUPER_ADMIN" : String(r.role ?? ""), email: r.email ?? null }))
    .filter((r) => isAtLeast(r.role, "CASHIER"));
}

export interface WeeklyRunResult {
  orgId: string;
  weekStart: string;
  flagsRaised: number;
  digestsSent: number;
}

/** Runs one org's week. Returns null when it already ran or Sunday has not closed yet. */
export async function runStaffWeekForOrg(orgId: string, week: { from: string; to: string }): Promise<WeeklyRunResult | null> {
  const [closed] = await db
    .select({ id: dailyCloseRuns.id })
    .from(dailyCloseRuns)
    .where(and(eq(dailyCloseRuns.orgId, orgId), sql`${dailyCloseRuns.tradingDay} = ${week.to}`))
    .limit(1);
  if (!closed) return null;

  // Flags, the Signal and the run row commit together; the emails go after,
  // so a failure part-way can never send the same digest twice.
  const ran = await db.transaction(async (tx: Executor) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`staff_weekly:${orgId}:${week.from}`})) AS got`);
    const got = (lock as any).rows?.[0]?.got ?? (lock as any)[0]?.got;
    if (!got) return null;
    const [already] = await tx
      .select({ id: staffWeeklyRuns.id })
      .from(staffWeeklyRuns)
      .where(and(eq(staffWeeklyRuns.orgId, orgId), sql`${staffWeeklyRuns.weekStart} = ${week.from}`))
      .limit(1);
    if (already) return null;

    const flags = await raiseLossPreventionFlags(orgId, week, tx);
    const team = await loadDigestTeam(orgId, week.from, week.to);
    if (team.rows.length > 0) {
      await notify(
        {
          orgId,
          title: "Your week at work",
          message: `Last week's digest (${week.from} to ${week.to}) is ready in My performance.`,
          severity: "info",
          source: "staff_digest",
          metadata: { week: week.from },
        },
        tx,
      );
    }
    const [run] = await tx
      .insert(staffWeeklyRuns)
      .values({ orgId, weekStart: week.from, flagsRaised: flags.length, digestsSent: 0 })
      .returning({ id: staffWeeklyRuns.id });
    return { runId: run.id as string, flags: flags.length, team };
  });
  if (!ran) return null;

  let sent = 0;
  if (ran.team.rows.length > 0 && process.env.RESEND_API_KEY?.trim()) {
    for (const r of await recipients(orgId)) {
      if (!r.email) continue;
      // Built now, for this person, and dropped once sent.
      const digest = await buildWeeklyDigest(orgId, { userId: r.userId, role: r.role }, week, ran.team);
      if (await sendDigestEmail(r.email, digest)) sent += 1;
    }
    await db.update(staffWeeklyRuns).set({ digestsSent: sent }).where(eq(staffWeeklyRuns.id, ran.runId));
  }
  return { orgId, weekStart: week.from, flagsRaised: ran.flags, digestsSent: sent };
}

/** Housekeeping: every org whose last week has closed and not yet run. */
export async function runDueStaffWeeks(now: Date = new Date()): Promise<WeeklyRunResult[]> {
  const orgs = await db.select({ id: organizations.id, timezone: organizations.timezone }).from(organizations);
  const out: WeeklyRunResult[] = [];
  for (const org of orgs) {
    const week = lastWeekOf(currentTradingDay(org.timezone ?? "Europe/London", now));
    try {
      const r = await runStaffWeekForOrg(org.id, week);
      if (r) out.push(r);
    } catch (error) {
      console.error("[StaffWeekly] failed for org", org.id, week.from, error);
    }
  }
  return out;
}

