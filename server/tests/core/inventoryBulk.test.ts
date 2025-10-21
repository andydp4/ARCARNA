import { describe, it, expect } from '@jest/globals';

// Inventory Bulk Upload Test Suite
// Validates CSV import and stock update logic

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

describe('Inventory Bulk Operations', () => {
  it('should handle bulk stock updates', async () => {
    // Get existing products
    const productsRes = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(productsRes.status).toBe(200);
    const products = await productsRes.json();

    if (products.length === 0) {
      console.warn('No products available for bulk update test');
      return;
    }

    // Update multiple products' stock
    const bulkUpdates = products.slice(0, 3).map((product: any) => ({
      id: product.id,
      stock: product.stock + 10
    }));

    for (const update of bulkUpdates) {
      const response = await fetch(`${API_BASE}/api/products/${update.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': SESSION_COOKIE
        },
        body: JSON.stringify({ stock: update.stock })
      });

      expect(response.status).toBe(200);
    }

    // Verify updates
    const verifyRes = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    const updatedProducts = await verifyRes.json();
    
    for (const update of bulkUpdates) {
      const product = updatedProducts.find((p: any) => p.id === update.id);
      expect(product.stock).toBe(update.stock);
    }
  });

  it('should validate stock levels', async () => {
    const response = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    const products = await response.json();
    
    // All products should have non-negative stock
    products.forEach((product: any) => {
      expect(product.stock).toBeGreaterThanOrEqual(0);
    });
  });
});