import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mapRole } from '@/lib/auth/clerk'
import { supabaseAdmin } from '@/lib/supabase/server'
import { invalidateByokCache } from '@/lib/langgraph/llm-factory'
import { resolveOrgUuid } from '@/lib/auth/rbac'

export async function GET() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return NextResponse.json({ keys: [] })

  // Return key metadata only — never the plaintext key
  const { data, error } = await supabaseAdmin
    .from('llm_keys')
    .select('id, provider, created_at, updated_at')
    .eq('org_id', orgUuid)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[keys] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  const kmsSecret = process.env.KMS_SECRET
  if (!kmsSecret) {
    return NextResponse.json({ error: 'KMS_SECRET is not configured on this server' }, { status: 500 })
  }

  let body: { provider?: string; plaintext_key?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { provider, plaintext_key } = body
  if (!provider || !plaintext_key) {
    return NextResponse.json({ error: 'provider and plaintext_key are required' }, { status: 400 })
  }

  // Store via DB function that encrypts with pgp_sym_encrypt before writing.
  // The plaintext_key is sent as a bind parameter — never interpolated into SQL.
  const { error } = await supabaseAdmin.rpc('store_llm_key', {
    p_org_id:    orgUuid,
    p_provider:  provider,
    p_plaintext: plaintext_key,
    p_kms_key:   kmsSecret,
  })

  if (error) {
    console.error('[keys] Failed to store key:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  invalidateByokCache(orgUuid)
  return NextResponse.json({ stored: true })
}

export async function DELETE(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'Missing key id' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('llm_keys')
    .delete()
    .eq('id', body.id)
    .eq('org_id', orgUuid)

  if (error) {
    console.error('[keys] Failed to delete:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  invalidateByokCache(orgUuid)
  return NextResponse.json({ deleted: true })
}
