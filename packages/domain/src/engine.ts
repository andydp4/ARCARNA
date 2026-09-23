import { PlaceOrderInput, UpdateOrderInput } from './schemas'
import type {
  OrdersRepo, ProductsRepo, CustomersRepo, InvoicesPort, AnalyticsSink, AuditPort,
  PriceExceptionsPort, PriceExceptionRecord,
} from './ports'
import type { EventBus } from './bus'
import type { Order, OrderId, OrderLine, Product, ProductId, Customer, CustomerId } from './types'
import { lineTotalFor, priceOrder, type PricedOrder } from '../../../shared/pricing/priceOrder'
import {
  isPriceCheckExempt,
  netLineTotals,
  snapshotFor,
  underpricedLine,
  type LineSnapshot,
  type OrderDiscounts,
} from '../../../shared/pricing/lineSnapshot'

/**
 * Who is behind an order write, for the silent price check's "by person".
 * Passed by the route beside the input — never read from the request body.
 */
export type OrderWriteContext = {
  actorUserId?: string | null
  /** The order's org, when the repo's order does not carry it. */
  orgId?: string | null
  /**
   * Set only by the server's own website checkout, which prices every line at
   * list itself: the one sale the silent price check skips. Never derived
   * from the order's `channel`, which a till or API caller can set to "web".
   */
  pricedAtList?: boolean
}

/**
 * What identifies one recorded breach, for telling an edit's unchanged lines
 * from changed ones. Pence and thousandths, so a numeric read back from the
 * database as a string compares equal to the engine's number.
 */
function breachKey(r: PriceExceptionRecord): string {
  const p = (v: unknown) => Math.round((Number(v) || 0) * 100)
  return [
    Math.round((Number(r.quantity) || 0) * 1000),
    p(r.unitPrice),
    p(r.underList),
    p(r.underCost),
    r.belowMinimum ? 1 : 0,
    r.belowCost ? 1 : 0,
  ].join('|')
}

function keysByProduct(rows: PriceExceptionRecord[]): Map<string, string> {
  const grouped = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.productId) continue
    const list = grouped.get(r.productId) ?? []
    list.push(breachKey(r))
    grouped.set(r.productId, list)
  }
  return new Map([...grouped].map(([pid, keys]) => [pid, keys.sort().join(',')]))
}

type SnapshotFields = Pick<OrderLine, 'listPrice' | 'floorPrice' | 'unitCost'>

function snapshotFields(snap: LineSnapshot | null): SnapshotFields {
  return snap
    ? { listPrice: snap.listPrice, floorPrice: snap.floorPrice, unitCost: snap.unitCost }
    : {}
}

function snapshotOf(line: SnapshotFields): LineSnapshot | null {
  if (line.listPrice == null || line.floorPrice == null) return null
  return { listPrice: line.listPrice, floorPrice: line.floorPrice, unitCost: line.unitCost ?? null }
}

/** Fallback when no org rate is supplied. Matches the historic fixed rate. */
export const DEFAULT_TAX_RATE_PERCENT = 0

export class DomainEngine {
  constructor(
    private readonly bus: EventBus,
    private readonly orders: OrdersRepo,
    private readonly products: ProductsRepo,
    private readonly customers: CustomersRepo,
    private readonly invoices: InvoicesPort,
    private readonly analytics: AnalyticsSink,
    private readonly audit: AuditPort,
    private readonly withTransaction: <T>(fn: ()=>Promise<T>)=>Promise<T>,
    // Optional so a hand-built engine (tests, tools) still constructs; without
    // it underpriced lines are simply not recorded.
    private readonly priceExceptions?: PriceExceptionsPort,
  ){}

  /**
   * The list price, floor and cost of each product on the order, as they are
   * right now (PRC-06). One read per distinct product. A product that cannot
   * be read gets no snapshot rather than a failed sale.
   */
  private async snapshotLines(productIds: string[]): Promise<Map<string, LineSnapshot | null>> {
    const out = new Map<string, LineSnapshot | null>()
    for (const id of new Set(productIds)) {
      let product: Product | null = null
      try {
        product = await this.products.findById(id as ProductId)
      } catch (error) {
        console.warn('[DomainEngine] snapshot read failed (line kept without one):', error)
      }
      out.set(id, snapshotFor(product as any))
    }
    return out
  }

