#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const METHODS = [
  "getProducts",
  "getCustomers",
  "getOrders",
  "getInvoices",
  "getLocations",
  "getLoyaltyTiers",
  "getPromotions",
  "getOverheadExpenses",
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__") continue;
      walk(p, acc);
    } else if (p.endsWith(".ts")) {
      acc.push(p);
    }
  }
  return acc;
}

const bad = [];
for (const f of walk("server")) {
  const src = readFileSync(f, "utf8");
  for (const method of METHODS) {
    const regex = new RegExp(`storage\\.${method}\\(\\s*\\)`, "g");
    let m;
    while ((m = regex.exec(src))) {
      bad.push(`${f}: storage.${method}()`);
    }
  }
}

if (bad.length) {
  console.error("Unscoped storage calls (missing orgId):\n" + bad.join("\n"));
  process.exit(1);
}

console.log("audit-storage-orgid: ok");
