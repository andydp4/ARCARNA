import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Product CRUD Test Suite
// Verifies product create/read/update/delete endpoints and DB persistence

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

describe('Product CRUD Operations', () => {
  let testProductId: string;
  const testLocationId = 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671';

  it('should create a new product', async () => {
    const productData = {
      name: 'Test Product CRUD',
      price: 49.99,
      sku: 'TEST-CRUD-001',
      cost: 25.00,
      stock: 100,
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

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.id).toBeDefined();
    expect(result.name).toBe(productData.name);
    expect(result.price).toBe(productData.price);
    
    testProductId = result.id;
  });

  it('should read the created product', async () => {
    const response = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const products = await response.json();
    expect(Array.isArray(products)).toBe(true);
    
    const testProduct = products.find((p: any) => p.id === testProductId);
    expect(testProduct).toBeDefined();
    expect(testProduct.name).toBe('Test Product CRUD');
  });

  it('should update the product', async () => {
    const updateData = {
      name: 'Updated Test Product',
      price: 59.99
    };

    const response = await fetch(`${API_BASE}/api/products/${testProductId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(updateData)
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.name).toBe(updateData.name);
    expect(result.price).toBe(updateData.price);
  });

  it('should delete the product', async () => {
    const response = await fetch(`${API_BASE}/api/products/${testProductId}`, {
      method: 'DELETE',
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect([200, 204]).toContain(response.status);
  });

  it('should verify product is deleted', async () => {
    const response = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    const products = await response.json();
    const deletedProduct = products.find((p: any) => p.id === testProductId);
    expect(deletedProduct).toBeUndefined();
  });
});