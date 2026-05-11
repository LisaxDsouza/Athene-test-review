import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkTypes() {
  const tables = [
    'departments',
    'org_members',
    'bi_access_grants',
    'document_embeddings',
    'org_integrations',
    'org_api_keys',
    'langgraph_checkpoints',
    'conversations',
    'cross_dept_audit_log',
    'user_automations'
  ]

  console.log('Checking column types...')
  
  for (const table of tables) {
    try {
      const { data: row, error: selectError } = await supabase.from(table).select('*').limit(1).maybeSingle()
      if (selectError) {
        console.log(`Table ${table}: Error selecting (${selectError.message})`)
      } else if (row) {
        console.log(`Table ${table}: Exists. Columns: ${Object.keys(row).join(', ')}`)
        // Try to check if specific columns are UUID by testing a cast? No, just list them.
      } else {
        console.log(`Table ${table}: Table might be empty or missing.`)
      }
    } catch (e) {
      console.log(`Table ${table}: Exception (${e.message})`)
    }
  }
}

checkTypes()

