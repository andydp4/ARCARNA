#!/usr/bin/env node
/**
 * Customer contact details are read in one place (v1.2 Phase 5, PRV-03).
 *
 * The customer view (server/services/customerView.ts) selects a role's columns
 * and never a contact column below admin. A new query that reads
 * `customers.phone`, selects a whole customer row, or calls
 * `storage.getCustomer(s)` would bypass it without anyone noticing — the
 * canary test only catches what a route actually sends, not what a worker or a
 * new report quietly reads. This fails CI instead.
 *
 * Every existing reader outside the view is listed below with why it may read,
 * and how many reads it has. The list is a ratchet: a file not on it, or a
 * file with more reads than listed, fails; a file with fewer prints a reminder
 * to lower its number, so the list only ever shrinks.
 *
 * Run: node scripts/audit-contact-fields.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["server", "apps/server/src", "packages"];
const VIEW = "server/services/customerView.ts";

/** file → { reads, why }. `reads` is the number of matches allowed today. */
const ALLOWED = {
  "apps/server/src/db/repos.ts": {
    reads: 8,
    why: "The domain engine's customer repository: it writes the row and returns it to the engine, never to a route.",
  },
  "server/storage.ts": {
    reads: 3,
    why: "Storage's own customer reads (getCustomer/getCustomers); callers are counted separately below.",
  },
  "server/lib/rfmService.ts": {
    reads: 1,
    why: "The admin-only RFM export (Q12, logged).",
  },
  "server/lib/bulkActionHandler.ts": {
    reads: 2,
    why: "Bulk actions: the customer export (admin only, logged) and per-row existence checks that return nothing.",
  },
  "server/routes/setupImports.ts": {
    reads: 2,
    why: "The import matches rows to existing customers; the preview sends back masks below admin (customerPreviewForRole).",
  },
  "server/services/invoices.ts": {
    reads: 1,
    why: "The Invoices list reads the email for admins and masks it for managers (Q7, Q13a).",
  },
  "server/routes/invoices.ts": {
    reads: 1,
    why: "Invoice PDF: name and billing address, which a VAT invoice needs (manager and above).",
  },
  "server/routes/receipts.ts": {
    reads: 1,
    why: "The receipt unsubscribe link finds the customer by a signed token and turns the email off; nothing is sent back.",
  },
  "server/workers/receiptEmailWorker.ts": {
    reads: 1,
    why: "The receipt worker sends to the email on file; it never returns it.",
  },
  "server/workers/customerWorker.ts": {
    reads: 2,
    why: "Recomputes metrics on the row; writes only.",
  },
  "server/workers/loyaltyWorker.ts": {
    reads: 1,
    why: "Loyalty accrual reads the row by id; writes points only.",
  },
  "server/whatsapp/store.ts": {
    reads: 1,
    why: "Matches an incoming WhatsApp number to a customer; the inbox list is masked by its route.",
  },
  "server/services/customerIntelligence.ts": {
    reads: 1,
    why: "Customer intelligence (manager and above, PRV-02); the service returns scores, not contact.",
  },
  "server/services/automationEngine.ts": {
    reads: 1,
    why: "Automations send messages to the customer; server-side only.",
  },
};

const PATTERNS = [
  { name: "contact column", re: /\bcustomers\.(?:phone|email|address|phoneE164)\b/g },
  { name: "whole customer row", re: /\.select\(\s*\)\s*\.from\(\s*(?:\w+\.)?customers\s*\)/g },
  { name: "whole customer row (storage)", re: /\bstorage\.getCustomers?\(/g },
  { name: "joined customer row", re: /\brow\.customers\.(?:phone|email|address)\b/g },
];

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments are prose about the fields, not reads of them. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const failures = [];
const shrunk = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.split(path.sep).join("/");
    if (rel === VIEW) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    let count = 0;
    const kinds = new Set();
    for (const { name, re } of PATTERNS) {
      const n = [...src.matchAll(re)].length;
      if (n) kinds.add(name);
      count += n;
    }
    const allowed = ALLOWED[rel];
    if (count === 0) {
      if (allowed) shrunk.push(`${rel}: 0 reads now (listed ${allowed.reads}) — remove it from ALLOWED`);
      continue;
    }
    if (!allowed) failures.push(`${rel}: ${count} read(s) (${[...kinds].join(", ")}) outside the customer view`);
    else if (count > allowed.reads) failures.push(`${rel}: ${count} read(s), ${allowed.reads} allowed (${[...kinds].join(", ")})`);
    else if (count < allowed.reads) shrunk.push(`${rel}: ${count} read(s) now (listed ${allowed.reads}) — lower its number`);
  }
}

for (const line of shrunk) console.warn(`audit-contact-fields: ${line}`);
if (failures.length > 0) {
  console.error("audit-contact-fields: customer contact fields read outside the customer view\n");
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\nRead customers through server/services/customerView.ts (listCustomersForRole, getCustomerForRole,\n" +
      "or a named, logged contact read). If a new reader genuinely needs the value, add it to ALLOWED\n" +
      "in this script with the reason, so review sees it.",
  );
  process.exit(1);
}
console.log("audit-contact-fields: OK");
