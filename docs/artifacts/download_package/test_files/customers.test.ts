import { describe, it, expect } from '@jest/globals';

// Customer Creation and Linking Test Suite
// Tests relationships between customers, orders, and loyalty tiers

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

describe('Customer CRUD and Relationships', () => {
  let testCustomerId: string;

  it('should create a new customer', async () => {
    const customerData = {
      name: 'Test Customer Loyalty',
      email: `test${Date.now()}@example.com`,
      phone: '555-TEST-01',
      category: 'regular',
      loyaltyEnabled: true
    };

    const response = await fetch(`${API_BASE}/api/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(customerData)
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.id).toBeDefined();
    expect(result.name).toBe(customerData.name);
    expect(result.loyaltyEnabled).toBe(true);
    
    testCustomerId = result.id;
  });

  it('should read customer data', async () => {
    const response = await fetch(`${API_BASE}/api/customers`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const customers = await response.json();
    
    const testCustomer = customers.find((c: any) => c.id === testCustomerId);
    expect(testCustomer).toBeDefined();
    expect(testCustomer.loyaltyEnabled).toBe(true);
  });

  it('should update customer tier', async () => {
    const updateData = {
      category: 'vip'
    };

    const response = await fetch(`${API_BASE}/api/customers/${testCustomerId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(updateData)
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.category).toBe('vip');
  });

  it('should link customer to order', async () => {
    // Get available products
    const productsRes = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });
    const products = await productsRes.json();
    
    if (products.length === 0) {
      console.warn('No products available for order test');
      return;
    }

    const orderData = {
      customerId: testCustomerId,
      items: [{
        productId: products[0].id,
        quantity: 2,
        price: products[0].price
      }],
      paymentMethod: 'cash',
      locationId: 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671'
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
    expect(result.customerId).toBe(testCustomerId);
  });

  it('should delete customer', async () => {
    const response = await fetch(`${API_BASE}/api/customers/${testCustomerId}`, {
      method: 'DELETE',
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect([200, 204]).toContain(response.status);
  });
});