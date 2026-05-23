/**
 * Links allowed_users rows to a Clerk auth_user_id by email (phased migration).
 *
 * Usage:
 *   npx tsx scripts/link-clerk-auth-by-email.ts --email user@example.com --clerk-user-id user_xxx
 *   npx tsx scripts/link-clerk-auth-by-email.ts --dry-run --email user@example.com --clerk-user-id user_xxx
 *
 * Skips when multiple allowed_users share the same email in different orgs (no silent merge).
 */
import { db } from "../server/db";
import { allowedUsers } from "../shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const emailIdx = args.indexOf("--email");
  const clerkIdx = args.indexOf("--clerk-user-id");
  const email = emailIdx >= 0 ? args[emailIdx + 1] : undefined;
  const clerkUserId = clerkIdx >= 0 ? args[clerkIdx + 1] : undefined;
  if (!email || !clerkUserId) {
    console.error(
      "Usage: tsx scripts/link-clerk-auth-by-email.ts [--dry-run] --email EMAIL --clerk-user-id USER_ID",
    );
    process.exit(1);
  }
  return { email, clerkUserId, dryRun };
}

async function main() {
  const { email, clerkUserId, dryRun } = parseArgs();
  const normalized = email.trim().toLowerCase();

  const rows = await db
    .select()
    .from(allowedUsers)
    .where(sql`lower(trim(${allowedUsers.email})) = ${normalized}`);

  if (rows.length === 0) {
    console.log(`No allowed_users row for email: ${email}`);
    process.exit(0);
  }

  if (rows.length > 1) {
    const orgKeys = new Set(rows.map((r) => r.orgId ?? "__none__"));
    if (orgKeys.size > 1) {
      console.error(
        `Refusing to link: ${rows.length} rows share email ${email} across different orgs.`,
      );
      console.error("Link each org explicitly or resolve duplicates first.");
      process.exit(1);
    }
  }

  const row = rows[0]!;
  console.log(
    `Target: allowed_users id=${row.id} replit_user_id=${row.replitUserId} org=${row.orgId ?? "none"}`,
  );

  if (dryRun) {
    console.log(`[dry-run] Would set auth_user_id=${clerkUserId} auth_provider=clerk`);
    process.exit(0);
  }

  const result = await storage.tryLinkAuthUserByEmail({
    email,
    newAuthUserId: clerkUserId,
    authProvider: "clerk",
  });

  if (!result.linked) {
    console.error(`Link failed: ${result.reason ?? "unknown"}`);
    process.exit(1);
  }

  console.log("Linked successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
