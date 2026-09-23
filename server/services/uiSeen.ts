import { db } from "../db";
import { userUiSeen } from "@shared/schema";
import { eq } from "drizzle-orm";

/** Every one-time UI key this account has already seen. */
export async function listSeenUiKeys(userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: userUiSeen.key })
    .from(userUiSeen)
    .where(eq(userUiSeen.userId, userId));
  return rows.map((r) => r.key);
}

/** Idempotent: marking something seen twice (two tabs, a retry) is a no-op. */
export async function markUiKeysSeen(userId: string, keys: string[]): Promise<void> {
  const distinct = [...new Set(keys)];
  if (!distinct.length) return;
  await db
    .insert(userUiSeen)
    .values(distinct.map((key) => ({ userId, key })))
    .onConflictDoNothing();
}
