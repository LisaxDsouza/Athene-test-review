import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('briefings')
    .select('id, summary, content, calendar_items, email_items, doc_items, generated_at, delivered')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[briefings] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ briefings: data ?? [] })
}
