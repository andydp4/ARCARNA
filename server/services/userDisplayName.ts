import { db } from "../db";
import { users } from "@shared/schema";
import { inArray } from "drizzle-orm";

/**
 * What to call a person, in one place.
 *
 * Three routes had grown their own copy of "full name, else email, else the
 * raw id" — the shift Z-report, the shifts list, and the refund history on an
 * order — and they had already drifted: one fell back to the email, another
 * went straight from a missing name to a UUID. A UUID where a name should be
 * is not a display name, it is a bug the operator has to decode.
 *
 * Resolving by id alone matches what those callers already did. Every one of
 * them reaches this holding a row it has already scoped to its own org, so the
 * id being named is one the caller was entitled to see.
 */
export type UserDisplayNames = Map<string, string>;

export async function resolveUserNames(userIds: Iterable<string>): Promise<UserDisplayNames> {
  const ids = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  // Falls back to the id for anyone the users table does not know — a shift
  // opened by an account since deleted still has to render.
  const names: UserDisplayNames = new Map(ids.map((id) => [id, id]));
  if (ids.length === 0) return names;

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, ids));

  for (const row of rows) {
    const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    names.set(row.id, full || row.email || row.id);
  }
  return names;
}

export async function resolveUserName(userId: string): Promise<string> {
  const names = await resolveUserNames([userId]);
  return names.get(userId) ?? userId;
}
