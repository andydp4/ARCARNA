/**
 * Force every active session to re-authenticate — used on a release where
 * everyone should be forced to log back in and see the What's New modal
 * (shared/whatsNew.ts).
 *
 * Which mechanism applies depends on AUTH_PROVIDER (server/authRuntime.ts):
 *  - clerk (production default): stateless JWTs, no local session store.
 *    Revokes every active Clerk session via the Backend API
 *    (clerkClient.sessions) — the only way to invalidate them server-side.
 *  - replit (legacy rollback): express-session + connect-pg-simple backed
 *    by the `sessions` Postgres table (apps/server/src/db/migrations/000_session_table.sql).
 *    Deletes every row — the next request on each browser 401s and the
 *    client's existing "session expired, please log in" flow takes over.
 *
 * Usage:
 *   npx tsx scripts/force-relogin-all.ts            # do it
 *   npx tsx scripts/force-relogin-all.ts --dry-run   # just report counts
 */
import { getAuthProvider } from "../server/authRuntime";

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function revokeAllClerkSessions(dryRun: boolean): Promise<void> {
  const { clerkClient } = await import("@clerk/express");
  let offset = 0;
  const pageSize = 500;
  let total = 0;
  let revoked = 0;

  for (;;) {
    const page = await clerkClient.sessions.getSessionList({
      status: "active",
      limit: pageSize,
      offset,
    });
    if (page.data.length === 0) break;
    total += page.data.length;

    if (!dryRun) {
      for (const session of page.data) {
        await clerkClient.sessions.revokeSession(session.id);
        revoked += 1;
      }
    }

    if (page.data.length < pageSize) break;
    offset += pageSize;
  }

  if (dryRun) {
    console.log(`[dry-run] Would revoke ${total} active Clerk session(s).`);
  } else {
    console.log(`Revoked ${revoked} of ${total} active Clerk session(s).`);
  }
}

async function deleteAllReplitSessions(dryRun: boolean): Promise<void> {
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");

  const result = await db.execute(sql`select count(*)::int as count from sessions`);
  const count = (result as { rows?: { count: number }[] }).rows?.[0]?.count ?? 0;

  if (dryRun) {
    console.log(`[dry-run] Would delete ${count} row(s) from the sessions table.`);
    return;
  }

  await db.execute(sql`delete from sessions`);
  console.log(`Deleted ${count} row(s) from the sessions table.`);
}

async function main() {
  const dryRun = isDryRun();
  const provider = getAuthProvider();
  console.log(`AUTH_PROVIDER resolved to "${provider}"${dryRun ? " (dry run)" : ""}.`);

  if (provider === "clerk") {
    await revokeAllClerkSessions(dryRun);
  } else {
    await deleteAllReplitSessions(dryRun);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("force-relogin-all failed:", err);
  process.exit(1);
});
