-- ---------------------------------------------------------------------------
-- Photographs and short video
-- ---------------------------------------------------------------------------
-- Nothing in this platform stored an image until now. 0055 said so plainly and
-- left it out: "What is deliberately not here: photographs, QR scanning and
-- the mobile shell." This is the photographs.
--
-- A fault report without a picture is a sentence of prose, and the difference
-- between "the tap is dripping" and a photograph of the tap is whether the
-- technician arrives with the right washer. The same is true of a waste write-
-- off nobody can see and a hygiene breach nobody can see.
--
-- Four decisions, each of which could reasonably have gone the other way, so
-- each one says why it went this way.
--
-- **One bucket, org-scoped paths — not a bucket per organisation.**
-- A bucket per venue means creating a bucket at sign-up, which is starting
-- data, which AGENTS.md §6 says belongs in a function — and then the size
-- limit and the MIME list are per-bucket configuration that has to be applied
-- to every bucket ever created. Seven migrations in this repository already
-- made the "runs once, over the organisations that exist today" mistake; a
-- bucket per organisation is that mistake with a storage API in front of it,
-- and the failure would be silent: venue number forty gets a bucket with no
-- limits because the loop that set them ran in 2026. One bucket with the
-- organisation as the first path segment is the shape 0042 already uses for
-- staff documents and sick notes, and it reuses that migration's
-- `storage_path_org()` rather than inventing a second way to read a path.
--
-- **A polymorphic parent, not one foreign key per parent table.**
-- Three parents today — a work order, a HACCP record, a stock movement — and
-- `PLAN.md` Part C is explicit that the next departments arrive as data and
-- share one front door, so the list grows. Separate foreign keys mean a table
-- with eight nullable columns, a check constraint asserting that exactly one
-- is set, and an ALTER of the attachments table every time a department is
-- added — touching a table that two row-level-security policies read. The
-- cost of the polymorphic shape is the lost foreign key, and it is paid back
-- by a trigger that refuses an attachment whose parent does not exist and by
-- an enum that closes the vocabulary, so a typo is a refusal rather than an
-- invisible row. `parent_type` is an enum and not text for exactly that
-- reason.
--
-- **The read rule is the parent's own policy, evaluated — not a copy of it.**
-- A photograph of a work order must be visible to precisely the people who can
-- see that work order. The temptation is to write `org_id in (select
-- auth_org_ids())` on the attachment and call it mirrored, which is true today
-- and stops being true the first time a parent's read policy is narrowed. So
-- `can_see_attachment()` is SECURITY INVOKER and selects from the parent
-- table: the parent's policy decides, and the two cannot drift because there
-- is only one rule and the attachment borrows it. A bucket with looser rules
-- than the row it illustrates is a leak, and a bucket with its own copy of
-- those rules is a leak with a delay.
--
-- **Append-only, like the other five ledgers.**
-- No UPDATE and no DELETE grant on `attachments` for `authenticated`, and no
-- update or delete policy on the objects either. Same reasoning as the sick
-- note in 0042: a technician who can quietly remove the photograph of the
-- damage is the whole reason the photograph was worth taking. The cost is
-- real and is not hidden — a picture uploaded in error stays, and removing it
-- is an administrator's job through the retention route below, not a button.
-- The alternative failure is worse and silent, which is how this repository
-- breaks ties.
--
-- Not a new section in the access grid. An attachment has no access of its
-- own; it has its parent's. Adding MEDIA to `app_sections` would mean a person
-- who may complete a work order but was never granted Media could not
-- photograph it, which is a permission nobody asked for and a support call
-- nobody can explain.
-- ---------------------------------------------------------------------------

-- ── What may be uploaded, in one place ──────────────────────────────────────

create type attachment_parent as enum (
  'WORK_ORDER',      -- Maintenance: a fault, and what it looked like afterwards
  'HACCP_RECORD',    -- Hygiene: a breach, and the corrective action
  'STOCK_MOVEMENT'   -- Inventory: a waste write-off or a damaged delivery
);

create type attachment_kind as enum ('IMAGE', 'VIDEO');

