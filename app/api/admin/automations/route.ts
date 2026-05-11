import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { mapRole } from '@/lib/auth/clerk'
import { supabaseAdmin } from '@/lib/supabase/server'
import { qstash } from '@/lib/qstash/client'
import { getAppBaseUrl } from '@/lib/config/app-url'
import { resolveOrgUuid } from '@/lib/auth/rbac'

// Cron expressions per automation type
const AUTOMATION_CRON: Record<string, string> = {
  morning_briefing: '0 7 * * *',
}

export async function GET() {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return NextResponse.json({ automations: [] })

  const { data, error } = await supabaseAdmin
    .from('automations')
    .select('*')
    .eq('org_id', orgUuid)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[automations] Failed to fetch:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ automations: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('automations')
    .insert({ ...body, org_id: orgUuid, created_by: userId })
    .select('id')
    .single()

  if (error) {
    console.error('[automations] Failed to insert:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ automation: data })
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

  if (!body.id) return NextResponse.json({ error: 'Missing automation id' }, { status: 400 })

  // Cancel any existing QStash schedule before deleting the record
  const { data: existing } = await supabaseAdmin
    .from('automations')
    .select('qstash_schedule_id')
    .eq('id', body.id)
    .eq('org_id', orgUuid)
    .maybeSingle()

  if (existing?.qstash_schedule_id) {
    try {
      await qstash.schedules.delete(existing.qstash_schedule_id)
    } catch (schedErr) {
      console.warn('[automations] Failed to delete QStash schedule during automation delete:', schedErr)
    }
  }

  const { error } = await supabaseAdmin
    .from('automations')
    .delete()
    .eq('id', body.id)
    .eq('org_id', orgUuid)

  if (error) {
    console.error('[automations] Failed to delete:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}

export async function PATCH(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth()
  if (!userId || !orgId) return new NextResponse('Unauthorized', { status: 401 })

  const role = mapRole(orgRole ?? undefined)
  if (role !== 'admin') return new NextResponse('Forbidden', { status: 403 })

  const orgUuid = await resolveOrgUuid(orgId)
  if (!orgUuid) return new NextResponse('Organization not found', { status: 403 })

  let body: { id?: string; enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'Missing automation id' }, { status: 400 })
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Missing enabled boolean' }, { status: 400 })

  // Fetch the current automation record
  const { data: automation, error: fetchError } = await supabaseAdmin
    .from('automations')
    .select('*')
    .eq('id', body.id)
    .eq('org_id', orgUuid)
    .maybeSingle()

  if (fetchError) {
    console.error('[automations] Failed to fetch automation:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

  let qstashScheduleId: string | null = automation.qstash_schedule_id ?? null
  const newStatus = body.enabled ? 'active' : 'paused'

  if (body.enabled) {
    // Cancel existing schedule first to avoid duplicates
    if (qstashScheduleId) {
      try {
        await qstash.schedules.delete(qstashScheduleId)
      } catch {
        // Ignore — may have already been deleted
      }
    }

    // Determine the cron expression: use the stored one or the default for the type
    const cronExpression = automation.cron_expression ?? AUTOMATION_CRON[automation.type] ?? '0 7 * * *'
    const workerUrl = `${getAppBaseUrl()}/api/worker/morning-briefing`

    const schedule = await qstash.schedules.create({
      destination: workerUrl,
      cron: cronExpression,
      // Pass the Supabase UUID so the worker can query the DB directly
      body: JSON.stringify({ orgId: orgUuid }),
      headers: { 'Content-Type': 'application/json' },
    })

    qstashScheduleId = schedule.scheduleId
  } else {
    // Cancel the existing QStash schedule
    if (qstashScheduleId) {
      try {
        await qstash.schedules.delete(qstashScheduleId)
      } catch (schedErr) {
        console.warn('[automations] Failed to delete QStash schedule:', schedErr)
      }
    }
    qstashScheduleId = null
  }

  // Persist the updated state
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('automations')
    .update({
      status: newStatus,
      qstash_schedule_id: qstashScheduleId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('org_id', orgUuid)
    .select('*')
    .single()

  if (updateError) {
    console.error('[automations] Failed to update automation:', updateError.message)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ automation: updated })
}
