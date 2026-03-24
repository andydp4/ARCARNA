import type { OrdersRepo, ProductsRepo, CustomersRepo, Order, OrderId, ProductId, CustomerId } from '@midnight/domain'

const state = {
  orders: new Map<string, Order>(),
  stock: new Map<string, number>(),
  history: new Map<string, string[]>(),
  tick: new Map<string, number>(),
}

export const OrdersRepoMemory: OrdersRepo = {
  async save(o: Order){ state.orders.set(o.id as any, o) },
  async findById(id: OrderId){ return state.orders.get(id as any) ?? null }
}

export const ProductsRepoMemory: ProductsRepo = {
  async checkStock(p: ProductId): Promise<number> {
    return state.stock.get(p as any) ?? 100
  },
  async reserveStock(p: ProductId, qty: number){
    const cur = state.stock.get(p as any) ?? 100
    state.stock.set(p as any, cur - qty)
  },
  async releaseStock(p: ProductId, qty: number){
    const cur = state.stock.get(p as any) ?? 100
    state.stock.set(p as any, cur + qty)
  },
  async create(product: any) { return product },
  async update(id: ProductId, product: any, _orgId?: string | null) { return product as any },
  async delete(id: ProductId, _orgId?: string | null) {},
  async findById(id: ProductId) { return null },
  async findAll() { return [] }
}

export const CustomersRepoMemory: CustomersRepo = {
  async addTickDebt(c: CustomerId, amount: number){
    const cur = state.tick.get(c as any) ?? 0
    state.tick.set(c as any, cur + amount)
  },
  async addOrderHistory(c: CustomerId, orderId: OrderId){
    const arr = state.history.get(c as any) ?? []
    arr.push(orderId as any)
    state.history.set(c as any, arr)
  },
  async create(customer: any) { return customer },
  async update(id: CustomerId, customer: any, _orgId?: string | null) { return customer as any },
  async delete(id: CustomerId, _orgId?: string | null) {},
  async findById(id: CustomerId) { return null },
  async findAll() { return [] },
  async updateMetrics(c: CustomerId) {}
}