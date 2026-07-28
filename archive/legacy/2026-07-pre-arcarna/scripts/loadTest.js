// Simple Load Testing Script
// Tests API performance under concurrent load

const API_BASE = 'http://localhost:5000';
const SESSION_COOKIE = 'connect.sid=test';
const CONCURRENT_REQUESTS = 50;
const TOTAL_REQUESTS = 200;

async function makeRequest(endpoint) {
  const startTime = Date.now();
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Cookie': SESSION_COOKIE }
    });
    const endTime = Date.now();
    return {
      status: res.status,
      latency: endTime - startTime,
      success: res.status === 200
    };
  } catch (err) {
    return {
      status: 0,
      latency: Date.now() - startTime,
      success: false,
      error: err.message
    };
  }
}

async function runLoadTest() {
  console.log('=== PERFORMANCE LOAD TEST ===');
  console.log(`Target: ${API_BASE}`);
  console.log(`Concurrent Requests: ${CONCURRENT_REQUESTS}`);
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log('');
  
  const endpoints = [
    '/api/products',
    '/api/customers',
    '/api/orders',
    '/api/locations',
    '/api/analytics/daily-revenue?days=7'
  ];
  
  const results = [];
  const startTime = Date.now();
  
  // Run requests in batches
  for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENT_REQUESTS) {
    const batch = [];
    for (let j = 0; j < CONCURRENT_REQUESTS && i + j < TOTAL_REQUESTS; j++) {
      const endpoint = endpoints[(i + j) % endpoints.length];
      batch.push(makeRequest(endpoint));
    }
    
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    
    process.stdout.write(`\rProgress: ${Math.min(i + CONCURRENT_REQUESTS, TOTAL_REQUESTS)}/${TOTAL_REQUESTS}`);
  }
  
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  
  // Calculate metrics
  const successfulRequests = results.filter(r => r.success).length;
  const failedRequests = results.filter(r => !r.success).length;
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  
  const avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const errorRate = (failedRequests / TOTAL_REQUESTS) * 100;
  const throughput = TOTAL_REQUESTS / (totalTime / 1000);
  
  console.log('\n\n=== RESULTS ===');
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Successful: ${successfulRequests}`);
  console.log(`Failed: ${failedRequests}`);
  console.log(`Error Rate: ${errorRate.toFixed(2)}%`);
  console.log('');
  console.log('=== LATENCY METRICS ===');
  console.log(`Average: ${avgLatency.toFixed(0)} ms`);
  console.log(`P50: ${p50} ms`);
  console.log(`P95: ${p95} ms`);
  console.log(`P99: ${p99} ms`);
  console.log('');
  console.log('=== THROUGHPUT ===');
  console.log(`Requests/sec: ${throughput.toFixed(2)}`);
  console.log(`Total Time: ${(totalTime/1000).toFixed(2)} seconds`);
  console.log('');
  console.log('=== THRESHOLDS ===');
  console.log(`P95 < 250ms: ${p95 < 250 ? '✓ PASS' : '✗ FAIL'} (${p95}ms)`);
  console.log(`Error Rate < 1%: ${errorRate < 1 ? '✓ PASS' : '✗ FAIL'} (${errorRate.toFixed(2)}%)`);
  console.log(`Throughput > 200 req/sec: ${throughput > 200 ? '✓ PASS' : '✗ FAIL'} (${throughput.toFixed(2)} req/sec)`);
  
  return {
    success: p95 < 250 && errorRate < 1 && throughput > 200,
    metrics: { p95, errorRate, throughput }
  };
}

// Run the test
runLoadTest()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error('Load test failed:', err);
    process.exit(1);
  });