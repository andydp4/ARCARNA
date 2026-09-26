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

/**
 * Keys whose values are personal contact details. The application log (PM2
 * stdout on the VPS) is not a place customer contact may live (v1.2.1
 * SEC-LOGPII): the line keeps which fields changed, never what they became.
 */
const CONTACT_KEY = /^(phone|mobile|email|e_?mail|address|address_?line\d*|postcode|post_?code|city|town|delivery_?(address|postcode|notes)|wa_?id|whatsapp|date_?of_?birth|dob|notes)$/i

/** On a customer event the person's name is contact detail too. */
const CUSTOMER_NAME_KEY = /^(name|first_?name|last_?name|full_?name|customer_?name)$/i

export function redactAuditPayload(event: string, payload: unknown, depth = 0): unknown {
  if (depth > 6 || payload === null || typeof payload !== 'object') return payload
  if (Array.isArray(payload)) return payload.map((v) => redactAuditPayload(event, v, depth + 1))
  const isCustomerEvent = /^customer/i.test(event)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (CONTACT_KEY.test(key) || (isCustomerEvent && CUSTOMER_NAME_KEY.test(key))) {
      out[key] = value == null ? value : '[redacted]'
    } else {
      out[key] = redactAuditPayload(event, value, depth + 1)
    }
  }
  return out
}

export const AuditPortDrizzle: AuditPort = {
  async log(event: string, payload: unknown){
    // No DB write: admin audit lives in `admin_audit_logs` (written at the route
    // layer via recordAdminAudit). Keep a structured log line for traceability,
    // with contact details removed.
    logApiJson({ kind: 'domain_audit', event, payload: redactAuditPayload(event, payload) })
  }
}
