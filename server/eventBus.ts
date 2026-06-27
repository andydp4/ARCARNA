/**
 * Event Bus - Transactional Outbox Pattern
 * 
 * This module provides event publishing and dispatching functionality
 * using the transactional outbox pattern for reliable event delivery.
 * 
 * Key concepts:
 * - Events are written to event_outbox within the same transaction as business operations
 * - A dispatcher polls pending events and creates jobs for each required worker
 * - Workers process jobs asynchronously with retry and dead-letter handling
 */

import { db } from "./db";
import { withRetries } from "./lib/dbUtils";
import { 
  eventOutbox, 
  jobQueue, 
  processedEvents,
  workerRunLogs,
  deadLetters,
  EventType, 
  EventEnvelope, 
  REQUIRED_WORKERS, 
  WorkerName 
} from "../shared/schema";
import { eq, and, lte, sql, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EventWriteClient = typeof db | DbTx;

// Generate a unique event ID using UUID v4
function generateEventId(): string {
  return randomUUID();
}

/**
 * Publish an event to the outbox
 * This should be called within the same transaction as the business operation
 * @param txClient - Optional transaction client for transactional outbox pattern
 */
export async function publishEvent<TPayload>(
  eventType: EventType,
  correlationId: string,
  payload: TPayload,
  options?: {
    actor?: { type: 'user' | 'system'; id: string };
    source?: string;
  },
  txClient?: EventWriteClient,
): Promise<string> {
  const eventId = generateEventId();
  const now = new Date();
  const actor = options?.actor || { type: 'system' as const, id: 'engine' };
  const source = options?.source || 'api';
  const payloadJson = JSON.stringify(payload as unknown as Record<string, unknown>);

  if (txClient) {
    // Same Postgres transaction as apps/server order writes (may use a different Drizzle schema).
    await txClient.execute(sql`
      INSERT INTO event_outbox (
        event_id, event_type, occurred_at, correlation_id, actor, source, version, payload, status, created_at
      ) VALUES (
        ${eventId},
        ${eventType},
        ${now},
        ${correlationId},
        ${JSON.stringify(actor)}::jsonb,
        ${source},
        1,
        ${payloadJson}::jsonb,
        'pending',
        ${now}
      )
    `);
  } else {
    await db.insert(eventOutbox).values({
      eventId,
      eventType,
      occurredAt: now,
      correlationId,
      actor,
      source,
      version: 1,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      createdAt: now,
    });
  }

  console.log(`[EventBus] Published event: ${eventType} (${eventId}) for ${correlationId}`);
  return eventId;
}

/** Publish inside an existing DB transaction (order + outbox atomicity). */
export async function publishEventTx<TPayload>(
  tx: EventWriteClient,
  eventType: EventType,
  correlationId: string,
  payload: TPayload,
  options?: {
    actor?: { type: 'user' | 'system'; id: string };
    source?: string;
  },
): Promise<string> {
  return publishEvent(eventType, correlationId, payload, options, tx);
}

/**
 * Helper to create a transactional event publisher bound to a transaction
 */
export function createTransactionalPublisher(tx: typeof db) {
  return async <TPayload>(
    eventType: EventType,
    correlationId: string,
    payload: TPayload,
    options?: {
      actor?: { type: 'user' | 'system'; id: string };
      source?: string;
    }
  ) => publishEvent(eventType, correlationId, payload, options, tx);
}

/**
 * Dispatch pending events by creating jobs for required workers
 * This runs in a separate process/interval to ensure events are processed
 * Uses transaction to ensure atomicity - only marks dispatched after all jobs created
 */
export async function dispatchPendingEvents(): Promise<number> {
  return withRetries(async () => dispatchPendingEventsInner());
}

async function dispatchPendingEventsInner(): Promise<number> {
  // Find pending events
  const pendingEvents = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.status, 'pending'))
    .orderBy(eventOutbox.occurredAt)
    .limit(100);

  if (pendingEvents.length === 0) {
    return 0;
  }

  let jobsCreated = 0;

  for (const event of pendingEvents) {
    try {
      const eventType = event.eventType as EventType;
      const requiredWorkers = REQUIRED_WORKERS[eventType] || [];
      const eventJobsCreated = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`
          SELECT event_id
          FROM event_outbox
          WHERE event_id = ${event.eventId}
            AND status = 'pending'
          FOR UPDATE SKIP LOCKED
        `);

        if (!locked.rows?.length) {
          return null;
        }

        let created = 0;

        // Create all jobs for this event, then mark dispatched in the same transaction.
        for (const workerName of requiredWorkers) {
          await tx.insert(jobQueue).values({
            eventId: event.eventId,
            workerName,
            status: 'queued',
            attempts: 0,
            maxAttempts: 10,
            runAt: new Date(),
          }).onConflictDoNothing();

          created++;
        }

        await tx
          .update(eventOutbox)
          .set({ status: 'dispatched' })
          .where(eq(eventOutbox.eventId, event.eventId));

        return created;
      });

      // Only notify after the enqueue + status update transaction commits.
      if (eventJobsCreated !== null) {
        jobsCreated += eventJobsCreated;

        try {
          const { notifyOutboundWebhooksForEvent } = await import("./webhooks/outboundNotify");
          void notifyOutboundWebhooksForEvent({
            eventId: event.eventId,
            eventType: event.eventType,
            payload: event.payload,
          });
        } catch {
          // non-fatal
        }
      }
    } catch (error) {
      console.error(`[EventBus] Error dispatching event ${event.eventId}:`, error);
      // Don't mark as dispatched, will retry on next poll
    }
  }

  if (jobsCreated > 0) {
    console.log(`[EventBus] Dispatched ${jobsCreated} jobs from ${pendingEvents.length} events`);
  }

  return jobsCreated;
}

