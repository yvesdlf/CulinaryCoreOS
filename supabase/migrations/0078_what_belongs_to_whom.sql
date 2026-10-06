-- ---------------------------------------------------------------------------
-- 0078 · Keys nobody can read, messages nobody can redirect, and a staff
--        record that belongs to the person it describes
-- ---------------------------------------------------------------------------
-- Three findings from the review before deployment, each about who something
-- belongs to.
--
-- The messaging provider's key sat in `message_channels.config`, a table
-- every member reads and the Settings screen loads whole — a VIEWER could
-- read the email or WhatsApp key in DevTools. The `endpoint` beside it was
-- any URL at all, called from the database host every minute, with the reply
-- body written back into `message_deliveries.last_error` for any member to
-- read: a port scanner for whoever could edit a channel. Channels could be
-- edited by any CHEF. Deliveries could be inserted or re-addressed by the
-- client, and a notification could name another venue's supplier.
--
-- `employees.user_id` was writable by anyone with People access, which every
-- CHEF has by default. Pointing a colleague's record at yourself made their
-- national ID, tax number and bank account readable, and made the portal
-- treat you as them. Changing their work email to yours did the same through
-- `auth_employee_id()`'s email fallback. Sign-up linked a record by email
-- before the address was confirmed, so on a project without confirmations,
-- typing a colleague's address was enough.
--
-- A date of birth was kept twice — once in the restricted `employee_private`
-- and once in `employees`, where every member reads it — birthdays were on
-- the calendar unless somebody turned them off, and the calendar named the
-- leave type, sick leave included (GDPR Art. 9).
--
-- Tests: supabase/tests/24_ownership.sql.
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_admin(org uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.user_id = (select auth.uid())
       and m.organization_id = org
       and m.role in ('OWNER', 'ADMIN')
  );
$$;

-- 1 · The provider key moves somewhere nobody reads ---------------------------

/*
 * A table rather than Vault so the suite can prove it: no grant, RLS on and no
 * policy, so the only readers are definer functions. `attempt_delivery` is
 * one; `set_channel_secret` writes and never reads back.
 */
create table public.message_channel_secrets (
  channel_id  uuid primary key references public.message_channels(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  auth_header text not null,
  updated_at  timestamptz not null default now()
);
alter table public.message_channel_secrets enable row level security;
revoke all on public.message_channel_secrets from anon, authenticated;

alter table public.message_channels add column has_secret boolean not null default false;

insert into public.message_channel_secrets (channel_id, org_id, auth_header)
select id, org_id, config ->> 'auth_header'
  from public.message_channels
 where coalesce(config ->> 'auth_header', '') <> '';
update public.message_channels
   set has_secret = true
 where coalesce(config ->> 'auth_header', '') <> '';
update public.message_channels
   set config = config - 'auth_header'
 where config ? 'auth_header';

alter table public.message_channels
  add constraint message_channels_no_secret_in_config
  check (not (config ? 'auth_header'));

create or replace function public.set_channel_secret(p_channel uuid, p_auth_header text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare org uuid;
begin
  select c.org_id into org from public.message_channels c where c.id = p_channel;
  if org is null or not public.auth_is_admin(org) then
    raise exception 'only an owner or administrator can set a channel''s key'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_auth_header), '') = '' then
    delete from public.message_channel_secrets where channel_id = p_channel;
  else
    insert into public.message_channel_secrets (channel_id, org_id, auth_header)
    values (p_channel, org, p_auth_header)
    on conflict (channel_id) do update
      set auth_header = excluded.auth_header, updated_at = now();
  end if;

  update public.message_channels
     set has_secret = coalesce(btrim(p_auth_header), '') <> '', updated_at = now()
   where id = p_channel;
end;
$$;

-- 2 · An endpoint is a provider, not an address -------------------------------

/*
 * The origins the outbox may call — scheme, host and port, compared whole, so
 * `https://api.resend.com.evil.test` is not `https://api.resend.com`.
 * Platform-owned: no venue edits it, and adding a provider is a row, not a
 * migration. Only https providers are listed; the suite adds the local stack
 * inside its own transaction to exercise a real request.
 */
