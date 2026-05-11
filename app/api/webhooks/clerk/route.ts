// app/api/webhooks/clerk/route.ts
//
// Handles Clerk org + membership lifecycle events.
//
// Events handled:
//   organization.created            → create row in organizations
//   organizationMembership.created  → upsert org_members (uses clerk_user_id + org UUID lookup)
//   organizationMembership.updated  → update role
//   organizationMembership.deleted  → remove row + evict Redis cache

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { supabaseAdmin } from '@/lib/supabase/server'
import { redis } from '@/lib/redis/client'
import { mapRole } from '@/lib/auth/clerk'

interface OrgCreatedData {
  id: string           // Clerk org ID e.g. "org_xxx"
  name: string
  slug: string | null
}

interface OrgMembershipData {
  organization: { id: string; name: string; slug: string | null }
  public_user_data: { user_id: string; first_name?: string; last_name?: string; identifier?: string }
  role: string
}

interface ClerkWebhookEvent {
  type: string
  data: OrgCreatedData & OrgMembershipData
}

function cacheKey(clerkUserId: string, clerkOrgId: string) {
  return `user_access:${clerkUserId}:${clerkOrgId}`
}

/** Look up the Supabase UUID for a Clerk org ID. Creates the org row if missing. */
async function resolveOrgUuid(clerkOrgId: string, name: string, slug: string | null): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .single()

  if (existing) return existing.id

  const safeSlug = slug ?? clerkOrgId
  const { data: created, error } = await supabaseAdmin
    .from('organizations')
    .insert({ clerk_org_id: clerkOrgId, name, slug: safeSlug })
    .select('id')
    .single()

  if (error) {
    console.error('[clerk-webhook] Failed to create organization:', error.message)
    return null
  }
  return created.id
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const svix_id        = req.headers.get('svix-id')
  const svix_timestamp = req.headers.get('svix-timestamp')
  const svix_signature = req.headers.get('svix-signature')

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
  }

  const body = await req.text()
  let event: ClerkWebhookEvent

  try {
    const wh = new Webhook(secret)
    event = wh.verify(body, {
      'svix-id':        svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as ClerkWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const { type, data } = event

  // ── organization.created ──────────────────────────────────────────────────
  if (type === 'organization.created') {
    const { id: clerkOrgId, name, slug } = data
    const safeSlug = slug ?? clerkOrgId
    const { error } = await supabaseAdmin
      .from('organizations')
      .upsert(
        { clerk_org_id: clerkOrgId, name, slug: safeSlug },
        { onConflict: 'clerk_org_id', ignoreDuplicates: true }
      )
    if (error) console.error('[clerk-webhook] org.created upsert failed:', error.message)
    else console.log(`[clerk-webhook] org.created: upserted org clerk_id=${clerkOrgId}`)
    return NextResponse.json({ received: true })
  }

  // ── membership events ─────────────────────────────────────────────────────
  const clerkOrgId  = data?.organization?.id
  const clerkUserId = data?.public_user_data?.user_id
  const clerkRole   = data?.role

  if (!clerkOrgId || !clerkUserId) {
    return NextResponse.json({ error: 'Missing org or user in payload' }, { status: 400 })
  }

  if (type === 'organizationMembership.created' || type === 'organizationMembership.updated') {
    const role = mapRole(clerkRole) ?? 'member'
    const orgName = data?.organization?.name ?? clerkOrgId
    const orgSlug = data?.organization?.slug ?? null

    const orgUuid = await resolveOrgUuid(clerkOrgId, orgName, orgSlug)
    if (!orgUuid) return NextResponse.json({ error: 'Could not resolve org UUID' }, { status: 500 })

    const { error } = await supabaseAdmin
      .from('org_members')
      .upsert(
        { clerk_user_id: clerkUserId, org_id: orgUuid, role },
        { onConflict: 'org_id,clerk_user_id', ignoreDuplicates: false }
      )

    if (error) {
      console.error(`[clerk-webhook] Failed to upsert org_members:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await redis.del(cacheKey(clerkUserId, clerkOrgId)).catch(() => null)
    console.log(`[clerk-webhook] ${type}: user=${clerkUserId} org=${clerkOrgId} role=${role}`)
  }

  if (type === 'organizationMembership.deleted') {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('clerk_org_id', clerkOrgId)
      .single()

    if (org) {
      await supabaseAdmin
        .from('org_members')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('org_id', org.id)
    }

    await redis.del(cacheKey(clerkUserId, clerkOrgId)).catch(() => null)
    console.log(`[clerk-webhook] deleted org_members user=${clerkUserId} org=${clerkOrgId}`)
  }

  return NextResponse.json({ received: true })
}
