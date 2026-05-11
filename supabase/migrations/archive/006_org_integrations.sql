-- ATH-20 / 006_org_integrations.sql
alter table org_integrations
  add constraint org_integrations_provider_not_blank check (length(trim(provider)) > 0),
  add constraint org_integrations_connection_not_blank check (length(trim(nango_connection_id)) > 0);

create or replace function set_updated_at_org_integrations()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_integrations_updated_at on org_integrations;
create trigger trg_org_integrations_updated_at
before update on org_integrations
for each row execute function set_updated_at_org_integrations();