/**
 * Get the next available job for processing with row-level locking
 */
export async function acquireJob(workerId: string): Promise<typeof jobQueue.$inferSelect | null> {
  const now = new Date();
  const staleTime = new Date(now.getTime() - 5 * 60 * 1000);
  
  // Use FOR UPDATE SKIP LOCKED to prevent concurrent processing
  const jobs = await db.execute(sql`
    SELECT job_id, event_id, worker_name, status, attempts, max_attempts, run_at, locked_at, locked_by, last_error, created_at, updated_at
    FROM job_queue 
    WHERE status = 'queued' 
      AND run_at <= ${now}
      AND (locked_at IS NULL OR locked_at < ${staleTime})
    ORDER BY run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `);

  if (!jobs.rows || jobs.rows.length === 0) {
    return null;
  }

  const row = jobs.rows[0] as Record<string, unknown>;

  // Lock the job
  await db
    .update(jobQueue)
    .set({
      status: 'running',
      lockedAt: now,
      lockedBy: workerId,
      attempts: ((row.attempts as number) || 0) + 1,
      updatedAt: now,
    })
    .where(eq(jobQueue.jobId, row.job_id as string));

  return {
    jobId: row.job_id as string,
    eventId: row.event_id as string,
    workerName: row.worker_name as string,
    status: 'running',
    attempts: ((row.attempts as number) || 0) + 1,
    maxAttempts: row.max_attempts as number,
    runAt: row.run_at as Date,
    lockedAt: now,
    lockedBy: workerId,
    lastError: row.last_error as string | null,
    createdAt: row.created_at as Date | null,
    updatedAt: now,
  };
}

/**
 * Mark a job as successful
 * Wraps all operations in a transaction for atomicity and concurrent safety
 */
export async function completeJob(
  jobId: string,
  eventId: string,
  workerName: string,
  summary: string,
  correlationId: string,
  eventType: string,
  logData?: Record<string, unknown> | null,
): Promise<void> {
  const now = new Date();

  // Wrap all completion operations in a transaction for atomicity
  await db.transaction(async (tx) => {
    // Update job status
    await tx
      .update(jobQueue)
      .set({
        status: 'success',
        updatedAt: now,
      })
      .where(eq(jobQueue.jobId, jobId));

    // Record in processed_events for idempotency
    await tx
      .insert(processedEvents)
      .values({
        eventId,
        workerName,
        processedAt: now,
        resultSummary: summary,
      })
      .onConflictDoNothing();

    // Log the successful run
    await tx.insert(workerRunLogs).values({
      eventId,
      correlationId,
      eventType,
      workerName,
      status: 'success',
      attempt: 1,
      summary,
      data: logData ?? null,
      createdAt: now,
    });
  });
}

/**
 * Append a worker run log row without completing a job (used for per-rule automation traces).
 */
