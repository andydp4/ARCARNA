import type { AnalyticsSink, AuditPort, OrderId } from '@midnight/domain'
import { logApiJson } from '../../../../server/structuredLog'

/**
 * Legacy domain ports.
 *
 * Analytics and audit side effects are owned by the canonical transactional
 * outbox (`event_outbox`) and `server/workers/*`, which consume `OrderCreated`
 * etc. (see ARCHITECTURAL_PRINCIPLES.md #4 and server/index.ts).
 *
 * These adapters previously wrote to the deprecated `domain_outbox` table and a
 * non-existent `audit_logs` table, which made every engine-backed write
 * (orders, customers, products) fail with a 500. They are now observability-only
 * no-ops so the engine no longer depends on parallel/non-canonical tables
 * (ARCHITECTURAL_PRINCIPLES.md #2).
 */
export const AnalyticsSinkDrizzle: AnalyticsSink = {
  async recordOrder(_orderId: OrderId){
    // No-op: analytics projection is handled by event_outbox workers.
  },

  async updateCustomerMetrics(_customerId: any){
    // No-op: customer metrics are recomputed by CustomerWorker on order events.
  }
}

export const AuditPortDrizzle: AuditPort = {
  async log(event: string, payload: unknown){
    // No DB write: admin audit lives in `admin_audit_logs` (written at the route
    // layer via recordAdminAudit). Keep a structured log line for traceability.
    logApiJson({ kind: 'domain_audit', event, payload })
  }
}