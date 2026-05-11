import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mapRole } from '@/lib/auth/clerk'
import { supabaseAdmin } from '@/lib/supabase/server'
import { redis } from '@/lib/redis/client'
import { resolveOrgUuid } from '@/lib/auth/rbac'

export async function GET() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return NextResponse.json({ grants: [] })

  const { data, error } = await supabaseAdmin
    .from('bi_access_grants')
    .select('id, user_id, dept_id, is_active, expires_at, created_at')
    .eq('org_id', orgUuid)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[bi-grants] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ grants: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { user_id?: string; dept_id?: string; expires_at?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.user_id || !body.dept_id) {
    return NextResponse.json({ error: 'user_id and dept_id are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bi_access_grants')
    .insert({
      org_id: orgUuid,
      user_id: body.user_id,
      dept_id: body.dept_id,
      is_active: true,
      expires_at: body.expires_at ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[bi-grants] Failed to insert:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Evict cache so next request picks up the new grant
  await redis.del(`user_access:${body.user_id}:${orgId}`).catch(() => null)

  return NextResponse.json({ grant: data })
}

export async function DELETE(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { id?: string; user_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'Missing grant id' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('bi_access_grants')
    .delete()
    .eq('id', body.id)
    .eq('org_id', orgUuid)

  if (error) {
    console.error('[bi-grants] Failed to delete:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.user_id) {
    await redis.del(`user_access:${body.user_id}:${orgId}`).catch(() => null)
  }

  return NextResponse.json({ deleted: true })
}
