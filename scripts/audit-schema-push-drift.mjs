#!/usr/bin/env node
/**
 * `shared/schema.ts` must describe what the migrations actually build.
 *
 * `drizzle-kit push` diffs the database against that file and executes the
 * difference. Anything the migrations created and the file does not declare
 * therefore looks like something to remove. That gap had grown to: two tables
 * (`audit_logs`, `domain_outbox`), a column (`admin_audit_logs.retention_until`),
 * ten CHECK constraints, six indexes — including the partial unique index that
 * stops one person holding two open shifts — and the NOT NULL on `org_id`
 * across ten core tables, which is the tenancy guarantee itself.
 *
 * "Nobody should run push against production" was the only thing standing
 * between that and a lost audit trail. With no terminal attached, push does not
 * even prompt. So this checks the gap instead of trusting the rule.
 *
 * Runs against the database in DATABASE_URL, which must be disposable: push is
 * invoked for real, because there is no dry-run mode. CI builds exactly the
 * right shape — db:push, then every migration — in the migration-sanity job.
 */
import { execFileSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error("audit-schema-push-drift: DATABASE_URL is required");
  process.exit(1);
}

let output = "";
try {
  output = execFileSync("npx", ["drizzle-kit", "push", "--verbose"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  if (!output) {
    console.error("audit-schema-push-drift: drizzle-kit push produced no output");
    process.exit(1);
  }
}

const lines = output.split("\n").map((l) => l.trim());
const recreated = new Set(
  lines.flatMap((l) => [...l.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/g)].map((m) => m[1])),
);

const findings = [];
for (const line of lines) {
  if (/^DROP TABLE /.test(line)) findings.push(["table", line]);
  else if (/ALTER TABLE .* DROP COLUMN /.test(line)) findings.push(["column", line]);
  else if (/ALTER COLUMN .* DROP NOT NULL/.test(line)) findings.push(["not-null", line]);
  else if (/DROP CONSTRAINT "[^"]*(_ck|_check)"/.test(line)) findings.push(["check", line]);
  else {
    const dropped = /^DROP INDEX "([^"]+)"/.exec(line);
    if (dropped && !recreated.has(dropped[1])) findings.push(["index", line]);
  }
}

if (findings.length > 0) {
  console.error("audit-schema-push-drift: push would REMOVE things the migrations built\n");
  for (const [kind, line] of findings) console.error(`  [${kind}] ${line}`);
  console.error(
    "\nDeclare each of these in shared/schema.ts so the file matches the" +
      "\nmigrations. Until then, running push against a real database destroys" +
      "\nthem — silently, if no terminal is attached.",
  );
  process.exit(1);
}

console.log("audit-schema-push-drift: ok (push would remove nothing)");
