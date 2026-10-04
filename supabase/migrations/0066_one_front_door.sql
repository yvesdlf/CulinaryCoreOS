-- ---------------------------------------------------------------------------
-- One front door
-- ---------------------------------------------------------------------------
-- `PLAN.md` Part C, the bullet that stayed open after stage 1 closed the other
-- nine: "the ability to raise a request to any other department, and receive
-- theirs."
--
-- Part C's own observation is the design. The platform already has five things
-- that are the same shape with different names — a maintenance job, a hygiene
-- breach, an HR case, a staff request, a hiring request — and every one of them
-- is *something happened, or somebody wants something → send it to the right
-- department → somebody owns it → close it with evidence.* Building a sixth
-- for every new department is the thing that would make Part C false.
--
-- ## This does not replace what exists
--
-- Part C is explicit and this migration holds to it: "Maintenance still turns a
-- fault report into a proper job with equipment and a schedule. It just means
-- every department shares the same front door." A request is the **intake**. A
-- work order is a job, with an asset, a plan, a technician and a meter reading,
-- and none of that belongs on an intake form a porter fills in at a tap.
--
-- So a request can be *converted*, and keeps a pointer to what it became.
-- Nothing is copied: the request stops being the live record at that moment and
-- says where the live record is. A request that is simply answered is answered
-- here and never becomes anything.
--
-- ## The kinds are data
--
-- `request_types` is a table, not an enum, because the whole point is that
-- Security's incident report and the bakery's batch complaint arrive by filling
-- in a form. A type says which department receives it, how urgent it starts,
-- how long before nobody answering becomes somebody's problem, and whether it
-- can become a work order. That is every question the five existing shapes
-- answer differently, as four columns.
--
-- ## Raising is open; owning is not
--
-- The usual section guard is wrong here in one direction. Anybody in the venue
-- may raise a request — a porter reporting a leak, a receptionist reporting a
-- guest complaint, a chef asking Security to check a door — and requiring a
-- grant for that would rebuild the bottleneck the front door exists to remove.
-- Changing one is different: acknowledging, owning, resolving and closing are
-- the receiving department's work and need its grant.
--
-- `requests` carries `business_unit_id` — the receiving department — so 0062's
-- unit scoping applies without anything new: "Requests, for the Kitchen" is a
-- grant somebody can hold.
--
-- ## Escalation is in 0067, not here
--
-- Gap 15 — chase what nobody answers — needs this table and a clock. The
-- clock is a separate argument and it is kept separate.
-- ---------------------------------------------------------------------------

-- ── What kinds of thing can be raised ───────────────────────────────────────

create table if not exists request_types (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  description text,

  /*
   * Which department receives it. Not nullable: a request with no destination
   * is a request nobody is responsible for, which is the state this whole
   * migration exists to make unreachable.
   */
  to_unit_id uuid not null references business_units(id) on delete restrict,

  default_priority work_order_priority not null default 'NORMAL',

  /*
   * How long before nobody having answered becomes somebody else's problem.
   *
   * Null means never chased, which is a real answer for a suggestion box and
   * the wrong one for a broken fridge. Used by 0067; stored here because it is
   * a property of the kind of request, not of the chasing.
   */
  respond_within_hours integer check (respond_within_hours is null
                                      or respond_within_hours between 1 and 8760),

  /*
   * What this can be turned into, where answering it is not enough. Today the
   * only destination is a work order; the column is text and checked rather
   * than an enum so adding the next one is a row in a check constraint rather
   * than an ALTER TYPE under load.
   */
  becomes text check (becomes is null or becomes in ('WORK_ORDER')),

  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint request_types_code_shape
    check (code = upper(code) and btrim(code) = code and code <> '')
);

create unique index if not exists idx_request_types_code
  on request_types(org_id, lower(code));
create index if not exists idx_request_types_unit on request_types(to_unit_id);

-- ── The request itself ──────────────────────────────────────────────────────

create type request_status as enum (
  'NEW',           -- Raised, nobody has looked
  'ACKNOWLEDGED',  -- Somebody has it
  'IN_PROGRESS',
  'BLOCKED',       -- Waiting on something outside the department
  'RESOLVED',      -- Done, pending the raiser agreeing
  'CLOSED',
  'REJECTED'       -- Not ours, or not happening, with a reason
);

