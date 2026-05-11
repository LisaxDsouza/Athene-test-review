import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { mapRole } from '@/lib/auth/clerk'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveOrgUuid } from '@/lib/auth/rbac'

export async function GET() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return NextResponse.json({ logs: [] })

  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('org_id', orgUuid)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[audit-log] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ logs: data ?? [] })
}
