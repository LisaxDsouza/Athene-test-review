import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RLSContext = {
  user_id: string;
  org_id: string;
  department_id?: string;
  user_role: string;
  /**
   * IDs of departments the user has been granted access to.
   * Required for BI Analysts and Cross-Department Agents.
   */
  grant_ids?: string[];
  bi_grant_id?: string;
};

/**
 * Executes a function with a Unified Security Handshake.
 * This is the core of the Athene AI security model, ensuring that identity,
 * roles, and department grants are applied atomically and audited.
 */
export async function withRLS<T>(
  ctx: RLSContext,
  fn: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const client = createSupabaseServiceClient();

  // UNIFIED SECURITY HANDSHAKE
  // This calls the initialize_secure_session RPC which:
  // 1. Sets Identity (Org/User/Role/Dept)
  // 2. Unlocks Access Grants (for BI Analysts)
  // 3. Logs the session for Security Auditing
  const { error } = await client.rpc("initialize_secure_session", {
    p_org_id: ctx.org_id,
    p_user_id: ctx.user_id,
    p_dept_id: ctx.department_id || null,
    p_role: ctx.user_role,
    p_grant_ids: ctx.grant_ids || []
  });

  if (error) {
    console.error("[RLS] Security Handshake Failed:", error);
    throw new Error(`Security Context Error: ${error.message}`);
  }

  return fn(client);
}
