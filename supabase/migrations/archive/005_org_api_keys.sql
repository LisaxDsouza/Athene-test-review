-- ATH-20 / 005_org_api_keys.sql
create or replace function encrypt_org_api_key(plaintext text)
returns bytea
language sql
stable
as $$
  select pgp_sym_encrypt(plaintext, current_setting('app.kms_key'));
$$;

create or replace function decrypt_org_api_key(ciphertext bytea)
returns text
language sql
stable
as $$
  select pgp_sym_decrypt(ciphertext, current_setting('app.kms_key'));
$$;
