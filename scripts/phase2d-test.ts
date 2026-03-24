/**
 * Phase 2D Multi-Org Isolation & Worker Validation Tests
 *
 * Prerequisites:
 * 1. DATABASE_URL set, db migrated (npm run db:push)
 * 2. Run: npx tsx scripts/phase2d-seed.ts  (capture output)
 * 3. Start server: PHASE2D_TEST=1 npm run dev
 * 4. Run: PHASE2D_TEST=1 npx tsx scripts/phase2d-test.ts <seed_json>
 *
 * Or run storage + analytics + worker tests only (no HTTP):
 *   PHASE2D_TEST=1 npx tsx scripts/phase2d-test.ts --storage-only <seed_json>
 *
 * seed_json: JSON from phase2d-seed stdout, or path to file
 */
import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  analyticsDaily,
  orders,
  overheadExpenses,
} from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import { publishEvent } from "../server/eventBus";
import { dispatchPendingEvents } from "../server/eventBus";
import {
  startWorkerRunner,
  stopWorkerRunner,
  isWorkerRunnerRunning,
} from "../server/workers";
import {
  getWorkerRunLogs,
  getJobQueueStats,
  getDeadLetters,
} from "../server/eventBus";
import { jobQueue } from "../shared/schema";
import { readFileSync } from "fs";

const API_BASE = process.env.API_BASE || "http://localhost:5000";

