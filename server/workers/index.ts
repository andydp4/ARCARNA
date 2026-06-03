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
  dispatchPendingEvents 
} from "../eventBus";
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

// Worker runner state
let isRunning = false;
let dispatchInterval: NodeJS.Timeout | null = null;
let processInterval: NodeJS.Timeout | null = null;
let scheduledReportInterval: NodeJS.Timeout | null = null;
let rfmInterval: NodeJS.Timeout | null = null;

// Start the worker runner
export function startWorkerRunner(options?: {
  dispatchIntervalMs?: number;
  processIntervalMs?: number;
  concurrency?: number;
}): void {
  if (isRunning) {
    console.log('[WorkerRunner] Already running');
    return;
  }

  const {
    dispatchIntervalMs = 1000,
    processIntervalMs = 100,
    concurrency = 3,
  } = options || {};

  registerWorkers();
  isRunning = true;

  const workerId = `worker-${process.pid}-${Date.now()}`;
  console.log(`[WorkerRunner] Starting with ID: ${workerId}`);

  // Dispatch pending events periodically
  dispatchInterval = setInterval(async () => {
    try {
      await dispatchPendingEvents();
    } catch (error) {
      console.error('[WorkerRunner] Dispatch error:', error);
    }
  }, dispatchIntervalMs);

  // Process jobs concurrently
  processInterval = setInterval(async () => {
    try {
      const promises = [];
      for (let i = 0; i < concurrency; i++) {
        promises.push(processJob(workerId));
      }
      await Promise.all(promises);
    } catch (error) {
      console.error('[WorkerRunner] Process error:', error);
    }
  }, processIntervalMs);

  scheduledReportInterval = setInterval(async () => {
    try {
      const { processScheduledReports } = await import("../services/scheduledReportsRunner");
      await processScheduledReports();
    } catch (error) {
      console.error("[WorkerRunner] Scheduled reports tick failed:", error);
    }
  }, 60_000);

  rfmInterval = setInterval(async () => {
    try {
      const { processRfmNightly } = await import("../services/rfmRunner");
      await processRfmNightly();
    } catch (error) {
      console.error("[WorkerRunner] RFM nightly tick failed:", error);
    }
  }, 60_000);

  console.log('[WorkerRunner] Started successfully');
}

// Stop the worker runner
export function stopWorkerRunner(): void {
  if (!isRunning) {
    return;
  }

  if (dispatchInterval) {
    clearInterval(dispatchInterval);
    dispatchInterval = null;
  }

  if (processInterval) {
    clearInterval(processInterval);
    processInterval = null;
  }

  if (scheduledReportInterval) {
    clearInterval(scheduledReportInterval);
    scheduledReportInterval = null;
  }

  if (rfmInterval) {
    clearInterval(rfmInterval);
    rfmInterval = null;
  }

  isRunning = false;
  console.log('[WorkerRunner] Stopped');
}

// Check if worker runner is running
export function isWorkerRunnerRunning(): boolean {
  return isRunning;
}
