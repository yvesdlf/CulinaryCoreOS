-- ---------------------------------------------------------------------------
-- Engineering and maintenance
-- ---------------------------------------------------------------------------
-- Assets, planned maintenance, work orders and meters.
--
-- The reference point is what hotel CMMS products do — work orders, preventive
-- maintenance, an asset register, a logbook, utility monitoring. Most of it is
-- composition rather than invention: a work order is the requisition machinery
-- with a different noun, and a maintenance plan is the HACCP control sheet with
-- a different noun, down to leading with what is overdue and refusing a record
-- that says a problem was found and nothing was done.
--
-- Four things here go beyond what those products do, and each exists because
-- this database already knows something a standalone CMMS does not:
--
--   assignment is refused, not warned about, when the technician is on leave,
--   no longer employed, or has no current certificate for the trade — the same
--   trigger shape that already guards the rota (852/2004 Annex II Ch. XII)
--
--   the person who did the work cannot be the person who signs it off, by
--   trigger, on the caller's JWT rather than on a field the client sends
--
--   parts are ordered through the purchasing chain that already exists, so a
--   spare part is requisitioned, approved and received like anything else
--   rather than through a second, unaudited stores process
--
--   a meter cannot read backwards without saying it was replaced or reset,
--   because a silent drop is how a month of utility cost goes missing
--
-- What is deliberately not here: photographs, QR scanning and the mobile shell.
-- All three need Supabase Storage and the Capacitor wrapper, which is a
-- separate piece of infrastructure rather than a column.
-- ---------------------------------------------------------------------------

-- ── Where things are ────────────────────────────────────────────────────────
/*
 * One location tree for the whole venue, not one per module.
 *
 * Maintenance needs plant rooms and outlets; housekeeping needs guest rooms;
 * both need "which building". Two trees would drift apart within a month and
 * then nobody could ask "everything that happened in Villa 3" without knowing
 * which module to ask.
 *
 * `kind` says what may be done with it rather than what it is called. A guest
 * room is cleanable and maintainable; a chiller plant room is only the second.
 */
create type location_kind as enum (
  'SITE',       -- the property
  'BUILDING',
  'FLOOR',
  'GUEST_ROOM',
  'PUBLIC_AREA',
  'BACK_OF_HOUSE',
  'PLANT',      -- plant rooms, roofs, anywhere only engineering goes
  'OUTLET'      -- a restaurant, bar or kitchen, which is also a cost centre
);

create table if not exists locations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  parent_id uuid references locations(id) on delete set null,
  code text not null,
  name text not null,
  kind location_kind not null default 'PUBLIC_AREA',

  -- Which part of the venue pays for work done here. Null means the work order
  -- takes its unit from elsewhere; see assign_work_order_reference below.
  cost_centre_id uuid references cost_centres(id) on delete set null,

  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_locations_code
  on locations(org_id, lower(code));
create index if not exists idx_locations_parent on locations(parent_id);
create index if not exists idx_locations_kind on locations(org_id, kind) where active;

/*
 * A location cannot contain itself, at any depth.
 *
 * Checked by walking up rather than by comparing to the parent, because the
 * cheap check only catches A -> A and the expensive failure is A -> B -> A,
 * which makes every recursive query on the tree hang rather than error.
 */
create or replace function public.enforce_location_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare walker uuid := new.parent_id; depth integer := 0;
begin
  while walker is not null loop
    if walker = new.id then
      raise exception 'a location cannot be inside itself';
    end if;
    depth := depth + 1;
    if depth > 12 then
      raise exception 'location nesting is too deep to be real';
    end if;
    select parent_id into walker from public.locations where id = walker;
  end loop;
  return new;
end;
$$;

create trigger locations_tree
  before insert or update on locations
  for each row execute function public.enforce_location_tree();

-- ── The asset register ──────────────────────────────────────────────────────

create type asset_criticality as enum ('CRITICAL', 'IMPORTANT', 'ROUTINE');

create type asset_status as enum (
  'IN_SERVICE',
  'DEGRADED',       -- working, with a known fault
  'OUT_OF_SERVICE',
  'DISPOSED'
);

