/**
 * Worker Runner - Job Processing System
 * 
 * This module provides the worker infrastructure for processing events.
 * It handles job acquisition, execution, retry logic, and logging.
 * 
 * SINGLE SOURCE OF TRUTH: Worker registration is driven by REQUIRED_WORKERS
 * from shared/schema.ts. Any worker referenced in REQUIRED_WORKERS must have
 * a factory registered in WORKER_FACTORIES below.
 */

import {
  acquireJob,
  completeJob,
  failJob,
  isEventProcessed,
  getEvent,
  dispatchPendingEvents,
  nextQueuedRunAt,
  runReconciliation,
} from "../eventBus";
import { setWorkerWaker } from "./wakeSignal";
import { EventEnvelope, EventType, WorkerName, WorkerResult, REQUIRED_WORKERS } from "../../shared/schema";
import { InventoryWorker } from "./inventoryWorker";
import { CustomerWorker } from "./customerWorker";
import { LoyaltyWorker } from "./loyaltyWorker";
import { InvoiceWorker } from "./invoiceWorker";
import { BusinessInsightsWorker } from "./businessInsightsWorker";
import { FinanceWorker } from "./financeWorker";
import { ExpensesWorker } from "./expensesWorker";
import { AutomationWorker } from "./automationWorker";
import { ReceiptEmailWorker } from "./receiptEmailWorker";

// Worker interface that all workers must implement
export interface IWorker {
  name: WorkerName;
  supports(eventType: EventType): boolean;
  handle(event: EventEnvelope): Promise<WorkerResult>;
}

// Worker factories - SINGLE SOURCE OF TRUTH for worker instantiation
// Any worker referenced in REQUIRED_WORKERS must have a factory here
const WORKER_FACTORIES: Record<WorkerName, () => IWorker> = {
  InventoryWorker: () => new InventoryWorker(),
  CustomerWorker: () => new CustomerWorker(),
  LoyaltyWorker: () => new LoyaltyWorker(),
  InvoiceWorker: () => new InvoiceWorker(),
  BusinessInsightsWorker: () => new BusinessInsightsWorker(),
  FinanceWorker: () => new FinanceWorker(),
  ExpensesWorker: () => new ExpensesWorker(),
  AutomationWorker: () => new AutomationWorker(),
  ReceiptEmailWorker: () => new ReceiptEmailWorker(),
};

// Worker registry
const workers: Map<WorkerName, IWorker> = new Map();

// Register all workers - driven by REQUIRED_WORKERS config
function registerWorkers() {
  // Collect all unique worker names from REQUIRED_WORKERS
  const requiredWorkerNames = new Set<WorkerName>();
  for (const eventType of Object.keys(REQUIRED_WORKERS) as EventType[]) {
    for (const workerName of REQUIRED_WORKERS[eventType]) {
      requiredWorkerNames.add(workerName);
    }
  }

  // Validate and instantiate workers
  const missingFactories: WorkerName[] = [];
  const workerNamesArray = Array.from(requiredWorkerNames);
  for (let i = 0; i < workerNamesArray.length; i++) {
    const workerName = workerNamesArray[i];
    const factory = WORKER_FACTORIES[workerName];
    if (!factory) {
      missingFactories.push(workerName);
      continue;
    }
    const worker = factory();
    workers.set(workerName, worker);
  }

  // Fail fast if any required workers are missing factories
  if (missingFactories.length > 0) {
    throw new Error(
      `[WorkerRunner] Missing factories for workers: ${missingFactories.join(', ')}. ` +
      `Add them to WORKER_FACTORIES in server/workers/index.ts`
    );
  }

  console.log(`[WorkerRunner] Registered ${workers.size} workers from REQUIRED_WORKERS config`);
}

// Get worker by name
function getWorker(name: string): IWorker | undefined {
  return workers.get(name as WorkerName);
}