create table if not exists requests (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  reference text,

  request_type_id uuid not null references request_types(id) on delete restrict,

  /*
   * Copied off the type at the moment it is raised, never read through it.
   *
   * A venue that re-points "Guest complaint" from Front of house to a new Guest
   * Relations department must not rewrite where last month's complaints went.
   * The same reasoning as `production_records.sub_recipe_version`: what was
   * true at the time is a fact about the record.
   */
  business_unit_id uuid not null references business_units(id) on delete restrict,

  -- Who is asking, and on whose behalf. The department is optional because a
  -- guest complaint is raised by somebody for nobody's department in particular.
  raised_by_employee_id uuid references employees(id) on delete set null,
  raised_by_email text,
  raised_from_unit_id uuid references business_units(id) on delete set null,

  title text not null,
  detail text,
  location_id uuid references locations(id) on delete set null,
  priority work_order_priority not null default 'NORMAL',

  status request_status not null default 'NEW',

  owner_employee_id uuid references employees(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution text,

  /* When somebody should have answered. Set from the type; see 0067. */
  respond_by timestamptz,

  /*
   * What it became, where answering was not enough. The request stops being
   * the live record at that point and says where the live one is.
   */
  converted_type text check (converted_type is null or converted_type in ('WORK_ORDER')),
  converted_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint requests_title check (btrim(title) <> ''),
  -- Rejected without a reason is a door shut in somebody's face.
  constraint requests_rejected_says_why
    check (status <> 'REJECTED' or coalesce(btrim(resolution), '') <> ''),
  constraint requests_converted_pair
    check ((converted_type is null) = (converted_id is null))
);

create index if not exists idx_requests_unit on requests(business_unit_id, status, created_at desc);
create index if not exists idx_requests_org on requests(org_id, created_at desc);
create index if not exists idx_requests_owner on requests(owner_employee_id)
  where owner_employee_id is not null;
-- The escalation sweep in 0067 reads this and only this.
create index if not exists idx_requests_overdue on requests(respond_by)
  where respond_by is not null and status in ('NEW', 'ACKNOWLEDGED');

/*
 * Every move, kept.
 *
 * The sixth ledger in this schema and the same shape as the other five. A
 * request that changed hands four times before anybody did anything is the
 * finding, and it only exists if each hand-off was written down at the time.
 */
create table if not exists request_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  from_status request_status,
  to_status request_status,
  note text,
  actor_email text,
  actor_employee_id uuid references employees(id) on delete set null,
  /*
   * `now()` is the transaction's start time, so two events written in one
   * transaction carry the same timestamp and `order by at` puts them in no
   * order at all. Kept, because the other five ledgers here do the same and
   * forking the convention for one table is worse than the property — but
   * stated, because a report that reads "the latest event" will be wrong
   * exactly where two things happened at once, which is where it matters.
   */
  at timestamptz not null default now()
);

create index if not exists idx_request_events_request
  on request_events(request_id, at desc);

-- ── What the client is not trusted to state ─────────────────────────────────

create or replace function public.enforce_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind record;
  caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  unit_org uuid;
begin
  if tg_op = 'INSERT' then
    select t.to_unit_id, t.org_id, t.default_priority, t.respond_within_hours, t.active
      into kind
      from public.request_types t where t.id = new.request_type_id;
    if kind is null then
      raise exception 'there is no such kind of request';
    end if;
    if not kind.active then
      raise exception 'that kind of request is no longer accepted'
        using hint = 'An administrator has retired it. Choose another kind.';
    end if;

    new.org_id := kind.org_id;
    -- Taken from the type, never from the client: a request addressed to a
    -- department by whoever raised it is a request that can be addressed to
    -- the wrong one.
    new.business_unit_id := kind.to_unit_id;

    if new.priority is null then
      new.priority := kind.default_priority;
    end if;
    if kind.respond_within_hours is not null then
      new.respond_by := now() + make_interval(hours => kind.respond_within_hours);
    end if;

    if caller_email is not null then
      new.raised_by_email := caller_email;
    elsif coalesce(btrim(new.raised_by_email), '') = '' then
      raise exception 'a request must record who raised it';
    end if;
  else
    new.updated_at := now();

    -- The department it was sent to does not change. Reassignment is a
    -- conversation, not an UPDATE: a request silently moved to another
    -- department is one the raiser is still waiting on at the old one.
    if new.business_unit_id is distinct from old.business_unit_id then
      raise exception 'a request cannot be moved to another department'
        using hint = 'Reject it with a reason, or convert it. Both leave a record.';
    end if;
    if new.reference is distinct from old.reference then
      raise exception 'a request keeps the number it was given';
    end if;

    -- Timestamps follow the status rather than the client.
    if new.status <> old.status then
      if new.status = 'ACKNOWLEDGED' and new.acknowledged_at is null then
        new.acknowledged_at := now();
      end if;
      if new.status in ('RESOLVED', 'REJECTED') and new.resolved_at is null then
        new.resolved_at := now();
      end if;
      if new.status = 'CLOSED' and new.closed_at is null then
        new.closed_at := now();
      end if;
    end if;
  end if;

  if new.location_id is not null then
    select l.org_id into unit_org from public.locations l where l.id = new.location_id;
    if unit_org is distinct from new.org_id then
      raise exception 'that place belongs to another organisation';
    end if;
  end if;

  return new;
end;
$$;

