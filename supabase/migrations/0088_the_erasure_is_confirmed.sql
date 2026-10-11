-- ---------------------------------------------------------------------------
-- An erasure is recorded when it is confirmed, not when it is posted
-- ---------------------------------------------------------------------------
-- 0087 closed the read and queued the file. Its drain had two defects, both
-- found before anything was configured, and together they would have been
-- worse than leaving the drain switched off.
--
-- 1. It sent only an `Authorization` header. Supabase's hosted gateway wants
--    `apikey` as well on `/storage/v1`, so every request would have been
--    rejected at the edge.
--
-- 2. It stamped `deleted_at` on dispatch and never looked at the reply. So
--    with (1) in place, the queue would have emptied itself on schedule while
--    every file stayed exactly where it was — a privacy ledger saying the
--    note was deleted, a queue saying the file was collected, and the file
--    still there. That is the same false record 0087 was written to fix,
--    moved one layer along and made harder to see.
--
-- The outbox already solved this and the solution is worth copying rather
-- than re-deriving. 0070 records the `pg_net` request id, reconciles against
-- `net._http_response` on a later pass, and distinguishes two kinds of
-- answer: a server that replied puts a code in `status_code`, and a request
-- that never reached one — DNS, timeout, refused — puts a sentence in
-- `error_msg` and leaves `status_code` null. 0070's first draft read only the
-- first pair, so a transport failure looked like a request still in flight,
-- forever. This would have had the identical bug.
--
-- 404 counts as success. The queue row's purpose is that the object is not
-- there; if the storage service has already forgotten it, that purpose is
-- met. Every other answer is a failure that keeps the row, with the reason,
-- for a later attempt.
--
-- Also percent-encoding. Object paths end in a file name somebody typed on a
-- phone, so spaces and accents are ordinary. An unencoded space makes a
-- malformed request line; with the reconciliation above that is now visible
-- rather than silent, but it is still a file that never gets deleted.
-- ---------------------------------------------------------------------------

alter table public.storage_api
  add column if not exists api_key text;

comment on column public.storage_api.api_key is
  'Sent as the apikey header. The hosted gateway rejects /storage/v1 without it.';

alter table public.storage_deletions
  add column if not exists request_id bigint,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists next_attempt_at timestamptz;

/*
 * Percent-encoding, per byte, leaving `/` alone because it separates the
 * path. Postgres has no built-in for this and the alternative is hoping that
 * no guest is called Sørensen.
 */
create or replace function public.percent_encode_path(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(
    case when ch ~ '^[A-Za-z0-9._~/-]$' then ch
         else (select string_agg('%' || upper(substr(hx, i, 2)), '')
                 from (select encode(convert_to(ch, 'UTF8'), 'hex') as hx) h,
                      generate_series(1, length(h.hx), 2) as i)
    end, '' order by n), '')
  from regexp_split_to_table(p_text, '') with ordinality as s(ch, n);
$$;

/*
 * Reconcile first, then dispatch.
 *
 * One job rather than two, because the two halves are useless apart and a
 * second cron entry is a second thing to notice has stopped.
 */
drop function if exists public.drain_storage_deletions();
create function public.drain_storage_deletions()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  d record;
  resp record;
  sent integer := 0;
  done integer := 0;
  failed integer := 0;
  req bigint;
begin
  -- 1 · What came back from last time.
  for d in
    select id, request_id, attempts, bucket, path
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

  -- 2 · What to send now.
  select * into cfg from public.storage_api where id;

  if cfg.base_url is null or btrim(cfg.base_url) = '' then
    return 'waiting: no storage endpoint configured'
           || case when done + failed > 0
                then format(' (%s confirmed, %s failed from earlier)', done, failed)
                else '' end;
  end if;

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
      url := rtrim(cfg.base_url, '/') || '/object/' || d.bucket || '/'
             || public.percent_encode_path(d.path),
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Authorization', cfg.auth_header,
        'apikey', cfg.api_key))
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
  'Asks the Storage API to remove queued objects and confirms the reply before marking the row done. See 0088.';
