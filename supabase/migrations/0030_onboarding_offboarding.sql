-- ---------------------------------------------------------------------------
-- Onboarding and offboarding — HR §4 and §5
-- ---------------------------------------------------------------------------
-- The two ends of employment, and they are not symmetrical.
--
-- Onboarding is a checklist that wants completing: contract signed, right to
-- work seen, training booked, uniform issued. Nothing breaks if a step is
-- late; somebody chases it.
--
-- Offboarding is a checklist that must not be left incomplete, and the reason
-- is security rather than tidiness. An account still live a month after
-- somebody left is a way in that nobody is watching, and keys not returned are
-- a building anybody can enter. So the offboarding side records what must be
-- revoked and refuses to call a leaver archived while any of it is open.
--
-- Both are templates instantiated per person, rather than free text, so
-- "did we get their bank details" has an answer rather than an opinion.
-- ---------------------------------------------------------------------------

create type checklist_kind as enum ('ONBOARDING', 'OFFBOARDING');

create type task_category as enum (
  'PAPERWORK',      -- contract, policies, right to work
  'DATA',           -- bank, tax, emergency contact
  'ACCESS',         -- accounts, keys, door codes
  'EQUIPMENT',      -- uniform, knives, phone
  'TRAINING',       -- induction, food safety, allergen
  'HANDOVER',       -- knowledge transfer, open work
  'FINAL'           -- final pay instruction, exit interview
);

/*
 * The template: what this venue does for every arrival and every departure.
 *
 * `blocks_completion` marks a step that must be done before somebody can be
 * archived. Revoking access is the obvious one; returning a locker key is not,
 * because chasing a key should not stop the record being closed.
 */
create table if not exists checklist_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind checklist_kind not null,
  category task_category not null,
  title text not null,
  detail text,
  -- Days from the start or leaving date. Negative is before it.
  due_offset_days integer not null default 0,
  blocks_completion boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_templates_kind
  on checklist_templates(org_id, kind, sort_order);

