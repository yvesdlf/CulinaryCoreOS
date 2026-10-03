-- ---------------------------------------------------------------------------
-- One organisation tree, because two of them disagreed
-- ---------------------------------------------------------------------------
-- `departments` (0023) and `cost_centres` (0021) were both "the part of the
-- venue this belongs to", written three migrations apart, and each grew its
-- own set of references. On this database they had already drifted: four
-- departments, three cost centres, two codes in common. SERVICE and ADMIN had
-- no cost centre, FOH had no department, and `departments.cost_centre_id` —
-- the column added to hold the two together — was null on three rows out of
-- four.
--
-- The cost of that is not untidiness. "What did the bar spend on staff" joins
-- `shifts` to `departments` and `purchase_orders` to `cost_centres` and has
-- nowhere to meet, so the question cannot be asked at all. Every cross-
-- department figure in docs/PLATFORM.md runs into the same seam.
--
-- This replaces both with `business_units`: one row that is the department,
-- is the cost centre, and owns the locations charged to it.
--
-- ## Why it is done this way and not by renaming a column
--
-- Twelve foreign keys point at the two old tables and eleven tables carry
-- one. Renaming `employees.department_id` would mean rewriting the views and
-- triggers in 0037, 0041 and 0053 in the same breath, and a mistake in any of
-- them is silent. So: the new column is added beside the old one, the old
-- names keep working as views, and nothing is dropped here. Dropping
-- `departments` and `cost_centres` is a separate piece of work for when every
-- reader has moved, and it will be a short migration rather than this one.
--
-- ## Which identity the merged row keeps
--
-- A matched pair has two ids and the unit can only have one. It keeps the
-- **cost centre's**, because that id is already written into
-- `budgets_period`, into every requisition and purchase order, and into the
-- reference numbers suppliers hold — `PO-KIT-260919-001` has been
-- abbreviating a cost centre code since 0047. The department's id is the
-- cheaper one to retire, so the department-side columns are rewritten to
-- point at the unit. Where only one tree had the code (SERVICE, ADMIN, FOH,
-- and the T-ENG the test fixtures create) the unit keeps the id it had, and
-- nothing is rewritten at all.
--
-- ## SERVICE and FOH are left as two units
--
-- They are plainly the same thing — "Service" and "Front of house" — and
-- merging them on that hunch would move one department's wage cost onto
-- another's budget with nothing in the record to say it happened. Codes are
-- what this migration matches on, and a venue that wants them as one unit can
-- reparent them itself. Guessing is how the two trees disagreed in the first
-- place.
-- ---------------------------------------------------------------------------

-- ── The unit ────────────────────────────────────────────────────────────────

