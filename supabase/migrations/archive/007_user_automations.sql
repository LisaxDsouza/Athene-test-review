-- ATH-20 / 007_user_automations.sql
create or replace function is_valid_cron(expr text)
returns boolean
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := regexp_split_to_array(trim(expr), '\\s+');
  return array_length(parts, 1) in (5, 6);
end;
$$;

alter table user_automations
  add constraint user_automations_cron_valid check (is_valid_cron(cron_expression));