create table if not exists employee_tasks (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  kind checklist_kind not null,
  category task_category not null,
  title text not null,
  detail text,
  due_on date,
  blocks_completion boolean not null default false,

  completed_at timestamptz,
  completed_by_email text,
  note text,

  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_tasks_employee
  on employee_tasks(employee_id, kind, sort_order);
create index if not exists idx_employee_tasks_open
  on employee_tasks(org_id, due_on) where completed_at is null;

-- Leaving details live beside the employee rather than on it, because most
-- people never have them and a dozen null columns on `employees` would be
-- read by every screen that lists staff.
create table if not exists employee_exits (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,

  -- Resignation and dismissal are different facts with different obligations.
  reason text not null,
  voluntary boolean not null default true,
  notice_given_on date,
  last_working_day date,

  exit_interview_on date,
  exit_notes text,
  -- Deliberately not a calculation. Final pay belongs to a payroll provider;
  -- this records that the instruction was sent and when.
  final_pay_instructed_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/**
 * Start a checklist for somebody.
 *
 * Copies the template rather than pointing at it, so changing the template
 * next year does not rewrite what a person was actually asked to do.
 */
create or replace function public.start_checklist(
  p_employee uuid, p_kind public.checklist_kind, p_anchor date default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  anchor date;
  made integer;
begin
  select e.org_id, coalesce(p_anchor, e.started_on, current_date)
    into target_org, anchor
    from public.employees e where e.id = p_employee;
  if target_org is null then raise exception 'employee not found'; end if;

  if not public.auth_can_write(target_org) then
    raise exception 'not allowed to start a checklist here';
  end if;

  insert into public.employee_tasks
    (org_id, employee_id, kind, category, title, detail, due_on,
     blocks_completion, sort_order)
  select target_org, p_employee, t.kind, t.category, t.title, t.detail,
         anchor + t.due_offset_days, t.blocks_completion, t.sort_order
    from public.checklist_templates t
   where t.org_id = target_org and t.kind = p_kind and t.active
     -- Starting the same checklist twice should not duplicate every task.
     and not exists (
       select 1 from public.employee_tasks x
        where x.employee_id = p_employee and x.kind = p_kind and x.title = t.title
     );
  get diagnostics made = row_count;
  return made;
end;
$$;

grant execute on function public.start_checklist(uuid, public.checklist_kind, date) to authenticated;

/*
 * A leaver cannot be archived while a blocking task is open.
 *
 * This is the point of the offboarding half. An account still live a month
 * after somebody left is a way in nobody is watching, and "we meant to" is
 * not a control. Enforced here so it holds however the status is changed.
 */
create or replace function public.enforce_offboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare outstanding text[];
begin
  if new.employment_status <> 'ARCHIVED'
     or old.employment_status = 'ARCHIVED' then
    return new;
  end if;

  select array_agg(t.title order by t.sort_order) into outstanding
    from public.employee_tasks t
   where t.employee_id = new.id
     and t.kind = 'OFFBOARDING'
     and t.blocks_completion
     and t.completed_at is null;

  if outstanding is not null and array_length(outstanding, 1) > 0 then
    raise exception 'cannot archive % %: % still open',
      new.first_name, new.last_name, array_to_string(outstanding, ', ')
      using hint = 'Access and equipment must be dealt with before archiving.';
  end if;
  return new;
end;
$$;

create trigger employees_enforce_offboarding
  before update on employees
  for each row execute function public.enforce_offboarding();

/** Open tasks, most overdue first — the chase list. */
create or replace view employee_task_board as
  select
    t.id, t.org_id, t.employee_id, t.kind, t.category, t.title, t.detail,
    t.due_on, t.blocks_completion, t.sort_order,
    e.first_name || ' ' || e.last_name as employee_name,
    e.employment_status,
    (t.due_on - current_date) as days_until_due
  from public.employee_tasks t
  join public.employees e on e.id = t.employee_id
  where t.completed_at is null
    and t.org_id in (select public.auth_org_ids());

grant select on employee_task_board to authenticated;

do $$
declare t text;
begin
  foreach t in array array['checklist_templates','employee_tasks','employee_exits']
  loop
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
    execute format(
      'create policy %1$s_delete on %1$I for delete to authenticated
         using (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

create trigger checklist_templates_set_org before insert on checklist_templates
  for each row execute function public.set_org_id();
create trigger employee_tasks_set_org before insert on employee_tasks
  for each row execute function public.set_org_id();

create or replace function public.set_exit_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select e.org_id into parent_org from public.employees e where e.id = new.employee_id;
  if parent_org is null then raise exception 'employee not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger employee_exits_set_org before insert on employee_exits
  for each row execute function public.set_exit_org_id();

-- ── A starting checklist ────────────────────────────────────────────────────
-- What a hospitality venue under EU rules actually has to do. Editable: every
-- venue's list differs, and this is a starting point rather than an answer.

insert into checklist_templates
  (org_id, kind, category, title, detail, due_offset_days, blocks_completion, sort_order)
select o.id, t.kind::checklist_kind, t.cat::task_category, t.title, t.detail,
       t.offs, t.blocks, t.ord
from organizations o
cross join (values
  ('ONBOARDING','PAPERWORK','Signed contract returned',null,-7,false,10),
  ('ONBOARDING','PAPERWORK','Right to work checked and recorded','Must be seen before the first shift.',-1,false,20),
  ('ONBOARDING','DATA','Bank and tax details collected','Restricted data — enter under the private section.',-1,false,30),
  ('ONBOARDING','DATA','Emergency contact recorded',null,0,false,40),
  ('ONBOARDING','TRAINING','Food safety induction completed','Required under Regulation 852/2004 Annex II Chapter XII.',3,false,50),
  ('ONBOARDING','TRAINING','Allergen training completed','Required before working any station handling allergens.',7,false,60),
  ('ONBOARDING','ACCESS','System access granted',null,0,false,70),
  ('ONBOARDING','EQUIPMENT','Uniform and locker issued',null,0,false,80),
  ('ONBOARDING','PAPERWORK','Probation review booked',null,60,false,90),
  ('OFFBOARDING','ACCESS','System access revoked','A live account after someone leaves is a way in nobody watches.',0,true,10),
  ('OFFBOARDING','ACCESS','Keys and door codes returned or changed',null,0,true,20),
  ('OFFBOARDING','EQUIPMENT','Uniform and equipment returned',null,0,false,30),
  ('OFFBOARDING','HANDOVER','Handover completed',null,-1,false,40),
  ('OFFBOARDING','FINAL','Exit interview held',null,0,false,50),
  ('OFFBOARDING','FINAL','Final pay instructed to the payroll provider','Recorded here; calculated there.',3,false,60),
  ('OFFBOARDING','FINAL','Outstanding leave balance settled',null,3,false,70)
) as t(kind,cat,title,detail,offs,blocks,ord)
on conflict do nothing;

comment on table employee_tasks is
  'A person''s copy of a checklist. Copied from the template so later edits do not rewrite history.';
comment on function public.enforce_offboarding() is
  'A leaver cannot be archived while a blocking offboarding task is open.';
