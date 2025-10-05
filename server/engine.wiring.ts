import { DomainEngine, InMemoryBus } from '../packages/domain/src/index'
import { InvoicesPortStub } from './ports/invoices.stub'

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
    
    // Use stub invoice port (puppeteer requires chromium which may not be available in production)
    return new DomainEngine(
      bus,
      OrdersRepoDrizzle,
      ProductsRepoDrizzle,
      CustomersRepoDrizzle,
      InvoicesPortStub,
      AnalyticsSinkDrizzle,
      AuditPortDrizzle,
      async (fn: any) => withTransaction(async (tx: any)=> fn(tx))
    )
  } else {
    // In-memory wiring (no external services required)
    const { OrdersRepoMemory, ProductsRepoMemory, CustomersRepoMemory } = await import('../apps/server/src/db/memory.repos')
    const { AnalyticsSinkMemory, AuditPortMemory } = await import('../apps/server/src/db/memory.ports')
    // simple passthrough transaction
    const withTx = async (fn: any) => await fn()
    
    return new DomainEngine(
      bus,
      OrdersRepoMemory,
      ProductsRepoMemory,
      CustomersRepoMemory,
      InvoicesPortStub,
      AnalyticsSinkMemory,
      AuditPortMemory,
      withTx
    )
  }
}

// Export the engine promise
export const engine = await createEngine()