create table if not exists business_units (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  /*
   * One venue is a flat list; a group is a head office with venues beneath
   * it. The same table does both, so neither had to be configured to be what
   * it is — which is the whole argument of PLATFORM.md §4.
   *
   * `on delete set null` rather than cascade: deleting a head office should
   * not take its venues' spend history with it.
   */
  parent_id uuid references business_units(id) on delete set null,

  /*
   * Short and uppercase because the first three characters of it are the unit
   * segment of every document reference — KIT, BAR, FOH. Refused rather than
   * folded to upper case on the way in: a trigger that quietly corrects what
   * it did not refuse is one of the three false passes `_harness.sql` is
   * about, and the caller never learns its code was not the code it asked
   * for.
   */
  code text not null,
  name text not null,

  -- Who runs it. An employee rather than an email, because the rota, the work
  -- order board and the hiring chain already identify people this way, and a
  -- second vocabulary for the same person is how one of them goes stale.
  manager_employee_id uuid references employees(id) on delete set null,

  /*
   * Spend at or above this needs the unit's own agreement on top of whatever
   * `approval_policies` says. Null means the organisation's policy is the
   * only rule, which is today's behaviour for every unit.
   *
   * numeric, not a float: it is money.
   */
  approval_threshold numeric(18,5),

  active boolean not null default true,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_units_code_shape
    check (code = upper(code) and btrim(code) = code and code <> ''),
  -- Twelve is already far longer than anything a reference can distinguish;
  -- see the prefix index below.
  constraint business_units_code_length check (length(code) <= 12),
  constraint business_units_threshold_sign
    check (approval_threshold is null or approval_threshold >= 0),
  -- Caught by the trigger below at any depth; this is the one-row case, which
  -- a constraint can state more cheaply than a function.
  constraint business_units_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index if not exists idx_business_units_code
  on business_units(org_id, lower(code));
create index if not exists idx_business_units_parent on business_units(parent_id);
create index if not exists idx_business_units_live on business_units(org_id) where active;

/*
 * Two units in one organisation cannot share a reference prefix.
 *
 * `unit_code()` takes the first three characters, so KITCHEN and KITCHENETTE
 * would both issue PO-KIT-260919-00n from the same daily counter and the
 * supplier would hold two orders whose numbers claim to be the same unit's.
 * The ambiguity is unrecoverable once the numbers are out, so it is refused
 * at the point the second code is created.
 */
create unique index if not exists idx_business_units_prefix
  on business_units(org_id, public.unit_code(code));

/*
 * A unit cannot contain itself, at any depth, and cannot be parented into
 * another organisation.
 *
 * Checked by walking up rather than by comparing to the parent, the same way
 * `enforce_location_tree` does in 0055 and for the same reason: the cheap
 * check only catches A -> A, and the expensive failure is A -> B -> A, which
 * makes every recursive query on the tree hang rather than error. The
 * one-row case is a check constraint above; this is the rest of it.
 *
 * The cross-tenant parent is here too because it is the same walk. A unit
 * whose parent is in another organisation would publish that parent's name
 * into this organisation's tree, and `org_id` on the row itself would still
 * look correct.
 */
create or replace function public.enforce_business_unit_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  walker uuid := new.parent_id;
  depth integer := 0;
  parent_org uuid;
  manager_org uuid;
begin
  if new.parent_id is not null then
    select org_id into parent_org from public.business_units where id = new.parent_id;
    if parent_org is null then
      raise exception 'that parent unit does not exist';
    end if;
    if parent_org <> new.org_id then
      raise exception 'a business unit cannot sit under another organisation''s unit';
    end if;
  end if;

  if new.manager_employee_id is not null then
    select org_id into manager_org from public.employees where id = new.manager_employee_id;
    if manager_org is distinct from new.org_id then
      raise exception 'that manager does not work for this organisation';
    end if;
  end if;

  while walker is not null loop
    if walker = new.id then
      raise exception 'a business unit cannot sit inside itself';
    end if;
    depth := depth + 1;
    if depth > 12 then
      raise exception 'business unit nesting is too deep to be real';
    end if;
    select parent_id into walker from public.business_units where id = walker;
  end loop;
  return new;
end;
$$;

create trigger business_units_tree
  before insert or update on business_units
  for each row execute function public.enforce_business_unit_tree();

-- ── Tenancy ─────────────────────────────────────────────────────────────────
-- The same four policies every other table in this schema carries, scoped by
-- org_id. Written out rather than looped because there is one table.

create trigger business_units_set_org before insert on business_units
  for each row execute function public.set_org_id();

alter table business_units enable row level security;

create policy business_units_read on business_units
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));
create policy business_units_insert on business_units
  for insert to authenticated
  with check (public.auth_can_write(org_id));
create policy business_units_update on business_units
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
create policy business_units_delete on business_units
  for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, update, delete on business_units to authenticated;

-- ── The backfill ────────────────────────────────────────────────────────────
/*
 * Cost centres first, keeping their ids, for the reason set out at the top.
 * Codes are normalised to upper case here because the new check constraint
 * refuses anything else and this is the one place where correcting stored
 * data is a migration's job rather than a trigger's.
 */
insert into business_units (id, org_id, code, name, active, created_at)
select c.id, c.org_id, upper(btrim(c.code)), c.name, c.active, c.created_at
  from cost_centres c
on conflict (id) do nothing;

/*
 * Then every department whose code no cost centre claimed, keeping its id.
 * Matched on lower(code), which is what both unique indexes are on, so
 * "Kitchen" and "KITCHEN" are one unit and not two.
 */