create table public.message_endpoint_origins (
  origin text primary key,
  note   text not null
);
alter table public.message_endpoint_origins enable row level security;
revoke all on public.message_endpoint_origins from anon, authenticated;
insert into public.message_endpoint_origins (origin, note) values
  ('https://api.resend.com',     'Resend email API'),
  ('https://graph.facebook.com', 'WhatsApp Cloud API');

create or replace function public.check_channel_endpoint()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  endpoint text := btrim(coalesce(new.config ->> 'endpoint', ''));
  v_origin text;
begin
  if endpoint = '' then
    return new;
  end if;
  -- No `@`: credentials in a URL are a second, unreviewed way to send a key.
  v_origin := lower(substring(endpoint from '^([a-z]+://[^/?#@]+)(?:[/?#]|$)'));
  if v_origin is null
     or not exists (select 1 from public.message_endpoint_origins o where o.origin = v_origin) then
    raise exception 'endpoint must be on an approved provider, not %', endpoint
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger message_channels_endpoint
  before insert or update of config on public.message_channels
  for each row execute function public.check_channel_endpoint();

create or replace function public.attempt_delivery(p_delivery uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  endpoint text;
  auth_header text;
  req_id bigint;
begin
  select m.*, c.config, c.kind as channel_kind, n.subject, n.body, n.kind as notification_kind
    into d
    from public.message_deliveries m
    join public.message_channels c on c.id = m.channel_id
    join public.notifications n on n.id = m.notification_id
   where m.id = p_delivery;

  if d is null then
    return 'gone';
  end if;

  if d.destination is null or btrim(d.destination) = '' then
    update public.message_deliveries
       set status = 'SKIPPED', last_error = 'no destination recorded', updated_at = now()
     where id = p_delivery;
    return 'skipped: no destination';
  end if;

  endpoint := d.config ->> 'endpoint';
  if endpoint is null or btrim(endpoint) = '' then
    -- Not a failure. See the header: this is the state of every venue that has
    -- not been given a provider, including this project's own laptops.
    return 'waiting: no endpoint configured for this channel';
  end if;

  -- The key lives where no member can read it; see section 1 of 0078.
  select s.auth_header into auth_header
    from public.message_channel_secrets s
   where s.channel_id = d.channel_id;

  select net.http_post(
    url := endpoint,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header)),
    body := jsonb_build_object(
      'to', d.destination,
      'subject', d.subject,
      'text', d.body,
      'reference', d.id)
  ) into req_id;

  update public.message_deliveries
     set attempts = attempts + 1,
         external_id = req_id::text,
         claimed_at = now(),
         updated_at = now()
   where id = p_delivery;

  return 'sent to ' || endpoint;
end;
$$;

/*
 * The provider's reply body no longer reaches a table members read. The code
 * stays (`response_code`); the body was the read-back half of the scanner.
 */
create or replace function public.reconcile_deliveries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  d record;
  resp record;
