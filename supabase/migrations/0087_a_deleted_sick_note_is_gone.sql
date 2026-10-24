-- ---------------------------------------------------------------------------
-- A deleted sick note is actually deleted
-- ---------------------------------------------------------------------------
-- `delete_sick_note` removes the `leave_attachments` row, queues the file in
-- `storage_deletions`, and writes a `privacy_actions` entry saying the note
-- was deleted against a named request reference.
--
-- Two things were wrong, and together they made that entry a false statement.
--
-- 1. `sick_notes_read` keyed on the storage path and a People section grant,
--    and never on `leave_attachments`. Deleting the row therefore revoked
--    nothing: the object stayed in the bucket and stayed readable by anybody
--    with People write.
--
-- 2. Nothing drained `storage_deletions`. Two cron jobs existed —
--    `chase-unanswered-requests` and `drain-outbox` — and neither was this
--    one. Rows accumulated with `deleted_at` null forever.
--
-- So the system recorded an erasure it had not performed, of GDPR Article 9
-- special-category health data, against a subject access or erasure request
-- that someone had presumably answered in writing.
--
-- The read policy is the part that matters most, and it is the part that
-- takes effect instantly. Once the attachment row is gone the object is
-- unreadable through the API in the same transaction, whether or not the
-- bytes have been collected yet. The drain is the housekeeping behind it.
--
-- The write policy is deliberately left alone. The client creates the object
-- before the `leave_attachments` row that points at it, so requiring the row
-- on insert would refuse every upload. Read is where the exposure was.
-- ---------------------------------------------------------------------------

/*
 * Readable only while something points at it.
 *
 * `leave_attachments.file_path` holds exactly the object name, as written by
 * the upload path, so this is an equality match rather than a path parse.
 */
drop policy if exists sick_notes_read on storage.objects;
create policy sick_notes_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sick-notes'
    and exists (
      select 1 from public.leave_attachments la
       where la.file_path = storage.objects.name
    )
    and (
      (
        public.auth_employee_id()::text = split_part(name, '/', 2)
        and public.storage_path_org(name) = public.auth_employee_org()
      )
      or public.can_write_section('PEOPLE', public.storage_path_org(name))
    )
  );

/*
 * And the queue gets drained — through the Storage API, not with SQL.
 *
 * The first version of this deleted from `storage.objects` directly and was
 * refused: Supabase guards that table with `storage.protect_delete`. The
 * guard is right. A row in `storage.objects` is metadata; the bytes live in
 * the storage service. Deleting the row would have removed the record of the
 * file while leaving the file, which is a worse version of the bug this
 * migration exists to fix, and one that looks fixed.
 *
 * So the drain makes an HTTP DELETE, the same way `attempt_delivery` posts a
 * message, with the endpoint and credential in a configuration row rather
 * than in this file.
 *
 * Unconfigured it does nothing and says so, rather than marking rows done.
 * That is deliberate and it is the same position 0070 takes for a venue with
 * no messaging provider: the queue stays visibly full, because a queue that
 * empties itself without doing the work is how nobody finds out.
 */
create table if not exists public.storage_api (
  id boolean primary key default true check (id),
  base_url text,
  auth_header text,
  updated_at timestamptz not null default now()
);
alter table public.storage_api enable row level security;
revoke all on public.storage_api from public, authenticated, anon;

comment on table public.storage_api is
  'Where to reach the Storage API to carry out an erasure. One row. No policy: service_role and the console only. See 0087.';

insert into public.storage_api (id) values (true) on conflict (id) do nothing;

-- Dropped rather than replaced: a rebuild that has seen an earlier shape of
-- this function cannot change its return type in place.
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
  n integer := 0;
begin
  select * into cfg from public.storage_api where id;

  if cfg.base_url is null or btrim(cfg.base_url) = '' then
    return 'waiting: no storage endpoint configured';
  end if;

  for d in
    select * from public.storage_deletions
     where deleted_at is null
     order by requested_at
     limit 200
  loop
    perform net.http_delete(
      url := rtrim(cfg.base_url, '/') || '/object/' || d.bucket || '/' || d.path,
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Authorization', cfg.auth_header))
    );

    /*
     * Stamped on dispatch, not on confirmation. pg_net is asynchronous and
     * the reply lands in net._http_response later; chasing it would mean a
     * second queue. A file the Storage API has already forgotten returns 404,
     * which is the outcome this row wanted anyway.
     */
    update public.storage_deletions set deleted_at = now() where id = d.id;
    n := n + 1;
  end loop;

  return n || ' sent to the storage API';
end;
$$;

revoke all on function public.drain_storage_deletions() from public;

comment on function public.drain_storage_deletions() is
  'Asks the Storage API to remove the objects queued by an erasure, and stamps the queue row. See 0087.';

-- Idempotent on a rebuild, for the reason 0069 gives: unschedule-then-schedule
-- says what it means on every version of pg_cron.
do $$
begin
  perform cron.unschedule('drain-storage-deletions');
exception when others then
  null;
end $$;

/*
 * Every ten minutes, not every minute. An erasure is answered in days and the
 * read policy above has already closed the access, so this is collecting
 * bytes rather than racing anybody.
 */
select cron.schedule(
  'drain-storage-deletions',
  '*/10 * * * *',
  $job$ select public.drain_storage_deletions() $job$
);

/*
 * And it is listed. The view names its jobs explicitly, so a job added
 * without touching it runs invisibly — which is the failure the view was
 * created to prevent.
 */
create or replace view scheduled_jobs as
  select jobname as name,
         schedule,
         active,
         command
    from cron.job
   where jobname in ('chase-unanswered-requests', 'drain-outbox',
                     'drain-storage-deletions');

/*
 * Revoked, not granted.
 *
 * 0069 created this view and granted it to `authenticated`; 0077 took that
 * grant away, because nothing on a screen reads it and `cron.job` is where a
 * job with a key written inline would one day end up. The first draft of this
 * migration recreated the view from 0069's text and handed the grant back —
 * precisely the mistake `AGENTS.md` describes, and two checks in
 * `23_exposure.sql` went red within the minute of running the suite.
 */
revoke all on scheduled_jobs from public, anon, authenticated;

comment on view scheduled_jobs is
  'The background jobs this database runs. Deleting expired media is deliberately not one — see 0069.';
