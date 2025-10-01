import type { DomainEvent, EventHandler } from './events'
export interface EventBus { publish(e: DomainEvent): Promise<void>; subscribe(t: DomainEvent['type'], h: EventHandler): void; }
export class InMemoryBus implements EventBus {
  private handlers: Record<string, EventHandler[]> = {};
  subscribe(t: DomainEvent['type'], h: EventHandler){ (this.handlers[t] ??= []).push(h) }
  async publish(e: DomainEvent){ for (const h of (this.handlers[e.type] ?? [])) await h(e) }
}