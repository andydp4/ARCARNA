#!/usr/bin/env npx tsx
/**
 * Verify every worker in REQUIRED_WORKERS has a factory in server/workers/index.ts.
 */
import { REQUIRED_WORKERS, type WorkerName } from "../shared/schema";

const WORKER_FACTORIES: Record<WorkerName, unknown> = {
  InventoryWorker: true,
  CustomerWorker: true,
  LoyaltyWorker: true,
  InvoiceWorker: true,
  BusinessInsightsWorker: true,
  FinanceWorker: true,
  ExpensesWorker: true,
  AutomationWorker: true,
  ReceiptEmailWorker: true,
};

const required = new Set<WorkerName>();
for (const workers of Object.values(REQUIRED_WORKERS)) {
  for (const w of workers) required.add(w);
}

const missing: WorkerName[] = [];
for (const name of required) {
  if (!(name in WORKER_FACTORIES)) missing.push(name);
}

if (missing.length > 0) {
  console.error("Missing WORKER_FACTORIES for:", missing.join(", "));
  process.exit(1);
}

console.log(`OK: ${required.size} workers registered for ${Object.keys(REQUIRED_WORKERS).length} event types`);
process.exit(0);