create table if not exists assets (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  category text not null default 'GENERAL',

  location_id uuid references locations(id) on delete set null,
  -- A compressor belongs to a chiller. Faults roll up; cost rolls up.
  parent_asset_id uuid references assets(id) on delete set null,

  manufacturer text,
  model text,
  serial_number text,

  supplier_id uuid references suppliers(id) on delete set null,
  commissioned_on date,
  warranty_until date,
  -- What it cost, for whole-life cost against cumulative repair spend.
  purchase_cost numeric(18,5),

  criticality asset_criticality not null default 'ROUTINE',
  status asset_status not null default 'IN_SERVICE',

  /*
   * The trade a job on this asset needs, matched against the certifications HR
   * already holds. Empty means anybody may be assigned.
   *
   * The same text values as job_roles.required_certifications, deliberately —
   * a second vocabulary for the same tickets would mean a technician certified
   * in one place and not the other.
   */
  required_certifications text[] not null default '{}',

  manual_url text,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create unique index if not exists idx_assets_code on assets(org_id, lower(code));
create index if not exists idx_assets_location on assets(location_id);
create index if not exists idx_assets_parent on assets(parent_asset_id);
create index if not exists idx_assets_live on assets(org_id, status)
  where status <> 'DISPOSED';

create or replace function public.enforce_asset_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare walker uuid := new.parent_asset_id; depth integer := 0;
begin
  while walker is not null loop
    if walker = new.id then
      raise exception 'an asset cannot be part of itself';
    end if;
    depth := depth + 1;
    if depth > 8 then
      raise exception 'asset nesting is too deep to be real';
    end if;
    select parent_asset_id into walker from public.assets where id = walker;
  end loop;
  return new;
end;
$$;

create trigger assets_tree
  before insert or update on assets
  for each row execute function public.enforce_asset_tree();

-- ── Planned maintenance ─────────────────────────────────────────────────────
/*
 * A plan is a standing instruction, not a job.
 *
 * It says what has to be done to an asset and how often. The job it produces
 * is an ordinary work order, so planned and reactive work sit in one list,
 * are assigned by the same rules and are counted in the same numbers. A
 * separate PM queue is how a venue ends up with two backlogs and a technician
 * who only ever works one of them.
 */
create table if not exists maintenance_plans (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  asset_id uuid references assets(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,

  code text not null,
  title text not null,
  instructions text,

  interval_days integer not null,
  -- How long it takes, for capacity against the rota. Estimated, and the work
  -- orders record what it actually took, so the estimate can be corrected.
  estimated_minutes integer not null default 60,

  required_certifications text[] not null default '{}',
  criticality asset_criticality not null default 'ROUTINE',

  -- A statutory inspection is not a service. Missing one is a legal finding
  -- rather than a deferred job, and the screen has to be able to say so.
  statutory boolean not null default false,

  active boolean not null default true,
  last_completed_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint maintenance_plans_interval check (interval_days between 1 and 3650),
  constraint maintenance_plans_minutes check (estimated_minutes between 1 and 10080),
  -- A plan with neither is a plan for nothing.
  constraint maintenance_plans_target check (asset_id is not null or location_id is not null)
);

create unique index if not exists idx_maintenance_plans_code
  on maintenance_plans(org_id, lower(code));
create index if not exists idx_maintenance_plans_due
  on maintenance_plans(org_id, last_completed_on) where active;

-- ── Work orders ─────────────────────────────────────────────────────────────

create type work_order_status as enum (
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',       -- waiting for a part, a contractor or an empty room
  'COMPLETED',     -- the technician says it is done
  'VERIFIED',      -- somebody else agrees
  'CANCELLED'
);

create type work_order_priority as enum ('EMERGENCY', 'HIGH', 'NORMAL', 'LOW');

create type work_order_source as enum ('REACTIVE', 'PLANNED', 'INSPECTION', 'GUEST');

create table if not exists work_orders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  reference text,

  title text not null,
  detail text,

  asset_id uuid references assets(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  cost_centre_id uuid references cost_centres(id) on delete set null,

  source work_order_source not null default 'REACTIVE',
  plan_id uuid references maintenance_plans(id) on delete set null,

  priority work_order_priority not null default 'NORMAL',
  status work_order_status not null default 'OPEN',

  -- Who asked. An email rather than an employee, because a work order can be
  -- raised by a head of department who is not on the engineering roll.
  raised_by_email text,
  raised_at timestamptz not null default now(),
  due_by date,

  assigned_to uuid references employees(id) on delete set null,
  assigned_at timestamptz,

  started_at timestamptz,
  completed_at timestamptz,
  completed_by_email text,
  completion_note text,

  verified_by_email text,
  verified_at timestamptz,

  -- Minutes the asset was unavailable, which is not the same as minutes worked.
  downtime_minutes integer,
  labour_minutes integer,

  /*
   * Parts are requisitioned, not taken.
   *
   * The link is to the purchasing chain that already exists, so a spare part
   * is approved and received like every other purchase. A stores process that
   * only engineering can see is how a venue loses track of what it owns.
   */
  requisition_id uuid references requisitions(id) on delete set null,

  cancelled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  constraint work_orders_title check (btrim(title) <> ''),
  constraint work_orders_downtime check (downtime_minutes is null or downtime_minutes >= 0),
  constraint work_orders_labour check (labour_minutes is null or labour_minutes >= 0)
);

create unique index if not exists idx_work_orders_reference
  on work_orders(org_id, reference) where reference is not null;
create index if not exists idx_work_orders_open on work_orders(org_id, status)
  where status not in ('VERIFIED', 'CANCELLED');
create index if not exists idx_work_orders_asset on work_orders(asset_id, raised_at desc);
create index if not exists idx_work_orders_assignee on work_orders(assigned_to, status);
create index if not exists idx_work_orders_location on work_orders(location_id, status);

/*
 * Every change of standing, kept.
 *
 * The same append-only shape as recipe status history and the approval ledger,
 * and for the same reason: "who put this on hold for three weeks" is asked
 * long after the row has moved on.
 */
create table if not exists work_order_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,

  from_status work_order_status,
  to_status work_order_status not null,
  note text,
  actor_email text,
  actor_employee_id uuid references employees(id) on delete set null,
  at timestamptz not null default now()
);

create index if not exists idx_work_order_events_wo
  on work_order_events(work_order_id, at desc);

-- ── Meters ──────────────────────────────────────────────────────────────────

create type meter_unit as enum ('KWH', 'M3', 'LITRE', 'KG', 'HOURS');

create table if not exists meters (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  unit meter_unit not null,

  location_id uuid references locations(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  cost_centre_id uuid references cost_centres(id) on delete set null,

  /*
   * A cumulative meter only goes up; a delivery meter records what arrived.
   *
   * The distinction decides whether a smaller number than last time is a fault
   * or an ordinary reading, and getting it wrong in either direction produces
   * consumption figures nobody can use.
   */
  cumulative boolean not null default true,
  cost_per_unit numeric(18,5),

  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_meters_code on meters(org_id, lower(code));

create table if not exists meter_readings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  meter_id uuid not null references meters(id) on delete cascade,

  read_on date not null default current_date,
  reading numeric(18,5) not null,

  -- Consumption since the previous reading, written by trigger rather than by
  -- the client, so two clients cannot disagree about the same interval.
  consumption numeric(18,5),

  /*
   * A cumulative meter that reads lower than last time has either been
   * replaced or rolled over. Saying which is the difference between a
   * consumption figure and a hole in one.
   */
  reset boolean not null default false,
  reset_reason text,

  read_by_email text,
  note text,
  created_at timestamptz not null default now(),

  constraint meter_readings_positive check (reading >= 0)
);

create unique index if not exists idx_meter_readings_day
  on meter_readings(meter_id, read_on);
create index if not exists idx_meter_readings_recent
  on meter_readings(meter_id, read_on desc);

create or replace function public.enforce_meter_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  previous numeric(18,5);
begin
  select unit, cumulative into m from public.meters where id = new.meter_id;
  if m is null then
    raise exception 'meter not found';
  end if;

  if not m.cumulative then
    new.consumption := new.reading;
    return new;
  end if;

  select reading into previous
    from public.meter_readings
   where meter_id = new.meter_id
     and read_on < new.read_on
   order by read_on desc
   limit 1;

  if previous is null then
    -- The first reading establishes the baseline. It is not consumption, and
    -- calling it consumption would report a year of usage on day one.
    new.consumption := null;
    return new;
  end if;

  if new.reading < previous then
    if not new.reset then
      raise exception
        'meter % read %, lower than the previous %', 
        (select code from public.meters where id = new.meter_id),
        new.reading, previous
        using hint = 'If the meter was replaced or has rolled over, record it as a reset and say why.';
    end if;
    if coalesce(btrim(new.reset_reason), '') = '' then
      raise exception 'a meter reset must say what happened to the meter';
    end if;
    -- A reset breaks the series. Consumption across it is unknowable, and a
    -- guess here would be indistinguishable from a reading.
    new.consumption := null;
    return new;
  end if;

  new.consumption := new.reading - previous;
  return new;
end;
$$;

create trigger meter_readings_enforce
  before insert on meter_readings
  for each row execute function public.enforce_meter_reading();

-- ── The work order's number ─────────────────────────────────────────────────
/*
 * WO-ENG-260919-001, from the same counter as everything else.
 *
 * Its own document type rather than the purchasing chain's shared stem: a work
 * order is not a later name for a requisition, and consuming a purchasing
 * number for one would waste that unit's daily range.
 *
 * The unit comes from the work order's own cost centre, then the location's,
 * then ENG. An engineering job against a location nobody has costed still
 * needs a number.
 */
create or replace function public.assign_work_order_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare unit text;
begin
  if new.reference is not null and btrim(new.reference) <> '' then
    return new;
  end if;

  select public.unit_code(c.code) into unit
    from public.cost_centres c where c.id = new.cost_centre_id;

  if unit is null and new.location_id is not null then
    select public.unit_code(c.code) into unit
      from public.locations l
      join public.cost_centres c on c.id = l.cost_centre_id
     where l.id = new.location_id;
  end if;

  new.reference := public.next_document_reference(
    'WO', coalesce(unit, 'ENG'), new.org_id);
  return new;
end;
$$;

create trigger work_orders_assign_reference
  before insert on work_orders
  for each row execute function public.assign_work_order_reference();

-- ── Who may be sent to do it ────────────────────────────────────────────────
/*
 * The rota already refuses to publish a shift for somebody who has left, is
 * on approved leave, or has no current certificate for the role. Assigning a
 * work order is the same act with a different table, so it gets the same
 * refusal rather than a warning.
 *
 * A CMMS that only warns produces exactly one outcome: the warning is clicked
 * through, and the venue finds out at the insurance claim that the gas work
 * was done by somebody whose ticket expired in March.
 *
 * The certificate is checked against the day the work is due, not today — a
 * job due next month may not be assigned to a ticket that expires next week.
 */
create or replace function public.enforce_work_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp record;
  required text[];
  missing text[];
  on_day date;
begin
  if new.assigned_to is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.assigned_to is not distinct from new.assigned_to
     and old.due_by is not distinct from new.due_by
  then
    return new;   -- nothing about the assignment changed
  end if;

  select e.first_name, e.last_name, e.employment_status
    into emp
    from public.employees e where e.id = new.assigned_to;

  if emp is null then
    raise exception 'employee not found';
  end if;

  if emp.employment_status not in ('PROBATION', 'ACTIVE', 'NOTICE') then
    raise exception '% % is % and cannot be assigned work',
      emp.first_name, emp.last_name, lower(emp.employment_status::text);
  end if;

  on_day := coalesce(new.due_by, current_date);

  if exists (
    select 1 from public.leave_requests l
     where l.employee_id = new.assigned_to
       and l.status in ('APPROVED', 'TAKEN')
       and on_day between l.starts_on and l.ends_on
  ) then
    raise exception '% % is on approved leave on %',
      emp.first_name, emp.last_name, to_char(on_day, 'DD Mon')
      using hint = 'Assign somebody else, or move the due date.';
  end if;

  -- What the job needs: the plan's requirement where there is one, otherwise
  -- the asset's.
  if new.plan_id is not null then
    select p.required_certifications into required
      from public.maintenance_plans p where p.id = new.plan_id;
  end if;
  if (required is null or array_length(required, 1) is null)
     and new.asset_id is not null then
    select a.required_certifications into required
      from public.assets a where a.id = new.asset_id;
  end if;

  if required is not null and array_length(required, 1) > 0 then
    select array_agg(r) into missing
      from unnest(required) as r
     where not exists (
       select 1 from public.employee_certifications c
        where c.employee_id = new.assigned_to
          and c.kind = r
          and (c.expires_on is null or c.expires_on >= on_day)
     );
    if missing is not null and array_length(missing, 1) > 0 then
      raise exception '% % is not certified for this work on %: %',
        emp.first_name, emp.last_name, to_char(on_day, 'DD Mon'),
        array_to_string(missing, ', ')
        using hint = 'Record a current certificate, or assign somebody who holds one.';
    end if;
  end if;

  if new.assigned_at is null then
    new.assigned_at := now();
  end if;
  if new.status = 'OPEN' then
    new.status := 'ASSIGNED';
  end if;
  return new;
end;
$$;

create trigger work_orders_enforce_assignment
  before insert or update on work_orders
  for each row execute function public.enforce_work_order_assignment();

-- ── Completing and signing off ──────────────────────────────────────────────
/*
 * The technician says it is done. Somebody else says it is done properly.
 *
 * The same separation as an approval and a HACCP verification, and written the
 * same way 0054 had to be rewritten: the caller's identity comes from the JWT,
 * never from the row. A sign-off whose audit trail can be filled in by the
 * person being signed off is decoration.
 *
 * A completion also has to say something. "Done" is not a maintenance record,
 * and an asset history of forty rows saying "done" cannot answer why the same
 * pump has failed four times.
 */
create or replace function public.enforce_work_order_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
  did_work text;
begin
  if new.status = 'COMPLETED' and coalesce(old.status, 'OPEN') <> 'COMPLETED' then
    if caller <> '' then
      new.completed_by_email := caller;
    elsif coalesce(new.completed_by_email, '') = '' then
      raise exception 'a completed job must record who completed it';
    end if;
    if coalesce(btrim(new.completion_note), '') = '' then
      raise exception 'say what was done before completing %', new.reference
        using hint = 'The next person to open this asset reads this note.';
    end if;
    if new.completed_at is null then
      new.completed_at := now();
    end if;
  end if;

  if new.status = 'VERIFIED' and coalesce(old.status, 'OPEN') <> 'VERIFIED' then
    if coalesce(new.completed_at, null) is null then
      raise exception 'a job cannot be verified before it is completed';
    end if;
    if caller <> '' then
      new.verified_by_email := caller;
    elsif coalesce(new.verified_by_email, '') = '' then
      raise exception 'a verification must record who made it';
    end if;

    did_work := lower(coalesce(new.completed_by_email, ''));
    if did_work <> '' and did_work = lower(coalesce(new.verified_by_email, '')) then
      raise exception 'you cannot sign off your own work on %', new.reference
        using hint = 'A supervisor or another technician verifies the job.';
    end if;
    if new.verified_at is null then
      new.verified_at := now();
    end if;
  end if;

  if new.status = 'CANCELLED' and coalesce(btrim(new.cancelled_reason), '') = '' then
    raise exception 'say why % was cancelled', new.reference;
  end if;

  return new;
end;
$$;

create trigger work_orders_signoff
  before insert or update on work_orders
  for each row execute function public.enforce_work_order_signoff();

/*
 * The plan advances when the job is signed off, not when it is reported done.
 *
 * Advancing on completion would let a technician clear a year of statutory
 * inspections by marking them complete, which is the failure mode the
 * verification step exists to prevent.
 */
create or replace function public.advance_maintenance_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is not null
     and new.status = 'VERIFIED'
     and coalesce(old.status, 'OPEN') <> 'VERIFIED'
  then
    update public.maintenance_plans
       set last_completed_on = coalesce(new.completed_at::date, current_date),
           updated_at = now()
     where id = new.plan_id;
  end if;
  return new;
end;
$$;

create trigger work_orders_advance_plan
  after insert or update on work_orders
  for each row execute function public.advance_maintenance_plan();

/*
 * Every transition, recorded as it happens.
 *
 * After the row is written rather than before, so the ledger cannot record a
 * change a later trigger refused.
 *
 * The actor is chosen by the transition, not by a fixed order of fallbacks.
 * The first version of this function coalesced to completed_by_email whenever
 * there was no session, which recorded the sign-off of a job under the name of
 * the technician who had just been refused permission to sign it off. The
 * control worked and its own audit trail contradicted it — the 0054 shape
 * again, found the same way, by reading the ledger after the test rather than
 * trusting that it said what the test had done.
 */
create or replace function public.log_work_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  actor text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  actor := coalesce(caller, case new.status
    when 'VERIFIED'  then new.verified_by_email
    when 'COMPLETED' then new.completed_by_email
    else new.raised_by_email
  end);

  insert into public.work_order_events
    (org_id, work_order_id, from_status, to_status, note, actor_email, actor_employee_id)
  values (
    new.org_id, new.id,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    case new.status
      when 'COMPLETED' then new.completion_note
      when 'CANCELLED' then new.cancelled_reason
      else null end,
    actor,
    new.assigned_to);
  return new;
end;
$$;

create trigger work_orders_log
  after insert or update on work_orders
  for each row execute function public.log_work_order_event();

-- ── What is due, what is late, and what it is costing ───────────────────────

create or replace view maintenance_due as
  select
    p.id as plan_id, p.org_id, p.code, p.title, p.interval_days,
    p.estimated_minutes, p.statutory, p.criticality,
    p.asset_id, a.name as asset_name, a.code as asset_code,
    coalesce(p.location_id, a.location_id) as location_id,
    l.name as location_name,
    p.last_completed_on,
    (coalesce(p.last_completed_on, current_date - p.interval_days) + p.interval_days)
      as due_on,
    (current_date
      - (coalesce(p.last_completed_on, current_date - p.interval_days) + p.interval_days))
      as days_overdue,
    exists (
      select 1 from public.work_orders w
       where w.plan_id = p.id
         and w.status not in ('VERIFIED', 'CANCELLED')
    ) as job_open
  from public.maintenance_plans p
  left join public.assets a on a.id = p.asset_id
  left join public.locations l on l.id = coalesce(p.location_id, a.location_id)
 where p.active
   and p.org_id in (select public.auth_org_ids());

grant select on maintenance_due to authenticated;

/*
 * An asset's record, as a manager would ask for it.
 *
 * Faults, downtime and spend in the last year, against what the asset cost.
 * The ratio is the replace-or-repair conversation, and it is the one number a
 * CMMS exists to produce.
 */
create or replace view asset_health as
  select
    a.id as asset_id, a.org_id, a.code, a.name, a.category,
    a.criticality, a.status, a.purchase_cost, a.warranty_until,
    a.location_id, l.name as location_name,
    (select count(*) from public.work_orders w
      where w.asset_id = a.id and w.raised_at > now() - interval '365 days')
      as jobs_year,
    (select count(*) from public.work_orders w
      where w.asset_id = a.id and w.status not in ('VERIFIED', 'CANCELLED'))
      as jobs_open,
    (select coalesce(sum(w.downtime_minutes), 0) from public.work_orders w
      where w.asset_id = a.id and w.raised_at > now() - interval '365 days')
      as downtime_minutes_year,
    (select coalesce(sum(rl.line_total), 0)
       from public.work_orders w
       join public.requisition_lines rl on rl.requisition_id = w.requisition_id
      where w.asset_id = a.id and w.raised_at > now() - interval '365 days')
      as parts_cost_year,
    (select max(w.completed_at) from public.work_orders w
      where w.asset_id = a.id and w.status = 'VERIFIED')
      as last_serviced_at
  from public.assets a
  left join public.locations l on l.id = a.location_id
 where a.status <> 'DISPOSED'
   and a.org_id in (select public.auth_org_ids());

grant select on asset_health to authenticated;

/*
 * Manning: what is on the engineering list against who is actually here.
 *
 * A backlog figure on its own tells a manager nothing — eleven open jobs is
 * fine with four technicians on and impossible with one. The rota already
 * knows who is on today, so the two belong in one row.
 */
create or replace view maintenance_manning as
  select
    e.org_id,
    e.id as employee_id,
    e.first_name || ' ' || e.last_name as name,
    (select count(*) from public.shifts s
      where s.employee_id = e.id
        and s.status = 'PUBLISHED'
        and s.starts_at::date = current_date) as shifts_today,
    (select count(*) from public.work_orders w
      where w.assigned_to = e.id
        and w.status in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD')) as jobs_open,
    (select coalesce(sum(
        coalesce(p.estimated_minutes, 60)), 0)
       from public.work_orders w
       left join public.maintenance_plans p on p.id = w.plan_id
      where w.assigned_to = e.id
        and w.status in ('ASSIGNED', 'IN_PROGRESS')) as minutes_assigned,
    (select count(*) from public.work_orders w
      where w.assigned_to = e.id
        and w.status in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD')
        and w.due_by < current_date) as jobs_late
  from public.employees e
 where e.employment_status in ('PROBATION', 'ACTIVE', 'NOTICE')
   and e.org_id in (select public.auth_org_ids());

grant select on maintenance_manning to authenticated;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['locations','assets','maintenance_plans','work_orders',
                           'work_order_events','meters','meter_readings']
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

grant delete on locations, assets, maintenance_plans, meters to authenticated;
create policy locations_delete on locations
  for delete to authenticated using (public.auth_can_write(org_id));
create policy assets_delete on assets
  for delete to authenticated using (public.auth_can_write(org_id));
create policy maintenance_plans_delete on maintenance_plans
  for delete to authenticated using (public.auth_can_write(org_id));
create policy meters_delete on meters
  for delete to authenticated using (public.auth_can_write(org_id));

/*
 * The ledgers do not move.
 *
 * No update and no delete grant on work_order_events or meter_readings, the
 * same as stock movements and the approval ledger. A correction to a reading
 * is another reading.
 */
revoke update, delete on work_order_events from authenticated;
revoke update, delete on meter_readings from authenticated;

-- ── The section ─────────────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core) values
  ('MAINTENANCE', 'Maintenance',
   'Assets, planned maintenance, work orders and utility meters.', 55, false)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  sort_order = excluded.sort_order, is_core = excluded.is_core;

do $$
declare t text;
begin
  foreach t in array array['locations','assets','maintenance_plans','work_orders','meters','meter_readings']
  loop
    execute format(
      'create trigger %1$s_section_guard before insert or update or delete
         on public.%1$I for each row
         execute function public.require_section_write(%2$L)', t, 'MAINTENANCE');
  end loop;
end $$;

-- ── What a venue starts with ────────────────────────────────────────────────
/*
 * In a function called on organisation creation, not as an INSERT in this
 * file. Seven migrations made that mistake and rebuilding from empty is what
 * found them — a bare insert here runs once, against whatever organisations
 * happen to exist today, and never for the next one.
 */
create or replace function public.seed_maintenance_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare site_id uuid;
begin
  if exists (select 1 from public.locations where org_id = p_org) then
    return;
  end if;

  insert into public.locations (org_id, code, name, kind)
  values (p_org, 'SITE', 'The property', 'SITE')
  returning id into site_id;

  insert into public.locations (org_id, parent_id, code, name, kind) values
    (p_org, site_id, 'BOH',   'Back of house',  'BACK_OF_HOUSE'),
    (p_org, site_id, 'PLANT', 'Plant rooms',    'PLANT'),
    (p_org, site_id, 'PUB',   'Public areas',   'PUBLIC_AREA');
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
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_maintenance_defaults(o.id);
  end loop;
end $$;

comment on table locations is
  'One location tree for the venue. Maintenance and housekeeping both hang off it.';
comment on table assets is
  'The asset register. required_certifications uses the same vocabulary as job roles.';
comment on table maintenance_plans is
  'Standing maintenance instructions. The job they produce is an ordinary work order.';
comment on table work_orders is
  'Reactive and planned jobs. Assignment is refused for an uncertified or absent technician.';
comment on table work_order_events is
  'Append-only. Every change of standing on a work order, with who made it.';
comment on table meter_readings is
  'Append-only. Consumption is computed by trigger; a backwards cumulative meter must declare a reset.';
comment on view maintenance_due is
  'Planned maintenance, with how late it is and whether a job is already open for it.';
comment on view asset_health is
  'Faults, downtime and parts spend per asset over the last year.';
comment on view maintenance_manning is
  'Open jobs and assigned minutes per technician, against whether they are rostered today.';