begin
  for d in
    select m.id, m.external_id, m.attempts
      from public.message_deliveries m
     where m.status = 'PENDING' and m.external_id is not null
  loop
    /*
     * `error_msg` as well as `status_code`, and the difference is a defect
     * this had before it was tested against a real endpoint.
     *
     * `pg_net` records two kinds of answer. A server that replied puts a code
     * and a body in `status_code`/`content`. A request that never reached a
     * server — no connection, DNS failure, timeout — puts a sentence in
     * `error_msg` and leaves the other two null. The first draft of this
     * selected only the first pair, so a transport failure produced a record
     * whose fields were all null, `resp is null` was true, and the delivery was
     * treated as still in flight. Forever: PENDING, with `external_id` set, so
     * nothing retried it and nothing reported it. A message that sticks
     * silently is the exact failure an outbox exists to make impossible, and it
     * was found by pointing a channel at an address that does not answer.
     */
    select status_code, content, error_msg into resp
      from net._http_response where id = d.external_id::bigint;
    if resp is null then
      continue;                      -- Still in flight.
    end if;

    if resp.status_code is null then
      -- Never reached a server. Treated as a failure, with the reason kept.
      update public.message_deliveries
         set status = case when d.attempts >= 5 then 'FAILED' else 'PENDING' end,
             last_error = left(coalesce(resp.error_msg, 'no response and no reason given'), 500),
             next_attempt_at = now() + public.delivery_backoff(d.attempts),
             external_id = null,
             updated_at = now()
       where id = d.id;
    elsif resp.status_code between 200 and 299 then
      update public.message_deliveries
         set status = 'SENT', sent_at = now(), response_code = resp.status_code,
             last_error = null, updated_at = now()
       where id = d.id;
    else
      update public.message_deliveries
         set status = case when d.attempts >= 5 then 'FAILED' else 'PENDING' end,
             response_code = resp.status_code,
             last_error = 'the provider refused it (HTTP ' || resp.status_code || ')',
             next_attempt_at = now() + public.delivery_backoff(d.attempts),
             external_id = null,
             updated_at = now()
       where id = d.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 3 · Who may change a channel, and who sees one ------------------------------

drop policy message_channels_insert on public.message_channels;
drop policy message_channels_update on public.message_channels;
drop policy message_channels_delete on public.message_channels;
drop policy message_channels_read   on public.message_channels;

create policy message_channels_insert on public.message_channels
  for insert to authenticated with check (public.auth_is_admin(org_id));
create policy message_channels_update on public.message_channels
  for update to authenticated using (public.auth_is_admin(org_id))
  with check (public.auth_is_admin(org_id));
create policy message_channels_delete on public.message_channels
  for delete to authenticated using (public.auth_is_admin(org_id));
create policy message_channels_read on public.message_channels
  for select to authenticated using (public.can_read_section('PARAMETERS', org_id));

-- 4 · Deliveries are made by the database, not the client ---------------------

/*
 * The queue trigger and the drain write deliveries; both are definer
 * functions. The screen only counts them. A client that could insert one
 * could send anything to anyone from the venue's channel, and one that could
 * update `destination` could forward purchase orders to itself.
 */
revoke insert, update, delete on public.message_deliveries from authenticated;

create or replace function public.notification_supplier_in_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.supplier_id is not null and not exists (
       select 1 from public.suppliers s
        where s.id = new.supplier_id and s.org_id = new.org_id) then
    raise exception 'that supplier does not belong to this venue'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_supplier_in_org
  before insert or update of supplier_id, org_id on public.notifications
  for each row execute function public.notification_supplier_in_org();

-- 5 · A staff record belongs to the person it describes -----------------------

/*
 * `user_id` is set by the database and nowhere else: on sign-up if the
 * address is already confirmed, on confirmation otherwise. Every other
 * column keeps the grants it had.
 */
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employees'
     and column_name not in ('user_id', 'date_of_birth');
  execute 'revoke insert, update on public.employees from authenticated';
  execute format('grant insert (%s) on public.employees to authenticated', cols);
  execute format('grant update (%s) on public.employees to authenticated', cols);
end $$;

create unique index employees_one_record_per_user
  on public.employees (org_id, user_id) where user_id is not null;

/*
 * A record re-addressed to somebody else stops belonging to whoever it was
 * linked to. Without this, changing a colleague's work email to your own
 * address and waiting for the email fallback did what the column grant now
 * refuses.
 */
create or replace function public.unlink_on_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.work_email is distinct from old.work_email then
    new.user_id := null;
  end if;
  return new;
end;
$$;

create trigger employees_unlink_on_email_change
  before update of work_email on public.employees
  for each row execute function public.unlink_on_email_change();

