// DATA PURGE SCRIPT FOR PRODUCTION RESET
// WARNING: This will delete ALL test data from the database
// Execute with caution

const { drizzle } = require('drizzle-orm/neon-http');
const { neon } = require('@neondatabase/serverless');

async function purgeTestData() {
  console.log('=== DATA PURGE FOR PRODUCTION RESET ===');
  console.log('WARNING: This will delete ALL test data');
  console.log('');
  
  // Connect to database
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  
  try {
    console.log('Starting data purge sequence...\n');
    
    // 1. Delete Orders (and cascade to order_items)
    console.log('1. Deleting all orders...');
    const orderResult = await sql`DELETE FROM orders`;
    console.log(`   Deleted ${orderResult.count || 0} orders`);
    
    // 2. Delete Invoices
    console.log('2. Deleting all invoices...');
    const invoiceResult = await sql`DELETE FROM invoices`;
    console.log(`   Deleted ${invoiceResult.count || 0} invoices`);
    
    // 3. Delete Analytics Data
    console.log('3. Deleting analytics data...');
    await sql`DELETE FROM analytics_daily`;
    await sql`DELETE FROM analytics_weekly`;
    await sql`DELETE FROM analytics_monthly`;
    await sql`DELETE FROM customer_metrics`;
    console.log('   Analytics tables cleared');
    
    // 4. Delete Products
    console.log('4. Deleting all products...');
    const productResult = await sql`DELETE FROM products`;
    console.log(`   Deleted ${productResult.count || 0} products`);
    
    // 5. Delete Customers
    console.log('5. Deleting all customers...');
    const customerResult = await sql`DELETE FROM customers`;
    console.log(`   Deleted ${customerResult.count || 0} customers`);
    
    // 6. Delete Expenses
    console.log('6. Deleting all expenses...');
    const expenseResult = await sql`DELETE FROM expenses`;
    console.log(`   Deleted ${expenseResult.count || 0} expenses`);
    
    // 7. Delete Promotions
    console.log('7. Deleting all promotions...');
    const promoResult = await sql`DELETE FROM promotions`;
    console.log(`   Deleted ${promoResult.count || 0} promotions`);
    
    // Verify empty tables
    console.log('\nVerifying data purge...');
    const counts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM orders) as orders,
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM customers) as customers,
        (SELECT COUNT(*) FROM invoices) as invoices
    `;
    
    const result = counts[0];
    const allEmpty = result.orders === '0' && 
                     result.products === '0' && 
                     result.customers === '0' && 
                     result.invoices === '0';
    
    if (allEmpty) {
      console.log('✅ All test data successfully purged');
      console.log('\n=== SYSTEM READY FOR PRODUCTION ===');
      console.log('Database is clean and ready for production data');
      return true;
    } else {
      console.log('⚠️ Warning: Some data may remain');
      console.log(`Orders: ${result.orders}, Products: ${result.products}, Customers: ${result.customers}, Invoices: ${result.invoices}`);
      return false;
    }
    
  } catch (err) {
    console.error('❌ Error during data purge:', err.message);
    return false;
  }
}

// Safety check - require explicit confirmation
if (process.argv[2] === '--confirm') {
  purgeTestData()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
} else {
  console.log('DATA PURGE SCRIPT');
  console.log('=================');
  console.log('This script will DELETE ALL DATA from the database.');
  console.log('');
  console.log('To execute, run:');
  console.log('  node scripts/dataPurge.js --confirm');
  console.log('');
  console.log('WARNING: This action cannot be undone!');
  process.exit(0);
}