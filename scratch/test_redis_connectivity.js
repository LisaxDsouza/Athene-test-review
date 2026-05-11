// scratch/test_redis_connectivity.js
const { getRedis } = require('../apps/web/lib/redis/client');
const dotenv = require('dotenv');
const path = require('path');

// 1. Load env vars from the web app directory
dotenv.config({ path: path.resolve(__dirname, '../apps/web/.env.local') });

async function testConnection() {
  console.log('📡 Testing Redis Connectivity...');
  
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.error('  ❌ ERROR: UPSTASH_REDIS_REST_URL is missing from .env.local');
    return;
  }

  try {
    const redis = getRedis();
    const testKey = 'athene_test_ping';
    const testValue = 'pong-' + Date.now();

    console.log('  > Attempting to WRITE to Redis...');
    await redis.set(testKey, testValue, { ex: 60 });
    console.log('  ✅ Write successful.');

    console.log('  > Attempting to READ from Redis...');
    const result = await redis.get(testKey);
    
    if (result === testValue) {
      console.log('  ✅ Read successful! Value matches:', result);
      console.log('\n✨ REDIS IS FULLY OPERATIONAL.');
    } else {
      console.log('  ❌ Read mismatch. Got:', result);
    }

  } catch (error) {
    console.error('  ❌ CONNECTION FAILED:', error.message);
  }
}

testConnection();
