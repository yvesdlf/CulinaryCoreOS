-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------
-- Rooms, the board, assignment sheets, inspections and lost property.
--
-- The reference point is what hotel housekeeping products do: a live board of
-- room status, automated assignment balanced by workload, digital checklists,
-- inspections, and lost and found. This builds that on the location tree from
-- 0055 and the HR tables that already exist.
--
-- ## The thing this is honest about
--
-- Housekeeping is driven by who is arriving, departing and staying over, and
-- that comes from a property management system. This application is not a PMS
-- and has no concept of a reservation or a guest.
--
-- So occupancy here is *recorded*, not *known*: somebody sets it, or a future
-- import sets it. Every screen that shows it says when it was last updated,
-- because a stale arrival list is worse than none — it sends an attendant to
-- a room that was never vacated. What the module does own completely is the
-- cleaning state, which is the venue's own fact and not the PMS's.
--
-- ## Four rules enforced here that the products this imitates only advise on
--
--   an attendant cannot inspect their own room, by trigger, on the caller's
--   JWT rather than on a field the client sends
--
--   a room cannot be released as clean while an open safety work order stands
--   against it — the cross-check between this module and maintenance, and the
--   one a separate housekeeping product structurally cannot make
--
--   work cannot be assigned to somebody who is not rostered that day, or who
--   is on approved leave, or who has left
--
--   an assignment sheet that exceeds the attendant's rostered minutes is
--   refused rather than flagged. A sheet nobody can finish is not a plan; it
--   is the reason rooms get signed as clean without being cleaned, which is
--   the failure this whole module exists to prevent
-- ---------------------------------------------------------------------------

-- ── Room types ──────────────────────────────────────────────────────────────
/*
 * How long a room takes, held per type rather than per room.
 *
 * Two numbers because they are different jobs. A departure is a strip and full
 * clean; a stayover is towels, bed and bathroom. Costing them the same makes
 * every assignment sheet wrong in whichever direction the day happens to lean.
 */
create table if not exists room_types (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  beds integer not null default 1,

  departure_minutes integer not null default 45,
  stayover_minutes integer not null default 20,
  deep_clean_minutes integer not null default 120,

  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint room_types_minutes check (
    departure_minutes between 1 and 600
    and stayover_minutes between 1 and 600
    and deep_clean_minutes between 1 and 1440)
);

create unique index if not exists idx_room_types_code
  on room_types(org_id, lower(code));

-- ── Rooms ───────────────────────────────────────────────────────────────────

create type housekeeping_state as enum (
  'DIRTY',
  'IN_PROGRESS',
  'CLEAN',          -- the attendant is finished
  'INSPECTED',      -- a supervisor agrees, and it may be sold
  'OUT_OF_SERVICE'  -- not sellable: a fault, a deep clean, a closure
);

/*
 * Occupancy as the venue last recorded it.
 *
 * Deliberately not a guest record. See the header: without a PMS this is a
 * statement about what somebody typed, and `occupancy_set_at` is part of the
 * data rather than metadata, because how old it is decides whether it can be
 * trusted.
 */
create type room_occupancy as enum (
  'VACANT', 'OCCUPIED', 'ARRIVAL', 'DEPARTURE', 'STAYOVER', 'UNKNOWN'
);

create table if not exists rooms (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Its place in the venue. One row per location, so "everything that ever
  -- happened in Villa 3" is one question rather than two.
  location_id uuid not null references locations(id) on delete cascade,
  room_type_id uuid references room_types(id) on delete set null,

  room_number text not null,
  floor text,

  state housekeeping_state not null default 'DIRTY',
  state_changed_at timestamptz not null default now(),
  state_changed_by_email text,

  occupancy room_occupancy not null default 'UNKNOWN',
  occupancy_set_at timestamptz,
  occupancy_set_by_email text,

  out_of_service_reason text,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create unique index if not exists idx_rooms_number on rooms(org_id, lower(room_number));
create unique index if not exists idx_rooms_location on rooms(location_id);
create index if not exists idx_rooms_state on rooms(org_id, state);

/*
 * Every change of room state, kept.
 *
 * "This room was sold at four and the guest found it dirty" is answered from
 * here, and only from here. The current state cannot answer it.
 */
create table if not exists room_state_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,

  from_state housekeeping_state,
  to_state housekeeping_state not null,
  occupancy room_occupancy,
  note text,
  actor_email text,
  at timestamptz not null default now()
);

