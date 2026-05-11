CREATE POLICY "admin_read_keys" ON org_api_keys FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  AND EXISTS (
    SELECT 1 FROM org_members
    WHERE org_members.org_id = org_api_keys.org_id
      AND org_members.user_id = current_setting('app.user_id', true)
      AND org_members.role = 'admin'
  )
);

CREATE INDEX idx_org_api_keys_active ON org_api_keys(org_id, provider) WHERE is_active = true;
