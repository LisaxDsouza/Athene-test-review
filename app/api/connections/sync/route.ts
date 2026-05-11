// app/api/connections/sync/route.ts
//
// Triggers a nango-fetch indexing job for a freshly-connected provider.
// Called by the integrations page immediately after Nango's "connect" event fires.
//
// QStash dispatches to /api/worker/nango-fetch which:
//   fetches chunks → embeds → upserts → enqueues graph-build

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { dispatchThrottled } from '@/lib/qstash/client'
import { getAppBaseUrl } from '@/lib/config/app-url'
import { resolveOrgUuid } from '@/lib/auth/rbac'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { connectionId?: string; provider?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { connectionId, provider } = body
  if (!connectionId || !provider) {
    return NextResponse.json(
      { error: 'connectionId and provider are required' },
      { status: 400 },
    )
  }

  const url = `${getAppBaseUrl()}/api/worker/nango-fetch`

  const { dispatched, msgId } = await dispatchThrottled({
    orgId: orgUuid,
    sourceType: provider,
    url,
    body: { orgId: orgUuid, connectionId, provider },
  })

  if (!dispatched) {
    // Throttled — job queued in pending_background_jobs, will run when slot frees
    return NextResponse.json({ queued: true, dispatched: false })
  }

  return NextResponse.json({ dispatched: true, msgId })
}
