import { redis } from '@/lib/redis/client'
import { supabaseAdmin } from '@/lib/supabase/server'
import { mapRole, type AppRole } from './clerk'

// Broader role union used by UI components (includes super_user for internal tooling)
export type UserRole = AppRole | 'super_user'

export interface UserAccess {
  role: AppRole | null
  dept_id: string | null
  accessible_dept_ids: string[]
  bi_grant_id: string | null
}

const RBAC_CACHE_TTL_SECONDS = 300

export async function resolveUserAccess(
  userId: string,
  orgId: string,
  clerkRole?: string | null,
): Promise<UserAccess> {
  const cacheKey = `user_access:${userId}:${orgId}`

  try {
    const cached = await redis.get<UserAccess>(cacheKey)
    if (cached) return cached
  } catch {
    // ignore cache failures
  }

  const fallbackRole = mapRole(clerkRole)

  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select('dept_id, role, bi_access_grants(id, dept_id, is_active, expires_at)')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (error || !data) {
    // No org_members row yet — auto-provision one with the Clerk role as default.
    // This is the safety net for users who sign in before the Clerk webhook fires,
    // or for orgs that were set up before the webhook was registered.
    if (fallbackRole) {
      await supabaseAdmin
        .from('org_members')
        .upsert(
          { user_id: userId, org_id: orgId, role: fallbackRole },
          { onConflict: 'user_id,org_id', ignoreDuplicates: true },
        )
        .then(({ error: upsertErr }) => {
          if (upsertErr) {
            console.warn('[rbac] Auto-provision org_members failed:', upsertErr.message)
          }
        })
    }

    const fallback: UserAccess = {
      role: fallbackRole,
      dept_id: null,
      accessible_dept_ids: [],
      bi_grant_id: null,
    }
    await redis.set(cacheKey, fallback, { ex: RBAC_CACHE_TTL_SECONDS })
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

  await redis.set(cacheKey, resolved, { ex: RBAC_CACHE_TTL_SECONDS })
  return resolved
}
