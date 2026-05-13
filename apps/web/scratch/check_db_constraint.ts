import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    console.log('Checking org_integrations table...')
    
    // Try to insert a dummy record with 'github'
    const { error } = await supabase.from('org_integrations').insert({
        org_id: '00000000-0000-0000-0000-000000000000', // Likely will fail FK but check error message
        source_type: 'github',
        nango_connection_id: 'test',
        index_mode: 'index_live_fetch'
    })
    
    if (error) {
        console.error('Error (expected or actual):', error.message)
        if (error.message.includes('check constraint')) {
            console.log('Confirmed: source_type has a restrictive check constraint.')
        }
    } else {
        console.log('Insert succeeded (unexpectedly)! No check constraint?')
    }
}

check()