insert into business_units (id, org_id, code, name, active, created_at)
select d.id, d.org_id, upper(btrim(d.code)), d.name, true, d.created_at
  from departments d
 where not exists (
   select 1 from business_units b
    where b.org_id = d.org_id and lower(b.code) = lower(btrim(d.code)))
on conflict (id) do nothing;

/*
 * A department that *did* match keeps its name on the merged row only where
 * the cost centre had none to give. Where both had one they are the same
 * word on every venue seen so far, and the cost centre's is the one already
 * printed on issued documents, so it wins.
 */
update business_units b
   set name = d.name
  from departments d
 where d.org_id = b.org_id
   and lower(d.code) = lower(b.code)
   and btrim(coalesce(b.name, '')) = '';

-- ── The old foreign keys come off ───────────────────────────────────────────
/*
 * They have to: `departments` and `cost_centres` become views below, and a
 * view cannot be the target of a foreign key. The integrity they provided is
 * not lost — each one is re-made against `business_units` further down, with
 * the same delete action it had, and the legacy column is kept in step with
 * the new one by trigger. Listed explicitly rather than discovered from the
 * catalogue, so that a thirteenth reference added between now and the day
 * this file is read fails loudly here instead of being silently dropped.
 */
alter table requisitions         drop constraint if exists requisitions_cost_centre_id_fkey;
alter table purchase_orders      drop constraint if exists purchase_orders_cost_centre_id_fkey;
alter table budgets              drop constraint if exists budgets_cost_centre_id_fkey;
alter table locations            drop constraint if exists locations_cost_centre_id_fkey;
alter table work_orders          drop constraint if exists work_orders_cost_centre_id_fkey;
alter table meters               drop constraint if exists meters_cost_centre_id_fkey;
alter table departments          drop constraint if exists departments_cost_centre_id_fkey;
alter table job_roles            drop constraint if exists job_roles_department_id_fkey;
alter table employees            drop constraint if exists employees_department_id_fkey;
alter table shifts               drop constraint if exists shifts_department_id_fkey;
alter table department_approvers drop constraint if exists department_approvers_department_id_fkey;
alter table hiring_requests      drop constraint if exists hiring_requests_department_id_fkey;

do $$
declare n integer;
begin
  select count(*) into n
    from pg_constraint
   where contype = 'f'
     and confrelid in ('public.departments'::regclass, 'public.cost_centres'::regclass);
  if n > 0 then
    raise exception
      'a reference to departments or cost_centres was added after this migration was written (% left); list it above'
      , n;
  end if;
end $$;

-- ── The department-side ids are rewritten to the unit's ─────────────────────
/*
 * Only the rows whose department was merged into a cost centre move; for
 * SERVICE, ADMIN and T-ENG the two ids are already the same value and these
 * statements change nothing. Done while `departments` is still a table, so
 * the mapping is readable from the row it is replacing.
 */
create temporary table department_to_unit as
  select d.id as old_id, b.id as unit_id
    from departments d
    join business_units b
      on b.org_id = d.org_id and lower(b.code) = lower(btrim(d.code))
   where b.id <> d.id;

-- Triggers off for the repointing, for the reason spelled out at the backfill
-- below: these rows were accepted when they were written, and re-running the
-- rota and offboarding rules over them now is not a question anybody asked.
alter table job_roles            disable trigger user;
alter table employees            disable trigger user;
alter table shifts               disable trigger user;
alter table department_approvers disable trigger user;
alter table hiring_requests      disable trigger user;

update job_roles            t set department_id = m.unit_id from department_to_unit m where t.department_id = m.old_id;
update employees            t set department_id = m.unit_id from department_to_unit m where t.department_id = m.old_id;
update shifts               t set department_id = m.unit_id from department_to_unit m where t.department_id = m.old_id;
update department_approvers t set department_id = m.unit_id from department_to_unit m where t.department_id = m.old_id;
update hiring_requests      t set department_id = m.unit_id from department_to_unit m where t.department_id = m.old_id;

alter table job_roles            enable trigger user;
alter table employees            enable trigger user;
alter table shifts               enable trigger user;
alter table department_approvers enable trigger user;
alter table hiring_requests      enable trigger user;