/*
 * The allowed types and their size caps, as rows.
 *
 * The bucket's own `allowed_mime_types` and `file_size_limit` are built from
 * this function below, and the insert trigger reads the same rows. Writing the
 * list twice is how a venue gets an upload the storage service accepts and the
 * database then refuses — a file on disk with no row pointing at it, which
 * nothing cleans up and nobody can see.
 *
 * Images are generous because a photograph of a fault is cheap and worth
 * keeping. Video is capped far harder than it feels, and deliberately: a venue
 * that uploads a clip of every dripping tap fills a bucket and then a bill,
 * and the thirty-second clip nobody ever watches costs the same as four
 * hundred photographs somebody does.
 *
 * image/heic is here because that is what an iPhone produces by default and
 * refusing it means a porter's camera roll does not work.
 */
create or replace function public.media_limits()
returns table (mime_type text, kind public.attachment_kind, max_bytes bigint)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('image/jpeg',      'IMAGE'::public.attachment_kind, 15728640::bigint),
    ('image/png',       'IMAGE'::public.attachment_kind, 15728640::bigint),
    ('image/webp',      'IMAGE'::public.attachment_kind, 15728640::bigint),
    ('image/heic',      'IMAGE'::public.attachment_kind, 15728640::bigint),
    ('video/mp4',       'VIDEO'::public.attachment_kind, 26214400::bigint),
    ('video/quicktime', 'VIDEO'::public.attachment_kind, 26214400::bigint),
    ('video/webm',      'VIDEO'::public.attachment_kind, 26214400::bigint)
  ) as v(mime_type, kind, max_bytes);
$$;

grant execute on function public.media_limits() to authenticated;

/*
 * The bucket, configured from the list above rather than beside it.
 *
 * `file_size_limit` and `allowed_mime_types` are enforced by the storage
 * service before a byte reaches disk, which is the only place a refusal is
 * cheap. They are not the whole control — the service believes the
 * Content-Type the client sends, so the trigger below checks the row too — but
 * they are what stops a 400 MB upload from being transferred at all.
 *
 * Not public. There is no such thing as a work order photograph that the whole
 * internet may read, and a public bucket would make the policies underneath
 * decoration.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'media', 'media', false,
       (select max(max_bytes) from public.media_limits()),
       (select array_agg(mime_type order by mime_type) from public.media_limits())
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/*
 * A uuid from one segment of a storage path, or null if that segment is not
 * one.
 *
 * 0042 reads the organisation out of the first segment the same way. The regex
 * matters more than it looks: a policy that casts `split_part(name,'/',3)` to
 * uuid raises on a path like `media/hello/world`, and a raised cast inside a
 * USING clause is an error on the caller's screen rather than a refusal, which
 * reads to whoever sees it as the platform being broken instead of the
 * platform saying no.
 */
create or replace function public.storage_path_uuid(p_name text, p_segment integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_segment) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', p_segment)::uuid
  end;
$$;

grant execute on function public.storage_path_uuid(text, integer) to authenticated;

-- ── Which parent, and whose rule it borrows ─────────────────────────────────

/*
 * The section of the access grid that governs the parent.
 *
 * Immutable and tiny, so it can be read from a policy without a plan change.
 * Null for anything not listed, and every caller treats null as "no".
 */
