import { db } from './index'
import * as s from './schema'
import type { AnalyticsSink, AuditPort, OrderId } from '@midnight/domain'

export const AnalyticsSinkDrizzle: AnalyticsSink = {
  async recordOrder(orderId: OrderId){
    // Write to outbox; a worker can project daily/weekly/monthly aggregates
    await db.insert(s.domain_outbox).values({
      type: 'OrderAggregatesRequested',
      payload: { orderId }
    })
  }
}

export const AuditPortDrizzle: AuditPort = {
  async log(event: string, payload: unknown){
    await db.insert(s.audit_logs).values({
      user_id: 'system', action: event, entity_type: 'order', new_values: payload as any
    })
  }
}