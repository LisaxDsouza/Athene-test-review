-- ATH-20 / 003_indexes.sql
create index if not exists idx_departments_org on departments(org_id);
create index if not exists idx_org_members_org on org_members(org_id);
create index if not exists idx_org_members_user on org_members(org_id, user_id);
create index if not exists idx_org_members_dept on org_members(org_id, dept_id);
create index if not exists idx_bi_access_grants_user on bi_access_grants(org_id, user_id);
create index if not exists idx_bi_access_grants_dept on bi_access_grants(org_id, dept_id);
create index if not exists idx_document_embeddings_org on document_embeddings(org_id);
create index if not exists idx_document_embeddings_dept on document_embeddings(org_id, dept_id);
create index if not exists idx_document_embeddings_user on document_embeddings(org_id, owner_user_id);
create index if not exists idx_org_integrations_org on org_integrations(org_id);
create index if not exists idx_org_api_keys_org on org_api_keys(org_id);
create index if not exists idx_langgraph_checkpoints_org_user on langgraph_checkpoints(org_id, user_id);
create index if not exists idx_conversations_org_user on conversations(org_id, user_id);
create index if not exists idx_cross_dept_audit_org_user on cross_dept_audit_log(org_id, user_id);
create index if not exists idx_pending_background_jobs_org on pending_background_jobs(org_id, status);
create index if not exists idx_user_automations_org_user on user_automations(org_id, user_id);
