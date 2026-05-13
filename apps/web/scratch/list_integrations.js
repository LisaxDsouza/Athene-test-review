const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    console.log('Fetching org_integrations...')
    const { data, error } = await supabase.from('org_integrations').select('*')
    if (error) {
        console.error('Error:', error.message)
    } else {
        console.log('Integrations found:', data.length)
        console.table(data.map(d => ({ 
            id: d.id, 
            org: d.org_id, 
            type: d.source_type, 
            conn: d.nango_connection_id,
            status: d.sync_status 
        })))
    }
}

check()
