import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkDeptType() {
  console.log('Testing departments.org_id type...')
  // Try to query departments with a text filter. If it fails with "uuid = text", we know org_id is uuid.
  const { error } = await supabase.from('departments').select('org_id').eq('org_id', 'some-text-id').limit(1)
  
  if (error) {
    console.log('Result:', error.message)
    if (error.message.includes('uuid')) {
        console.log('CONFIRMED: departments.org_id is UUID')
    }
  } else {
    console.log('Result: Success! org_id is TEXT (or compatible)')
  }

  console.log('Testing org_members.user_id type...')
  const { error: error2 } = await supabase.from('org_members').select('user_id').eq('user_id', 'some-text-id').limit(1)
  if (error2) {
    console.log('Result:', error2.message)
  } else {
    console.log('Result: Success!')
  }
}

checkDeptType()
