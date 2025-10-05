import { DomainEngine, InMemoryBus } from '../packages/domain/src/index'

const bus = new InMemoryBus()

function hasDb(){
  return !!process.env.DATABASE_URL
}

// Create engine instance based on environment
async function createEngine() {
  if (hasDb()){
    // Use the Drizzle-backed implementations from apps/server
    const { OrdersRepoDrizzle, ProductsRepoDrizzle, CustomersRepoDrizzle } = await import('../apps/server/src/db/repos')
    const { AnalyticsSinkDrizzle, AuditPortDrizzle } = await import('../apps/server/src/db/analytics_audit')
    const { withTransaction } = await import('../apps/server/src/db')
    const { InvoicesPortPuppeteer } = await import('../apps/server/src/ports/invoices.puppeteer')
    
    return new DomainEngine(
      bus,
      OrdersRepoDrizzle,
      ProductsRepoDrizzle,
      CustomersRepoDrizzle,
      InvoicesPortPuppeteer,
      AnalyticsSinkDrizzle,
      AuditPortDrizzle,
      async (fn: any) => withTransaction(async (tx: any)=> fn(tx))
    )
  } else {
    // In-memory wiring (no external services required)
    const { OrdersRepoMemory, ProductsRepoMemory, CustomersRepoMemory } = await import('../apps/server/src/db/memory.repos')
    const { AnalyticsSinkMemory, AuditPortMemory } = await import('../apps/server/src/db/memory.ports')
    const { InvoicesPortPuppeteer } = await import('../apps/server/src/ports/invoices.puppeteer')
    // simple passthrough transaction
    const withTx = async (fn: any) => await fn()
    
    return new DomainEngine(
      bus,
      OrdersRepoMemory,
      ProductsRepoMemory,
      CustomersRepoMemory,
      InvoicesPortPuppeteer,
      AnalyticsSinkMemory,
      AuditPortMemory,
      withTx
    )
  }
}

// Export the engine promise
export const engine = await createEngine()
