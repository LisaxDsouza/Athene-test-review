CREATE POLICY "owner_automations" ON user_automations FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true)
);

CREATE INDEX idx_user_automations_active ON user_automations(org_id, user_id, is_active);
