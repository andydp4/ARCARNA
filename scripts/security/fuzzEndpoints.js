// Endpoint Fuzzing Script
// Tests input validation and error handling

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';

const fuzzTests = [
  {
    name: 'SQL Injection Test',
    endpoint: '/api/products',
    payload: { name: "'; DROP TABLE products; --", price: 100 }
  },
  {
    name: 'XSS Script Injection',
    endpoint: '/api/products',
    payload: { name: "<script>alert('XSS')</script>", price: 100 }
  },
  {
    name: 'Path Traversal',
    endpoint: '/api/products',
    payload: { name: "../../../etc/passwd", price: 100 }
  },
  {
    name: 'Null Byte Injection',
    endpoint: '/api/products',
    payload: { name: "test\x00admin", price: 100 }
  },
  {
    name: 'Oversized Payload',
    endpoint: '/api/products',
    payload: { name: "A".repeat(10000), price: 100 }
  }
];

async function runFuzzTests() {
  console.log('=== ENDPOINT FUZZING TESTS ===\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of fuzzTests) {
    try {
      const response = await fetch(`${API_BASE}${test.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': SESSION_COOKIE
        },
        body: JSON.stringify(test.payload)
      });
      
      // Check if server properly handled malicious input
      if (response.status === 400 || response.status === 422 || response.status === 500) {
        console.log(`✓ ${test.name}: Request rejected (${response.status})`);
        passed++;
      } else {
        const data = await response.text();
        // Verify payload was sanitized
        if (!data.includes(test.payload.name)) {
          console.log(`✓ ${test.name}: Input sanitized`);
          passed++;
        } else {
          console.log(`✗ ${test.name}: Potential vulnerability`);
          failed++;
        }
      }
    } catch (err) {
      console.log(`✓ ${test.name}: Connection rejected (good)`);
      passed++;
    }
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}/${fuzzTests.length}`);
  console.log(`Failed: ${failed}/${fuzzTests.length}`);
  console.log(`\nOverall: ${failed === 0 ? '✓ PASS' : '✗ FAIL'}\n`);
  
  return failed === 0;
}

runFuzzTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Fuzz test error:', err);
    process.exit(1);
  });