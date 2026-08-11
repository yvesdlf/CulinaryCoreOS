-- ---------------------------------------------------------------------------
-- The rest of what an employee needs from HR
-- ---------------------------------------------------------------------------
-- The staff portal in 0041 covered what HR sends out and what an employee sends
-- back: documents, training, leave, clocking. This adds the parts that make it
-- a place somebody actually opens rather than a place they are sent.
--
--   public holidays and birthdays   a calendar with something on it
--   more request kinds              a change of shift, a loan, a final exit
--   the community board             what is for sale and who is playing football
--   the company                     who we are, on a page
--
-- Two decisions worth stating.
--
-- Requests that are not leave get their own table rather than more leave types.
-- A loan is not measured in days, a change of shift needs the two shifts, and a
-- final exit is a process rather than an absence. Forcing them into
-- leave_requests would mean a days column that means nothing on three of them
-- and a balance calculation that has to know which kinds to skip.
--
-- The community board is moderated before it is visible, and by the poster's
-- own line manager. Not because a kitchen needs censorship, but because the
-- board carries somebody's phone number and a price, it is read by their
-- colleagues, and the person who has to deal with it going wrong is the one
-- who should have seen it first.
-- ---------------------------------------------------------------------------

alter table employees add column if not exists date_of_birth date;
-- Whether the venue may show it. A birthday on a shared calendar is pleasant
-- for most people and unwelcome for some, and the difference is not the
-- venue's to assume.
alter table employees add column if not exists birthday_visible boolean not null default true;

-- ── Public holidays ─────────────────────────────────────────────────────────
/*
 * Kept per venue rather than looked up.
 *
 * A hospitality business does not observe the same days as an office — Nyepi
 * closes a venue in Bali completely, and Christmas is its busiest trading day.
 * `closed` is the distinction that matters: a public holiday the venue trades
 * through is a rota problem, not a day off.
 */
create table if not exists public_holidays (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  holiday_on date not null,
  closed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  constraint public_holidays_unique unique (org_id, holiday_on, name)
);

create index if not exists idx_public_holidays_when
  on public_holidays(org_id, holiday_on);

-- ── Requests that are not leave ─────────────────────────────────────────────

create type staff_request_kind as enum (
  'SHIFT_CHANGE',
  'LOAN',
  'FINAL_EXIT',
  'DOCUMENT_LETTER',   -- proof of employment, for a visa or a landlord
  'EXPENSE_CLAIM',
  'OTHER'
);

create type staff_request_status as enum (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'
);

create table if not exists staff_requests (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  kind staff_request_kind not null,
  reference text,
  subject text not null,
  detail text,

  -- Whatever the kind needs: the two shifts for a swap, the amount and term
  -- for a loan, the last working day for an exit. Typed per kind in the app,
  -- because a column per field would be forty columns mostly null.
  fields jsonb not null default '{}'::jsonb,

  status staff_request_status not null default 'SUBMITTED',
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_requests_subject check (btrim(subject) <> '')
);

create index if not exists idx_staff_requests_employee
  on staff_requests(employee_id, created_at desc);
create index if not exists idx_staff_requests_open
  on staff_requests(org_id, status) where status = 'SUBMITTED';

/*
 * A request is decided by somebody else.
 *
 * The same rule as leave and time corrections, for the same reason: a loan
 * approved by the person taking it is not an approval.
 */
create or replace function public.enforce_staff_request_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare subject_user uuid; caller text;
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', coalesce(new.decided_by_email, '')));
  if caller = '' then
    raise exception 'a decision must record who made it';
  end if;

  select e.user_id into subject_user
    from public.employees e where e.id = new.employee_id;

  if (subject_user is not null and subject_user = auth.uid())
     or exists (select 1 from public.employees e
                 where e.id = new.employee_id
                   and lower(coalesce(e.work_email, '')) = caller)
  then
    raise exception 'you cannot decide your own request'
      using hint = 'Ask your line manager.';
  end if;

  new.decided_by_email := coalesce(new.decided_by_email, caller);
  if new.decided_at is null then new.decided_at := now(); end if;
  return new;
end;
$$;

create trigger staff_requests_enforce
  before insert or update on staff_requests
  for each row execute function public.enforce_staff_request_decision();

-- ── The community board ─────────────────────────────────────────────────────

create type board_post_kind as enum ('FOR_SALE', 'WANTED', 'EVENT', 'NOTICE');
create type board_post_status as enum ('PENDING', 'PUBLISHED', 'REJECTED', 'WITHDRAWN');

create table if not exists board_posts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  kind board_post_kind not null default 'FOR_SALE',
  title text not null,
  body text,
  price numeric(18,5),
  contact text,
  event_on date,
  image_path text,

  /*
   * Nothing is visible until a manager has seen it.
   *
   * PENDING is the default and there is no path that writes PUBLISHED from the
   * client — see the trigger. A board that published first and moderated later
   * would put a colleague's phone number in front of the whole venue before
   * anybody had read it.
   */
  status board_post_status not null default 'PENDING',
  approved_by_email text,
  approved_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint board_posts_title check (btrim(title) <> '')
);

create index if not exists idx_board_posts_live
  on board_posts(org_id, status, created_at desc);