// Process a single job
async function processJob(workerId: string): Promise<boolean> {
  const job = await acquireJob(workerId);
  
  if (!job) {
    return false;
  }

  const worker = getWorker(job.workerName);
  if (!worker) {
    console.error(`[WorkerRunner] Unknown worker: ${job.workerName}`);
    await failJob(
      job.jobId,
      job.eventId,
      job.workerName,
      `Unknown worker: ${job.workerName}`,
      job.eventId,
      'unknown',
      job.attempts,
      job.maxAttempts
    );
    return true;
  }

  // Check idempotency
  const alreadyProcessed = await isEventProcessed(job.eventId, job.workerName);
  if (alreadyProcessed) {
    console.log(`[WorkerRunner] Event ${job.eventId} already processed by ${job.workerName}`);
    await completeJob(
      job.jobId,
      job.eventId,
      job.workerName,
      'Already processed',
      job.eventId,
      'unknown'
    );
    return true;
  }

  // Get the event
  const event = await getEvent(job.eventId);
  if (!event) {
    console.error(`[WorkerRunner] Event not found: ${job.eventId}`);
    await failJob(
      job.jobId,
      job.eventId,
      job.workerName,
      `Event not found: ${job.eventId}`,
      job.eventId,
      'unknown',
      job.attempts,
      job.maxAttempts
    );
    return true;
  }

  // Build event envelope
  const envelope: EventEnvelope = {
    eventId: event.eventId,
    eventType: event.eventType as EventType,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    actor: event.actor as { type: 'user' | 'system'; id: string } | undefined,
    source: event.source || undefined,
    version: event.version,
    payload: event.payload,
  };

  try {
    console.log(`[WorkerRunner] Processing ${job.workerName} for event ${job.eventId}`);
    
    const result = await worker.handle(envelope);

    if (result.status === 'success' || result.status === 'already_processed') {
      await completeJob(
        job.jobId,
        job.eventId,
        job.workerName,
        result.summary,
        event.correlationId,
        event.eventType,
        result.data ?? null,
      );
      console.log(`[WorkerRunner] ${job.workerName} completed: ${result.summary}`);
    } else {
      await failJob(
        job.jobId,
        job.eventId,
        job.workerName,
        result.error || 'Worker returned failed status',
        event.correlationId,
        event.eventType,
        job.attempts,
        job.maxAttempts
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WorkerRunner] ${job.workerName} failed:`, errorMessage);
    
    await failJob(
      job.jobId,
      job.eventId,
      job.workerName,
      errorMessage,
      event.correlationId,
      event.eventType,
      job.attempts,
      job.maxAttempts
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// Adaptive worker loop
//
// Previously the runner used fixed-rate setInterval timers (process jobs every
// ~200ms x3, dispatch every 1s, plus three 60s service timers and a 5-min
// reconciliation). That issued ~16 DB queries/second around the clock, which
// kept Neon's serverless compute permanently awake and defeated scale-to-zero —
// so the database billed for ~730 compute-hours/month even with zero orders.
//
// The loop below instead self-schedules with exponential backoff. When there is
// work it polls fast; when idle it backs off toward a long ceiling and stops
// touching the DB, letting Neon suspend. `publishEvent` calls wakeWorkers() to
// pull the loop back to fast polling the instant an event is written, and future
// retries are scheduled precisely via nextQueuedRunAt() instead of busy-polling.
// The former 60s service timers and reconciliation now run as coarse
// "housekeeping" folded into the same loop.
// ---------------------------------------------------------------------------

// Worker runner state
let isRunning = false;
let workerId = "";
let loopTimer: NodeJS.Timeout | null = null;
let nextTickAt = Number.POSITIVE_INFINITY; // epoch ms of the currently-scheduled tick
let idleDelayMs = 0; // current backoff delay while idle
let lastHousekeepingAt = 0;
let ticking = false;

// Tunables (set from startWorkerRunner options)
let activeBaseMs = 250; // gap between polls while actively draining work
let idleCeilingMs = 15 * 60 * 1000; // max gap between polls when fully idle
let housekeepingIntervalMs = 15 * 60 * 1000; // scheduled reports / RFM / auto-close / reconcile
let concurrency = 3;

const MAX_DRAIN_ITERATIONS = 100; // cap work per tick so the loop stays responsive

function scheduleTick(delayMs: number): void {
  if (!isRunning) return;
  const when = Date.now() + Math.max(0, delayMs);
  // Keep an already-scheduled tick if it is sooner than the requested one.
  if (loopTimer && when >= nextTickAt) return;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  nextTickAt = when;
  loopTimer = setTimeout(() => {
    void runTick();
  }, Math.max(0, delayMs));
}

/** External kick (from publishEvent): reset backoff and run as soon as possible. */
function wake(): void {
  idleDelayMs = 0;
  scheduleTick(0);
}

/** Coarse background tasks that used to have their own 60s / 5-min timers. */
async function runHousekeeping(): Promise<void> {
  const tasks: Array<[string, () => Promise<unknown>]> = [
    ["scheduled-reports", async () =>
      (await import("../services/scheduledReportsRunner")).processScheduledReports()],
    ["rfm-nightly", async () =>
      (await import("../services/rfmRunner")).processRfmNightly()],
    ["cashier-shift-autoclose", async () =>
      (await import("../services/cashierShiftEngine")).autoCloseInactiveCashierShifts()],
    ["reconciliation", async () => runReconciliation()],
  ];
  for (const [name, fn] of tasks) {
    try {
      await fn();
    } catch (error) {
      console.error(`[WorkerRunner] Housekeeping (${name}) failed:`, error);
    }
  }
}

async function runTick(): Promise<void> {
  loopTimer = null;
  nextTickAt = Number.POSITIVE_INFINITY;
  if (!isRunning) return;
  if (ticking) {
    // A tick is already in flight (e.g. a wake landed mid-tick); retry shortly.
    scheduleTick(activeBaseMs);
    return;
  }

  ticking = true;
  let didWork = false;
  try {
    // Housekeeping piggybacks on ticks; runs at most once per housekeeping window.
    if (Date.now() - lastHousekeepingAt >= housekeepingIntervalMs) {
      lastHousekeepingAt = Date.now();
      await runHousekeeping();
    }

    // Turn pending outbox events into jobs.
    const dispatched = await dispatchPendingEvents();
    if (dispatched > 0) didWork = true;

    // Drain ready jobs until none remain (bounded per tick).
    for (let i = 0; i < MAX_DRAIN_ITERATIONS; i++) {
      const results = await Promise.all(
        Array.from({ length: concurrency }, () => processJob(workerId)),
      );
      if (!results.some(Boolean)) break;
      didWork = true;
    }
  } catch (error) {
    console.error("[WorkerRunner] Tick error:", error);
  } finally {
    ticking = false;
  }

  if (!isRunning) return;

  if (didWork) {
    // Stay hot while there is activity.
    idleDelayMs = activeBaseMs;
    scheduleTick(activeBaseMs);
    return;
  }

  // Idle: back off exponentially toward the ceiling.
  idleDelayMs = idleDelayMs > 0 ? Math.min(idleDelayMs * 2, idleCeilingMs) : activeBaseMs * 4;
  let delay = idleDelayMs;

  // If a retry is queued for the future, wake exactly then (bounded by the ceiling).
  try {
    const next = await nextQueuedRunAt();
    if (next) {
      const untilNext = next.getTime() - Date.now();
      delay = untilNext <= 0 ? 0 : Math.min(delay, Math.max(activeBaseMs, untilNext));
    }
  } catch {
    // Ignore lookahead failures; the ceiling still bounds the next poll.
  }

  scheduleTick(delay);
}

// Start the worker runner
export function startWorkerRunner(options?: {
  // dispatchIntervalMs is kept for backward compatibility; the adaptive loop no
  // longer uses a separate dispatch timer (dispatch runs every tick).
  dispatchIntervalMs?: number;
  processIntervalMs?: number;
  concurrency?: number;
  idleCeilingMs?: number;
  housekeepingIntervalMs?: number;
}): void {
  if (isRunning) {
    console.log('[WorkerRunner] Already running');
    return;
  }

  activeBaseMs = options?.processIntervalMs && options.processIntervalMs > 0
    ? options.processIntervalMs
    : 250;
  concurrency = options?.concurrency && options.concurrency > 0 ? options.concurrency : 3;
  idleCeilingMs = options?.idleCeilingMs && options.idleCeilingMs > 0
    ? options.idleCeilingMs
    : 15 * 60 * 1000;
  housekeepingIntervalMs = options?.housekeepingIntervalMs && options.housekeepingIntervalMs > 0
    ? options.housekeepingIntervalMs
    : 15 * 60 * 1000;

  registerWorkers();
  isRunning = true;
  idleDelayMs = 0;
  lastHousekeepingAt = 0; // force housekeeping on the first tick

  workerId = `worker-${process.pid}-${Date.now()}`;
  console.log(`[WorkerRunner] Starting with ID: ${workerId}`);

  // Let publishEvent nudge us out of the idle/dormant state.
  setWorkerWaker(wake);

  // Kick off immediately to drain any backlog left from a previous run.
  scheduleTick(0);

  console.log(
    `[WorkerRunner] Started (active ${activeBaseMs}ms, idle ceiling ${Math.round(
      idleCeilingMs / 1000,
    )}s, concurrency ${concurrency})`,
  );
}

// Stop the worker runner
export function stopWorkerRunner(): void {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  setWorkerWaker(null);

  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  nextTickAt = Number.POSITIVE_INFINITY;

  console.log('[WorkerRunner] Stopped');
}

// Check if worker runner is running
export function isWorkerRunnerRunning(): boolean {
  return isRunning;
}