  /**
   * Silent recording (PRC-03, CMP-03): every line below its minimum or below
   * known cost is written to price_exceptions. Inside the engine so the till,
   * manager edits, the API and voice drafts are all covered by construction.
   * It never blocks and never errors: the sale has already been decided.
   *
   * Lines are judged on what they brought in after the order's tier,
   * promotion and points (owner Q3: no trade exemption), not only on their
   * unit price, which those discounts leave at list.
   *
   * On an edit the order's rows are reconciled rather than added to: a
   * product whose breach is exactly as recorded keeps its row (and who it was
   * recorded against); any other product's rows are replaced by the breach as
   * it now stands, or removed when the line is now fine or gone. So each
   * breach is counted once in "Would have flagged".
   */
  private async recordUnderpriced(args: {
    orgId: string | null | undefined
    orderId: string
    lines: OrderLine[]
    pricing: OrderDiscounts
    source: 'sale' | 'edit'
    channel?: string | null
    paymentMethod?: string | null
    actorUserId?: string | null
    pricedAtList?: boolean
  }): Promise<void> {
    try {
      if (!this.priceExceptions || !args.orgId) return
      if (isPriceCheckExempt({ paymentMethod: args.paymentMethod, source: args.source, pricedAtList: args.pricedAtList })) return
      const nets = netLineTotals(args.lines, args.pricing)
      const rows: PriceExceptionRecord[] = []
      args.lines.forEach((line, i) => {
        const snap = snapshotOf(line)
        const breach = underpricedLine({ ...line, netLineTotal: nets[i] }, snap)
        if (!breach || !snap) return
        const qty = Number(line.quantity) || 0
        rows.push({
          orgId: args.orgId as string,
          orderId: args.orderId,
          productId: line.productId as string,
          userId: args.actorUserId ?? null,
          source: args.source,
          channel: args.channel ?? null,
          quantity: line.quantity,
          // What each unit actually brought in after the order's discounts,
          // which is the price the breach is about.
          unitPrice: qty > 0 ? Math.round((nets[i] / qty) * 100) / 100 : line.unitPrice,
          listPrice: snap.listPrice,
          floorPrice: snap.floorPrice,
          unitCost: snap.unitCost,
          ...breach,
        })
      })
      if (args.source === 'sale') {
        if (rows.length) await this.priceExceptions.record(rows)
        return
      }
      const before = keysByProduct(await this.priceExceptions.forOrder(args.orgId, args.orderId))
      const now = keysByProduct(rows)
      const changed = [...new Set([...before.keys(), ...now.keys()])].filter((pid) => before.get(pid) !== now.get(pid))
      if (changed.length === 0) return
      await this.priceExceptions.replaceForOrder(
        args.orgId,
        args.orderId,
        changed,
        rows.filter((r) => changed.includes(r.productId)),
      )
    } catch (error) {
      console.warn('[DomainEngine] underpriced-sale recording failed (sale unaffected):', error)
    }
  }