export async function insertWorkerRunLog(entry: {
  eventId: string;
  correlationId: string;
  eventType: string;
  workerName: string;
  status: string;
  attempt?: number;
  summary?: string | null;
  data?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  const now = new Date();
  await db.insert(workerRunLogs).values({
    eventId: entry.eventId,
    correlationId: entry.correlationId,
    eventType: entry.eventType,
    workerName: entry.workerName,
    status: entry.status,
    attempt: entry.attempt ?? 1,
    summary: entry.summary ?? null,
    data: entry.data ?? null,
    error: entry.error ?? null,
    createdAt: now,
  });
}

/**
 * Mark a job as failed with retry logic
 * Wraps all operations in a transaction for atomicity and concurrent safety
 */
export async function failJob(
  jobId: string,
  eventId: string,
  workerName: string,
  error: string,
  correlationId: string,
  eventType: string,
  attempt: number,
  maxAttempts: number
): Promise<void> {
  const now = new Date();

  if (attempt >= maxAttempts) {
    // Move to dead letter - wrap in transaction
    await db.transaction(async (tx) => {
      // Update job status
      await tx
        .update(jobQueue)
        .set({
          status: 'dead_letter',
          lastError: error,
          updatedAt: now,
        })
        .where(eq(jobQueue.jobId, jobId));

      // Get the event payload for snapshot
      const event = await tx
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.eventId, eventId))
        .limit(1);

      // Insert into dead_letters
      await tx.insert(deadLetters).values({
        jobId,
        eventId,
        workerName,
        failedAt: now,
        error,
        payloadSnapshot: event[0]?.payload || {},
      });

      // Log dead letter
      await tx.insert(workerRunLogs).values({
        eventId,
        correlationId,
        eventType,
        workerName,
        status: 'dead_letter',
        attempt,
        error,
        createdAt: now,
      });
    });

    console.log(`[EventBus] Job ${jobId} moved to dead letter after ${attempt} attempts`);
  } else {
    // Schedule retry with exponential backoff (capped at 15 minutes)
    const backoffMs = Math.min(Math.pow(2, attempt) * 10000, 15 * 60 * 1000);
    const nextRunAt = new Date(now.getTime() + backoffMs);

    // Wrap retry operations in transaction
    await db.transaction(async (tx) => {
      await tx
        .update(jobQueue)
        .set({
          status: 'queued',
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          runAt: nextRunAt,
          updatedAt: now,
        })
        .where(eq(jobQueue.jobId, jobId));

      // Log retry
      await tx.insert(workerRunLogs).values({
        eventId,
        correlationId,
        eventType,
        workerName,
        status: 'retrying',
        attempt,
        error,
        summary: `Retry scheduled in ${Math.round(backoffMs / 1000)}s`,
        createdAt: now,
      });
    });

    console.log(`[EventBus] Job ${jobId} scheduled for retry in ${Math.round(backoffMs / 1000)}s`);
  }
}

/**
 * Check if an event has already been processed by a worker
 */
