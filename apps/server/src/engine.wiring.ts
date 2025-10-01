import { DomainEngine, InMemoryBus } from '../../../packages/domain/src/index'
import { InvoicesPortPuppeteer } from './ports/invoices.puppeteer'

const bus = new InMemoryBus()

function hasDb(){
  return !!process.env.DATABASE_URL
}

// Create engine instance based on environment
async function createEngine() {
  if (hasDb()){
    // Drizzle-backed wiring
    const { OrdersRepoDrizzle, ProductsRepoDrizzle, CustomersRepoDrizzle } = await import('./db/repos')
    const { AnalyticsSinkDrizzle, AuditPortDrizzle } = await import('./db/analytics_audit')
    const { withTransaction } = await import('./db')
    
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
    const { OrdersRepoMemory, ProductsRepoMemory, CustomersRepoMemory } = await import('./db/memory.repos')
    const { AnalyticsSinkMemory, AuditPortMemory } = await import('./db/memory.ports')
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