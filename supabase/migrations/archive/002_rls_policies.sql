-- ATH-20 / 002_rls_policies.sql

alter table document_embeddings enable row level security;
alter table langgraph_checkpoints enable row level security;
alter table cross_dept_audit_log enable row level security;
alter table departments enable row level security;
alter table org_members enable row level security;
alter table bi_access_grants enable row level security;
alter table org_integrations enable row level security;
alter table org_api_keys enable row level security;
alter table conversations enable row level security;
alter table pending_background_jobs enable row level security;
alter table user_automations enable row level security;

create policy org_scope_read_departments on departments for select
using (org_id::text = current_setting('app.org_id', true));

create policy org_scope_read_members on org_members for select
using (org_id::text = current_setting('app.org_id', true));

create policy embedding_hierarchical_read on document_embeddings for select using (
  org_id::text = current_setting('app.org_id', true)
  and (
    exists (
      select 1 from org_members m
      where m.org_id = document_embeddings.org_id
        and m.user_id = current_setting('app.user_id', true)
        and m.role = 'admin'
    )
    or (
      exists (
        select 1 from org_members m
        where m.org_id = document_embeddings.org_id
          and m.user_id = current_setting('app.user_id', true)
          and m.role = 'member'
          and m.dept_id = document_embeddings.dept_id
      )
      and document_embeddings.visibility in ('org_wide','department','bi_accessible')
    )
    or (
      exists (
        select 1 from org_members m
        where m.org_id = document_embeddings.org_id
          and m.user_id = current_setting('app.user_id', true)
          and m.role = 'bi_analyst'
      )
      and (
        (document_embeddings.visibility in ('org_wide','department','bi_accessible') and exists (
          select 1 from org_members m
          where m.org_id = document_embeddings.org_id
            and m.user_id = current_setting('app.user_id', true)
            and m.dept_id = document_embeddings.dept_id
        ))
        or (
          document_embeddings.visibility = 'bi_accessible'
          and exists (
            select 1 from bi_access_grants g
            where g.org_id = document_embeddings.org_id
              and g.user_id = current_setting('app.user_id', true)
              and g.dept_id = document_embeddings.dept_id
          )
        )
      )
    )
  )
);

create policy langgraph_checkpoints_owner_only on langgraph_checkpoints
for all using (
  org_id::text = current_setting('app.org_id', true)
  and user_id = current_setting('app.user_id', true)
) with check (
  org_id::text = current_setting('app.org_id', true)
  and user_id = current_setting('app.user_id', true)
);

create policy cross_dept_audit_insert_only on cross_dept_audit_log for insert
with check (
  org_id::text = current_setting('app.org_id', true)
  and user_id = current_setting('app.user_id', true)
);

create policy cross_dept_audit_admin_read on cross_dept_audit_log for select
using (
  org_id::text = current_setting('app.org_id', true)
  and exists (
    select 1 from org_members m
    where m.org_id = cross_dept_audit_log.org_id
      and m.user_id = current_setting('app.user_id', true)
      and m.role = 'admin'
  )
);

revoke update, delete on cross_dept_audit_log from public;
