import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testHealth() {
  console.log('Testing Supabase queries...')
  const table = 'organizations'
  console.log(`Checking table: ${table}...`)
  const start = Date.now()
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
  
  if (error) {
    console.log(`Error: ${error.message}`)
  } else {
    console.log(`Success! Count: ${count} (${Date.now() - start}ms)`)
  }

  console.log('Testing Nango...')
  // Simplified nango check
  const nangoSecret = process.env.NANGO_SECRET_KEY
  console.log('Nango Secret exists:', !!nangoSecret)
  
  // Just try a simple fetch to Nango if it's reachable
  try {
      const res = await fetch('https://api.nango.dev/config', {
          headers: { Authorization: `Bearer ${nangoSecret}` }
      })
      console.log('Nango API status:', res.status)
  } catch (e) {
      console.log('Nango fetch failed:', e.message)
  }
}

testHealth()