-- ── Every reference gains the new column ────────────────────────────────────
/*
 * Added beside the legacy column rather than replacing it, so a reader that
 * has not moved yet still works. The two are kept identical by trigger
 * below; the FK is on the new one.
 *
 * `budgets`, `hiring_requests` and `department_approvers` had NOT NULL on the
 * legacy column, so the new one gets it too — after the backfill, because
 * adding a NOT NULL column with no default to a populated table cannot work
 * the other way round.
 */
do $$
declare
  m record;
begin
  for m in select * from (values
    -- The money side. The id is already the unit's, so the backfill is a copy.
    ('requisitions',         'cost_centre_id', false),
    ('purchase_orders',      'cost_centre_id', false),
    ('budgets',              'cost_centre_id', true),
    ('locations',            'cost_centre_id', false),
    ('work_orders',          'cost_centre_id', false),
    ('meters',               'cost_centre_id', false),
    -- The people side, rewritten just above.
    ('job_roles',            'department_id',  false),
    ('employees',            'department_id',  false),
    ('shifts',               'department_id',  false),
    ('department_approvers', 'department_id',  true),
    ('hiring_requests',      'department_id',  true)
  ) as v(tbl, legacy, required)
  loop
    execute format('alter table public.%I add column if not exists business_unit_id uuid', m.tbl);

    /*
     * Triggers off for the copy, and only for the copy.
     *
     * Filling a new column from the one beside it is not a business event,
     * but every rule on these tables is written for UPDATE as well as
     * INSERT, so the backfill re-runs them against rows that were already
     * accepted. `shifts_enforce` is what found this: the fixtures hold a
     * published shift on a day its technician was later given leave — the
     * only order in which "rostered and on leave" can exist, and the state
     * two maintenance checks are built on — and the backfill refused to copy
     * a uuid because of it. A migration that cannot touch an awkward row is a
     * migration that stops halfway through a venue's data.
     *
     * Re-enabled on the next line, inside the same transaction, so there is
     * no window in which a failure leaves the table unguarded.
     */
    execute format('alter table public.%I disable trigger user', m.tbl);
    execute format('update public.%I set business_unit_id = %I where business_unit_id is null', m.tbl, m.legacy);
    execute format('alter table public.%I enable trigger user', m.tbl);
    execute format(
      'alter table public.%I add constraint %I foreign key (business_unit_id)
         references public.business_units(id) on delete %s',
      m.tbl, m.tbl || '_business_unit_id_fkey',
      case m.tbl when 'budgets' then 'cascade'
                 when 'department_approvers' then 'cascade'
                 when 'hiring_requests' then 'restrict'
                 else 'set null' end);
    if m.required then
      execute format('alter table public.%I alter column business_unit_id set not null', m.tbl);
    end if;
    execute format('create index if not exists %I on public.%I(business_unit_id)',
                   'idx_' || m.tbl || '_business_unit', m.tbl);
  end loop;
end $$;

/*
 * One approver per unit, the same rule `department_approvers_unique` states
 * about the old column.
 *
 * It also has to exist for the screen to work: the approver row is written as
 * an upsert, and an upsert needs a unique constraint on the column it conflicts
 * against. Without this, saving an approver by unit would insert a second row
 * and the hiring chain would have two answers to who signs.
 */
create unique index if not exists idx_department_approvers_unit
  on department_approvers(business_unit_id);

/*
 * A row cannot name a unit in another organisation.
 *
 * The foreign key says the unit exists; it does not say it belongs here, and
 * `org_id` on the row would still read correctly. Stated once, as a check on
 * every table that carries the column, because the alternative is eleven
 * triggers that have to agree.
 */