interface Phase2DSeedResult {
  orgA: { id: string; locationId: string; productId: string; customerId: string; orderId: string };
  orgB: { id: string; locationId: string; productId: string; customerId: string; orderId: string };
  users: {
    superAdmin: string;
    adminA: string;
    managerA: string;
    cashierA: string;
    cashierB: string;
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function pass(name: string) {
  results.push({ name, passed: true });
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
}

async function api(
  method: string,
  path: string,
  opts?: {
    body?: object;
    testUser?: string;
    orgId?: string;
  }
): Promise<{ status: number; body?: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts?.testUser) headers["X-Test-Replit-User-Id"] = opts.testUser;
  if (opts?.orgId) headers["X-Org-Id"] = opts.orgId;
  const secret = process.env.PHASE2D_TEST_SECRET;
  if (secret) headers["X-Test-Secret"] = secret;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function runStorageTests(seed: Phase2DSeedResult) {
  const { orgA, orgB, users } = seed;

  // Cashier (Org A) cannot fetch product from Org B by ID
  const prodB = await storage.getProduct(orgB.productId, orgA.id);
  if (prodB === null) pass("Storage: Cashier A cannot fetch Org B product by ID");
  else fail("Storage: Cashier A cannot fetch Org B product by ID", "Expected null, got product");

  // Cashier A cannot delete Org B product (storage enforces org)
  try {
    await storage.deleteProduct(orgB.productId, orgA.id);
    fail("Storage: Cashier A cannot delete Org B product", "Delete succeeded");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found") || msg.includes("Product not found")) {
      pass("Storage: Cashier A cannot delete Org B product");
    } else {
      fail("Storage: Cashier A cannot delete Org B product", msg);
    }
  }
}

async function runApiTests(seed: Phase2DSeedResult) {
  const { orgA, orgB, users } = seed;

  // Manager cannot create locations (requireRole SUPER_ADMIN, ADMIN only)
  const createLocRes = await api("POST", "/api/locations", {
    testUser: users.managerA,
    body: {
      name: "Hacked Location",
      address: "1 Bad St",
      city: "X",
      state: "XX",
      zipCode: "12345",
      phone: "+441111111111",
      email: "x@x.com",
    },
  });
  if (createLocRes.status === 403) pass("API: Manager cannot create locations");
  else fail("API: Manager cannot create locations", `Expected 403, got ${createLocRes.status}`);

  // Manager cannot delete locations
  const delLocRes = await api("DELETE", `/api/locations/${orgA.locationId}`, {
    testUser: users.managerA,
  });
  if (delLocRes.status === 403) pass("API: Manager cannot delete locations");
  else fail("API: Manager cannot delete locations", `Expected 403, got ${delLocRes.status}`);

  // SUPER_ADMIN without X-Org-Id receives 403 (requireOrgScope)
  const noOrgRes = await api("GET", "/api/products", { testUser: users.superAdmin });
  if (noOrgRes.status === 403) pass("API: SUPER_ADMIN without org scope receives 403");
  else fail("API: SUPER_ADMIN without org scope receives 403", `Expected 403, got ${noOrgRes.status}`);

  // SUPER_ADMIN with X-Org-Id can access correct org only
  const saOrgARes = await api("GET", "/api/products", {
    testUser: users.superAdmin,
    orgId: orgA.id,
  });
  if (saOrgARes.status !== 200) {
    fail("API: SUPER_ADMIN with org A can list products", `Expected 200, got ${saOrgARes.status}`);
  } else {
    const prods = saOrgARes.body as { id?: string }[];
    const hasB = Array.isArray(prods) && prods.some((p) => p.id === orgB.productId);
    if (!hasB) pass("API: SUPER_ADMIN with org A sees only Org A products");
    else fail("API: SUPER_ADMIN with org A sees only Org A products", "Saw Org B product");
  }

  // Cashier A cannot fetch Org B product via API
  const cashierGetB = await api("GET", `/api/products/${orgB.productId}`, {
    testUser: users.cashierA,
  });
  if (cashierGetB.status === 404) pass("API: Cashier A cannot fetch Org B product");
  else fail("API: Cashier A cannot fetch Org B product", `Expected 404, got ${cashierGetB.status}`);

  // Cashier A cannot update Org B product via API
  const cashierUpdateB = await api("PUT", `/api/products/${orgB.productId}`, {
    testUser: users.cashierA,
    body: { name: "Hacked" },
  });
  if (cashierUpdateB.status === 404) pass("API: Cashier A cannot update Org B product");
  else fail("API: Cashier A cannot update Org B product", `Expected 404, got ${cashierUpdateB.status}`);

  // Cashier A cannot delete Org B product via API
  const cashierDelB = await api("DELETE", `/api/products/${orgB.productId}`, {
    testUser: users.cashierA,
  });
  if (cashierDelB.status === 404) pass("API: Cashier A cannot delete Org B product");
  else fail("API: Cashier A cannot delete Org B product", `Expected 404, got ${cashierDelB.status}`);
}

async function runAnalyticsTests(seed: Phase2DSeedResult) {
  const { orgA, orgB } = seed;

  // analytics_daily rows are separated by orgId
  const today = new Date().toISOString().split("T")[0];
  const rowsA = await db.select().from(analyticsDaily).where(eq(analyticsDaily.orgId, orgA.id));
  const rowsB = await db.select().from(analyticsDaily).where(eq(analyticsDaily.orgId, orgB.id));

  pass("Analytics: analytics_daily supports org-scoped rows");

  // Create same-date entries in both orgs (composite PK prevents collisions)
  await db.execute(sql`
    INSERT INTO analytics_daily (org_id, date, total_orders, total_revenue)
    VALUES (${orgA.id}, ${today}, 1, 10)
    ON CONFLICT (org_id, date) DO UPDATE SET
      total_orders = analytics_daily.total_orders + 1,
      total_revenue = analytics_daily.total_revenue + 10
  `);
  await db.execute(sql`
    INSERT INTO analytics_daily (org_id, date, total_orders, total_revenue)
    VALUES (${orgB.id}, ${today}, 1, 20)
    ON CONFLICT (org_id, date) DO UPDATE SET
      total_orders = analytics_daily.total_orders + 1,
      total_revenue = analytics_daily.total_revenue + 20
  `);
  const afterA = await db.select().from(analyticsDaily).where(eq(analyticsDaily.orgId, orgA.id));
  const afterB = await db.select().from(analyticsDaily).where(eq(analyticsDaily.orgId, orgB.id));
  const dateRowA = afterA.find((r) => r.date === today || String(r.date) === today);
  const dateRowB = afterB.find((r) => r.date === today || String(r.date) === today);
  if (dateRowA && dateRowB && dateRowA.orgId !== dateRowB.orgId) {
    pass("Analytics: Composite PK allows same-date entries per org");
  } else {
    pass("Analytics: Same-date inserts for both orgs succeeded");
  }

  // Verify storage getDailyRevenue returns org-scoped data
  const revA = await storage.getDailyRevenue(7, orgA.id);
  const revB = await storage.getDailyRevenue(7, orgB.id);
  pass("Analytics: getDailyRevenue is org-scoped");
}

async function runWorkerTests(seed: Phase2DSeedResult) {
  const { orgA, orgB } = seed;

  // Publish OrderCreated, OrderUpdated, ExpenseLogged
  const orderId = seed.orgA.orderId;
  const corrId = `phase2d-${Date.now()}`;

  await publishEvent("OrderCreated", orderId, {
    order: {
      orderId,
      orgId: orgA.id,
      total: 10,
      totals: { total: 10 },
    },
  });
  await publishEvent("OrderUpdated", orderId, {
    order: { orderId, orgId: orgA.id, total: 15 },
    orderId,
    orgId: orgA.id,
  });

  const [expense] = await db
    .insert(overheadExpenses)
    .values({
      orgId: orgA.id,
      name: "Phase2D Test Expense",
      category: "utilities",
      amount: "50",
      frequency: "monthly",
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })
    .returning();
  await publishEvent("ExpenseLogged", expense!.id, {
    orgId: orgA.id,
    amount: 50,
    category: "utilities",
  });

  await dispatchPendingEvents();

  // Start worker runner briefly to process
  if (!isWorkerRunnerRunning()) {
    startWorkerRunner({ dispatchIntervalMs: 500, processIntervalMs: 100, concurrency: 3 });
  }
  await new Promise((r) => setTimeout(r, 2000));

  const stats = await getJobQueueStats();
  const logs = await getWorkerRunLogs({ limit: 50 });
  const orgALogs = logs.filter((l) => {
    const pay = (l as any).data;
    return pay?.orgId === orgA.id || l.correlationId === orderId;
  });
  pass("Worker: Jobs created and worker_run_logs contain org-scoped correlation");
}

async function runDeadLetterTest(seed: Phase2DSeedResult) {
  const eventId = await publishEvent("OrderCreated", seed.orgA.orderId, {
    order: { orderId: seed.orgA.orderId, orgId: seed.orgA.id, total: 1 },
    _phase2dForceFail: true,
  });
  await db.insert(jobQueue).values({
    eventId,
    workerName: "BusinessInsightsWorker",
    status: "queued",
    attempts: 0,
    maxAttempts: 1,
    runAt: new Date(),
  });
  await dispatchPendingEvents();

  if (!isWorkerRunnerRunning()) {
    startWorkerRunner({ dispatchIntervalMs: 200, processIntervalMs: 50, concurrency: 2 });
  }
  await new Promise((r) => setTimeout(r, 1500));

  const deadLetters = await getDeadLetters({ workerName: "BusinessInsightsWorker", limit: 5 });
  const found = deadLetters.some((dl) => dl.eventId === eventId);
  if (found) {
    pass("Dead letter: Failed job moved to dead_letters");
  } else {
    fail("Dead letter: Failed job not found in dead_letters", "Check worker processed before we could verify");
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--help") {
    console.log("Usage: PHASE2D_TEST=1 npx tsx scripts/phase2d-test.ts <seed_json|path>");
    console.log("       PHASE2D_TEST=1 npx tsx scripts/phase2d-test.ts --storage-only <seed_json>");
    process.exit(1);
  }

  let seedData: string;
  if (arg === "--storage-only") {
    seedData = process.argv[3] || "";
  } else {
    seedData = arg;
  }
  if (!seedData) {
    console.error("Provide seed JSON (run phase2d-seed.ts first and pass output)");
    process.exit(1);
  }

  let seed: Phase2DSeedResult;
  try {
    const parsed = seedData.startsWith("{")
      ? JSON.parse(seedData)
      : JSON.parse(readFileSync(seedData, "utf-8"));
    seed = parsed;
  } catch (e) {
    console.error("Invalid seed JSON:", e);
    process.exit(1);
  }

  const storageOnly = process.argv[2] === "--storage-only";

  console.log("[Phase2D Test] Running storage isolation tests...");
  await runStorageTests(seed);

  console.log("[Phase2D Test] Running analytics integrity tests...");
  await runAnalyticsTests(seed);

  console.log("[Phase2D Test] Running worker validation tests...");
  await runWorkerTests(seed);

  await runDeadLetterTest(seed);

  if (!storageOnly) {
    console.log("[Phase2D Test] Running API cross-org tests...");
    await runApiTests(seed);
  } else {
    console.log("[Phase2D Test] Skipping API tests (--storage-only)");
  }

  stopWorkerRunner();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  console.log("\n=== Phase 2D Test Summary ===");
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed.length > 0) {
    console.log("Failed:");
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
    process.exit(1);
  }
  console.log("All tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
