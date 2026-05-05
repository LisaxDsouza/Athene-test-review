import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RLSContext = {
  user_id: string;
  org_id: string;
  department_id?: string;
  user_role: string;
  bi_grant_id?: string;
};

/**
 * Executes a function with the Supabase Row Level Security context set.
 * This is the core of the Athene AI "Zero-Touch" model.
 */
export async function withRLS<T>(
  ctx: RLSContext,
  fn: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const client = createSupabaseServiceClient();

  const { error } = await client.rpc("set_app_context", {
    p_org_id: ctx.org_id,
    p_user_id: ctx.user_id,
    p_dept_id: ctx.department_id || "",
    p_role: ctx.user_role
  });

  if (error) {
    console.error("[RLS] Failed to set app context:", error);
    throw new Error(`Security Context Error: ${error.message}`);
  }

  return fn(client);
}