create or replace function public.attachment_parent_section(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'WORK_ORDER'     then 'MAINTENANCE'
    when 'HACCP_RECORD'   then 'HYGIENE'
    when 'STOCK_MOVEMENT' then 'INVENTORY'
  end;
$$;

/*
 * The organisation the parent row belongs to.
 *
 * SECURITY DEFINER, because this answers "where does this row live" and not
 * "may you see it" — the write path needs the organisation in order to ask
 * `auth_can_write` about it, and asking that question must not depend on the
 * caller already being able to read the row.
 */
create or replace function public.attachment_parent_org(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'WORK_ORDER'     then (select w.org_id from public.work_orders w where w.id = p_id)
    when 'HACCP_RECORD'   then (select h.org_id from public.haccp_records h where h.id = p_id)
    when 'STOCK_MOVEMENT' then (select m.org_id from public.stock_movements m where m.id = p_id)
  end;
$$;

/*
 * May the caller see the record this file illustrates?
 *
 * SECURITY INVOKER on purpose, which is the one thing about this migration
 * worth reading twice. The function does not reimplement the parent's read
 * rule; it selects from the parent table and lets that table's own row-level
 * policy answer. Mirror by copying and the copy is correct until somebody
 * narrows the original; mirror by evaluating and there is nothing to keep in
 * step.
 *
 * Note what this means when it is called from inside a SECURITY DEFINER
 * trigger: the invoker is then the function owner and every existing parent
 * looks visible. That is why the write path below asks `auth_can_write` and
 * `can_write_section` explicitly rather than leaning on this.
 */
create or replace function public.can_see_attachment(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case p_type
      when 'WORK_ORDER'     then exists (select 1 from public.work_orders w where w.id = p_id)
      when 'HACCP_RECORD'   then exists (select 1 from public.haccp_records h where h.id = p_id)
      when 'STOCK_MOVEMENT' then exists (select 1 from public.stock_movements m where m.id = p_id)
    end, false);
$$;

grant execute on function
  public.attachment_parent_section(text),
  public.attachment_parent_org(text, uuid),
  public.can_see_attachment(text, uuid)
  to authenticated;

/*
 * May the caller attach a file to it?
 *
 * Seeing the parent is not enough. Attaching is a write to the record's story,
 * so it needs what writing to the record needs: membership of the venue that
 * may write, and edit access to the parent's section. A person with READ on
 * Maintenance may look at the photographs on a job and may not add one, which
 * is the same answer the section grid already gives for the completion note.
 */
create or replace function public.can_attach_to(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.can_see_attachment(p_type, p_id)
     and public.auth_can_write(public.attachment_parent_org(p_type, p_id))
     and public.can_write_section(
           public.attachment_parent_section(p_type),
           public.attachment_parent_org(p_type, p_id));
$$;

grant execute on function public.can_attach_to(text, uuid) to authenticated;

-- ── How long a file is kept ─────────────────────────────────────────────────
/*
 * Retention per parent and per kind, because the two differ by years.
 *
 * A photograph on a HACCP record is part of a food-safety record and outlives
 * everything else here — 178/2002 Art 18 makes traceability a legal duty and
 * the records that support it are kept long after the batch is gone. A
 * photograph of a repaired pump supports a warranty or insurance claim, which
 * is a matter of a few years. A thirty-second clip supports an argument that
 * is over within the quarter and costs forty times as much to store, so it is
 * kept for months rather than years.
 *
 * Editable per venue, because none of these numbers is ours to fix: a group
 * with its own records policy will have a different one, and finding out that
 * the number is in a migration rather than a table is the sort of discovery
 * that arrives during an audit.
 */
create table if not exists attachment_retention (
  org_id uuid not null references organizations(id) on delete cascade,
  parent_type attachment_parent not null,
  kind attachment_kind not null,
  keep_days integer not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, parent_type, kind),
  constraint attachment_retention_days check (keep_days between 1 and 7300)
);

-- ── The attachment itself ───────────────────────────────────────────────────

create table if not exists attachments (
  id uuid primary key default uuid_generate_v4(),

  /*
   * Taken from the parent row, never from the client.
   *
   * The same reasoning as `set_line_org_id` in 0004: a line inherits its
   * parent's organisation rather than the caller's default, so a photograph
   * can never end up filed in a different tenant from the job it is of.
   */
  org_id uuid not null references organizations(id) on delete cascade,

  parent_type attachment_parent not null,
  parent_id uuid not null,

  bucket_id text not null default 'media',
  object_path text not null,

  file_name text not null,
  mime_type text not null,
  -- Derived from mime_type by trigger, not accepted from the client: a video
  -- labelled IMAGE would otherwise take the image size cap and the image
  -- retention, which is a fifteen-megabyte clip kept for three years.
  kind attachment_kind not null,
  byte_size bigint not null,

  /*
   * Seconds, where the client knows them. Nothing in Postgres can open an MP4
   * and count frames, so this is a declared figure and the refusal above
   * thirty seconds only bites a client that declares honestly. The cap that
   * always bites is the byte cap, and the front end measures the duration
   * before offering the upload so the honest path is also the easy one.
   */
  duration_seconds integer,

  caption text,

  -- From the caller's JWT. See the trigger: 0054 exists because a decision got
  -- filed under somebody else's name, and a photograph is evidence in exactly
  -- the same way a decision is.
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),

  -- When retention says it may go. Null means kept: see the trigger.
  delete_after timestamptz,

  constraint attachments_file_name check (btrim(file_name) <> ''),
  constraint attachments_size check (byte_size > 0),
  -- Thirty seconds. A fault needs a shot of the thing, not a documentary.
  constraint attachments_duration
    check (duration_seconds is null or duration_seconds between 1 and 30)
);

-- One row per object. Two attachments pointing at one file would mean removing
-- the file under retention breaks the other one.
create unique index if not exists idx_attachments_object
  on attachments(bucket_id, object_path);
create index if not exists idx_attachments_parent
  on attachments(parent_type, parent_id, uploaded_at desc);
create index if not exists idx_attachments_org
  on attachments(org_id, uploaded_at desc);
-- The sweep reads this and only this.
create index if not exists idx_attachments_expiry
  on attachments(delete_after) where delete_after is not null;

/*
 * Everything about an attachment that the client is not trusted to state.
 *
 * In one trigger rather than six, because the checks depend on each other: the
 * kind comes from the type, the cap comes from the kind, the retention comes
 * from both, and the path has to agree with the parent that produced the
 * organisation. Split across several triggers the order would be implicit and
 * the next person would reorder it.
 *
 * The three things worth naming:
 *
 *   The uploader is the caller. Whatever `uploaded_by_email` the client sent
 *   is discarded where there is a session, which is the fix 0054 had to make
 *   twice. A photograph filed under a colleague's name is worse than no
 *   photograph, because it reads as a fact.
 *
 *   The claimed size and type are checked against the object actually in
 *   storage, not merely against the caps. A client is perfectly able to upload
 *   a 300 MB file through a route that skipped the bucket limit and then
 *   declare `byte_size = 2000000`; the caps would pass and the row would lie.
 *   So the row is compared with `storage.objects.metadata`, and an attachment
 *   whose object is not there yet is refused outright — the file goes up
 *   first, which is the order `repository.ts` already uses for staff documents
 *   so that a row never points at nothing.
 *
 *   The path has to sit under its own parent. The storage policy reads access
 *   out of the path, so a row pointing at `<org>/WORK_ORDER/<some other job>/`
 *   would be readable under the other job's rule. Tying the two together here
 *   is what makes "the policy mirrors the parent" true of the file as well as
 *   of the row.
 */
create or replace function public.enforce_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  caller_id uuid := auth.uid();
  parent_org uuid;
  section text;
  limits record;
  object_meta jsonb;
  object_there boolean;
  object_size bigint;
  object_mime text;
  keep integer;
  expected_prefix text;
begin
  section := public.attachment_parent_section(new.parent_type::text);
  parent_org := public.attachment_parent_org(new.parent_type::text, new.parent_id);
  if parent_org is null then
    raise exception 'there is no % to attach this to', lower(replace(new.parent_type::text, '_', ' '))
      using hint = 'Save the record first; the file belongs to it, not the other way round.';
  end if;
  new.org_id := parent_org;

  /*
   * No session means a migration, a cascade or an administrator at the
   * console, the same reading `require_section_write` takes. The access checks
   * stand down there and only there.
   */
  if caller_id is not null then
    if not public.auth_can_write(parent_org) then
      raise exception 'you cannot add files at this venue';
    end if;
    if not public.can_write_section(section, parent_org) then
      raise exception 'you do not have edit access to %',
        coalesce((select s.name from public.app_sections s where s.code = section), section)
        using hint = 'Ask an administrator for edit rights to this section.';
    end if;
  end if;

  if caller_email is not null then
    new.uploaded_by_email := caller_email;
    new.uploaded_by := caller_id;
  elsif coalesce(btrim(new.uploaded_by_email), '') = '' then
    raise exception 'an attachment must record who uploaded it';
  end if;

  new.mime_type := lower(btrim(coalesce(new.mime_type, '')));
  select m.kind, m.max_bytes into limits
    from public.media_limits() m where m.mime_type = new.mime_type;
  if limits is null then
    raise exception '% cannot be attached here', coalesce(nullif(new.mime_type, ''), 'a file with no type')
      using hint = 'Photographs and short video only: ' ||
        (select string_agg(m.mime_type, ', ' order by m.mime_type) from public.media_limits() m);
  end if;
  new.kind := limits.kind;

  if new.byte_size > limits.max_bytes then
    raise exception '% is %, over the % limit of %',
      new.file_name, pg_size_pretty(new.byte_size),
      lower(new.kind::text), pg_size_pretty(limits.max_bytes)
      using hint = case new.kind
        when 'VIDEO' then 'Record a shorter clip, or photograph it instead.'
        else 'Photograph it again at a smaller size.' end;
  end if;

  new.bucket_id := coalesce(nullif(btrim(new.bucket_id), ''), 'media');
  expected_prefix := parent_org::text || '/' || new.parent_type::text || '/'
                     || new.parent_id::text || '/';
  if position(expected_prefix in coalesce(new.object_path, '')) <> 1
     or length(new.object_path) = length(expected_prefix) then
    raise exception 'the file is not stored under the record it belongs to'
      using hint = 'The path is <organisation>/<parent type>/<parent id>/<file>.';
  end if;

  select true, o.metadata into object_there, object_meta
    from storage.objects o
   where o.bucket_id = new.bucket_id and o.name = new.object_path;
  if not coalesce(object_there, false) then
    raise exception 'there is no file at % yet', new.object_path
      using hint = 'Upload the file first, then record it. The other order leaves a row pointing at nothing.';
  end if;

  object_size := (object_meta ->> 'size')::bigint;
  object_mime := lower(coalesce(object_meta ->> 'mimetype', ''));

  /*
   * A resumable upload writes the object row before it knows either figure, so
   * an absent size is not evidence of anything and is not treated as one. A
   * size that is present and disagrees is: that is a client describing a file
   * other than the one it uploaded.
   */
  if object_size is not null and object_size <> new.byte_size then
    raise exception 'the file on disk is % and the record says %',
      pg_size_pretty(object_size), pg_size_pretty(new.byte_size);
  end if;
  if object_size is not null and object_size > limits.max_bytes then
    raise exception '% is %, over the % limit of %',
      new.file_name, pg_size_pretty(object_size),
      lower(new.kind::text), pg_size_pretty(limits.max_bytes);
  end if;
  if object_mime <> '' and object_mime <> new.mime_type then
    raise exception 'the file on disk is % and the record says %', object_mime, new.mime_type;
  end if;

  if new.uploaded_at is null then
    new.uploaded_at := now();
  end if;

  select r.keep_days into keep
    from public.attachment_retention r
   where r.org_id = parent_org
     and r.parent_type = new.parent_type
     and r.kind = new.kind;
  /*
   * No policy row means keep, not delete.
   *
   * The blank-is-not-a-zero rule from the count sheets, in a different coat: a
   * venue that has removed its retention row has said nothing about how long
   * to keep this, and reading silence as "nought days" would destroy evidence
   * on the strength of a missing row.
   */
  if keep is not null then
    new.delete_after := new.uploaded_at + make_interval(days => keep);
  end if;

  return new;
end;
$$;

create trigger attachments_enforce
  before insert on attachments
  for each row execute function public.enforce_attachment();

/*
 * The same caps, at the object.
 *
 * The bucket's limits are enforced by the storage service and the attachment's
 * are enforced by the trigger above, and between the two sits a gap: an object
 * uploaded and never recorded. It is invisible to the application and it is
 * still on the bill. This refuses it at the row, from the same list, so the
 * three answers cannot differ.
 *
 * Deliberately tolerant of absent metadata. A resumable upload inserts the
 * object row before the bytes have finished arriving, and refusing that would
 * break every upload over the size that triggers it.
 */
create or replace function public.enforce_media_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_mime text;
  claimed_size bigint;
  cap bigint;
begin
  if new.bucket_id <> 'media' then
    return new;
  end if;

  claimed_mime := lower(coalesce(new.metadata ->> 'mimetype', ''));
  claimed_size := (new.metadata ->> 'size')::bigint;

  if claimed_mime <> '' then
    select m.max_bytes into cap from public.media_limits() m where m.mime_type = claimed_mime;
    if cap is null then
      raise exception '% cannot be stored here', claimed_mime
        using hint = 'Photographs and short video only.';
    end if;
    if claimed_size is not null and claimed_size > cap then
      raise exception 'a % may not be larger than %', claimed_mime, pg_size_pretty(cap);
    end if;
  elsif claimed_size is not null
        and claimed_size > (select max(m.max_bytes) from public.media_limits() m) then
    raise exception 'that file is larger than anything this bucket accepts';
  end if;

  return new;
end;
$$;

drop trigger if exists media_objects_enforce on storage.objects;
create trigger media_objects_enforce
  before insert or update on storage.objects
  for each row execute function public.enforce_media_object();

-- ── Tenancy ─────────────────────────────────────────────────────────────────

alter table attachments enable row level security;
alter table attachment_retention enable row level security;

/*
 * Read: the parent's rule, borrowed. Write: the parent's rule plus edit access
 * to its section, which is the same pair the trigger checks. Both, because a
 * policy is what refuses a read and a trigger is what refuses a write the
 * policy let through — and because the trigger is the only one of the two that
 * applies to a caller connecting as the table owner.
 */
create policy attachments_read on attachments
  for select to authenticated
  using (public.can_see_attachment(parent_type::text, parent_id));

create policy attachments_insert on attachments
  for insert to authenticated
  with check (public.can_attach_to(parent_type::text, parent_id));

grant select, insert on attachments to authenticated;

/*
 * The ledger does not move.
 *
 * No UPDATE and no DELETE for anybody signed in, the same as stock movements,
 * approval events, recipe status events, HACCP records and time entries. A
 * caption typed wrongly stays wrong and a second attachment can carry the
 * correction; the alternative is a photograph of a damaged chiller that the
 * person who damaged it can take down.
 *
 * service_role may delete, and only because retention has to be able to: the
 * sweep below removes the object through the storage API and then the row, as
 * a job, with nobody's finger on it.
 */
revoke update, delete on attachments from authenticated;
grant delete on attachments to service_role;

create policy attachment_retention_read on attachment_retention
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy attachment_retention_write on attachment_retention
  for all to authenticated
  using (public.can_write_section('ADMIN', org_id))
  with check (public.can_write_section('ADMIN', org_id));
grant select, insert, update, delete on attachment_retention to authenticated;

-- ── The objects ─────────────────────────────────────────────────────────────
/*
 * The whole point of this migration.
 *
 * `media/<org_id>/<PARENT_TYPE>/<parent_id>/<file>` — three facts in the path,
 * so the policy can answer without joining to the attachment row. 0042 learned
 * that the hard way: an object policy that has to look up its own row lets a
 * file exist in a state nothing can read, because the row is written after the
 * upload and the upload is the thing being authorised.
 *
 * Reading a file therefore asks exactly one question, and it is the question
 * the parent table would have been asked: may you see this work order? The
 * organisation in the first segment is checked against the parent's own
 * organisation on the way in, so a path cannot claim a venue its parent is not
 * in.
 *
 * No update policy and no delete policy. An object in this bucket cannot be
 * replaced or removed by anybody signed in — which is also what makes the
 * append-only attachment row mean something, since a row that cannot be
 * deleted next to a file that can is just a broken thumbnail.
 */
drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and public.can_see_attachment(
          split_part(name, '/', 2),
          public.storage_path_uuid(name, 3))
  );

