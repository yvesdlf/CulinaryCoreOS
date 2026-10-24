-- ---------------------------------------------------------------------------
-- A rota is built from a pattern, and staff can say when they cannot work
-- ---------------------------------------------------------------------------
-- `shifts` has existed since 0026 and a rota is still typed from nothing
-- every week. Three things are missing and they are the three a manager
-- actually spends the time on.
--
-- A pattern. Most weeks are last week with two changes, and retyping forty
-- shifts to make two of them is how a rota ends up published late.
--
-- Availability. The system has never had anywhere for "I cannot work
-- Tuesdays" to live, so it lives in somebody's head or in a message, and
-- the rota breaks it. Recording it does not stop a manager rostering over
-- it — sometimes they must — but the clash is named when it happens rather
-- than discovered by the person who does not turn up.
--
-- Swaps. Two people agreeing to exchange shifts is the commonest change to
-- a published rota, and with nowhere to record it the rota stops matching
-- who is actually working — which then makes the attendance variance and
-- the labour cost wrong too.
--
-- The rule throughout: a swap is a request, not an act. 2003/88/EC rest
-- rules and the certificate checks in `enforce_shift_rules` apply to the
-- person who ends up on the shift, so a swap has to go through approval and
-- land as a normal change to `shifts` — where those rules already run —
-- rather than quietly repointing a row around them.
-- ---------------------------------------------------------------------------

do $$ begin
  create type swap_status as enum ('REQUESTED', 'ACCEPTED', 'APPROVED', 'REJECTED', 'CANCELLED');
exception when duplicate_object then null; end $$;

create table if not exists shift_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  -- No foreign key, deliberately: `departments` is a view over the business
  -- unit tree, and `shifts.department_id` has none either. Mirroring the
  -- table this generates into rather than inventing a stricter rule for the
  -- pattern than for the thing it produces.
  department_id uuid,
  job_role_id uuid references job_roles(id) on delete set null,

  name text not null,
  -- 0 is Sunday, matching Postgres `extract(dow)`, so nothing has to
  -- translate between this and a date.
  weekday smallint not null,
  starts_at_time time not null,
  ends_at_time time not null,
  break_minutes integer not null default 0,
  headcount integer not null default 1,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_templates_named check (btrim(name) <> ''),
  constraint shift_templates_weekday check (weekday between 0 and 6),
  constraint shift_templates_headcount check (headcount > 0),
  constraint shift_templates_break check (break_minutes >= 0)
);

create table if not exists staff_availability (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  /*
   * Either a repeating weekday or a specific date, never both.
   *
   * "I cannot work Tuesdays" and "I cannot work the 14th" are different
   * facts and conflating them is how one silently becomes the other.
   */
  weekday smallint,
  on_date date,

  available boolean not null default true,
  available_from time,
  available_to time,
  note text,

  created_at timestamptz not null default now(),

  constraint staff_availability_when
    check ((weekday is null) <> (on_date is null)),
  constraint staff_availability_weekday
    check (weekday is null or weekday between 0 and 6),
  constraint staff_availability_window
    check (available_from is null or available_to is null or available_to > available_from)
);

create index if not exists idx_staff_availability_emp
  on staff_availability(org_id, employee_id);

create table if not exists shift_swap_requests (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  shift_id uuid not null references shifts(id) on delete cascade,

  from_employee_id uuid not null references employees(id) on delete cascade,
  to_employee_id uuid references employees(id) on delete set null,

  status swap_status not null default 'REQUESTED',
  reason text,
  accepted_at timestamptz,
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shift_swap_not_self check (from_employee_id <> to_employee_id)
);

create index if not exists idx_shift_swaps_open
  on shift_swap_requests(org_id, status) where status in ('REQUESTED', 'ACCEPTED');

create or replace function public.set_availability_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select e.org_id into parent_org from public.employees e where e.id = new.employee_id;
  if parent_org is null then raise exception 'no such employee'; end if;
  new.org_id := parent_org;
  return new;
end $$;

create or replace function public.set_swap_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select s.org_id into parent_org from public.shifts s where s.id = new.shift_id;
  if parent_org is null then raise exception 'no such shift'; end if;
  new.org_id := parent_org;
  return new;
end $$;

/*
 * Building a week from the patterns.
 *
 * Drafts, never publishes. `enforce_shift_rules` only runs its certificate
 * and employment checks on a PUBLISHED shift, so a generated week lands as
 * a draft for somebody to assign people to and publish — which is when
 * those rules bite. Generating published shifts with no employee would
 * skip every check the rota has.
 *
 * Skips a day that already has shifts for the same template slot, so
 * running it twice does not double the week.
 */
