// scratch/verify_redis_fix.js
const path = require('path');

console.log('🚀 Starting Redis Boot Verification...');

// 1. Simulate a "Cold Start" with MISSING environment variables
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

console.log('  > Environment variables cleared.');

try {
  // 2. Attempt to import the Redis client
  // We use the compiled or transpiled version if possible, 
  // but for a quick check we'll just check if the logic allows loading.
  const { getRedis } = require('../apps/web/lib/redis/client');
  
  console.log('  ✅ SUCCESS: Module imported without crashing.');
  console.log('  > The "Cold Start" crash loop is officially broken.');
  
  // 3. Optional: Prove that it ONLY fails when we actually try to use it
  try {
    console.log('  > Testing lazy initialization (this SHOULD throw now)...');
    getRedis(); 
  } catch (err) {
    console.log('  ✅ SUCCESS: Error caught only at runtime, as expected:', err.message);
  }

} catch (error) {
  console.error('  ❌ FAILURE: The module still crashes on import:', error.message);
  process.exit(1);
}

console.log('\n✨ Verification Complete.');
