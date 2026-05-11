CREATE POLICY "admin_read_integrations" ON org_integrations FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  AND EXISTS (
    SELECT 1 FROM org_members
    WHERE org_members.org_id = org_integrations.org_id
      AND org_members.user_id = current_setting('app.user_id', true)
      AND org_members.role = 'admin'
  )
);

CREATE INDEX idx_org_integrations_active ON org_integrations(org_id, is_active, source_type);