create index if not exists idx_room_state_events_room
  on room_state_events(room_id, at desc);

-- ── The work ────────────────────────────────────────────────────────────────

create type housekeeping_task_kind as enum (
  'DEPARTURE', 'STAYOVER', 'DEEP_CLEAN', 'TURNDOWN', 'PUBLIC_AREA', 'LINEN'
);

create type housekeeping_task_status as enum (
  'PENDING', 'IN_PROGRESS', 'DONE', 'INSPECTED', 'REJECTED', 'CANCELLED'
);

create table if not exists housekeeping_tasks (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- A room task, or an area task. One of the two.
  room_id uuid references rooms(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,

  kind housekeeping_task_kind not null,
  task_date date not null default current_date,

  assigned_to uuid references employees(id) on delete set null,
  assigned_at timestamptz,

  /*
   * What this job is costed at, copied from the room type when the task is
   * made rather than read through at display time.
   *
   * Copied, because changing a room type's standard next month must not
   * silently rewrite what last month's sheets were planned against — the same
   * reasoning as onboarding templates being copied rather than referenced.
   */
  standard_minutes integer not null default 30,

  status housekeeping_task_status not null default 'PENDING',
  started_at timestamptz,
  finished_at timestamptz,
  actual_minutes integer,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint housekeeping_tasks_target check (room_id is not null or location_id is not null),
  constraint housekeeping_tasks_minutes check (standard_minutes between 1 and 1440),
  constraint housekeeping_tasks_actual check (actual_minutes is null or actual_minutes >= 0)
);

create index if not exists idx_hk_tasks_day on housekeeping_tasks(org_id, task_date, status);
create index if not exists idx_hk_tasks_assignee on housekeeping_tasks(assigned_to, task_date);
create index if not exists idx_hk_tasks_room on housekeeping_tasks(room_id, task_date desc);

/*
 * An inspection is a second person's opinion, recorded separately.
 *
 * Not a column on the task, because a room can be inspected, rejected,
 * re-cleaned and inspected again, and a single pass/fail column would keep
 * only the last of those — which is exactly the history a supervisor needs
 * when the same attendant fails the same check every week.
 */
create table if not exists housekeeping_inspections (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references housekeeping_tasks(id) on delete cascade,

  inspector_email text,
  inspector_employee_id uuid references employees(id) on delete set null,

  passed boolean not null,
  score integer,
  findings text,

  inspected_at timestamptz not null default now(),

  constraint hk_inspections_score check (score is null or score between 0 and 100)
);

create index if not exists idx_hk_inspections_task
  on housekeeping_inspections(task_id, inspected_at desc);

-- ── Lost property ───────────────────────────────────────────────────────────

create type lost_property_status as enum ('HELD', 'RETURNED', 'DISPOSED', 'DONATED');

create table if not exists lost_property (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  reference text,
  description text not null,
  found_in_room_id uuid references rooms(id) on delete set null,
  found_in_location_id uuid references locations(id) on delete set null,

  found_on date not null default current_date,
  found_by_employee_id uuid references employees(id) on delete set null,
  storage_ref text,

  status lost_property_status not null default 'HELD',

  /*
   * Ninety days, because somebody else's property is not the venue's to throw
   * away because a cupboard is full. Disposing early is possible — perishables
   * exist — but it has to be said out loud and it is recorded.
   */
  hold_until date,

  released_to text,
  released_by_email text,
  released_on date,
  release_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lost_property_description check (btrim(description) <> '')
);

create index if not exists idx_lost_property_open
  on lost_property(org_id, status) where status = 'HELD';

-- ── Consumables ─────────────────────────────────────────────────────────────
/*
 * Amenities and linen are stock, not a housekeeping-only list.
 *
 * A second inventory that only housekeeping can see is how a venue ends up not
 * knowing what it owns. These rows say how much of an existing product a room
 * consumes, so replenishment is answered from the ledger everything else uses
 * and reordering goes through the purchasing chain like any other buy.
 */
create table if not exists housekeeping_consumables (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  product_id uuid not null references products(id) on delete cascade,
  room_type_id uuid references room_types(id) on delete cascade,
  kind housekeeping_task_kind not null default 'DEPARTURE',

  quantity_per_room numeric(18,5) not null,

  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint hk_consumables_qty check (quantity_per_room > 0),
  constraint hk_consumables_unique unique (org_id, product_id, room_type_id, kind)
);

-- ── Who may be sent, and how much ───────────────────────────────────────────
/*
 * The rota decides who is available; this decides how much they can be given.
 *
 * Refused rather than flagged. A sheet of eighteen departures for somebody on
 * a six-hour shift is not an ambitious plan, it is a plan that ends with rooms
 * marked clean that nobody entered — and every control downstream of that
 * assumes the room was actually cleaned.
 *
 * The trade-off, stated because it is real: a venue that does not publish a
 * rota cannot assign housekeeping at all. That is deliberate. The alternative
 * is a capacity rule that silently does nothing wherever it matters most.
 */
create or replace function public.enforce_housekeeping_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp record;
  rostered integer;
  already integer;
begin
  if new.assigned_to is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.assigned_to is not distinct from new.assigned_to
     and old.task_date is not distinct from new.task_date
     and old.standard_minutes is not distinct from new.standard_minutes
  then
    return new;
  end if;

  select e.first_name, e.last_name, e.employment_status
    into emp from public.employees e where e.id = new.assigned_to;
  if emp is null then
    raise exception 'employee not found';
  end if;

  if emp.employment_status not in ('PROBATION', 'ACTIVE', 'NOTICE') then
    raise exception '% % is % and cannot be given work',
      emp.first_name, emp.last_name, lower(emp.employment_status::text);
  end if;

  if exists (
    select 1 from public.leave_requests l
     where l.employee_id = new.assigned_to
       and l.status in ('APPROVED', 'TAKEN')
       and new.task_date between l.starts_on and l.ends_on
  ) then
    raise exception '% % is on approved leave on %',
      emp.first_name, emp.last_name, to_char(new.task_date, 'DD Mon');
  end if;

  -- Rostered working minutes that day, breaks taken out.
  select coalesce(sum(
           greatest(0,
             (extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer
             - coalesce(s.break_minutes, 0))), 0)
    into rostered
    from public.shifts s
   where s.employee_id = new.assigned_to
     and s.status = 'PUBLISHED'
     and (s.starts_at at time zone 'UTC')::date = new.task_date;

  if rostered = 0 then
    raise exception '% % is not rostered on %',
      emp.first_name, emp.last_name, to_char(new.task_date, 'DD Mon')
      using hint = 'Publish a shift for them that day, or assign somebody who is on.';
  end if;

  select coalesce(sum(t.standard_minutes), 0) into already
    from public.housekeeping_tasks t
   where t.assigned_to = new.assigned_to
     and t.task_date = new.task_date
     and t.status not in ('CANCELLED', 'REJECTED')
     and (tg_op = 'INSERT' or t.id <> new.id);

  if already + new.standard_minutes > rostered then
    raise exception
      '% % is rostered % minutes on % and this sheet would need %',
      emp.first_name, emp.last_name, rostered,
      to_char(new.task_date, 'DD Mon'), already + new.standard_minutes
      using hint = 'Move a room to somebody else, or roster more hours.';
  end if;

  if new.assigned_at is null then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

create trigger housekeeping_tasks_assignment
  before insert or update on housekeeping_tasks
  for each row execute function public.enforce_housekeeping_assignment();

-- ── Inspecting ──────────────────────────────────────────────────────────────
/*
 * Not your own room.
 *
 * The caller's identity from the JWT, never the row — 0054's lesson, applied
 * at the start rather than after somebody demonstrates the hole. Matched on
 * both the employee id and the work email, so an attendant who has no login
 * is still caught when a supervisor types their address.
 *
 * A failed inspection must say what is wrong. "Failed" with no finding is not
 * something an attendant can act on, and it is not evidence either.
 */
create or replace function public.enforce_housekeeping_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
  attendant uuid;
  attendant_email text;
begin
  if caller <> '' then
    new.inspector_email := caller;
  elsif coalesce(new.inspector_email, '') = '' then
    raise exception 'an inspection must record who made it';
  end if;

  select t.assigned_to into attendant
    from public.housekeeping_tasks t where t.id = new.task_id;

  if attendant is not null then
    select lower(coalesce(e.work_email, '')) into attendant_email
      from public.employees e where e.id = attendant;

    if (new.inspector_employee_id is not null and new.inspector_employee_id = attendant)
       or (attendant_email <> '' and attendant_email = lower(new.inspector_email))
    then
      raise exception 'you cannot inspect a room you cleaned'
        using hint = 'A supervisor or another attendant inspects the room.';
    end if;
  end if;

  if not new.passed and coalesce(btrim(new.findings), '') = '' then
    raise exception 'a failed inspection must say what is wrong'
      using hint = 'The attendant has to know what to put right.';
  end if;

  return new;
end;
$$;

create trigger housekeeping_inspections_enforce
  before insert on housekeeping_inspections
  for each row execute function public.enforce_housekeeping_inspection();

/*
 * The inspection moves the task and the room, in one place.
 *
 * A pass makes the room sellable; a failure sends it back to be done again
 * rather than leaving it sitting in DONE, which is how a rejected room gets
 * sold anyway.
 */
create or replace function public.apply_housekeeping_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare room uuid;
begin
  select t.room_id into room from public.housekeeping_tasks t where t.id = new.task_id;

  /*
   * Cast the branches explicitly.
   *
   * A CASE over bare literals is text, and assigning text to an enum column
   * fails at runtime rather than at creation — so this function was accepted
   * by the migration and broke the first time a supervisor passed a room.
   * Found by inspecting a room rather than by reading the SQL.
   */
  update public.housekeeping_tasks
     set status = case when new.passed
                       then 'INSPECTED'::public.housekeeping_task_status
                       else 'REJECTED'::public.housekeeping_task_status end,
         updated_at = now()
   where id = new.task_id;

  if room is not null then
    update public.rooms
       set state = case when new.passed
                        then 'INSPECTED'::public.housekeeping_state
                        else 'DIRTY'::public.housekeeping_state end,
           state_changed_at = now(),
           state_changed_by_email = new.inspector_email,
           updated_at = now()
     where id = room;
  end if;
  return new;
end;
$$;

create trigger housekeeping_inspections_apply
  after insert on housekeeping_inspections
  for each row execute function public.apply_housekeeping_inspection();

-- ── A room with an open fault is not clean ──────────────────────────────────
/*
 * The cross-check a standalone housekeeping product cannot make.
 *
 * Maintenance and housekeeping disagreeing about whether a room may be sold is
 * the oldest fault line in hotel operations: engineering has an open job on
 * the air conditioning, housekeeping has finished the room, and the front desk
 * sells it because the two systems never spoke.
 *
 * Here they are the same database, so the question is answerable, and the
 * answer is enforced. Only EMERGENCY and HIGH jobs block — a chipped skirting
 * board is a real job and not a reason to hold a room, and a rule that blocked
 * on everything would be switched off within a week.
 */
create or replace function public.enforce_room_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare blocker record;
begin
  if new.state not in ('CLEAN', 'INSPECTED') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.state = new.state then
    return new;
  end if;

  select w.reference, w.title, w.priority into blocker
    from public.work_orders w
   where w.location_id = new.location_id
     and w.priority in ('EMERGENCY', 'HIGH')
     and w.status not in ('VERIFIED', 'CANCELLED')
   order by w.priority, w.raised_at
   limit 1;

  if blocker.reference is not null then
    raise exception 'room % has an open % job: % (%)',
      new.room_number, lower(blocker.priority::text), blocker.title, blocker.reference
      using hint = 'Close the work order, or put the room out of service.';
  end if;
  return new;
end;
$$;

create trigger rooms_release
  before insert or update on rooms
  for each row execute function public.enforce_room_release();

/*
 * Out of service has to say why, and every state change is kept.
 */
create or replace function public.log_room_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'OUT_OF_SERVICE'
     and coalesce(btrim(new.out_of_service_reason), '') = '' then
    raise exception 'say why room % is out of service', new.room_number;
  end if;

  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return new;
  end if;

  new.state_changed_at := now();
  new.state_changed_by_email := coalesce(
    nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
    new.state_changed_by_email);
  return new;
end;
$$;

create trigger rooms_state_stamp
  before insert or update on rooms
  for each row execute function public.log_room_state();

create or replace function public.record_room_state_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return new;
  end if;
  insert into public.room_state_events
    (org_id, room_id, from_state, to_state, occupancy, note, actor_email)
  values (new.org_id, new.id,
          case when tg_op = 'UPDATE' then old.state else null end,
          new.state, new.occupancy,
          case when new.state = 'OUT_OF_SERVICE' then new.out_of_service_reason else null end,
          new.state_changed_by_email);
  return new;
end;
$$;

create trigger rooms_log_state
  after insert or update on rooms
  for each row execute function public.record_room_state_event();

-- ── Lost property rules ─────────────────────────────────────────────────────

create or replace function public.enforce_lost_property()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare caller text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if new.hold_until is null then
    new.hold_until := new.found_on + 90;
  end if;

  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'LF-' || to_char(new.found_on, 'YYMMDD') || '-' ||
      lpad((
        select count(*) + 1 from public.lost_property
         where org_id = new.org_id and found_on = new.found_on
      )::text, 3, '0');
  end if;

  if new.status in ('RETURNED', 'DONATED', 'DISPOSED')
     and coalesce(old.status, 'HELD') <> new.status
  then
    new.released_by_email := coalesce(caller, new.released_by_email);
    if coalesce(new.released_by_email, '') = '' then
      raise exception 'releasing an item must record who released it';
    end if;
    if new.released_on is null then
      new.released_on := current_date;
    end if;

    if new.status = 'RETURNED' and coalesce(btrim(new.released_to), '') = '' then
      raise exception 'say who % was returned to', new.reference;
    end if;

    -- Somebody else's property is not the venue's to clear out early in
    -- silence. It can be done; it cannot be done without saying so.
    if new.status in ('DISPOSED', 'DONATED')
       and current_date < new.hold_until
       and coalesce(btrim(new.release_note), '') = ''
    then
      raise exception
        '% is held until % and cannot be disposed of before then without a reason',
        new.reference, to_char(new.hold_until, 'DD Mon YYYY')
        using hint = 'Perishable or hazardous items can go early — write down which.';
    end if;
  end if;

  return new;
end;
$$;

create trigger lost_property_enforce
  before insert or update on lost_property
  for each row execute function public.enforce_lost_property();

-- ── What the board and management read ──────────────────────────────────────

create or replace view housekeeping_board as
  select
    r.id as room_id, r.org_id, r.room_number, r.floor,
    r.state, r.state_changed_at, r.occupancy, r.occupancy_set_at,
    r.out_of_service_reason,
    rt.code as room_type, rt.name as room_type_name,
    l.id as location_id, l.name as location_name,
    t.id as task_id, t.kind as task_kind, t.status as task_status,
    t.standard_minutes, t.actual_minutes,
    e.first_name || ' ' || e.last_name as attendant,
    (select count(*) from public.work_orders w
      where w.location_id = r.location_id
        and w.status not in ('VERIFIED','CANCELLED')) as jobs_open,
    (select count(*) from public.work_orders w
      where w.location_id = r.location_id
        and w.priority in ('EMERGENCY','HIGH')
        and w.status not in ('VERIFIED','CANCELLED')) as jobs_blocking
  from public.rooms r
  join public.locations l on l.id = r.location_id
  left join public.room_types rt on rt.id = r.room_type_id
  left join public.housekeeping_tasks t
    on t.room_id = r.id and t.task_date = current_date
   and t.status not in ('CANCELLED','REJECTED')
  left join public.employees e on e.id = t.assigned_to
 where r.org_id in (select public.auth_org_ids());

grant select on housekeeping_board to authenticated;

/*
 * Manning: minutes given out against minutes rostered, per attendant.
 *
 * The same shape as maintenance_manning, because it answers the same question
 * — is today's work possible with today's people — and a manager should not
 * have to read two different layouts to ask it twice.
 */
create or replace view housekeeping_workload as
  select
    e.org_id,
    e.id as employee_id,
    e.first_name || ' ' || e.last_name as name,
    d.task_date,
    coalesce(sum(t.standard_minutes) filter (
      where t.status not in ('CANCELLED','REJECTED')), 0) as minutes_assigned,
    coalesce(sum(t.actual_minutes), 0) as minutes_worked,
    count(t.id) filter (where t.status not in ('CANCELLED','REJECTED')) as rooms_assigned,
    count(t.id) filter (where t.status in ('DONE','INSPECTED')) as rooms_finished,
    (select coalesce(sum(
       greatest(0, (extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer
                   - coalesce(s.break_minutes, 0))), 0)
       from public.shifts s
      where s.employee_id = e.id and s.status = 'PUBLISHED'
        and (s.starts_at at time zone 'UTC')::date = d.task_date) as minutes_rostered
  from public.employees e
  cross join (select current_date as task_date) d
  left join public.housekeeping_tasks t
    on t.assigned_to = e.id and t.task_date = d.task_date
 where e.employment_status in ('PROBATION','ACTIVE','NOTICE')
   and e.org_id in (select public.auth_org_ids())
 group by e.org_id, e.id, e.first_name, e.last_name, d.task_date;

grant select on housekeeping_workload to authenticated;

/*
 * What has to be put in the rooms today, against what is on the shelf.
 *
 * Reads the same stock ledger as the kitchen, so an amenity is never counted
 * in two places. What it does not do is order anything: the page raises an
 * ordinary requisition, which is approved and received like every other buy.
 */
create or replace view housekeeping_replenishment as
  select
    c.org_id,
    c.product_id,
    p.name as product_name,
    p.stock_unit as unit,
    sum(c.quantity_per_room) as needed_today,
    coalesce((select sum(m.quantity) from public.stock_movements m
               where m.product_id = c.product_id), 0) as on_hand,
    coalesce((select sum(m.quantity) from public.stock_movements m
               where m.product_id = c.product_id), 0)
      - sum(c.quantity_per_room) as after_today
  from public.housekeeping_consumables c
  join public.products p on p.id = c.product_id
  join public.housekeeping_tasks t
    on t.task_date = current_date
   and t.kind = c.kind
   and t.status not in ('CANCELLED','REJECTED')
  join public.rooms r on r.id = t.room_id and r.room_type_id = c.room_type_id
 where c.active
   and c.org_id in (select public.auth_org_ids())
 group by c.org_id, c.product_id, p.name, p.stock_unit;

grant select on housekeeping_replenishment to authenticated;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['room_types','rooms','room_state_events','housekeeping_tasks',
                           'housekeeping_inspections','lost_property','housekeeping_consumables']
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

grant delete on room_types, rooms, housekeeping_tasks, housekeeping_consumables to authenticated;
create policy room_types_delete on room_types
  for delete to authenticated using (public.auth_can_write(org_id));
create policy rooms_delete on rooms
  for delete to authenticated using (public.auth_can_write(org_id));
create policy housekeeping_tasks_delete on housekeeping_tasks
  for delete to authenticated using (public.auth_can_write(org_id));
create policy housekeeping_consumables_delete on housekeeping_consumables
  for delete to authenticated using (public.auth_can_write(org_id));

-- An inspection and a room's history are evidence. They do not move.
revoke update, delete on housekeeping_inspections from authenticated;
revoke update, delete on room_state_events from authenticated;

-- ── The section ─────────────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core) values
  ('HOUSEKEEPING', 'Housekeeping',
   'Rooms, cleaning assignments, inspections and lost property.', 57, false)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  sort_order = excluded.sort_order, is_core = excluded.is_core;

do $$
declare t text;
begin
  foreach t in array array['room_types','rooms','housekeeping_tasks',
                           'housekeeping_inspections','lost_property','housekeeping_consumables']
  loop
    execute format(
      'create trigger %1$s_section_guard before insert or update or delete
         on public.%1$I for each row
         execute function public.require_section_write(%2$L)', t, 'HOUSEKEEPING');
  end loop;
end $$;

-- ── What a venue starts with ────────────────────────────────────────────────

create or replace function public.seed_housekeeping_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.room_types where org_id = p_org) then
    return;
  end if;
  insert into public.room_types
    (org_id, code, name, beds, departure_minutes, stayover_minutes, deep_clean_minutes)
  values
    (p_org, 'STD',   'Standard room',    1, 40,  20, 100),
    (p_org, 'DBL',   'Double room',      2, 45,  22, 120),
    (p_org, 'SUITE', 'Suite',            2, 75,  35, 180),
    (p_org, 'VILLA', 'Villa',            3, 110, 45, 240);
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
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_housekeeping_defaults(o.id);
  end loop;
end $$;

comment on table rooms is
  'Guest rooms. Occupancy is recorded, not known — there is no PMS behind it.';
comment on table room_state_events is
  'Append-only. Every change of a room''s cleaning state, with who made it.';
comment on table housekeeping_tasks is
  'Cleaning work. Assignment is refused when it exceeds the attendant''s rostered minutes.';
comment on table housekeeping_inspections is
  'Append-only. An attendant cannot inspect a room they cleaned.';
comment on table lost_property is
  'Held 90 days by default. Disposing earlier is possible and has to be written down.';
comment on view housekeeping_board is
  'The room board, with open maintenance jobs against each room.';
comment on view housekeeping_workload is
  'Minutes assigned against minutes rostered, per attendant, today.';
