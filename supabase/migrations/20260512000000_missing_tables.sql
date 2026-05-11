-- 20260512000000_missing_tables.sql
-- Creates audit_logs and bi_access_audit tables referenced in code but never migrated.

-- audit_logs — used by GET /api/admin/audit-log
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES org_members(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_org_created
  ON audit_logs (org_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_admin_read ON audit_logs
  FOR SELECT
  USING (
    org_id = (current_setting('app.org_id', true))::uuid
    AND current_setting('app.user_role', true) = 'admin'
  );

-- bi_access_audit — written by cross-dept-agent after every cross-department query
CREATE TABLE IF NOT EXISTS bi_access_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES org_members(id) ON DELETE SET NULL,
  query       text,
  dept        text,
  doc_id      uuid,
  timestamp   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bi_access_audit_org_ts
  ON bi_access_audit (org_id, timestamp DESC);

ALTER TABLE bi_access_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_access_audit_admin_read ON bi_access_audit
  FOR SELECT
  USING (
    org_id = (current_setting('app.org_id', true))::uuid
    AND current_setting('app.user_role', true) IN ('admin', 'super_user')
  );

CREATE POLICY bi_access_audit_agent_insert ON bi_access_audit
  FOR INSERT
  WITH CHECK (true);
