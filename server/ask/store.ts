/**
 * Ask arcarna's records (v1.2): the org's settings, the audit row per
 * question, and the month's spend the cap is checked against.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { askQuestions, askSettings } from "@shared/schema";
import {
  ASK_DEFAULT_SETTINGS,
  estimateCostGbp,
  scrubQuestion,
  type AskLogRow,
  type AskOutcome,
  type AskSettingsInput,
  type AskUsage,
} from "@shared/ask";
import { localCalendarDate, localInstant } from "@shared/time/tradingDay";
import { orgTimeZone } from "../services/tradingDayShift";
import { resolveUserNames } from "../services/userDisplayName";

export interface AskOrgSettings {
  monthlyCapGbp: number;
  usdToGbp: number;
}

export async function getAskSettings(orgId: string): Promise<AskOrgSettings> {
  const [row] = await db.select().from(askSettings).where(eq(askSettings.orgId, orgId)).limit(1);
  if (!row) return { ...ASK_DEFAULT_SETTINGS };
  return { monthlyCapGbp: Number(row.monthlyCapGbp), usdToGbp: Number(row.usdToGbp) };
}

export async function saveAskSettings(orgId: string, input: AskSettingsInput, userId: string): Promise<AskOrgSettings> {
  const values = {
    monthlyCapGbp: input.monthlyCapGbp.toFixed(2),
    usdToGbp: input.usdToGbp.toFixed(4),
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(askSettings)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: askSettings.orgId, set: values });
  return getAskSettings(orgId);
}

/** The first moment of this calendar month in the shop's time zone. */
export async function askMonthStart(orgId: string, now: Date = new Date()): Promise<{ start: Date; iso: string }> {
  const tz = await orgTimeZone(orgId);
  const iso = `${localCalendarDate(now, tz).slice(0, 7)}-01`;
  return { start: localInstant(iso, 0, tz), iso };
}

export async function askSpendThisMonth(orgId: string, now: Date = new Date()): Promise<{ spentGbp: number; questions: number; monthStart: string }> {
  const month = await askMonthStart(orgId, now);
  const [row] = await db
    .select({
      spent: sql<string>`COALESCE(SUM(${askQuestions.costGbp}), 0)`,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(askQuestions)
    .where(and(eq(askQuestions.orgId, orgId), gte(askQuestions.askedAt, month.start)));
  return { spentGbp: Number(row?.spent ?? 0) || 0, questions: Number(row?.n ?? 0) || 0, monthStart: month.iso };
}

/** The audit row. Never the answer; the question scrubbed of contact and card details. */
export async function recordAskQuestion(args: {
  orgId: string;
  userId: string;
  role: string;
  question: string;
  tools: string[];
  model: string;
  usage: AskUsage;
  usdToGbp: number;
  outcome: AskOutcome;
  servedByFallback: boolean;
}): Promise<void> {
  const q = scrubQuestion(args.question);
  await db.insert(askQuestions).values({
    orgId: args.orgId,
    userId: args.userId,
    role: args.role,
    question: q.text,
    questionScrubbed: q.scrubbed,
    tools: args.tools,
    model: args.model.slice(0, 64),
    servedByFallback: args.servedByFallback,
    inputTokens: args.usage.inputTokens,
    outputTokens: args.usage.outputTokens,
    cacheReadTokens: args.usage.cacheReadTokens,
    cacheWriteTokens: args.usage.cacheWriteTokens,
    costGbp: estimateCostGbp(args.usage, args.usdToGbp, args.model).toFixed(4),
    outcome: args.outcome,
  });
}

/** The admins' question log: the latest questions, newest first. */
export async function listAskLog(orgId: string, limit = 100): Promise<AskLogRow[]> {
  const rows = await db
    .select()
    .from(askQuestions)
    .where(eq(askQuestions.orgId, orgId))
    .orderBy(desc(askQuestions.askedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  const names = await resolveUserNames(rows.map((r) => r.userId));
  return rows.map((r) => ({
    id: r.id,
    askedAt: r.askedAt.toISOString(),
    userId: r.userId,
    name: names.get(r.userId) ?? "Unknown",
    role: r.role,
    question: r.question,
    questionScrubbed: r.questionScrubbed,
    tools: r.tools ?? [],
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    costGbp: Number(r.costGbp),
    outcome: r.outcome as AskOutcome,
    servedByFallback: r.servedByFallback,
  }));
}
