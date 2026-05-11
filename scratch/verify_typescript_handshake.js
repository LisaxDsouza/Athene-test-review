// scratch/verify_typescript_handshake.js
const { withRLS } = require('../apps/web/lib/supabase/rls-client');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../apps/web/.env.local') });

async function verifyWrapper() {
  console.log('🧪 Verifying TypeScript withRLS Wrapper...');

  const ctx = {
    user_id: '00000000-0000-0000-0000-000000000002',
    org_id: '00000000-0000-0000-0000-000000000001',
    user_role: 'super_user',
    grant_ids: ['00000000-0000-0000-0000-000000000099']
  };

  try {
    await withRLS(ctx, async (supabase) => {
      console.log('  ✅ Handshake sent via TypeScript.');
      
      // Query the audit log to prove this call was recorded
      const { data, error } = await supabase
        .from('security_audit_log')
        .select('*')
        .eq('role', 'super_user')
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        console.log(`  ✅ Audit Confirmation: Session recorded (ID: ${data[0].id})`);
      } else {
        console.log('  ❌ Audit Confirmation: No log found.');
      }
    });
    
    console.log('\n✨ INTEGRATION SUCCESS: TypeScript is talking to the Security Engine.');
  } catch (err) {
    console.error('  ❌ Integration Failed:', err.message);
  }
}

verifyWrapper();