  /**
   * `pricing` is the till route's server-side priceOrder() result (tier,
   * promotion, points already validated inside the sale's transaction). It is
   * a separate, trusted argument — never read from the request body — so a
   * caller cannot post its own discount. Without it the sale is priced from
   * its lines and the org rate alone, by the same function (v1.2 Phase 1B).
   */
  async placeOrder(
    input: unknown,
    pricing?: PricedOrder,
    context: OrderWriteContext = {},
  ): Promise<{ orderId: OrderId; warnings?: string[] }> {
    const dto = PlaceOrderInput.parse(input)
    // Rate comes from the org's settings; DEFAULT_TAX_RATE_PERCENT only
    // applies when a caller supplies none.
    const priced =
      pricing ??
      priceOrder({ lines: dto.lines, taxRatePercent: (dto as any).taxRatePercent ?? DEFAULT_TAX_RATE_PERCENT })
    const { subtotal, vatAmount: vat, total } = priced

    const result = await this.withTransaction(async () => {
      // Check stock availability for all line items
      const stockCtx = {
        orgId: (dto as any).orgId as string,
        locationId: (dto as any).locationId as string | undefined,
        orderId: undefined as string | undefined,
      }
      const stockWarnings: string[] = []
      for (const line of dto.lines) {
        const availableStock = await this.products.checkStock(line.productId as any, stockCtx)
        if (availableStock < line.quantity) {
          const product = await this.products.findById(line.productId as any)
          const productName = product?.name || line.productId
          stockWarnings.push(`Insufficient stock for ${productName}: requested ${line.quantity}, available ${availableStock}`)
        }
      }

      // Determine order status based on stock availability
      const orderStatus = stockWarnings.length > 0 ? 'on-hold' : dto.status ?? 'pending'
      const snapshots = await this.snapshotLines(dto.lines.map((l) => l.productId))

      // These three ride alongside the domain Order purely so OrdersRepo can
      // persist them; no engine rule reads any of them. Declared here rather
      // than left to `as any` at the repo end, because an untyped handoff is
      // precisely how fulfilmentMethod was lost between the two.
      const order: Order & {
        orgId?: string
        locationId?: string
        fulfilmentMethod?: 'collection' | 'delivery'
        pricing?: PricedOrder
      } = {
        id: crypto.randomUUID() as OrderId,
        customerId: dto.customerId as any,
        lines: dto.lines.map((l: any) => ({
          ...l,
          lineTotal: lineTotalFor(l.quantity, l.unitPrice),
          ...snapshotFields(snapshots.get(l.productId) ?? null),
        })),
        subtotal, vat, total, paymentMethod: dto.paymentMethod, status: orderStatus, channel: dto.channel, createdAt: new Date(),
        orgId: (dto as any).orgId,
        locationId: (dto as any).locationId,
        // Carried alongside the domain Order rather than inside it, the same way
        // orgId/locationId are: OrdersRepo persists it, no engine rule reads it.
        fulfilmentMethod: (dto as any).fulfilmentMethod,
        // The breakdown behind `total`, persisted alongside it (migration 082).
        pricing: priced,
      }
      await this.orders.save(order)
      await this.recordUnderpriced({
        orgId: order.orgId,
        orderId: order.id,
        lines: order.lines,
        pricing: priced,
        source: 'sale',
        channel: order.channel,
        paymentMethod: order.paymentMethod,
        actorUserId: context.actorUserId,
        pricedAtList: context.pricedAtList === true,
      })
      // Stock mutations: InventoryWorker on OrderCreated (event-driven, per-location)
      
      if (order.paymentMethod === 'tick' && order.customerId) await this.customers.addTickDebt(order.customerId as any, order.total)
      
      let invoiceId = null
      try {
        const result = await this.invoices.createAndStore(order.id)
        invoiceId = result.invoiceId
      } catch (error) {
        console.warn('[DomainEngine] Invoice generation failed (non-critical):', error)
      }
      
      await this.analytics.recordOrder(order.id)
      if (order.customerId) {
        await this.customers.addOrderHistory(order.customerId as any, order.id)
        // Update customer metrics after order
        await this.customers.updateMetrics(order.customerId as any)
        await this.analytics.updateCustomerMetrics(order.customerId as any)
      }
      await this.audit.log('OrderCreated', { orderId: order.id, total: order.total, status: orderStatus })
      await this.bus.publish({ type: 'OrderPlaced', orderId: order.id, customerId: order.customerId as any })
      if (orderStatus !== 'on-hold') {
        await this.bus.publish({ type: 'StockReserved', orderId: order.id })
      }
      if (order.paymentMethod === 'tick' && order.customerId) await this.bus.publish({ type: 'TickAdded', orderId: order.id, customerId: order.customerId as any })
      if (invoiceId) await this.bus.publish({ type: 'InvoiceCreated', orderId: order.id, invoiceId })
      await this.bus.publish({ type: 'AnalyticsProjected', orderId: order.id })
      if (order.customerId) await this.bus.publish({ type: 'CustomerHistoryUpdated', orderId: order.id, customerId: order.customerId as any })
      return { orderId: order.id, warnings: stockWarnings }
    })
    return result
  }

