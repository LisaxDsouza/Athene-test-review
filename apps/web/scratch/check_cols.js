import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkCols() {
  const { data, error } = await supabase.from('org_members').select('*').limit(1)
  if (data && data.length > 0) {
    console.log('org_members columns:', Object.keys(data[0]))
  } else {
    // If empty, we can try to get column names via an empty insert error or similar?
    // Actually, let's try to query a known column to see if it fails.
    console.log('org_members is empty. Trying to list columns via RPC if possible...')
  }
}

checkCols()
