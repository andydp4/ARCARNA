// Mock Transaction Generator for Testing
// Generates 50+ transactions for analytics validation

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

async function generateMockTransactions() {
  console.log('Starting mock transaction generation...');
  
  // First, get existing products and customers
  const productsRes = await fetch(`${API_BASE}/api/products`, {
    headers: { 'Cookie': SESSION_COOKIE }
  });
  const products = await productsRes.json();
  
  const customersRes = await fetch(`${API_BASE}/api/customers`, {
    headers: { 'Cookie': SESSION_COOKIE }
  });
  const customers = await customersRes.json();
  
  // Create some test products if needed
  if (products.length < 5) {
    console.log('Creating test products...');
    for (let i = 1; i <= 5; i++) {
      await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': SESSION_COOKIE
        },
        body: JSON.stringify({
          name: `Test Product ${i}`,
          price: Math.random() * 100 + 10,
          sku: `MOCK-SKU-${i}`,
          cost: Math.random() * 50 + 5,
          stock: 1000,
          barcode: `${Date.now()}${i}`,
          locationId: 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671'
        })
      });
    }
  }
  
  // Create some test customers if needed
  if (customers.length < 10) {
    console.log('Creating test customers...');
    for (let i = 1; i <= 10; i++) {
      await fetch(`${API_BASE}/api/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': SESSION_COOKIE
        },
        body: JSON.stringify({
          name: `Mock Customer ${i}`,
          email: `mock${i}@test.com`,
          phone: `555-${String(i).padStart(4, '0')}`,
          category: i % 3 === 0 ? 'vip' : 'regular',
          loyaltyEnabled: true
        })
      });
    }
  }
  
  // Re-fetch products and customers
  const finalProducts = await (await fetch(`${API_BASE}/api/products`, {
    headers: { 'Cookie': SESSION_COOKIE }
  })).json();
  
  const finalCustomers = await (await fetch(`${API_BASE}/api/customers`, {
    headers: { 'Cookie': SESSION_COOKIE }
  })).json();
  
  // Generate 50 mock transactions
  console.log('Generating 50 mock orders...');
  const orderResults = [];
  
  for (let i = 1; i <= 50; i++) {
    const customer = finalCustomers[Math.floor(Math.random() * finalCustomers.length)];
    const numItems = Math.floor(Math.random() * 4) + 1;
    const items = [];
    
    for (let j = 0; j < numItems; j++) {
      const product = finalProducts[Math.floor(Math.random() * finalProducts.length)];
      if (product && product.id) {
        items.push({
          productId: product.id,
          quantity: Math.floor(Math.random() * 5) + 1,
          price: product.price
        });
      }
    }
    
    if (items.length > 0) {
      const paymentMethods = ['cash', 'card', 'transfer', 'tick'];
      const order = {
        customerId: customer?.id || null,
        items: items,
        paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
        locationId: 'c9aa5a21-8e32-4b86-a40b-d3b9c4804671'
      };
      
      try {
        const res = await fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': SESSION_COOKIE
          },
          body: JSON.stringify(order)
        });
        
        const result = await res.json();
        orderResults.push(result);
        console.log(`Order ${i}/50 created: ${result.id || 'success'}`);
      } catch (err) {
        console.error(`Failed to create order ${i}:`, err.message);
      }
    }
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`Total orders created: ${orderResults.length}`);
  console.log(`Total revenue generated: $${orderResults.reduce((sum, o) => sum + (o.total || 0), 0).toFixed(2)}`);
  
  return orderResults;
}

// Run the generator
generateMockTransactions()
  .then(() => {
    console.log('\nMock transaction generation complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error generating mock transactions:', err);
    process.exit(1);
  });