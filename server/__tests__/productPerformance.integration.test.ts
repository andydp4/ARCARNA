import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, gte, lt } from 'drizzle-orm';
import { orders } from '@shared/schema';
// Use one isolated connection so temporary fixture tables cannot affect real data.
const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../db', () => ({ db: fixture.db }));
let client: import('pg').Client | undefined;
beforeAll(async () => {
  const { Client } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { sslFor } = await import('../lib/dbConnection');
  client = new Client({ connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL!) });
  await client.connect();
  fixture.db = drizzle(client);
});
const org = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
afterAll(async () => { await client?.end(); });
describe.skipIf(!process.env.DATABASE_URL)('real PostgreSQL product calculations', () => {
  it('nets discounts, fees, returns and costs; preserves identities and org/date/status scope', async () => {
    await client!.query(`
      CREATE TEMP TABLE products(id uuid PRIMARY KEY, name text, cost_price numeric);
      CREATE TEMP TABLE orders(id uuid PRIMARY KEY, org_id uuid, status text, settled_at timestamp,
        payment_method text, total numeric, settled_total numeric, delivery_fee numeric, vat_rate numeric);
      CREATE TEMP TABLE order_items(id uuid PRIMARY KEY, order_id uuid, product_id uuid,
        quantity numeric, total_price numeric, list_price numeric, unit_cost numeric);
      CREATE TEMP TABLE refund_lines(order_line_id uuid, qty numeric, amount numeric);
      INSERT INTO products VALUES
        ('10000000-0000-0000-0000-000000000001','Same name',99),
        ('10000000-0000-0000-0000-000000000002','Missing snapshot cost',12),
        ('10000000-0000-0000-0000-000000000003','Same name',3),
        ('10000000-0000-0000-0000-000000000004','Weighed',4),
        ('10000000-0000-0000-0000-000000000005','Loss maker',5);
      INSERT INTO orders VALUES
        ('20000000-0000-0000-0000-000000000001','${org}','completed','2026-09-20 12:00','cash',96,96,5,20),
        ('20000000-0000-0000-0000-000000000002','${org}','completed','2026-09-20 12:00','card',40,40,0,0),
        ('20000000-0000-0000-0000-000000000003','${org}','completed','2026-09-20 12:00','card',15,15,0,0),
        ('20000000-0000-0000-0000-000000000004','${org}','completed','2026-09-20 12:00','card',2,2,0,0),
        ('20000000-0000-0000-0000-000000000005','${org}','completed','2026-09-20 12:00','personal_use',1000,1000,0,0),
        ('20000000-0000-0000-0000-000000000006','${org}','pending','2026-09-20 12:00','cash',1000,1000,0,0),
        ('20000000-0000-0000-0000-000000000007','${other}','completed','2026-09-20 12:00','cash',1000,1000,0,0),
        ('20000000-0000-0000-0000-000000000008','${org}','completed','2026-08-20 12:00','cash',1000,1000,0,0);
      INSERT INTO order_items VALUES
        ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',8,80,10,5),
        ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,20,20,NULL),
        ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003',4,40,NULL,NULL),
        ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',1.5,15,10,4),
        ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000005',1,2,2,5),
        ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',100,1000,10,5),
        ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',100,1000,10,5),
        ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001',100,1000,10,5),
        ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001',100,1000,10,5);
      INSERT INTO refund_lines VALUES ('30000000-0000-0000-0000-000000000001',1,9);
    `);
    const { productPerformance } = await import('../services/productPerformance');
    const rows = await productPerformance(and(eq(orders.orgId, org), eq(orders.status, 'completed'),
      gte(orders.settledAt, new Date('2026-09-01')), lt(orders.settledAt, new Date('2026-10-01'))));
    expect(rows).toHaveLength(5);
    const by = new Map(rows.map(r => [r.productId.slice(-1), r]));
    expect(by.get('1')).toMatchObject({quantity:7, revenue:63, grossProfit:28, missingCostUnits:0});
    expect(by.get('2')).toMatchObject({quantity:1, revenue:18, grossProfit:null, missingCostUnits:1});
    expect(by.get('3')).toMatchObject({quantity:4, revenue:40, grossProfit:28});
    expect(by.get('4')).toMatchObject({quantity:1.5, revenue:15, grossProfit:9});
    expect(by.get('5')).toMatchObject({quantity:1, revenue:2, grossProfit:-3});
  });
});
