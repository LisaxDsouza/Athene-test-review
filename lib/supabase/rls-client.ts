import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type RLSContext = {
  org_id: string
  user_id: string
  user_role: string
  department_id?: string | null
  grant_ids?: string[]
}

export function createRlsClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for backend tools

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function withRLS<T>(
  ctx: RLSContext,
  fn: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const client = createRlsClient()

  const { error } = await client.rpc('initialize_secure_session', {
    p_org_id: ctx.org_id,
    p_user_id: ctx.user_id,
    p_role: ctx.user_role || 'member',
    p_dept_id: ctx.department_id || null,
    p_grant_ids: ctx.grant_ids || []
  })

  if (error) {
    throw new Error(`Failed to set RLS context: ${error.message}`)
  }

  return fn(client)
}
