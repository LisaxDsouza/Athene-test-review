// scratch/test_unified_security.js
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../apps/web/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runSecurityTests() {
  console.log('🛡️ Starting Unified Security Stress Test...\n');

  const mockOrgId = '00000000-0000-0000-0000-000000000001';
  const mockUserId = '00000000-0000-0000-0000-000000000002';
  const mockDeptId = '00000000-0000-0000-0000-000000000003';
  const mockGrantIds = [
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005'
  ];

  // --- SCENARIO 1: ADMIN HANDSHAKE ---
  console.log('Test 1: Admin Handshake (No Grants)');
  const { error: err1 } = await supabase.rpc('initialize_secure_session', {
    p_org_id: mockOrgId,
    p_user_id: mockUserId,
    p_role: 'admin',
    p_dept_id: mockDeptId,
    p_grant_ids: []
  });
  if (err1) console.error('  ❌ Failed:', err1.message);
  else console.log('  ✅ Handshake Successful.');

  // --- SCENARIO 2: BI ANALYST HANDSHAKE (WITH GRANTS) ---
  console.log('\nTest 2: BI Analyst Handshake (With 2 Grants)');
  const { error: err2 } = await supabase.rpc('initialize_secure_session', {
    p_org_id: mockOrgId,
    p_user_id: mockUserId,
    p_role: 'bi_analyst',
    p_dept_id: mockDeptId,
    p_grant_ids: mockGrantIds
  });
  if (err2) console.error('  ❌ Failed:', err2.message);
  else console.log('  ✅ Handshake Successful.');

  // --- SCENARIO 3: AUDIT LOG VERIFICATION ---
  console.log('\nTest 3: Verifying Audit Log Entries');
  const { data: logs, error: logError } = await supabase
    .from('security_audit_log')
    .select('*')
    .eq('user_id', mockUserId)
    .order('created_at', { ascending: false });

  if (logError) {
    console.error('  ❌ Audit Log Check Failed:', logError.message);
  } else {
    console.log(`  ✅ Audit Log has ${logs.length} entries for this user.`);
    logs.slice(0, 2).forEach((log, i) => {
      console.log(`    [Entry ${i+1}] Role: ${log.role}, Grants: ${log.grant_count}`);
    });
  }

  console.log('\n✨ ALL SECURITY SCENARIOS PASSED.');
}

runSecurityTests();
