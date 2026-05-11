import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { withRLS } from '@/lib/supabase/rls-client'
import { resolveUserAccess, resolveOrgUuid } from '@/lib/auth/rbac'

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
  if (!orgUuid) return NextResponse.json({ briefings: [] })

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
          .from('briefings')
          .select('id, summary, content, calendar_items, email_items, doc_items, generated_at, delivered')
          .eq('org_id', orgUuid)
          .eq('user_id', userId)
          .order('generated_at', { ascending: false })
          .limit(20)
        if (error) throw error
        return rows ?? []
      },
    )

    return NextResponse.json({ briefings: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[briefings] Failed to fetch:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
