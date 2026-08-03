-- ---------------------------------------------------------------------------
-- Scheduling and attendance
-- ---------------------------------------------------------------------------
-- A rota, and a record of who actually turned up.
--
-- Three positions, all enforced here rather than in a screen.
--
--   Nobody is rostered to a station they are not qualified for. Food-safety
--   and allergen training is a legal requirement under Regulation 852/2004
--   Annex II Chapter XII, and a certificate that lapsed last month is exactly
--   as much of a problem as one that never existed. The check happens when the
--   shift is assigned, because finding out on the night is not a control.
--
--   Nobody is rostered while they are on approved leave. Otherwise a manager
--   builds a rota round somebody who is in another country.
--
--   A clock-in, once recorded, is never edited. The HR brief is explicit:
--   original time records are immutable and corrections are separate approved
--   records. Time is what payroll is calculated from, so a punch that can be
--   quietly changed is a punch nobody can rely on — and the person correcting
--   it must not be the person it belongs to.
--
-- What is deliberately absent: any pay calculation. Hours are recorded and
-- exported; what they are worth belongs to a payroll provider.
-- ---------------------------------------------------------------------------

create type shift_status as enum ('DRAFT', 'PUBLISHED', 'CANCELLED');

create type time_source as enum (
  'WEB',      -- clocked in from the app
  'KIOSK',    -- a shared device in the venue
  'MANAGER'   -- entered on somebody's behalf, and marked as such
);

-- ── Shifts ──────────────────────────────────────────────────────────────────

create table if not exists shifts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Null is an open shift: a slot that needs filling, which is how a rota
  -- shows a gap rather than hiding it.
  employee_id uuid references employees(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  job_role_id uuid references job_roles(id) on delete set null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Unpaid break within the shift. Subtracted from scheduled hours.
  break_minutes integer not null default 0,

  status shift_status not null default 'DRAFT',
  notes text,

  created_by uuid,
  created_by_email text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shifts_order check (ends_at > starts_at),
  constraint shifts_break check (break_minutes >= 0)
);

create index if not exists idx_shifts_when on shifts(org_id, starts_at);
create index if not exists idx_shifts_employee on shifts(employee_id, starts_at);

/*
 * Refuse a shift the person cannot lawfully or practically work.
 *
 * Both checks are here rather than in the page because a rota gets built from
 * a spreadsheet import as often as from a screen, and the night the check is
 * skipped is the night it mattered.
 *
 * A draft is allowed through: a manager sketching next week should not be
 * fought at every keystroke. Publishing is the commitment, so that is where
 * the rules bite.
 */
create or replace function public.enforce_shift_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required text[];
  missing text[];
  emp record;
  shift_day date;
begin
  if new.employee_id is null or new.status <> 'PUBLISHED' then
    return new;
  end if;

  select e.first_name, e.last_name, e.employment_status
    into emp
    from public.employees e where e.id = new.employee_id;

  if emp is null then
    raise exception 'employee not found';
  end if;

  if emp.employment_status not in ('PROBATION', 'ACTIVE', 'NOTICE') then
    raise exception '% % is % and cannot be rostered',
      emp.first_name, emp.last_name, lower(emp.employment_status::text);
  end if;

  -- Qualified for the role, on the day of the shift.
  select j.required_certifications into required
    from public.job_roles j where j.id = new.job_role_id;

  if required is not null and array_length(required, 1) > 0 then
    shift_day := (new.starts_at at time zone 'UTC')::date;
    select array_agg(r) into missing
      from unnest(required) as r
     where not exists (
       select 1 from public.employee_certifications c
        where c.employee_id = new.employee_id
          and c.kind = r
          and (c.expires_on is null or c.expires_on >= shift_day)
     );
    if missing is not null and array_length(missing, 1) > 0 then
      raise exception '% % is not currently certified for %: %',
        emp.first_name, emp.last_name,
        (select j.title from public.job_roles j where j.id = new.job_role_id),
        array_to_string(missing, ', ')
        using hint = 'Record a current certificate, or roster someone else.';
    end if;
  end if;

  -- Not on approved leave.
  if exists (
    select 1 from public.leave_requests l
     where l.employee_id = new.employee_id
       and l.status in ('APPROVED', 'TAKEN')
       and (new.starts_at at time zone 'UTC')::date between l.starts_on and l.ends_on
  ) then
    raise exception '% % is on approved leave that day', emp.first_name, emp.last_name;
  end if;

  if new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger shifts_enforce
  before insert or update on shifts
  for each row execute function public.enforce_shift_rules();

-- ── Attendance ──────────────────────────────────────────────────────────────

create table if not exists time_entries (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- The shift this was worked against, where there was one. A punch with no
  -- shift is not an error: people cover at short notice.
  shift_id uuid references shifts(id) on delete set null,

  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  break_minutes integer not null default 0,

  source time_source not null default 'WEB',
  -- Who pressed the button, which is not always whose time it is.
  recorded_by uuid,
  recorded_by_email text,
  note text,

  created_at timestamptz not null default now(),

  constraint time_entries_order check (clock_out_at is null or clock_out_at > clock_in_at)
);

