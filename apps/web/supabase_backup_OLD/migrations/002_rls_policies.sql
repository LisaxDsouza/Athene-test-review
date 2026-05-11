CREATE OR REPLACE FUNCTION set_app_context(p_org_id text, p_user_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.org_id', p_org_id, true);
  PERFORM set_config('app.user_id', p_user_id, true);
END;
$$;

CREATE OR REPLACE FUNCTION encrypt_key(p_key text, p_secret text)
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT encode(pgp_sym_encrypt(p_key, p_secret), 'base64');
$$;

CREATE OR REPLACE FUNCTION decrypt_key(p_encrypted text, p_secret text)
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pgp_sym_decrypt(decode(p_encrypted, 'base64'), p_secret);
$$;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE bi_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_dept_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "same_org_departments" ON departments FOR SELECT USING (org_id = current_setting('app.org_id', true));
CREATE POLICY "same_org_members" ON org_members FOR SELECT USING (org_id = current_setting('app.org_id', true));
CREATE POLICY "same_org_grants" ON bi_access_grants FOR SELECT USING (org_id = current_setting('app.org_id', true));

CREATE POLICY "hierarchical_read" ON document_embeddings FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  AND (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE user_id = current_setting('app.user_id', true)
        AND org_id = document_embeddings.org_id
        AND role = 'admin'
    )
    OR visibility = 'org_wide'
    OR (
      visibility IN ('department', 'bi_accessible')
      AND EXISTS (
        SELECT 1 FROM org_members
        WHERE user_id = current_setting('app.user_id', true)
          AND org_id = document_embeddings.org_id
          AND role = 'member'
          AND dept_id = document_embeddings.dept_id
      )
    )
    OR (
      visibility NOT IN ('confidential', 'restricted')
      AND EXISTS (
        SELECT 1 FROM org_members om
        JOIN bi_access_grants bg ON bg.user_id = om.user_id AND bg.org_id = om.org_id
          AND bg.is_active = true
          AND (bg.expires_at IS NULL OR bg.expires_at > now())
        WHERE om.user_id = current_setting('app.user_id', true)
          AND om.org_id = document_embeddings.org_id
          AND om.role = 'bi_analyst'
          AND (
            om.dept_id = document_embeddings.dept_id
            OR (
              document_embeddings.dept_id = ANY(bg.granted_dept_ids)
              AND document_embeddings.visibility = 'bi_accessible'
            )
          )
      )
    )
  )
);

CREATE POLICY "owner_only" ON langgraph_checkpoints FOR ALL USING (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true)
) WITH CHECK (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true)
);

CREATE POLICY "conversation_owner" ON conversations FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true)
);

CREATE POLICY "insert_only" ON cross_dept_audit_log FOR INSERT WITH CHECK (
  org_id = current_setting('app.org_id', true)
);