drop policy if exists media_write on storage.objects;
create policy media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.can_attach_to(
          split_part(name, '/', 2),
          public.storage_path_uuid(name, 3))
    and public.storage_path_org(name) = public.attachment_parent_org(
          split_part(name, '/', 2),
          public.storage_path_uuid(name, 3))
  );

-- ── Retention, and the sweep that nothing runs ──────────────────────────────

/*
 * What is past its retention date.
 *
 * **Nothing calls this.** There is no scheduler in this project — no pg_cron,
 * no job runner, and nothing deployed to run one on. Saying so here rather
 * than leaving the reader to discover it: `delete_after` is computed on every
 * row from today, the query that finds expired rows is written and tested, and
 * no file has ever been deleted by it. When Stage 3 brings something that can
 * run a job, that job calls this, removes each object through the storage API
 * and then deletes the row as service_role.
 *
 * It returns rows rather than deleting them because Postgres cannot delete the
 * file. `storage.protect_delete` refuses a direct DELETE on storage.objects
 * for exactly the right reason — the bytes live outside the database and a row
 * removed here leaves them orphaned on the bill. So the database says what has
 * expired and the storage API does the deleting, in that order.
 */
create or replace function public.expired_attachments(p_limit integer default 500)
returns table (
  id uuid,
  org_id uuid,
  bucket_id text,
  object_path text,
  kind public.attachment_kind,
  parent_type public.attachment_parent,
  delete_after timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.org_id, a.bucket_id, a.object_path, a.kind, a.parent_type, a.delete_after
    from public.attachments a
   where a.delete_after is not null
     and a.delete_after < now()
   order by a.delete_after
   limit greatest(p_limit, 0);
$$;

revoke all on function public.expired_attachments(integer) from public;
grant execute on function public.expired_attachments(integer) to service_role;

-- ── What a venue starts with ────────────────────────────────────────────────
/*
 * In a function called on organisation creation, not as an INSERT in this
 * file. Seven migrations made that mistake and rebuilding from empty is what
 * found them: a bare insert here runs once, against whatever organisations
 * exist at that moment, which on a database built from its own migrations is
 * none.
 *
 * `on conflict do nothing` rather than `do update`, so a venue that has
 * shortened its own retention does not have it lengthened again by a redeploy.
 */
create or replace function public.seed_media_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_retention (org_id, parent_type, kind, keep_days)
  values
    -- Three years: long enough for a warranty claim and an insurer's question
    -- about the state of a machine when it failed.
    (p_org, 'WORK_ORDER',     'IMAGE', 1095),
    (p_org, 'WORK_ORDER',     'VIDEO', 90),
    -- Five years. A food-safety record supports the traceability duty under
    -- 178/2002 Art 18 and is asked for long after the food has gone.
    (p_org, 'HACCP_RECORD',   'IMAGE', 1825),
    (p_org, 'HACCP_RECORD',   'VIDEO', 180),
    -- Two years: a waste photograph backs a supplier credit and a year's
    -- accounts, and is of no interest after the second audit.
    (p_org, 'STOCK_MOVEMENT', 'IMAGE', 730),
    (p_org, 'STOCK_MOVEMENT', 'VIDEO', 90)
  on conflict (org_id, parent_type, kind) do nothing;
end;
$$;

create or replace function public.seed_organization_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_venue_parameters(p_org);
  perform public.seed_purchasing_defaults(p_org);
  perform public.seed_tax_and_channels(p_org);
  perform public.seed_people_defaults(p_org);
  perform public.seed_haccp_forms(p_org);
  perform public.seed_maintenance_defaults(p_org);
  perform public.seed_housekeeping_defaults(p_org);
  perform public.seed_media_defaults(p_org);
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_media_defaults(o.id);
  end loop;
end $$;

-- ── What the screens read ───────────────────────────────────────────────────
/*
 * Counts per record, so a list of jobs can show a paperclip without fetching
 * every photograph.
 *
 * `security_invoker` rather than the explicit `org_id in (select
 * auth_org_ids())` the older views carry. A view without it runs as its owner
 * and sees every row, so the badge would be a count of files the caller cannot
 * open — which is itself a small leak, and a confusing one. The older views
 * predate this option being available here; new ones should use it.
 */
create or replace view attachment_counts with (security_invoker = true) as
  select a.parent_type, a.parent_id, a.org_id,
         count(*) as files,
         count(*) filter (where a.kind = 'IMAGE') as images,
         count(*) filter (where a.kind = 'VIDEO') as videos,
         max(a.uploaded_at) as last_uploaded_at
    from public.attachments a
   group by a.parent_type, a.parent_id, a.org_id;

grant select on attachment_counts to authenticated;

comment on table attachments is
  'Append-only. A stored file and the record it illustrates; access is the parent record''s own.';
comment on table attachment_retention is
  'How long files are kept, per parent and per kind. A missing row means keep.';
comment on function public.can_see_attachment(text, uuid) is
  'SECURITY INVOKER on purpose: the parent table''s own policy answers, so the two cannot drift.';
comment on function public.media_limits() is
  'The allowed types and size caps. The bucket config and the insert trigger both read this.';
comment on function public.expired_attachments(integer) is
  'What retention says may go. Nothing calls it yet; there is no job runner.';
comment on view attachment_counts is
  'Files per record, for a list that wants a paperclip and not the photographs.';
