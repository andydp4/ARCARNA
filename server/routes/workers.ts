import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

export function registerWorkerAdminRoutes(app: Express): void {
  
  // Get worker run logs with filters
  app.get("/api/admin/worker-logs", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getWorkerRunLogs } = await import('../eventBus');
      const logs = await getWorkerRunLogs({
        eventId: req.query.eventId as string,
        correlationId: req.query.correlationId as string,
        workerName: req.query.workerName as string,
        status: req.query.status as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(logs);
    } catch (error) {
      console.error("Error fetching worker logs:", error);
      res.status(500).json({ message: "Failed to fetch worker logs" });
    }
  });

  // Get dead letters
  app.get("/api/admin/dead-letters", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getDeadLetters } = await import('../eventBus');
      const deadLetters = await getDeadLetters({
        eventId: req.query.eventId as string,
        workerName: req.query.workerName as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(deadLetters);
    } catch (error) {
      console.error("Error fetching dead letters:", error);
      res.status(500).json({ message: "Failed to fetch dead letters" });
    }
  });

  // Get job queue stats
  app.get("/api/admin/worker-stats", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getJobQueueStats } = await import('../eventBus');
      const stats = await getJobQueueStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching worker stats:", error);
      res.status(500).json({ message: "Failed to fetch worker stats" });
    }
  });

  // Retry a dead letter
  app.post("/api/admin/dead-letters/:id/retry", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { retryDeadLetter } = await import('../eventBus');
      const success = await retryDeadLetter(req.params.id);
      if (success) {
        res.json({ message: "Dead letter requeued for retry" });
      } else {
        res.status(404).json({ message: "Dead letter not found" });
      }
    } catch (error) {
      console.error("Error retrying dead letter:", error);
      res.status(500).json({ message: "Failed to retry dead letter" });
    }
  });

  // Get event details
  app.get("/api/admin/events/:eventId", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getEvent, getWorkerRunLogs } = await import('../eventBus');
      const event = await getEvent(req.params.eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      const workerLogs = await getWorkerRunLogs({ eventId: req.params.eventId });
      
      res.json({
        event,
        workerLogs,
      });
    } catch (error) {
      console.error("Error fetching event details:", error);
      res.status(500).json({ message: "Failed to fetch event details" });
    }
  });

  // Get job queue with detailed info (run_at, locked_at, last_error)
  app.get("/api/admin/job-queue", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { db } = await import('../../apps/server/src/db');
      const { jobQueue } = await import('@shared/schema');
      const { desc, eq, and } = await import('drizzle-orm');
      
      // Build filters
      const conditions: any[] = [];
      if (req.query.status) {
        conditions.push(eq(jobQueue.status, req.query.status));
      }
      if (req.query.workerName) {
        conditions.push(eq(jobQueue.workerName, req.query.workerName));
      }
      if (req.query.eventId) {
        conditions.push(eq(jobQueue.eventId, req.query.eventId));
      }
      
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      
      let query = db.select().from(jobQueue);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const jobs = await query.orderBy(desc(jobQueue.createdAt)).limit(limit).offset(offset);
      
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching job queue:", error);
      res.status(500).json({ message: "Failed to fetch job queue" });
    }
  });

  // Test endpoint to verify event-driven system end-to-end
  app.post("/api/admin/test-event", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { publishEvent, dispatchPendingEvents } = await import('../eventBus');
      const { randomUUID } = await import('crypto');
      
      // Use valid UUIDs for all IDs to prevent database errors
      const testOrderId = randomUUID();
      const testLineId = randomUUID();
      const testProductId = randomUUID(); // Valid UUID prevents InventoryWorker failures
      
      // Publish a test OrderCreated event with valid UUIDs
      const eventId = await publishEvent('OrderCreated', testOrderId, {
        order: {
          orderId: testOrderId,
          status: 'pending',
          customerId: null, // No customer to avoid lookup failures
          total: 50.00,
          items: [
            {
              lineId: testLineId,
              productId: testProductId, // Valid UUID - InventoryWorker will gracefully handle non-existent product
              qty: 2,
              unitPrice: 25.00,
              lineTotal: 50.00,
            }
          ],
        }
      }, { source: 'test-endpoint' });
      
      // Immediately dispatch to create jobs
      const jobsCreated = await dispatchPendingEvents();
      
      console.log(`[TestEvent] Published event ${eventId}, dispatched ${jobsCreated} jobs`);
      
      res.json({
        success: true,
        eventId,
        correlationId: testOrderId,
        jobsCreated,
        message: `Test event published. Check /api/admin/worker-logs to see results.`,
      });
    } catch (error) {
      console.error("Error creating test event:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to create test event",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
