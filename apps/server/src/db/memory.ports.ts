import type { AnalyticsSink, AuditPort, OrderId } from '@midnight/domain'

export const AnalyticsSinkMemory: AnalyticsSink = {
  async recordOrder(orderId: OrderId){ /* no-op in memory */ }
}

export const AuditPortMemory: AuditPort = {
  async log(event: string, payload: unknown){ /* no-op in memory */ }
}