export async function isEventProcessed(eventId: string, workerName: string): Promise<boolean> {
  const result = await db
    .select()
    .from(processedEvents)
    .where(
      and(
        eq(processedEvents.eventId, eventId),
        eq(processedEvents.workerName, workerName)
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get event by ID
 */
export async function getEvent(eventId: string): Promise<typeof eventOutbox.$inferSelect | null> {
  const result = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, eventId))
    .limit(1);

  return result[0] || null;
}

/**
 * Retry a dead letter job
 */
export async function retryDeadLetter(deadLetterId: string): Promise<boolean> {
  const dl = await db
    .select()
    .from(deadLetters)
    .where(eq(deadLetters.deadLetterId, deadLetterId))
    .limit(1);

  if (dl.length === 0) {
    return false;
  }

  const deadLetter = dl[0];
  const now = new Date();

  // Reset the job for retry
  await db
    .update(jobQueue)
    .set({
      status: 'queued',
      attempts: 0,
      runAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(jobQueue.jobId, deadLetter.jobId));

  // Remove from dead letters
  await db
    .delete(deadLetters)
    .where(eq(deadLetters.deadLetterId, deadLetterId));

  console.log(`[EventBus] Dead letter ${deadLetterId} requeued for retry`);
  return true;
}

/**
 * Get worker run logs with filters
 */
export async function getWorkerRunLogs(filters?: {
  eventId?: string;
  correlationId?: string;
  workerName?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<typeof workerRunLogs.$inferSelect[]> {
  let query = db.select().from(workerRunLogs);

  const conditions = [];
  if (filters?.eventId) {
    conditions.push(eq(workerRunLogs.eventId, filters.eventId));
  }
  if (filters?.correlationId) {
    conditions.push(eq(workerRunLogs.correlationId, filters.correlationId));
  }
  if (filters?.workerName) {
    conditions.push(eq(workerRunLogs.workerName, filters.workerName));
  }
  if (filters?.status) {
    conditions.push(eq(workerRunLogs.status, filters.status));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query
    .orderBy(desc(workerRunLogs.createdAt))
    .limit(filters?.limit || 100)
    .offset(filters?.offset || 0);
}

/**
 * Get dead letters with filters
 */
export async function getDeadLetters(filters?: {
  eventId?: string;
  workerName?: string;
  limit?: number;
  offset?: number;
}): Promise<typeof deadLetters.$inferSelect[]> {
  let query = db.select().from(deadLetters);

  const conditions = [];
  if (filters?.eventId) {
    conditions.push(eq(deadLetters.eventId, filters.eventId));
  }
  if (filters?.workerName) {
    conditions.push(eq(deadLetters.workerName, filters.workerName));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query
    .orderBy(desc(deadLetters.failedAt))
    .limit(filters?.limit || 100)
    .offset(filters?.offset || 0);
}

/**
 * Get job queue stats
 */
export async function getJobQueueStats(): Promise<{
  queued: number;
  running: number;
  success: number;
  failed: number;
  deadLetter: number;
}> {
  const result = await db.execute<{ status: string; count: string }>(sql`
    SELECT status, COUNT(*) as count 
    FROM job_queue 
    GROUP BY status
  `);

  const stats = {
    queued: 0,
    running: 0,
    success: 0,
    failed: 0,
    deadLetter: 0,
  };

  for (const row of result.rows || []) {
    switch (row.status) {
      case 'queued':
        stats.queued = parseInt(row.count);
        break;
      case 'running':
        stats.running = parseInt(row.count);
        break;
      case 'success':
        stats.success = parseInt(row.count);
        break;
      case 'failed':
        stats.failed = parseInt(row.count);
        break;
      case 'dead_letter':
        stats.deadLetter = parseInt(row.count);
        break;
    }
  }

  return stats;
}

/**
 * Reconciliation job - safety net for stuck events
 * Finds events that are dispatched but have incomplete workers after X minutes
 * and requeues missing jobs
 */
export async function runReconciliation(): Promise<{
  stuckEvents: number;
  requeuedJobs: number;
}> {
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes
  let stuckEvents = 0;
  let requeuedJobs = 0;

  try {
    // Find dispatched events older than threshold
    const stuckEventsResult = await db
      .select()
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.status, 'dispatched'),
          sql`${eventOutbox.createdAt} < ${staleThreshold}`
        )
      )
      .limit(50);

    for (const event of stuckEventsResult) {
      const eventType = event.eventType as EventType;
      const requiredWorkers = REQUIRED_WORKERS[eventType] || [];

      // Check which workers haven't completed
      const completedWorkers = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.eventId, event.eventId));

      const completedWorkerNames = new Set(completedWorkers.map(w => w.workerName));

      for (const workerName of requiredWorkers) {
        if (!completedWorkerNames.has(workerName)) {
          // Check if there's already a queued/running job
          const existingJob = await db
            .select()
            .from(jobQueue)
            .where(
              and(
                eq(jobQueue.eventId, event.eventId),
                eq(jobQueue.workerName, workerName),
                sql`${jobQueue.status} IN ('queued', 'running')`
              )
            )
            .limit(1);

          if (existingJob.length === 0) {
            // Requeue the job
            await db.insert(jobQueue).values({
              eventId: event.eventId,
              workerName,
              status: 'queued',
              attempts: 0,
              maxAttempts: 10,
              runAt: new Date(),
            }).onConflictDoNothing();
            
            requeuedJobs++;
            console.log(`[Reconciliation] Requeued ${workerName} for event ${event.eventId}`);
          }
        }
      }

      stuckEvents++;
    }

    if (stuckEvents > 0) {
      console.log(`[Reconciliation] Processed ${stuckEvents} stuck events, requeued ${requeuedJobs} jobs`);
    }
  } catch (error) {
    console.error('[Reconciliation] Error:', error);
  }

  return { stuckEvents, requeuedJobs };
}

// Reconciliation interval handle
let reconciliationInterval: NodeJS.Timeout | null = null;

/**
 * Start the reconciliation job on a schedule
 */
export function startReconciliationJob(intervalMs: number = 5 * 60 * 1000): void {
  if (reconciliationInterval) {
    return;
  }

  console.log(`[Reconciliation] Starting reconciliation job (every ${intervalMs / 1000}s)`);
  
  // Run immediately on start
  runReconciliation();

  // Then run on interval
  reconciliationInterval = setInterval(() => {
    runReconciliation();
  }, intervalMs);
}

/**
 * Stop the reconciliation job
 */
export function stopReconciliationJob(): void {
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
    console.log('[Reconciliation] Stopped');
  }
}
