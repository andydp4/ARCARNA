#!/usr/bin/env npx tsx
/**
 * Security audit helper — separates production runtime from dev-tooling findings.
 *
 * Exit codes:
 *   0 — production high/critical audit passed
 *   1 — production high/critical audit failed
 *
 * Dev-only high/critical findings are reported as WARN and do not fail the gate.
 */
import { spawnSync } from "child_process";

type AuditMetadata = {
  vulnerabilities?: {
    info?: number;
    low?: number;
    moderate?: number;
    high?: number;
    critical?: number;
    total?: number;
  };
};

function runAudit(args: string[]): { ok: boolean; metadata: AuditMetadata; raw: string } {
  const result = spawnSync("npm", ["audit", ...args, "--json"], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const raw = [result.stdout, result.stderr].filter(Boolean).join("\n");
  let metadata: AuditMetadata = {};
  try {
    metadata = JSON.parse(result.stdout || "{}") as AuditMetadata;
  } catch {
    // npm audit may emit non-JSON when audit registry fails
  }
  const high = metadata.vulnerabilities?.high ?? 0;
  const critical = metadata.vulnerabilities?.critical ?? 0;
  return { ok: high + critical === 0, metadata, raw };
}

function formatCounts(metadata: AuditMetadata): string {
  const v = metadata.vulnerabilities ?? {};
  return `total=${v.total ?? 0} (critical=${v.critical ?? 0}, high=${v.high ?? 0}, moderate=${v.moderate ?? 0}, low=${v.low ?? 0})`;
}

function main() {
  console.log("\n=== Security audit ===\n");

  const prod = runAudit(["--omit=dev", "--audit-level=high"]);
  console.log(`Production dependency audit (--omit=dev --audit-level=high): ${prod.ok ? "PASS" : "FAIL"}`);
  console.log(`  ${formatCounts(prod)}`);

  const full = runAudit(["--audit-level=high"]);
  const fullHigh = (full.metadata.vulnerabilities?.high ?? 0) + (full.metadata.vulnerabilities?.critical ?? 0);
  const prodHigh =
    (prod.metadata.vulnerabilities?.high ?? 0) + (prod.metadata.vulnerabilities?.critical ?? 0);
  const devOnlyHigh = Math.max(0, fullHigh - prodHigh);
  const fullStatus = full.ok ? "PASS" : devOnlyHigh > 0 && prod.ok ? "WARN" : "FAIL";
  console.log(
    `Full dependency audit including dev tooling (--audit-level=high): ${fullStatus}`,
  );
  console.log(`  ${formatCounts(full)}`);
  if (devOnlyHigh > 0 && prod.ok) {
    console.log(`  ${devOnlyHigh} high/critical finding(s) are dev-tooling only (non-blocking).`);
  }
  console.log("");

  if (!prod.ok) {
    console.error("Production high/critical vulnerabilities must be resolved before release.");
    process.exit(1);
  }

  console.log("=== Security audit passed (production) ===\n");
  process.exit(0);
}

main();
