import { redis } from '@/lib/redis/client'
import { supabaseAdmin } from '@/lib/supabase/server'
import { mapRole, type AppRole } from './clerk'

export type UserRole = AppRole | 'super_user'

export interface UserAccess {
  role: AppRole | null
  dept_id: string | null
  accessible_dept_ids: string[]
  bi_grant_id: string | null
}

const RBAC_CACHE_TTL_SECONDS = 300

/** Resolve the Supabase UUID for a Clerk org ID. Returns null if the org row doesn't exist yet. */
export async function resolveOrgUuid(clerkOrgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .single()
  return data?.id ?? null
}

export async function resolveUserAccess(
  clerkUserId: string,
  clerkOrgId: string,
  clerkRole?: string | null,
): Promise<UserAccess> {
  const cacheKey = `user_access:${clerkUserId}:${clerkOrgId}`

  try {
    const cached = await redis.get<UserAccess>(cacheKey)
    if (cached) return cached
  } catch {
    // ignore cache failures — fall through to DB
  }

  const fallbackRole = mapRole(clerkRole)

  const orgUuid = await resolveOrgUuid(clerkOrgId)

  if (!orgUuid) {
    // Org row doesn't exist yet (webhook hasn't fired). Return fallback.
    const fallback: UserAccess = { role: fallbackRole, dept_id: null, accessible_dept_ids: [], bi_grant_id: null }
    return fallback
  }

  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select('id, dept_id, role, bi_access_grants(id, dept_id, is_active, expires_at)')
    .eq('clerk_user_id', clerkUserId)
    .eq('org_id', orgUuid)
    .single()

  if (error || !data) {
    // Auto-provision the org_members row as a safety net
    if (fallbackRole) {
      await supabaseAdmin
        .from('org_members')
        .upsert(
          { clerk_user_id: clerkUserId, org_id: orgUuid, role: fallbackRole },
          { onConflict: 'org_id,clerk_user_id', ignoreDuplicates: true },
        )
        .then(({ error: e }) => {
          if (e) console.warn('[rbac] Auto-provision org_members failed:', e.message)
        })
    }

    const fallback: UserAccess = { role: fallbackRole, dept_id: null, accessible_dept_ids: [], bi_grant_id: null }
    try { await redis.set(cacheKey, fallback, { ex: RBAC_CACHE_TTL_SECONDS }) } catch {}
    return fallback
  }

  type Grant = { id: string; dept_id: string; is_active: boolean; expires_at: string | null }
  const grants = (Array.isArray(data.bi_access_grants) ? data.bi_access_grants : []) as Grant[]
  const now = new Date()
  const active = grants.filter((g) => g.is_active && (!g.expires_at || new Date(g.expires_at) > now))

  const resolved: UserAccess = {
    role: (data.role as AppRole | null) ?? fallbackRole,
    dept_id: data.dept_id ?? null,
    accessible_dept_ids: [...new Set(active.map((g) => g.dept_id))],
    bi_grant_id: active[0]?.id ?? null,
  }

  try { await redis.set(cacheKey, resolved, { ex: RBAC_CACHE_TTL_SECONDS }) } catch {}
  return resolved
}