  // Product Management Methods
  async createProduct(input: unknown): Promise<Product> {
    const product = await this.withTransaction(async () => {
      // Generate unique product code if not provided or empty
      const providedCode = (input as any).productCode?.trim()
      const productCode = providedCode || `PRD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      
      const newProduct: Product & { orgId?: string } = {
        id: crypto.randomUUID() as ProductId,
        productCode,
        name: (input as any).name,
        barcode: (input as any).barcode,
        // No cost given is "cost unknown" (null), never £0: a £0 cost reads
        // as a free item and flatters every margin (v1.2 Phase 2, PRC-F3).
        costPrice: (input as any).costPrice ?? null,
        salePrice: (input as any).salePrice ?? (input as any).defaultSalePrice ?? 0,
        // No minimum given means "follows the sale price".
        minPrice: (input as any).minPrice ?? null,
        stock: (input as any).stock || 0,
        // `??`: a par level of 0 is a choice, not a missing value.
        stockLimit: (input as any).stockLimit ?? 100,
        categoryId: (input as any).categoryId,
        orgId: (input as any).orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const created = await this.products.create(newProduct)
      await this.audit.log('ProductCreated', { productId: created.id, name: created.name })
      await this.bus.publish({ type: 'ProductCreated', productId: created.id })
      return created
    })
    return product
  }

  async updateProduct(id: string, input: unknown, orgId?: string | null): Promise<Product> {
    const product = await this.withTransaction(async () => {
      const productId = id as ProductId
      const existing = await this.products.findById(productId)
      if (!existing) throw new Error('Product not found')
      
      const updated = await this.products.update(productId, {
        ...(input as any),
        updatedAt: new Date(),
      }, orgId)
      await this.audit.log('ProductUpdated', { productId: updated.id, changes: input })
      await this.bus.publish({ type: 'ProductUpdated', productId: updated.id })
      return updated
    })
    return product
  }

  async deleteProduct(id: string, orgId?: string | null): Promise<void> {
    await this.withTransaction(async () => {
      const productId = id as ProductId
      const existing = await this.products.findById(productId)
      if (!existing) throw new Error('Product not found')
      
      await this.products.delete(productId, orgId)
      await this.audit.log('ProductDeleted', { productId })
      await this.bus.publish({ type: 'ProductDeleted', productId })
    })
  }

  async getProducts(): Promise<Product[]> {
    return await this.products.findAll()
  }

  async getProduct(id: string): Promise<Product | null> {
    return await this.products.findById(id as ProductId)
  }

  // Customer Management Methods
  async createCustomer(input: unknown): Promise<Customer> {
    const customer = await this.withTransaction(async () => {
      const newCustomer: Customer & { orgId?: string } = {
        id: crypto.randomUUID() as CustomerId,
        name: (input as any).name,
        phone: (input as any).phone,
        email: (input as any).email,
        address: (input as any).address,
        source: (input as any).source,
        // Who created it, for the staff report, and the receipt switch as the
        // till left it (v1.2 Phase 5). The repo writes both when present.
        ...((input as any).createdByUserId ? { createdByUserId: (input as any).createdByUserId } : {}),
        ...(typeof (input as any).receiptEmailOptIn === 'boolean' ? { receiptEmailOptIn: (input as any).receiptEmailOptIn } : {}),
        category: (input as any).category || 'Bronze',
        loyaltyPoints: 0,
        totalSpent: 0,
        orgId: (input as any).orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const created = await this.customers.create(newCustomer)
      await this.audit.log('CustomerCreated', { customerId: created.id, name: created.name })
      await this.bus.publish({ type: 'CustomerCreated', customerId: created.id, name: created.name })
      return created
    })
    return customer
  }

  async updateCustomer(id: string, input: unknown, orgId?: string | null): Promise<Customer> {
    const customer = await this.withTransaction(async () => {
      const customerId = id as CustomerId
      const existing = await this.customers.findById(customerId)
      if (!existing) throw new Error('Customer not found')
      
      const previousCategory = existing.category
      const updated = await this.customers.update(customerId, {
        ...(input as any),
        updatedAt: new Date(),
      }, orgId)
      
      // If category changed, trigger loyalty tier update
      if (previousCategory !== updated.category) {
        await this.analytics.updateCustomerMetrics(customerId)
        await this.bus.publish({ type: 'CustomerTierChanged', customerId, from: previousCategory, to: updated.category })
      }
      
      await this.audit.log('CustomerUpdated', { customerId: updated.id, changes: input })
      await this.bus.publish({ type: 'CustomerUpdated', customerId: updated.id })
      return updated
    })
    return customer
  }

  async deleteCustomer(id: string, orgId?: string | null): Promise<void> {
    await this.withTransaction(async () => {
      const customerId = id as CustomerId
      const existing = await this.customers.findById(customerId)
      if (!existing) throw new Error('Customer not found')
      
      await this.customers.delete(customerId, orgId)
      await this.audit.log('CustomerDeleted', { customerId })
      await this.bus.publish({ type: 'CustomerDeleted', customerId })
    })
  }

  async getCustomers(): Promise<Customer[]> {
    return await this.customers.findAll()
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return await this.customers.findById(id as CustomerId)
  }

  // Update customer metrics (CLV, RFM) - called by worker
  async updateCustomerMetrics(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const customerId = id as CustomerId
      await this.customers.updateMetrics(customerId)
      await this.analytics.updateCustomerMetrics(customerId)
      await this.bus.publish({ type: 'CustomerMetricsUpdated', customerId })
    })
  }

  // Order editing - update line items, quantities, prices
  /**
   * `pricing` is the route's re-price of the edit (priceEditedOrder(): the
   * org's VAT rate, the sale's own discounts kept) — trusted, never read from
   * the request body. Without it the lines are priced at the rate alone.
   */
  async updateOrder(
    id: string,
    input: unknown,
    pricing?: PricedOrder,
    context: OrderWriteContext = {},
  ): Promise<{ orderId: OrderId; warnings?: string[] }> {
    const dto = UpdateOrderInput.parse(input)
    const result = await this.withTransaction(async () => {
      const orderId = id as OrderId
      const existingOrder = await this.orders.findById(orderId)
      if (!existingOrder) throw new Error('Order not found')

      // SECURITY: once an order is settled ("completed"), its financials are
      // frozen. Without this, a client could re-post lines at inflated
      // unitPrice, which rewrites orders.total + order_items, and then refund
      // the difference as cash or store credit — paying out more than was ever
      // collected. Non-financial edits must go through their own routes.
      if (existingOrder.status === 'completed') {
        const err: any = new Error(
          'This order is already completed. Its items and prices are locked. Refund or reopen the order instead.',
        )
        err.statusCode = 409
        err.code = 'ORDER_SETTLED_IMMUTABLE'
        throw err
      }

      const stockCtx = {
        orgId: (existingOrder as any).orgId as string,
        locationId: (existingOrder as any).locationId as string | undefined,
        orderId: orderId as string,
      }
      const stockWarnings: string[] = []
      for (const line of dto.lines) {
        const availableStock = await this.products.checkStock(line.productId as any, stockCtx)
        if (availableStock < line.quantity && existingOrder.status !== 'on-hold') {
          const product = await this.products.findById(line.productId as any)
          const productName = product?.name || line.productId
          stockWarnings.push(
            `Insufficient stock for ${productName}: requested ${line.quantity}, available ${availableStock}`,
          )
        }
      }
      // Stock deltas: InventoryWorker on OrderUpdated

      // New totals from the one pricing function, so an edit cannot price
      // differently from a sale. Rate comes from the org's settings;
      // DEFAULT_TAX_RATE_PERCENT only applies when a caller supplies none.
      const priced =
        pricing ??
        priceOrder({ lines: dto.lines, taxRatePercent: (dto as any).taxRatePercent ?? DEFAULT_TAX_RATE_PERCENT })
      const { subtotal, vatAmount: vat, total } = priced

      // Determine order status: 
      // - If warnings exist, set to on-hold
      // - If no warnings and was on-hold, promote to pending  
      // - Otherwise keep existing status
      const orderStatus = stockWarnings.length > 0 
        ? 'on-hold' 
        : (existingOrder.status === 'on-hold' ? 'pending' : existingOrder.status)

      // A product already on the order keeps the snapshot it was sold with:
      // an edit changes what was charged, not what the list price and cost
      // were at the sale. Only a product new to the order is snapshotted now.
      const keptSnapshots = new Map<string, SnapshotFields>()
      for (const l of existingOrder.lines) {
        if (l.listPrice != null && !keptSnapshots.has(l.productId)) keptSnapshots.set(l.productId, snapshotFields(snapshotOf(l)))
      }
      const fresh = await this.snapshotLines(
        dto.lines.map((l) => l.productId).filter((pid) => !keptSnapshots.has(pid)),
      )

      // Update order, preserving existing metadata
      const updatedOrder: Order & { pricing?: PricedOrder } = {
        ...existingOrder,
        // Persisted alongside (migration 082) only when the route priced it.
        ...(pricing ? { pricing } : {}),
        lines: dto.lines.map((l: any) => ({
          ...l,
          lineTotal: lineTotalFor(l.quantity, l.unitPrice),
          ...(keptSnapshots.get(l.productId) ?? snapshotFields(fresh.get(l.productId) ?? null)),
        })),
        subtotal,
        vat,
        total,
        status: orderStatus,
      }
      await this.orders.save(updatedOrder)
      await this.recordUnderpriced({
        orgId: (existingOrder as any).orgId ?? context.orgId,
        orderId,
        lines: updatedOrder.lines,
        pricing: priced,
        source: 'edit',
        channel: existingOrder.channel,
        paymentMethod: existingOrder.paymentMethod,
        actorUserId: context.actorUserId,
      })

      await this.audit.log('OrderUpdated', { orderId, changes: input, newTotal: total, newStatus: orderStatus })
      await this.bus.publish({ type: 'OrderUpdated', orderId })

      return { orderId, warnings: stockWarnings }
    })
    return result
  }
}
