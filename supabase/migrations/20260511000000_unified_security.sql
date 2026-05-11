-- ============================================================
-- 20260511000000_unified_security.sql
-- ============================================================

-- 1. Create the Security Audit Log (The Paper Trail)
CREATE TABLE IF NOT EXISTS security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  user_id uuid,
  role text,
  grant_count int,
  created_at timestamptz DEFAULT now()
);

-- 2. Create the Unified Handshake Function (The Engine)
CREATE OR REPLACE FUNCTION initialize_secure_session(
  p_org_id uuid,
  p_user_id uuid,
  p_role text,
  p_dept_id uuid,
  p_grant_ids uuid[] DEFAULT '{}'
)
RETURNS void AS $$
DECLARE
  v_grant_id uuid;
BEGIN
  -- SET IDENTITY & ROLE
  PERFORM set_config('app.org_id', p_org_id::text, true);
  PERFORM set_config('app.user_id', p_user_id::text, true);
  PERFORM set_config('app.department_id', COALESCE(p_dept_id::text, ''), true);
  PERFORM set_config('app.user_role', p_role, true);

  -- SET DYNAMIC GRANTS
  CREATE TEMPORARY TABLE IF NOT EXISTS session_grants (
    scope_type text,
    scope_id uuid
  ) ON COMMIT DROP;

  TRUNCATE session_grants;

  IF array_length(p_grant_ids, 1) > 0 THEN
    INSERT INTO session_grants (scope_type, scope_id)
    SELECT 'department', unnest(p_grant_ids);
  END IF;

  -- LOG THE INITIALIZATION
  INSERT INTO security_audit_log (org_id, user_id, role, grant_count)
  VALUES (p_org_id, p_user_id, p_role, COALESCE(array_length(p_grant_ids, 1), 0));

END;
$$ LANGUAGE plpgsql;

-- 3. Permissions
GRANT EXECUTE ON FUNCTION initialize_secure_session(uuid, uuid, text, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION initialize_secure_session(uuid, uuid, text, uuid, uuid[]) TO authenticated;

-- Refresh Cache
NOTIFY pgrst, 'reload schema';