create or replace function public.generate_rota_week(p_org uuid, p_week_start date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  d date;
  made integer := 0;
  starts timestamptz;
  ends timestamptz;
  tz text;
begin
  if not public.can_write_section('PEOPLE', p_org) then
    raise exception 'you do not have edit access to PEOPLE' using errcode = '42501';
  end if;

  select coalesce(o.timezone, 'UTC') into tz from public.organizations o where o.id = p_org;

  for t in
    select * from public.shift_templates
     where org_id = p_org and active
  loop
    -- The date in this week that falls on the template's weekday.
    d := p_week_start + ((t.weekday - extract(dow from p_week_start)::int + 7) % 7);

    starts := (d + t.starts_at_time) at time zone tz;
    ends   := (d + t.ends_at_time) at time zone tz;
    -- A shift that ends before it starts crosses midnight.
    if ends <= starts then ends := ends + interval '1 day'; end if;

    if exists (
      select 1 from public.shifts s
       where s.org_id = p_org
         and s.starts_at = starts
         and s.department_id is not distinct from t.department_id
         and s.job_role_id is not distinct from t.job_role_id
    ) then
      continue;
    end if;

    for i in 1..t.headcount loop
      insert into public.shifts
        (org_id, department_id, job_role_id, business_unit_id,
         starts_at, ends_at, break_minutes, status, notes)
      values (p_org, t.department_id, t.job_role_id, t.business_unit_id,
              starts, ends, t.break_minutes, 'DRAFT',
              'From the ' || t.name || ' pattern');
      made := made + 1;
    end loop;
  end loop;

  return made;
end $$;

revoke all on function public.generate_rota_week(uuid, date) from public;
grant execute on function public.generate_rota_week(uuid, date) to authenticated;

/*
 * Is this person available then?
 *
 * A specific date beats a repeating weekday, because "I cannot work
 * Tuesdays, but I can this Tuesday" is a thing people say and the specific
 * statement is the later and more deliberate one.
 */
create or replace function public.is_available(
  p_employee uuid, p_starts timestamptz, p_ends timestamptz
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with asked as (
    select (p_starts at time zone 'UTC')::date as d,
           (p_starts at time zone 'UTC')::time as t_from,
           (p_ends   at time zone 'UTC')::time as t_to
  ),
  specific as (
    select a.available, a.available_from, a.available_to
      from public.staff_availability a, asked
     where a.employee_id = p_employee and a.on_date = asked.d
     limit 1
  ),
  repeating as (
    select a.available, a.available_from, a.available_to
      from public.staff_availability a, asked
     where a.employee_id = p_employee
       and a.weekday = extract(dow from asked.d)::smallint
     limit 1
  ),
  chosen as (
    select * from specific
    union all
    select * from repeating where not exists (select 1 from specific)
  )
  select case
    when not exists (select 1 from chosen) then true   -- nothing said: available
    when not (select available from chosen limit 1) then false
    else coalesce(
      (select (c.available_from is null or asked.t_from >= c.available_from)
          and (c.available_to is null or asked.t_to <= c.available_to)
         from chosen c, asked limit 1), true)
  end;
$$;

/*
 * Rostering over a stated unavailability is allowed and named.
 *
 * Refusing it would be wrong — a manager sometimes has to, and a rule that
 * cannot be overridden gets worked around by not recording availability at
 * all. A warning in the shift's notes is the honest middle: the clash is on
 * the record and the manager made it deliberately.
 */
create or replace function public.note_availability_clash()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is null or new.status <> 'PUBLISHED' then
    return new;
  end if;
  if not public.is_available(new.employee_id, new.starts_at, new.ends_at) then
    new.notes := coalesce(nullif(btrim(new.notes), '') || ' — ', '')
      || 'Rostered against stated availability.';
  end if;
  return new;
end $$;

drop trigger if exists shifts_zz_availability on shifts;
create trigger shifts_zz_availability before insert or update on shifts
  for each row execute function public.note_availability_clash();

/*
 * A swap, approved, moves the shift.
 *
 * Through `shifts` rather than around it, so `enforce_shift_rules` runs on
 * the person who ends up working: their certificates, their employment
 * status, the rest rules. A swap that repointed the row directly would be a
 * second way onto a rota with none of the checks the first way has.
 */
create or replace function public.enforce_swap_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'ACCEPTED' then
    if new.to_employee_id is null then
      raise exception 'nobody has offered to take this shift yet';
    end if;
    new.accepted_at := now();
    return new;
  end if;

  if new.status = 'APPROVED' then
    if old.status <> 'ACCEPTED' then
      raise exception 'a swap is approved after somebody has accepted it';
    end if;
    if not public.can_write_section('PEOPLE', new.org_id) then
      raise exception 'approving a swap needs People access' using errcode = '42501';
    end if;
    new.decided_by_email := coalesce(nullif(caller, ''), new.decided_by_email);
    new.decided_at := now();

    update public.shifts
       set employee_id = new.to_employee_id,
           notes = coalesce(nullif(btrim(notes), '') || ' — ', '')
                   || 'Swapped from the original holder.',
           updated_at = now()
     where id = new.shift_id;
    return new;
  end if;

  if new.status = 'REJECTED' then
    new.decided_by_email := coalesce(nullif(caller, ''), new.decided_by_email);
    new.decided_at := now();
  end if;
  return new;
end $$;

drop trigger if exists shift_templates_set_org on shift_templates;
create trigger shift_templates_set_org before insert on shift_templates
  for each row execute function public.set_org_id();
drop trigger if exists shift_templates_touch on shift_templates;
create trigger shift_templates_touch before update on shift_templates
  for each row execute function public.set_updated_at();
drop trigger if exists staff_availability_set_org on staff_availability;
create trigger staff_availability_set_org before insert on staff_availability
  for each row execute function public.set_availability_org();
drop trigger if exists shift_swap_requests_set_org on shift_swap_requests;
create trigger shift_swap_requests_set_org before insert on shift_swap_requests
  for each row execute function public.set_swap_org();
drop trigger if exists shift_swap_requests_touch on shift_swap_requests;
create trigger shift_swap_requests_touch before update on shift_swap_requests
  for each row execute function public.set_updated_at();
drop trigger if exists shift_swap_requests_zz_decision on shift_swap_requests;
create trigger shift_swap_requests_zz_decision before update on shift_swap_requests
  for each row execute function public.enforce_swap_decision();

alter table shift_templates enable row level security;
alter table staff_availability enable row level security;
alter table shift_swap_requests enable row level security;

drop policy if exists shift_templates_read on shift_templates;
create policy shift_templates_read on shift_templates for select to authenticated
  using (public.can_read_section('PEOPLE', org_id));
drop policy if exists shift_templates_write on shift_templates;
create policy shift_templates_write on shift_templates for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists shift_templates_update on shift_templates;
create policy shift_templates_update on shift_templates for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists shift_templates_delete on shift_templates;
create policy shift_templates_delete on shift_templates for delete to authenticated
  using (public.auth_can_write(org_id));

/*
 * Availability is readable by People, and by the person it is about.
 *
 * A room attendant has no section access at all — everything they can do
 * comes from the self-service policies (0041) — and somebody who cannot
 * read back what they told the system will stop telling it.
 */
drop policy if exists staff_availability_read on staff_availability;
create policy staff_availability_read on staff_availability for select to authenticated
  using (public.can_read_section('PEOPLE', org_id)
         or employee_id = public.auth_employee_id());
drop policy if exists staff_availability_write on staff_availability;
create policy staff_availability_write on staff_availability for insert to authenticated
  with check (public.auth_can_write(org_id)
              or employee_id = public.auth_employee_id());
drop policy if exists staff_availability_delete on staff_availability;
create policy staff_availability_delete on staff_availability for delete to authenticated
  using (public.auth_can_write(org_id)
         or employee_id = public.auth_employee_id());

drop policy if exists shift_swap_requests_read on shift_swap_requests;
create policy shift_swap_requests_read on shift_swap_requests for select to authenticated
  using (public.can_read_section('PEOPLE', org_id)
         or from_employee_id = public.auth_employee_id()
         or to_employee_id = public.auth_employee_id());
drop policy if exists shift_swap_requests_write on shift_swap_requests;
create policy shift_swap_requests_write on shift_swap_requests for insert to authenticated
  with check (public.auth_can_write(org_id)
              or from_employee_id = public.auth_employee_id());
drop policy if exists shift_swap_requests_update on shift_swap_requests;
create policy shift_swap_requests_update on shift_swap_requests for update to authenticated
  using (public.auth_can_write(org_id)
         or to_employee_id = public.auth_employee_id())
  with check (public.auth_can_write(org_id)
              or to_employee_id = public.auth_employee_id());

grant select, insert, update, delete on shift_templates to authenticated;
grant select, insert, delete on staff_availability to authenticated;
grant select, insert, update on shift_swap_requests to authenticated;

drop trigger if exists shift_templates_section_guard on shift_templates;
create trigger shift_templates_section_guard
  before insert or update or delete on shift_templates
  for each row execute function public.require_section_write('PEOPLE');

delete from public.section_read_rules
 where table_name in ('shift_templates', 'staff_availability', 'shift_swap_requests');
insert into public.section_read_rules (table_name, section_code, shared_because) values
  ('shift_templates', 'PEOPLE', null),
  -- Both of these are reachable by the person they are about, which is the
  -- point of them, so they are registered as shared with the reason stated
  -- rather than as People-only, which they are not.
  ('staff_availability', null, 'what a person told the rota about themselves'),
  ('shift_swap_requests', null, 'a swap is visible to the two people in it');

comment on table shift_templates is
  'The shape of a normal week. generate_rota_week drafts from it; it never publishes. See 0101.';
comment on table staff_availability is
  'When somebody can and cannot work. Rostering over it is allowed and noted, never silently refused. See 0101.';