/*
 * The number, allocated from the department that is going to deal with it.
 *
 * `RQ-SEC-260919-001` — Security's first request today. The unit segment is the
 * *receiving* department and not the raiser's, because the number is read by
 * whoever has to answer it, on their own list, among their own work.
 *
 * Named so it sorts after `requests_enforce`, which is what sets
 * `business_unit_id`. 0058 learned that the hard way: a trigger of the same
 * timing whose name sorted wrongly numbered a kitchen job WO-ENG-, and the
 * control suite caught it only because somebody had written the assertion.
 */
create or replace function public.assign_request_reference()
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
  select public.unit_code(b.code) into unit
    from public.business_units b where b.id = new.business_unit_id;
  new.reference := public.next_document_reference('RQ', coalesce(unit, 'GEN'), new.org_id);
  return new;
end;
$$;

create trigger requests_enforce
  before insert or update on requests
  for each row execute function public.enforce_request();

create trigger requests_number
  before insert on requests
  for each row execute function public.assign_request_reference();

/*
 * The ledger writes itself.
 *
 * Same as `log_work_order_event` in 0055, including the part that migration
 * had to fix twice: the actor is the caller where there is a session, and only
 * falls back to a stored address where there is not. A hand-off filed under
 * the wrong person reads as a fact about that person.
 */
create or replace function public.log_request_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if tg_op = 'INSERT' then
    insert into public.request_events
      (org_id, request_id, from_status, to_status, note, actor_email, actor_employee_id)
    values (new.org_id, new.id, null, new.status, 'Raised',
            coalesce(caller, new.raised_by_email), new.raised_by_employee_id);
    return new;
  end if;

  if new.status is distinct from old.status
     or new.owner_employee_id is distinct from old.owner_employee_id
  then
    insert into public.request_events
      (org_id, request_id, from_status, to_status, note, actor_email, actor_employee_id)
    values (new.org_id, new.id, old.status, new.status,
            case
              when new.status is distinct from old.status then new.resolution
              else 'Owner changed'
            end,
            coalesce(caller, new.raised_by_email), new.owner_employee_id);
  end if;
  return new;
end;
$$;

create trigger requests_log
  after insert or update on requests
  for each row execute function public.log_request_event();

-- ── Who may do what ─────────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core)
values ('REQUESTS', 'Requests',
        'The shared front door: anything raised to another department, and what became of it.',
        15, true)
on conflict (code) do nothing;

alter table request_types enable row level security;
alter table requests enable row level security;
alter table request_events enable row level security;

create policy request_types_read on request_types
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy request_types_write on request_types
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

/*
 * Read by anybody in the venue.
 *
 * A front door whose contents only the receiving department can see is a
 * suggestion box. The raiser has to be able to watch what happened to their
 * own report, and "I raised it and nobody told me" is the complaint this is
 * built to answer.
 */
create policy requests_read on requests
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy requests_insert on requests
  for insert to authenticated with check (public.auth_can_write(org_id));
create policy requests_update on requests
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

create policy request_events_read on request_events
  for select to authenticated using (org_id in (select public.auth_org_ids()));

grant select, insert, update, delete on request_types to authenticated;
-- No delete. A request that can be removed is one the raiser can be told never
-- existed; rejecting it with a reason is the honest route and leaves both rows.
grant select, insert, update on requests to authenticated;
grant select on request_events to authenticated;

create trigger request_types_section_guard
  before insert or update or delete on request_types
  for each row execute function public.require_section_write('PARAMETERS');

/*
 * Raising is open to the venue; changing one needs the department's grant.
 *
 * `require_section_write` cannot express that — it is one answer for every
 * operation — so this is its own trigger rather than a second argument to it.
 * It still reads the row's own unit, so a grant scoped to one department works
 * here exactly as it does everywhere else.
 */
create or replace function public.enforce_request_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- A staff-portal user has no membership by design; see 0057's reasoning.
  if not exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = coalesce(new.org_id, old.org_id))
  then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- Anybody in the venue may knock on any department's door. That is the
    -- whole point, and gating it rebuilds the bottleneck.
    return new;
  end if;

  if not public.can_write_section('REQUESTS', old.org_id, old.business_unit_id) then
    raise exception 'answering a request is %''s to do',
      coalesce((select b.name from public.business_units b where b.id = old.business_unit_id),
               'another department')
      using hint = 'Add a comment instead, or ask an administrator for Requests on that department.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger requests_section_guard
  before insert or update or delete on requests
  for each row execute function public.enforce_request_write();

-- ── A photograph of it ──────────────────────────────────────────────────────
/*
 * 0059 said the polymorphic shape existed so "the next departments arrive as
 * data and share one front door, so the list grows". This is the list growing,
 * and it is three lines plus a retention default — which is the test that
 * design was making a claim about.
 */
alter type attachment_parent add value if not exists 'REQUEST';
