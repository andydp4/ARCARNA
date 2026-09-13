import { db } from "../db";
import { allowedUsers, users } from "@shared/schema";
import { inArray, or } from "drizzle-orm";

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
 *
 * `allowed_users` fallback (N3a): the Operations Centre board names the
 * loader, the assignee and the completer of every card, but a seeded org
 * (`scripts/seed.ts`) — and any org whose staff have never triggered a
 * `users` upsert — has rows in `allowed_users` and NONE in `users`. Without
 * this fallback every one of those names would render as a bare auth-subject
 * id (`seed-cashier`) on a screen the owner asked to be readable at a glance.
 * Matched the same way `storage.ts`'s `allowedUserSubjectWhere` already
 * resolves a subject to a row: either `authUserId` (Clerk) or the legacy
 * `replitUserId` may hold it.
 */
export type UserDisplayNames = Map<string, string>;

export async function resolveUserNames(userIds: Iterable<string>): Promise<UserDisplayNames> {
  const ids = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  // Falls back to the id for anyone neither table knows — an account since
  // deleted still has to render as something.
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

  const resolved = new Set<string>();
  for (const row of rows) {
    const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    names.set(row.id, full || row.email || row.id);
    resolved.add(row.id);
  }

  const stillUnresolved = ids.filter((id) => !resolved.has(id));
  if (stillUnresolved.length === 0) return names;

  const allowedRows = await db
    .select({
      authUserId: allowedUsers.authUserId,
      replitUserId: allowedUsers.replitUserId,
      name: allowedUsers.name,
      email: allowedUsers.email,
    })
    .from(allowedUsers)
    .where(
      or(
        inArray(allowedUsers.authUserId, stillUnresolved),
        inArray(allowedUsers.replitUserId, stillUnresolved),
      ),
    );

  for (const row of allowedRows) {
    const subject = stillUnresolved.find((id) => id === row.authUserId || id === row.replitUserId);
    if (!subject) continue;
    const name = row.name?.trim();
    names.set(subject, name || row.email || subject);
  }
  return names;
}

export async function resolveUserName(userId: string): Promise<string> {
  const names = await resolveUserNames([userId]);
  return names.get(userId) ?? userId;
}
