CREATE INDEX idx_doc_emb_org_dept ON document_embeddings(org_id, dept_id);
CREATE INDEX idx_doc_emb_visibility ON document_embeddings(visibility);
CREATE INDEX idx_doc_emb_source ON document_embeddings(org_id, source_type, source_id);
CREATE INDEX idx_conversations_user ON conversations(org_id, user_id);
CREATE INDEX idx_conversations_thread ON conversations(thread_id);
CREATE INDEX idx_audit_org ON cross_dept_audit_log(org_id, accessed_at DESC);
CREATE INDEX idx_integrations_org ON org_integrations(org_id, source_type) WHERE is_active = true;
