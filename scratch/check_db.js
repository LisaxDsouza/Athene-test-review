const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load env from the web app
dotenv.config({ path: path.join(__dirname, '../apps/web/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log('🚀 Starting Deep Database Verification...\n');

  // 1. Check Core Tables
  const tables = ['organizations', 'org_members', 'access_grants', 'documents', 'document_embeddings', 'cross_dept_audit_log'];
  console.log('--- Phase 1: Schema Check ---');
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') { 
      console.log(`❌ Table "${table}" error:`, error.message);
    } else if (error && error.code === '42P01') {
      console.log(`❌ Table "${table}" is MISSING.`);
    } else {
      console.log(`✅ Table "${table}" is online.`);
    }
  }

  // 2. Encryption / Decryption Round-Trip
  console.log('\n--- Phase 2: Encryption & BYOK Logic ---');
  const testKey = 'sk-athene-test-' + Date.now();
  const kmsSecret = 'athene-dev-secret';

  // We need a real org and an admin member for the FKs to pass
  const tempSlug = 'encrypt-test-' + Date.now();
  const { data: org } = await supabase.from('organizations').insert({ name: 'Encrypt Test', slug: tempSlug, clerk_org_id: tempSlug }).select().single();

  if (org) {
    // CREATE DUMMY ADMIN MEMBER
    const { error: memError } = await supabase.from('org_members').insert({
      org_id: org.id,
      clerk_user_id: 'test-admin-' + Date.now(),
      email: 'admin@test.com',
      role: 'admin'
    });

    if (memError) {
      console.log('  ❌ Admin member insertion FAILED:', memError.message);
    } else {
      console.log('  ✅ Admin member created.');
      
      // DOUBLE CHECK: Can we see the admin?
      const { data: checkMem } = await supabase.from('org_members').select('id, role').eq('org_id', org.id).eq('role', 'admin').single();
      if (!checkMem) {
        console.log('  ❌ Admin verification FAILED: Database cannot see the new admin.');
      } else {
        console.log(`  ✅ Admin verification SUCCESS: Found Admin ID ${checkMem.id}`);
      }
    }

    console.log('  > Testing store_llm_key...');
    const { error: storeError } = await supabase.rpc('store_llm_key', {
      p_org_id: org.id,
      p_provider: 'test-provider',
      p_plaintext: testKey,
      p_kms_key: kmsSecret
    });

    if (storeError) {
      console.log('  ❌ store_llm_key failed:', storeError.message);
    } else {
      console.log('  ✅ Key stored and encrypted.');

      console.log('  > Testing get_decrypted_llm_key...');
      const { data: decData, error: decError } = await supabase.rpc('get_decrypted_llm_key', {
        p_org_id: org.id,
        p_kms_key: kmsSecret
      });

      if (decError) {
        console.log('  ❌ get_decrypted_llm_key failed:', decError.message);
      } else if (decData && decData[0] && decData[0].plaintext === testKey) {
        console.log('  ✅ Encryption/Decryption round-trip SUCCESS.');
      } else {
        console.log('  ❌ Decrypted data mismatch!');
      }
    }
    // Cleanup
    await supabase.from('organizations').delete().eq('id', org.id);
  } else {
    console.log('  ⚠️ Skipping Phase 2: Could not create test organization.');
  }

  // 3. Round-Trip Read/Write (General)
  console.log('\n--- Phase 3: Round-Trip Read/Write ---');
  const dummySlug = 'test-org-' + Date.now();
  
  console.log('  > Inserting test organization...');
  const { data: insData, error: insError } = await supabase
    .from('organizations')
    .insert({ name: 'Sanity Test Org', slug: dummySlug, clerk_org_id: 'clerk-' + dummySlug })
    .select()
    .single();

  if (insError) {
    console.log('  ❌ Insert failed:', insError.message);
  } else {
    console.log(`  ✅ Inserted Org ID: ${insData.id}`);
    
    console.log('  > Verifying read...');
    const { data: selData, error: selError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', insData.id)
      .single();
    
    if (selError || selData.slug !== dummySlug) {
      console.log('  ❌ Read verification failed.');
    } else {
      console.log('  ✅ Read verification successful.');
    }

    console.log('  > Cleaning up...');
    await supabase.from('organizations').delete().eq('id', insData.id);
    console.log('  ✅ Cleanup complete.');
  }

  console.log('\n✨ Deep Verification Complete.');
}

runTests();
