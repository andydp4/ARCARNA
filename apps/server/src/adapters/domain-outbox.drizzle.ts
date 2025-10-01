import { db } from '../db'
import { domain_outbox } from '../db/schema'

export interface OutboxEvent {
  type: string
  payload: any
}

export class DomainOutboxAdapter {
  async publishEvent(event: OutboxEvent): Promise<void> {
    await db.insert(domain_outbox).values({
      type: event.type,
      payload: event.payload,
    })
  }
  
  async publishEvents(events: OutboxEvent[]): Promise<void> {
    if (events.length === 0) return
    
    const values = events.map(event => ({
      type: event.type,
      payload: event.payload,
    }))
    
    await db.insert(domain_outbox).values(values)
  }
}

export const domainOutbox = new DomainOutboxAdapter()