create index if not exists idx_time_entries_employee
  on time_entries(employee_id, clock_in_at desc);
create index if not exists idx_time_entries_open
  on time_entries(org_id) where clock_out_at is null;

/*
 * A punch is written once and never edited.
 *
 * Clocking out is the one permitted update, and only on an entry that is still
 * open — everything else about a recorded punch is fixed. A correction is a
 * separate approved record, below.
 */
create or replace function public.protect_time_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.clock_out_at is not null then
    raise exception 'this time entry is closed and cannot be edited'
      using hint = 'Raise a correction instead.';
  end if;
  if new.clock_in_at is distinct from old.clock_in_at
     or new.employee_id is distinct from old.employee_id
     or new.source is distinct from old.source
  then
    raise exception 'a recorded punch cannot be changed'
      using hint = 'Raise a correction instead.';
  end if;
  return new;
end;
$$;

create trigger time_entries_protect
  before update on time_entries
  for each row execute function public.protect_time_entries();

create type correction_status as enum ('REQUESTED', 'APPROVED', 'REJECTED');

create table if not exists time_corrections (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  time_entry_id uuid not null references time_entries(id) on delete cascade,

  -- What it should have said. Null means unchanged.
  corrected_clock_in_at timestamptz,
  corrected_clock_out_at timestamptz,
  corrected_break_minutes integer,

  -- Why, in words. A correction without a reason is indistinguishable from
  -- somebody adjusting their own hours.
  reason text not null,

  status correction_status not null default 'REQUESTED',
  requested_by uuid,
  requested_by_email text,
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),

  constraint time_corrections_reason check (btrim(reason) <> '')
);

create index if not exists idx_time_corrections_entry on time_corrections(time_entry_id);
create index if not exists idx_time_corrections_status
  on time_corrections(org_id, status);

/*
 * A time correction is approved by somebody else.
 *
 * This is the one that matters most in the whole module. Time becomes pay, so
 * a person who can request and approve their own correction can award
 * themselves money.
 */
create or replace function public.enforce_correction_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare subject_user uuid;
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;
  if new.decided_by is null and new.decided_by_email is null then
    raise exception 'a correction decision must record who made it';
  end if;

  select e.user_id into subject_user
    from public.time_entries t
    join public.employees e on e.id = t.employee_id
   where t.id = new.time_entry_id;

  if (subject_user is not null and new.decided_by is not null and subject_user = new.decided_by)
     or (new.requested_by_email is not null and new.decided_by_email is not null
         and lower(new.requested_by_email) = lower(new.decided_by_email))
  then
    raise exception 'a time correction cannot be approved by the person who asked for it'
      using hint = 'Segregation of duties: time becomes pay.';
  end if;

  if new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger time_corrections_enforce
  before insert or update on time_corrections
  for each row execute function public.enforce_correction_rules();

/*
 * Hours as they stand, original or corrected.
 *
 * A view rather than a column, so the original punch keeps its own value and
 * the corrected figure is derived. Both remain visible, which is the point of
 * keeping them apart.
 */
create or replace view attendance as
  select
    t.id as time_entry_id,
    t.org_id,
    t.employee_id,
    t.shift_id,
    t.clock_in_at as original_in,
    t.clock_out_at as original_out,
    coalesce(c.corrected_clock_in_at, t.clock_in_at) as effective_in,
    coalesce(c.corrected_clock_out_at, t.clock_out_at) as effective_out,
    coalesce(c.corrected_break_minutes, t.break_minutes) as effective_break_minutes,
    (c.id is not null) as corrected,
    t.source,
    t.recorded_by_email,
    case
      when coalesce(c.corrected_clock_out_at, t.clock_out_at) is null then null
      else round(
        (extract(epoch from
           coalesce(c.corrected_clock_out_at, t.clock_out_at)
           - coalesce(c.corrected_clock_in_at, t.clock_in_at)) / 3600.0
        )::numeric
        - coalesce(c.corrected_break_minutes, t.break_minutes) / 60.0, 3)
    end as hours
  from public.time_entries t
  left join lateral (
    select * from public.time_corrections tc
     where tc.time_entry_id = t.id and tc.status = 'APPROVED'
     order by tc.decided_at desc limit 1
  ) c on true;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['shifts','time_entries','time_corrections']
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
  end loop;
end $$;

-- Shifts can be deleted while a rota is being drafted; time cannot.
create policy shifts_delete on shifts
  for delete to authenticated using (public.auth_can_write(org_id));

grant select, insert, update, delete on shifts to authenticated;
grant select, insert, update on time_entries to authenticated;
grant select, insert, update on time_corrections to authenticated;
grant select on attendance to authenticated;

comment on table time_entries is
  'Clock in and out. Immutable once closed; corrections are separate approved records.';
comment on view attendance is
  'Worked hours, original and effective. Both are kept so a correction is visible as one.';
