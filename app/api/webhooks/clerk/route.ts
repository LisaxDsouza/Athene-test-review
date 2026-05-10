// app/api/webhooks/clerk/route.ts
//
// Handles Clerk organization membership lifecycle events so that every
// user who joins or leaves an org has a matching row in org_members.
//
// Events handled:
//   organizationMembership.created → upsert row with Clerk role as default
//   organizationMembership.updated → update role when admin changes it in Clerk
//   organizationMembership.deleted → remove row + evict Redis cache
//
// Setup: add this URL in Clerk Dashboard → Webhooks:
//   https://<your-domain>/api/webhooks/clerk
// Required env var: CLERK_WEBHOOK_SECRET (the signing secret from Clerk)

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { supabaseAdmin } from '@/lib/supabase/server'
import { redis } from '@/lib/redis/client'
import { mapRole } from '@/lib/auth/clerk'

// ── Clerk webhook payload types ────────────────────────────────────────────

interface OrgMembershipData {
  organization: { id: string }
  public_user_data: { user_id: string }
  role: string         // e.g. "org:member", "org:admin"
}

interface ClerkWebhookEvent {
  type: string
  data: OrgMembershipData
}

// ── Cache key helper ────────────────────────────────────────────────────────

function cacheKey(userId: string, orgId: string) {
  return `user_access:${userId}:${orgId}`
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  // 1. Verify Svix signature
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
  const orgId  = data?.organization?.id
  const userId = data?.public_user_data?.user_id
  const clerkRole = data?.role

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Missing org or user in payload' }, { status: 400 })
  }

  // 2. Route by event type
  if (type === 'organizationMembership.created' || type === 'organizationMembership.updated') {
    const role = mapRole(clerkRole) ?? 'member'

    const { error } = await supabaseAdmin
      .from('org_members')
      .upsert(
        { user_id: userId, org_id: orgId, role },
        { onConflict: 'user_id,org_id', ignoreDuplicates: false }
      )

    if (error) {
      console.error(`[clerk-webhook] Failed to upsert org_members for ${userId}/${orgId}:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Evict stale cache so next request picks up the new role
    await redis.del(cacheKey(userId, orgId)).catch(() => null)

    console.log(`[clerk-webhook] ${type}: upserted org_members user=${userId} org=${orgId} role=${role}`)
  }

  if (type === 'organizationMembership.deleted') {
    const { error } = await supabaseAdmin
      .from('org_members')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId)

    if (error) {
      console.error(`[clerk-webhook] Failed to delete org_members for ${userId}/${orgId}:`, error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await redis.del(cacheKey(userId, orgId)).catch(() => null)

    console.log(`[clerk-webhook] deleted org_members user=${userId} org=${orgId}`)
  }

  return NextResponse.json({ received: true })
}
