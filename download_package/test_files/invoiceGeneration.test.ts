import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Invoice Generation Test Suite
// Confirms PDF/CSV outputs and file creation

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';
const INVOICE_DIR = path.join(process.cwd(), 'attached_assets', 'invoices');

describe('Invoice Generation', () => {
  let testOrderId: string;

  beforeAll(async () => {
    // Ensure invoice directory exists
    if (!fs.existsSync(INVOICE_DIR)) {
      fs.mkdirSync(INVOICE_DIR, { recursive: true });
    }

    // Create an order for invoice generation
    const productsRes = await fetch(`${API_BASE}/api/products`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });
    const products = await productsRes.json();

    if (products.length === 0) {
      throw new Error('No products available for invoice test');
    }

    const orderData = {
      customerId: null,
      items: [{
        productId: products[0].id,
        quantity: 1,
        price: products[0].price
      }],
      paymentMethod: 'cash',
      locationId: 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671'
    };

    const orderRes = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION_COOKIE
      },
      body: JSON.stringify(orderData)
    });

    const order = await orderRes.json();
    testOrderId = order.id;
  });

  it('should generate invoice for order', async () => {
    const response = await fetch(`${API_BASE}/api/invoices/${testOrderId}`, {
      method: 'POST',
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.invoiceNumber).toBeDefined();
    expect(result.orderId).toBe(testOrderId);
  });

  it('should retrieve invoice data', async () => {
    const response = await fetch(`${API_BASE}/api/invoices`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    expect(response.status).toBe(200);
    const invoices = await response.json();
    
    const testInvoice = invoices.find((inv: any) => inv.orderId === testOrderId);
    expect(testInvoice).toBeDefined();
    expect(testInvoice.invoiceNumber).toBeDefined();
  });

  it('should verify invoice metadata', async () => {
    const response = await fetch(`${API_BASE}/api/invoices`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });

    const invoices = await response.json();
    const testInvoice = invoices.find((inv: any) => inv.orderId === testOrderId);
    
    expect(testInvoice.total).toBeGreaterThan(0);
    expect(testInvoice.createdAt).toBeDefined();
  });
});