/*
 * Only somebody other than the poster may publish.
 *
 * The poster's own line manager, or anybody who administers People. Not the
 * poster, whatever role they hold — a head chef selling a motorbike does not
 * approve their own advert.
 */
create or replace function public.enforce_board_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare poster_user uuid; caller text;
begin
  if tg_op = 'INSERT' then
    -- A post always starts pending, whatever the client asked for.
    if new.status <> 'WITHDRAWN' then new.status := 'PENDING'; end if;
    return new;
  end if;

  if new.status = old.status then return new; end if;

  -- Withdrawing is the poster's own act and needs nobody's permission.
  if new.status = 'WITHDRAWN' then return new; end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  select e.user_id into poster_user
    from public.employees e where e.id = new.employee_id;

  if (poster_user is not null and poster_user = auth.uid())
     or exists (select 1 from public.employees e
                 where e.id = new.employee_id
                   and lower(coalesce(e.work_email, '')) = caller)
  then
    raise exception 'you cannot approve your own post'
      using hint = 'Your line manager sees it on their tasks.';
  end if;

  if new.status = 'PUBLISHED' then
    new.approved_by_email := coalesce(new.approved_by_email, nullif(caller, ''));
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;

create trigger board_posts_moderate
  before insert or update on board_posts
  for each row execute function public.enforce_board_moderation();

-- ── The company, on a page ──────────────────────────────────────────────────

alter table organizations add column if not exists about text;
alter table organizations add column if not exists address text;
alter table organizations add column if not exists contact_email text;
alter table organizations add column if not exists contact_phone text;
alter table organizations add column if not exists founded_on date;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['public_holidays','staff_requests','board_posts']
  loop
    execute format('create trigger %1$s_set_org before insert on %1$I
                      for each row execute function public.set_org_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %1$s_read on %1$I for select to authenticated
         using (org_id in (select public.auth_org_ids()))', t);
    execute format(
      'create policy %1$s_insert on %1$I for insert to authenticated
         with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy %1$s_update on %1$I for update to authenticated
         using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update on %I to authenticated', t);
  end loop;
end $$;

grant delete on public_holidays, board_posts to authenticated;
create policy public_holidays_delete on public_holidays
  for delete to authenticated using (public.auth_can_write(org_id));
create policy board_posts_delete on board_posts
  for delete to authenticated using (public.auth_can_write(org_id));

-- Managing holidays is an HR act; the board is moderated rather than owned.
create trigger public_holidays_section_guard
  before insert or update or delete on public_holidays
  for each row execute function public.require_section_write('PEOPLE');

-- ── What a portal user reaches ──────────────────────────────────────────────

create policy public_holidays_staff on public_holidays
  for select to authenticated
  using (org_id = public.auth_employee_org());

create policy staff_requests_own on staff_requests
  for select to authenticated
  using (employee_id = public.auth_employee_id());
create policy staff_requests_own_insert on staff_requests
  for insert to authenticated
  with check (employee_id = public.auth_employee_id());

-- A published post is visible to everybody at the venue; a pending one only to
-- the person who wrote it, until somebody has looked at it.
create policy board_posts_published on board_posts
  for select to authenticated
  using (
    (org_id = public.auth_employee_org() and status = 'PUBLISHED')
    or employee_id = public.auth_employee_id());
create policy board_posts_own_insert on board_posts
  for insert to authenticated
  with check (employee_id = public.auth_employee_id());
create policy board_posts_own_update on board_posts
  for update to authenticated
  using (employee_id = public.auth_employee_id())
  with check (employee_id = public.auth_employee_id());

/*
 * The month ahead: who is off, whose birthday it is, and what is closed.
 *
 * One view because a calendar wants one list sorted by date, and three
 * queries merged in the browser is three chances to sort them differently.
 */
create or replace view venue_calendar as
  select org_id, 'HOLIDAY' as kind, holiday_on as on_date,
         name as title,
         case when closed then 'Venue closed' else 'Trading' end as detail,
         null::uuid as employee_id
    from public.public_holidays
  union all
  select e.org_id, 'BIRTHDAY',
         make_date(
           extract(year from current_date)::int,
           extract(month from e.date_of_birth)::int,
           extract(day from e.date_of_birth)::int),
         e.first_name || ' ' || e.last_name,
         coalesce(d.name, ''),
         e.id
    from public.employees e
    left join public.departments d on d.id = e.department_id
   where e.date_of_birth is not null
     and e.birthday_visible
     and e.employment_status in ('PROBATION', 'ACTIVE', 'NOTICE')
  union all
  select l.org_id, 'LEAVE', l.starts_on,
         e.first_name || ' ' || e.last_name,
         t.name,
         e.id
    from public.leave_requests l
    join public.employees e on e.id = l.employee_id
    join public.leave_types t on t.id = l.leave_type_id
   where l.status in ('APPROVED', 'TAKEN');

grant select on venue_calendar to authenticated;

comment on table staff_requests is
  'Requests that are not absences: a shift swap, a loan, a final exit. Decided by somebody else.';
comment on table board_posts is
  'The staff board. Nothing is visible until a manager other than the poster has approved it.';
comment on view venue_calendar is
  'Holidays, birthdays and approved leave in one list, for a calendar to render.';
