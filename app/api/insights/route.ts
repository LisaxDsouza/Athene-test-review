import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { withRLS } from '@/lib/supabase/rls-client'
import { resolveUserAccess, resolveOrgUuid } from '@/lib/auth/rbac'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const [access, orgUuid] = await Promise.all([
    resolveUserAccess(userId, orgId),
    resolveOrgUuid(orgId),
  ])

  if (!access.role) {
    return new NextResponse('User not found in organization', { status: 403 })
  }
  if (!orgUuid) return NextResponse.json({ insights: [] })

  try {
    const data = await withRLS(
      {
        org_id: orgUuid,
        user_id: userId,
        user_role: access.role,
        department_id: access.dept_id ?? null,
      },
      async (client) => {
        const { data: rows, error } = await client
          .from('insights')
          .select('id, title, query, result, citations, refreshed_at, created_at')
          .eq('org_id', orgUuid)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false })
        if (error) throw error
        return rows ?? []
      },
    )

    return NextResponse.json({ insights: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[insights] Failed to fetch:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { title?: string; query?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.title || !body.query) {
    return NextResponse.json({ error: 'title and query are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('insights')
    .insert({
      org_id: orgUuid,
      created_by: userId,
      title: body.title,
      query: body.query,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[insights] Failed to insert:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ insight: data })
}

export async function DELETE(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'Missing insight id' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('insights')
    .delete()
    .eq('id', body.id)
    .eq('org_id', orgUuid)

  if (error) {
    console.error('[insights] Failed to delete:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
