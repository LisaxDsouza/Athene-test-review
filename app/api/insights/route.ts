import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('insights')
    .select('id, title, query, result, citations, refreshed_at, created_at')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[insights] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ insights: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

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
      org_id: orgId,
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
    .eq('org_id', orgId)

  if (error) {
    console.error('[insights] Failed to delete:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