create or replace function public.link_employee_record(p_user uuid, p_email text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.employees e
     set user_id = p_user
   where e.work_email is not null
     and lower(e.work_email) = lower(p_email)
     and e.user_id is null
     and not exists (select 1 from public.employees o
                      where o.org_id = e.org_id and o.user_id = p_user);
$$;
revoke execute on function public.link_employee_record(uuid, text) from authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  -- Someone with an invitation waiting is joining a venue, not starting one.
  if exists (
    select 1 from public.organization_invitations i
     where lower(i.email) = lower(new.email)
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    return new;
  end if;

  -- And neither is somebody who already appears on a payroll.
  if exists (
    select 1 from public.employees e
     where e.work_email is not null
       and lower(e.work_email) = lower(new.email)
  ) then
    -- Linked here only if the address is already proved — an account created
    -- confirmed, as an administrator or an auto-confirming project does.
    -- Otherwise it waits for link_employee_on_confirmation, below: binding at
    -- sign-up gave the record, and its bank details, to whoever typed the
    -- address first.
    if new.email_confirmed_at is not null then
      perform public.link_employee_record(new.id, new.email);
    end if;
    return new;
  end if;

  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  if base_slug is null or base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug)
  values (coalesce(new.raw_user_meta_data ->> 'organization_name', base_slug), final_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'OWNER');

  return new;
end;
$$;

create or replace function public.link_employee_on_confirmation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.link_employee_record(new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.link_employee_on_confirmation();

/*
 * The email fallback stays — somebody who signed up before their record was
 * created still needs to be recognised — but only for a proved address.
 * Rewritten whole because it is SQL; the `email_confirmed_at` line is new.
 */
create or replace function public.auth_employee_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.user_id = (select auth.uid())
     or (e.work_email is not null
         and lower(e.work_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
         and exists (select 1 from auth.users u
                      where u.id = (select auth.uid())
                        and u.email_confirmed_at is not null))
  order by (e.user_id = (select auth.uid())) desc
  limit 1;
$$;

-- 6 · One date of birth, kept where it is restricted -------------------------

insert into public.employee_private (employee_id, org_id, date_of_birth)
select e.id, e.org_id, e.date_of_birth
  from public.employees e
 where e.date_of_birth is not null
on conflict (employee_id) do update
  set date_of_birth = coalesce(public.employee_private.date_of_birth, excluded.date_of_birth);

/*
 * Opt-in. A birthday on the venue's calendar is the employee's to share; the
 * flag was on for everybody and is now off for everybody until they say so.
 * Nobody has real data in this system yet, so nothing is being taken away.
 */
alter table public.employees alter column birthday_visible set default false;
update public.employees set birthday_visible = false where birthday_visible;

/*
 * Same audience as 0077. Two changes: the birthday comes from
 * `employee_private`, which a definer view may read and a member may not;
 * and leave says "Away". The type of leave — sick leave — is health data,
 * and the calendar is for knowing who is in, not why they are not.
 */
create or replace view public.venue_calendar as
select v.*
  from (
    select h.org_id,
           'HOLIDAY'::text as kind,
           h.holiday_on as on_date,
           h.name as title,
           case when h.closed then 'Venue closed'::text else 'Trading'::text end as detail,
           null::uuid as employee_id
      from public.public_holidays h
    union all
    select e.org_id,
           'BIRTHDAY'::text,
           make_date(extract(year from current_date)::integer,
                     extract(month from p.date_of_birth)::integer,
                     extract(day from p.date_of_birth)::integer),
           e.first_name || ' ' || e.last_name,
           coalesce(b.name, ''),
           e.id
      from public.employees e
      join public.employee_private p on p.employee_id = e.id
      left join public.business_units b on b.id = e.business_unit_id
     where p.date_of_birth is not null
       and e.birthday_visible
       and e.employment_status in ('PROBATION', 'ACTIVE', 'NOTICE')
    union all
    select l.org_id,
           'LEAVE'::text,
           l.starts_on,
           e.first_name || ' ' || e.last_name,
           'Away'::text,
           e.id
      from public.leave_requests l
      join public.employees e on e.id = l.employee_id
     where l.status in ('APPROVED', 'TAKEN')
  ) v
 where v.org_id in (select public.auth_org_ids())
    or v.org_id = public.auth_employee_org();

alter table public.employees drop column date_of_birth;
