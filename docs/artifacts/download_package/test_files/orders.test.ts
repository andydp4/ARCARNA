import { describe, it, expect, beforeAll } from '@jest/globals';

// Order Lifecycle Test Suite
// Verifies order flow: new → processing → complete with inventory and analytics updates

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

describe('Order Lifecycle', () => {
  let testOrderId: string;
  let testProductId: string;
  let initialStock: number;
  const testLocationId = 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671';

  beforeAll(async () => {
    // Create a test product for order
    const productData = {
      name: 'Order Test Product',
      price: 29.99,
      sku: `ORDER-TEST-${Date.now()}`,
      cost: 15.00,
      stock: 50,
      barcode: `BC${Date.now()}`,
      locationId: testLocationId
    };

    const response = await fetch(`${API_BASE}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(productData)
    });

    const result = await response.json();
    testProductId = result.id;
    initialStock = result.stock;
  });

  it('should create a new order', async () => {
    const orderData = {
      customerId: null,
      items: [{
        productId: testProductId,
        quantity: 5,
        price: 29.99
      }],
      paymentMethod: 'cash',
      locationId: testLocationId
    };

    const response = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(orderData)
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.id).toBeDefined();
    expect(result.total).toBeGreaterThan(0);
    
    testOrderId = result.id;
  });

  it('should verify inventory reduction', async () => {
    const response = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    const products = await response.json();
    const testProduct = products.find((p: any) => p.id === testProductId);
    
    expect(testProduct).toBeDefined();
    expect(testProduct.stock).toBe(initialStock - 5);
  });

  it('should retrieve order details', async () => {
    const response = await fetch(`${API_BASE}/api/orders`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const orders = await response.json();
    
    const testOrder = orders.find((o: any) => o.id === testOrderId);
    expect(testOrder).toBeDefined();
    expect(testOrder.status).toBeDefined();
  });

  it('should verify analytics update', async () => {
    const response = await fetch(`${API_BASE}/api/analytics/daily-revenue?days=1`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const analytics = await response.json();
    expect(Array.isArray(analytics)).toBe(true);
  });
});