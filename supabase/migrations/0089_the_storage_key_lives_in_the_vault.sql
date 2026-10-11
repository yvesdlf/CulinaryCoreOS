-- ---------------------------------------------------------------------------
-- The storage credential lives in the vault, not in a column
-- ---------------------------------------------------------------------------
-- 0087 put the Storage API credential in `storage_api.auth_header`, and 0088
-- added `api_key` beside it. Both in plain text.
--
-- That credential is the `service_role` key. It bypasses row-level security
-- entirely — it is the one secret in this project that, on its own, reads
-- every venue's pay, every sick note and every HR case. A plaintext column
-- puts it in every backup, every `pg_dump`, every restored copy somebody
-- takes to debug something, and in the query history of whoever sets it.
--
-- Nothing has been deployed yet and no real key has ever been written, so
-- this costs one migration now and would have cost a key rotation later.
--
-- `supabase_vault` is already installed (0.3.1) and encrypts at rest, with
-- the plaintext available only through `vault.decrypted_secrets`, which is
-- owner's-rights and reachable from a security-definer function like this
-- one. `base_url` stays a column: a project URL is not a secret and keeping
-- it visible is how somebody checks which project a database is pointed at
-- without being able to use it.
--
-- To configure a deployment, against that project's database:
--
--   select vault.create_secret('<service-role-key>', 'storage_service_key',
--                              'Storage API credential for erasures');
--   update storage_api set base_url = 'https://<ref>.supabase.co/storage/v1';
--
-- and to rotate it, `vault.update_secret`.
-- ---------------------------------------------------------------------------

alter table public.storage_api drop column if exists auth_header;
alter table public.storage_api drop column if exists api_key;

comment on table public.storage_api is
  'Where to reach the Storage API to carry out an erasure. One row, no secret: the credential is in the vault under storage_service_key. See 0089.';

drop function if exists public.drain_storage_deletions();
create function public.drain_storage_deletions()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  service_key text;
  d record;
  resp record;
  sent integer := 0;
  done integer := 0;
  failed integer := 0;
  req bigint;
  earlier text;
begin
  -- 1 · What came back from last time. Before the configuration check, so a
  -- deployment whose credential is removed still finishes what it started.
  for d in
    select id, request_id, attempts
      from public.storage_deletions
     where deleted_at is null and request_id is not null
  loop
    select status_code, error_msg into resp
      from net._http_response where id = d.request_id;

    if resp is null then
      continue;                                   -- Still in flight.
    end if;

    if resp.status_code between 200 and 299 or resp.status_code = 404 then
      -- 404: the storage service does not have it. That is the outcome.
      update public.storage_deletions
         set deleted_at = now(), last_error = null, request_id = null
       where id = d.id;
      done := done + 1;
    else
      update public.storage_deletions
         set last_error = left(coalesce(
               nullif(resp.status_code::text, ''),
               resp.error_msg,
               'no response and no reason given'), 500),
             request_id = null,
             next_attempt_at = now() + (interval '5 minutes' * least(d.attempts, 6))
       where id = d.id;
      failed := failed + 1;
    end if;
  end loop;

  earlier := case when done + failed > 0
                  then format(' (%s confirmed, %s failed from earlier)', done, failed)
                  else '' end;

  -- 2 · Can we send anything?
  select s.base_url into base_url from public.storage_api s where s.id;
  if base_url is null or btrim(base_url) = '' then
    return 'waiting: no storage endpoint configured' || earlier;
  end if;

  select v.decrypted_secret into service_key
    from vault.decrypted_secrets v where v.name = 'storage_service_key';
  if service_key is null or btrim(service_key) = '' then
    -- Distinct from the message above on purpose. "Not configured" and
    -- "configured but I cannot get at the key" send somebody to different
    -- places, and a single message would send them to the wrong one.
    return 'waiting: no storage_service_key in the vault' || earlier;
  end if;

  -- 3 · What to send now.
  for d in
    select id, bucket, path, attempts
      from public.storage_deletions
     where deleted_at is null
       and request_id is null
       and (next_attempt_at is null or next_attempt_at <= now())
     order by requested_at
     limit 200
  loop
    select net.http_delete(
      url := rtrim(base_url, '/') || '/object/' || d.bucket || '/'
             || public.percent_encode_path(d.path),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key)
    ) into req;

    update public.storage_deletions
       set request_id = req, attempts = d.attempts + 1
     where id = d.id;
    sent := sent + 1;
  end loop;

  return format('%s sent, %s confirmed, %s failed', sent, done, failed);
end;
$$;

revoke all on function public.drain_storage_deletions() from public;

comment on function public.drain_storage_deletions() is
  'Asks the Storage API to remove queued objects and confirms the reply before recording the erasure. Credential from the vault. See 0089.';