create or replace function public.business_unit_in_org(p_unit uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_unit is null or exists (
    select 1 from public.business_units b where b.id = p_unit and b.org_id = p_org);
$$;

grant execute on function public.business_unit_in_org(uuid, uuid) to authenticated;

-- ── The legacy column and the new one stay the same value ───────────────────
/*
 * They are the same fact, so drift between them is the defect this migration
 * exists to remove, reintroduced one table lower down.
 *
 * Whichever one the caller moved wins, so a front end that has migrated and
 * a screen that has not can both write the same row. On insert, either alone
 * fills the other.
 *
 * The trigger is named `_align_unit` and not something more obvious because
 * triggers of the same timing fire in name order, and `assign_reference` on
 * purchase orders and work orders — and `sync_reference` on requisitions —
 * read the *legacy* column to build the document number. "align" sorts before
 * all three; a name that did not would hand a newly migrated screen a
 * PO-GEN- number for a unit it had named perfectly well.
 */
create or replace function public.align_business_unit_column()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text := tg_argv[0];
  fresh jsonb := to_jsonb(new);
  stale jsonb;
  legacy uuid := nullif(fresh ->> col, '')::uuid;
  unit uuid := nullif(fresh ->> 'business_unit_id', '')::uuid;
  /*
   * Resolved the same way `set_org_id` resolves it, because `set_org_id`
   * sorts *after* this trigger by name and this one has to sort before
   * `assign_reference`. Reading new.org_id alone would be null on every
   * client insert, and the tenancy check below would then either refuse
   * everything or — worse — be skipped in the only path that matters.
   */
  home uuid := coalesce(new.org_id, public.auth_default_org_id());
begin
  if tg_op = 'UPDATE' then
    stale := to_jsonb(old);
    if unit is distinct from nullif(stale ->> 'business_unit_id', '')::uuid then
      legacy := unit;
    elsif legacy is distinct from nullif(stale ->> col, '')::uuid then
      unit := legacy;
    end if;
  else
    unit := coalesce(unit, legacy);
    legacy := unit;
  end if;

  -- `home` is null only with no session and no membership, which is the
  -- migration-or-console case every other guard in this schema stands down
  -- for; there is no organisation to check against.
  if home is not null and not public.business_unit_in_org(unit, home) then
    raise exception 'that business unit belongs to another organisation';
  end if;

  return jsonb_populate_record(
    new, jsonb_build_object(col, legacy, 'business_unit_id', unit));
end;
$$;

do $$
declare
  m record;
begin
  for m in select * from (values
    ('requisitions',         'cost_centre_id'),
    ('purchase_orders',      'cost_centre_id'),
    ('budgets',              'cost_centre_id'),
    ('locations',            'cost_centre_id'),
    ('work_orders',          'cost_centre_id'),
    ('meters',               'cost_centre_id'),
    ('job_roles',            'department_id'),
    ('employees',            'department_id'),
    ('shifts',               'department_id'),
    ('department_approvers', 'department_id'),
    ('hiring_requests',      'department_id')
  ) as v(tbl, legacy)
  loop
    execute format(
      'create trigger %1$s_align_unit before insert or update on public.%1$I
         for each row execute function public.align_business_unit_column(%2$L)',
      m.tbl, m.legacy);
  end loop;
end $$;

-- ── The old names keep working ──────────────────────────────────────────────
/*
 * Views, not tables kept in sync. Two tables synchronised by trigger is two
 * places a value can be, which is the state this migration is undoing — and
 * a pair of cross-firing triggers is a loop waiting for somebody to add a
 * third.
 *
 * `security_invoker` is on both. Without it a view runs with its owner's
 * rights, the owner is `postgres`, and row-level security on
 * `business_units` would be bypassed for every caller. That is not
 * hypothetical in this schema; see the note on `budget_positions` below.
 *
 * Nothing is dropped beyond the two tables themselves. The two views that
 * read `departments.name` are recreated against the unit, unchanged in every
 * other respect.
 */
drop view if exists my_profile;
drop view if exists venue_calendar;
drop table if exists departments;
drop table if exists cost_centres;

create view departments with (security_invoker = true) as
  select
    b.id,
    b.org_id,
    b.code,
    b.name,
    -- The column that used to join the two trees. A unit is its own cost
    -- centre now, so the honest answer is the row itself, and the joins in
    -- 0037 and 0040 that read it still resolve.
    b.id as cost_centre_id,
    b.created_at
  from business_units b;

create view cost_centres with (security_invoker = true) as
  select b.id, b.org_id, b.code, b.name, b.active, b.created_at
  from business_units b;

/*
 * Writable, because the fixtures, the demo seed and the HR screens all write
 * to these names and a compatibility shim that only reads is not one.
 *
 * Deliberately *not* security definer: the write then runs as the caller, so
 * `business_units`' own policies and its section guard apply exactly as they
 * would to a direct write, and this function grants nobody anything.
 *
 * `ON CONFLICT` does not work against a view, which is why 0040's seeders are
 * replaced further down rather than left to find out.
 */
create or replace function public.write_through_department()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.business_units where id = old.id;
    return old;
  end if;

  /*
   * A supplied cost centre is refused rather than ignored. Anybody passing
   * one is working from the two-tree model, and silently dropping it would
   * put the labour cost somewhere other than where they asked.
   */
  if tg_op = 'INSERT' then
    if new.cost_centre_id is not null then
      raise exception 'a business unit is its own cost centre'
        using hint = 'Write to business_units and leave cost_centre_id out.';
    end if;
    insert into public.business_units (org_id, code, name)
    values (new.org_id, new.code, new.name)
    returning id, org_id, created_at into new.id, new.org_id, new.created_at;
    new.cost_centre_id := new.id;
    return new;
  end if;

  if new.cost_centre_id is distinct from old.id then
    raise exception 'a business unit is its own cost centre'
      using hint = 'To move a unit in the tree, set its parent_id on business_units.';
  end if;
  update public.business_units
     set code = new.code, name = new.name, updated_at = now()
   where id = old.id;
  return new;
end;
$$;

create or replace function public.write_through_cost_centre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.business_units where id = old.id;
    return old;
  end if;
  if tg_op = 'INSERT' then
    insert into public.business_units (org_id, code, name, active)
    values (new.org_id, new.code, new.name, coalesce(new.active, true))
    returning id, org_id, created_at into new.id, new.org_id, new.created_at;
    return new;
  end if;
  update public.business_units
     set code = new.code, name = new.name, active = new.active, updated_at = now()
   where id = old.id;
  return new;
end;
$$;

create trigger departments_write_through
  instead of insert or update or delete on departments
  for each row execute function public.write_through_department();

create trigger cost_centres_write_through
  instead of insert or update or delete on cost_centres
  for each row execute function public.write_through_cost_centre();

grant select, insert, update, delete on departments to authenticated;
grant select, insert, update, delete on cost_centres to authenticated;

-- ── The two views that read a department's name ─────────────────────────────
/*
 * Recreated against the unit and otherwise byte-for-byte what 0041 and 0053
 * wrote, including their owner's rights.
 *
 * They are *not* given `security_invoker` here, although both return rows
 * from other organisations to anybody signed in. That is a real fault and it
 * is recorded in docs/PROGRESS.md rather than fixed in passing: both are read
 * by staff-portal users, who by the rule in AGENTS.md §7 are deliberately not
 * organisation members, so invoker rights would empty `my_profile` for
 * exactly the people it exists for. The fix is an explicit scope that admits
 * the portal, which is a decision about the portal and not about this tree.
 */
create view my_profile as
  select
    e.id as employee_id,
    e.org_id,
    o.name as venue_name,
    e.employee_number,
    e.first_name,
    e.last_name,
    e.work_email,
    e.employment_status,
    b.name as department,
    j.title as job_title,
    m.first_name || ' ' || m.last_name as manager_name
  from employees e
  join organizations o on o.id = e.org_id
  left join business_units b on b.id = e.business_unit_id
  left join job_roles j on j.id = e.job_role_id
  left join employees m on m.id = e.manager_id
 where e.id = public.auth_employee_id();

create view venue_calendar as
  select h.org_id, 'HOLIDAY' as kind, h.holiday_on as on_date, h.name as title,
         case when h.closed then 'Venue closed' else 'Trading' end as detail,
         null::uuid as employee_id
    from public_holidays h
  union all
  select e.org_id, 'BIRTHDAY', make_date(
           extract(year from current_date)::int,
           extract(month from e.date_of_birth)::int,
           extract(day from e.date_of_birth)::int),
         e.first_name || ' ' || e.last_name,
         coalesce(b.name, ''),
         e.id
    from employees e
    left join business_units b on b.id = e.business_unit_id
   where e.date_of_birth is not null
     and e.birthday_visible
     and e.employment_status in ('PROBATION', 'ACTIVE', 'NOTICE')
  union all
  select l.org_id, 'LEAVE', l.starts_on,
         e.first_name || ' ' || e.last_name,
         t.name,
         e.id
    from leave_requests l
    join employees e on e.id = l.employee_id
    join leave_types t on t.id = l.leave_type_id
   where l.status in ('APPROVED', 'TAKEN');

grant select on my_profile to authenticated;
grant select on venue_calendar to authenticated;

-- ── The budget position reads the unit, and only this venue's ───────────────
/*
 * Repointed at `business_unit_id` so that a budget written by a migrated
 * screen is found by the committed and actual subqueries.
 *
 * The org filter is new and is a fix, not a tidy-up: this view carried none
 * and runs with its owner's rights, so `select count(distinct org_id) from
 * budget_positions` returned five to a user with no membership at all —
 * every venue's budget, commitment and invoiced spend. `maintenance_manning`
 * in 0055 is the pattern: an owner's-rights view states its own scope.
 * Unlike the two views above, nothing in the staff portal reads this one, so
 * the scope can simply be the caller's organisations.
 */
-- Dropped rather than replaced: `create or replace view` can only add columns
-- at the end, and business_unit_id belongs beside the column it replaces.
drop view if exists budget_positions;

create view budget_positions as
  select
    b.id as budget_id,
    b.org_id,
    b.cost_centre_id,
    b.business_unit_id,
    b.name,
    b.period_start,
    b.period_end,
    b.amount,
    b.hard_stop,
    coalesce((
      select sum(po.total_amount - coalesce((
               select sum(si.total_amount) from public.supplier_invoices si
                where si.purchase_order_id = po.id
                  and si.status <> 'CANCELLED'), 0))
        from public.purchase_orders po
       where po.business_unit_id = b.business_unit_id
         and po.status in ('APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED')
         and coalesce(po.ordered_on, po.created_at::date) between b.period_start and b.period_end
    ), 0) as committed,
    coalesce((
      select sum(si.total_amount)
        from public.supplier_invoices si
        join public.purchase_orders po2 on po2.id = si.purchase_order_id
       where po2.business_unit_id = b.business_unit_id
         and si.status <> 'CANCELLED'
         and si.invoice_date between b.period_start and b.period_end
    ), 0) as actual
  from public.budgets b
 where b.org_id in (select public.auth_org_ids());

grant select on budget_positions to authenticated;

comment on view budget_positions is
  'What a unit has committed and what it has been invoiced, against its budget. This venue only.';

-- ── Which section owns it ───────────────────────────────────────────────────
/*
 * Venue parameters, not People.
 *
 * 0057 moved `department_approvers` to PARAMETERS with the reasoning "who may
 * approve what is a finance parameter, not an HR one", and this row now
 * carries an approval threshold, the budget's cost centre and the reference
 * prefix printed on every supplier document. Creating or renaming one is a
 * finance act that happens to also change an HR label.
 *
 * It is a tightening and worth saying so: `departments` was guarded by PEOPLE
 * in 0057, so an HR manager granted People and nothing else could rename a
 * department and can no longer rename the unit. They never could change where
 * its wages were charged, and that is now the same decision.
 */
create trigger business_units_section_guard
  before insert or update or delete on business_units
  for each row execute function public.require_section_write('PARAMETERS');

-- ── What a venue starts with ────────────────────────────────────────────────
/*
 * In a function, called on organisation creation. Seven migrations wrote
 * `insert ... select ... from organizations` in a migration body, which runs
 * once over the organisations that exist at that moment — and on a database
 * built from its own migrations, that is none. Rebuilding from empty is what
 * found them, and this file is rebuilt from empty on every CI run.
 *
 * The four units are the three cost centres 0040 seeded and the two
 * departments it added beyond them, merged: KITCHEN, BAR, FOH, ADMIN. SERVICE
 * is gone from the defaults, because FOH and SERVICE were the same room with
 * two codes and a new venue should not start with both. An existing venue
 * keeps whichever of them it has — this does not delete anything.
 *
 * Flat, with no parent. A head office above the venues is a group's shape and
 * a group says so by creating one; starting every venue with a root it did
 * not ask for is the tier list PLATFORM.md §2 withdrew.
 */
create or replace function public.seed_business_units(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_units (org_id, code, name)
  select p_org, u.code, u.name
    from (values ('KITCHEN', 'Kitchen'),
                 ('BAR',     'Bar'),
                 ('FOH',     'Front of house'),
                 ('ADMIN',   'Administration')) as u(code, name)
   where not exists (
     select 1 from public.business_units b
      where b.org_id = p_org and lower(b.code) = lower(u.code))
   -- The prefix index refuses a second unit sharing the first three
   -- characters, so a venue that already runs a FOHBAR keeps it and does not
   -- have this migration fail on its behalf.
   and not exists (
     select 1 from public.business_units b
      where b.org_id = p_org and public.unit_code(b.code) = public.unit_code(u.code));
end;
$$;

/*
 * 0040's two seeders wrote to the old tables with `ON CONFLICT`, which a view
 * does not accept. Replaced rather than left to break on the next sign-up,
 * and both now say the same thing: the unit list comes from one place.
 */
create or replace function public.seed_purchasing_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.approval_policies (org_id, document_type, min_amount, required_role)
  select p_org, d.t, v.amt, v.role::public.org_role
  from (values ('REQUISITION'), ('PURCHASE_ORDER')) as d(t)
  cross join (values (0, 'CHEF'), (5000000, 'ADMIN'), (25000000, 'OWNER')) as v(amt, role)
  on conflict do nothing;

  perform public.seed_business_units(p_org);

  insert into public.matching_tolerances (org_id) values (p_org)
  on conflict do nothing;

  -- Unchanged amounts, read off the unit instead of the cost centre. FOH now
  -- stands where the old 'else' branch stood, so the figures are the same.
  insert into public.budgets (org_id, business_unit_id, name, period_start, period_end, amount)
  select b.org_id, b.id,
         'FY' || extract(year from current_date)::text || ' ' || b.name,
         date_trunc('year', current_date)::date,
         (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
         case b.code when 'KITCHEN' then 2000000000
                     when 'BAR' then 800000000
                     else 200000000 end
  from public.business_units b
  where b.org_id = p_org
  on conflict do nothing;
end;
$$;

create or replace function public.seed_people_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_business_units(p_org);

  insert into public.leave_types
    (org_id, code, name, paid, annual_entitlement_days, max_carryover_days)
  select p_org, t.code, t.name, t.paid, t.days, t.carry
  from (values
    ('ANNUAL',   'Annual leave',     true,  20,   5),
    ('SICK',     'Sick leave',       true,  null, null),
    ('UNPAID',   'Unpaid leave',     false, null, null),
    ('PARENTAL', 'Parental leave',   true,  null, null),
    ('LIEU',     'Time off in lieu', true,  null, null)
  ) as t(code, name, paid, days, carry)
  on conflict do nothing;
end;
$$;

/*
 * `seed_organization_defaults` is deliberately *not* redefined here.
 *
 * It is the one function four migrations have each rewritten in full to add
 * their own line, and every rewrite is a chance to drop somebody else's. The
 * local database already has a `seed_production_defaults` in that list with
 * no migration behind it, which is exactly what that pattern produces. Both
 * seeders this file replaces call `seed_business_units` themselves, so the
 * units are there without the orchestrator needing to know.
 */

-- Every organisation that already exists. Idempotent, and it overwrites
-- nothing a venue has changed.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_business_units(o.id);
  end loop;
end $$;

comment on table business_units is
  'One tree. The department, the cost centre and the owner of a location, which were three tables and disagreed.';
comment on column business_units.approval_threshold is
  'Spend at or above this needs the unit to agree as well as approval_policies. Null means policy alone.';
comment on function public.enforce_business_unit_tree() is
  'Walks up rather than comparing to the parent: A -> B -> A is the failure that hangs recursive queries.';
comment on function public.align_business_unit_column() is
  'Keeps business_unit_id and the legacy column identical while both have readers.';
comment on function public.seed_business_units(uuid) is
  'The units a new venue starts with. Idempotent; never removes one a venue has.';
comment on view departments is
  'Compatibility over business_units while its readers move. A unit is its own cost centre.';
comment on view cost_centres is
  'Compatibility over business_units while its readers move.';
