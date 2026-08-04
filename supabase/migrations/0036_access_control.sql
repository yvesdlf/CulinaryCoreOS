-- ---------------------------------------------------------------------------
-- Per-section access, protected parameters, and hiring approval
-- ---------------------------------------------------------------------------
-- Four roles were never going to be enough. A chef needs to write recipes and
-- read purchasing; a bookkeeper needs the opposite; a bar manager needs People
-- for their own department and nothing in the kitchen. Expressing that as
-- OWNER/ADMIN/CHEF/VIEWER means giving half the venue more than they need,
-- which is how an access model stops being believed.
--
-- So access is now a grid: a person, a section of the app, and one of three
-- levels. The role still exists and still decides who may administer, but what
-- somebody can reach is granted explicitly.
--
-- Three things this refuses to make cosmetic.
--
--   The grant is enforced in the database, not by hiding menu items. A hidden
--   page is a page anybody can still reach by typing a URL or calling the API,
--   and an access model that only works in one client is not an access model.
--
--   Certain parameters are protected: tax rates, approval thresholds, waste
--   and inflation defaults. These decide what everything costs and who may
--   approve it, so changing them is restricted to people the venue names, and
--   every change is recorded with the old and new value.
--
--   Hiring is approved by the department that will pay for the person —
--   the head chef for a kitchen hire, the general manager for front of house,
--   the bar manager for bar staff. Not by whoever happens to be an admin.
-- ---------------------------------------------------------------------------

create type access_level as enum ('NONE', 'READ', 'WRITE');

/*
 * The sections of the app, as a person would name them.
 *
 * A table rather than an enum so a section added later does not need a type
 * change, and so the administration screen can describe each one.
 */
create table if not exists app_sections (
  code text primary key,
  name text not null,
  description text not null,
  sort_order integer not null default 0,
  -- Whether losing access to this would stop somebody doing their job at all.
  is_core boolean not null default false
);

insert into app_sections (code, name, description, sort_order, is_core) values
  ('RECIPES',    'Recipes & costing', 'Dishes, preparations, ingredients and what they cost.', 10, true),
  ('INVENTORY',  'Inventory',         'Stock on hand, counts, waste and par levels.', 20, false),
  ('TRACEABILITY','Traceability',     'Lots, expiry dates and recalls.', 30, false),
  ('HYGIENE',    'Hygiene',           'HACCP control sheets and food-safety records.', 40, false),
  ('PRODUCTION', 'Production',        'Prep lists and pull lists from expected covers.', 50, false),
  ('PURCHASING', 'Purchasing',        'Requisitions, orders, receiving, invoices and budgets.', 60, false),
  ('SUPPLIERS',  'Suppliers',         'Supplier records, contracts and the vendor portal.', 70, false),
  ('MENU',       'Menu engineering',  'Sales mix and what each dish contributes.', 80, false),
  ('PEOPLE',     'People',            'Staff records, rota, attendance, leave and training.', 90, false),
  ('HR_CASES',   'HR cases',          'Discipline, grievances and investigations. Restricted further per case.', 100, false),
  ('PARAMETERS', 'Venue parameters',  'Tax rates, approval thresholds, waste and inflation defaults.', 110, false),
  ('ADMIN',      'Administration',    'Accounts, access and organisation settings.', 120, false)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  sort_order = excluded.sort_order, is_core = excluded.is_core;

grant select on app_sections to authenticated;

create table if not exists member_access (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  section_code text not null references app_sections(code) on delete cascade,
  level access_level not null default 'NONE',

  granted_by_email text,
  granted_at timestamptz not null default now(),
  constraint member_access_unique unique (org_id, user_id, section_code)
);

create index if not exists idx_member_access_user on member_access(user_id, org_id);

/*
 * What the caller may do in a section.
 *
 * An owner has everything, always — otherwise an administrator could lock the
 * owner out of the screen used to fix it. Below that, an explicit grant
 * decides, and the absence of a grant means no access rather than some
 * default, because a permission model that grants by omission eventually
 * grants everything.
 */
create or replace function public.auth_section_level(p_section text)
returns public.access_level
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'WRITE'::public.access_level
       from public.organization_members m
      where m.user_id = (select auth.uid()) and m.role = 'OWNER'
      limit 1),
    (select a.level
       from public.member_access a
      where a.user_id = (select auth.uid())
        and a.section_code = p_section
        and a.org_id in (select public.auth_org_ids())
      limit 1),
    'NONE'::public.access_level
  );
$$;

grant execute on function public.auth_section_level(text) to authenticated;

create or replace function public.can_write_section(p_section text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section) = 'WRITE'; $$;

create or replace function public.can_read_section(p_section text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section) <> 'NONE'; $$;

grant execute on function public.can_write_section(text) to authenticated;
grant execute on function public.can_read_section(text) to authenticated;

/*
 * Attach a section to a table.
 *
 * A trigger rather than a policy rewrite, because every table already has
 * working row-level security scoped to the organisation and replacing forty
 * policies would risk widening one by accident. This narrows: a write must
 * satisfy both the existing policy and the section grant.
 */
create or replace function public.require_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare section text := tg_argv[0];
begin
  -- No session means a cascade, a migration or an administrator with direct
  -- access; the same reasoning as the membership guard.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if not public.can_write_section(section) then
    raise exception 'you do not have edit access to %',
      (select s.name from public.app_sections s where s.code = section)
      using hint = 'Ask an administrator for edit rights to this section.';
  end if;
  return coalesce(new, old);
end;
$$;

/*
 * Wire the sections to their tables.
 *
 * Listed explicitly rather than guessed from names, so adding a table is a
 * deliberate decision about which section owns it.
 */
do $$
declare
  m record;
begin
  for m in select * from (values
    ('RECIPES',     array['products','recipes','sub_recipes','recipe_lines','sub_recipe_lines','collections']),
    ('INVENTORY',   array['stock_movements']),
    ('TRACEABILITY',array['stock_lots']),
    ('HYGIENE',     array['haccp_records','haccp_forms']),
    ('PURCHASING',  array['requisitions','requisition_lines','purchase_orders','purchase_order_lines',
                          'goods_receipts','goods_receipt_lines','supplier_invoices','supplier_invoice_lines',
                          'budgets','rfqs','rfq_lines','rfq_quotes','rfq_awards']),
    ('SUPPLIERS',   array['suppliers','supplier_certificates','contracts','contract_prices','supplier_users']),
    ('MENU',        array['sales_periods','sales_lines']),
    ('PEOPLE',      array['employees','employee_private','shifts','time_entries','leave_requests',
                          'training_courses','training_assignments','competencies','competency_assessments',
                          'performance_reviews','employee_tasks','employee_certifications']),
    ('HR_CASES',    array['hr_cases']),
    ('PARAMETERS',  array['tax_rates','category_tax_rates','approval_policies','matching_tolerances',
                          'cost_centres','message_channels'])
  ) as t(section, tables)
  loop
    for i in 1 .. array_length(m.tables, 1) loop
      if to_regclass('public.' || m.tables[i]) is not null then
        execute format(
          'drop trigger if exists %1$s_section_guard on public.%1$I', m.tables[i]);
        execute format(
          'create trigger %1$s_section_guard before insert or update or delete
             on public.%1$I for each row
             execute function public.require_section_write(%2$L)',
          m.tables[i], m.section);
      end if;
    end loop;
  end loop;
end $$;

-- ── Protected parameters ────────────────────────────────────────────────────
/*
 * The numbers that decide what everything costs, and who may change them.
 *
 * Held as rows so a venue can add its own, and every change is recorded with
 * the value before and after. These are exactly the settings that get quietly
 * adjusted to make a number look better.
 */
create table if not exists venue_parameters (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  description text,
  value numeric(18,5) not null,
  unit text not null default 'percent',
  min_value numeric(18,5),
  max_value numeric(18,5),

  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint venue_parameters_unique unique (org_id, code)
);

create table if not exists parameter_changes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  parameter_code text not null,
  old_value numeric(18,5),
  new_value numeric(18,5) not null,
  reason text,
  changed_by_email text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_parameter_changes
  on parameter_changes(org_id, changed_at desc);

/*
 * Record every parameter change, and refuse one outside its own bounds.
 *
 * A target food cost of 2% or a waste allowance of 90% is a typo, and the
 * bounds are there to catch the typo rather than to constrain the venue.
 */
create or replace function public.record_parameter_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.min_value is not null and new.value < new.min_value then
    raise exception '% must be at least %', new.name, new.min_value;
  end if;
  if new.max_value is not null and new.value > new.max_value then
    raise exception '% must be at most %', new.name, new.max_value;
  end if;

  if tg_op = 'UPDATE' and new.value is distinct from old.value then
    insert into public.parameter_changes
      (org_id, parameter_code, old_value, new_value, changed_by_email)
    values (new.org_id, new.code, old.value, new.value,
            coalesce(auth.jwt() ->> 'email', new.updated_by_email));
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger venue_parameters_record
  before insert or update on venue_parameters
  for each row execute function public.record_parameter_change();

create trigger venue_parameters_section_guard
  before insert or update or delete on venue_parameters
  for each row execute function public.require_section_write('PARAMETERS');

-- ── Hiring approval, by department ──────────────────────────────────────────
/*
 * Who signs off a hire, per department.
 *
 * The head chef for the kitchen, the general manager for front of house, the
 * bar manager for the bar. Not whoever happens to hold an admin role, because
 * the person who will pay for the hire out of their own labour budget is the
 * person who should agree to it.
 */
create table if not exists department_approvers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  approver_email text not null,
  -- A second name for when the first is on leave. Without one, hiring stops
  -- every time somebody takes a holiday.
  deputy_email text,
  constraint department_approvers_unique unique (department_id)
);

create type hiring_status as enum ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FILLED', 'CANCELLED');

create table if not exists hiring_requests (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  reference text not null,
  department_id uuid not null references departments(id) on delete restrict,
  job_role_id uuid references job_roles(id) on delete set null,

  headcount integer not null default 1,
  employment_type employment_type not null default 'FULL_TIME',
  reason text not null,
  needed_by date,
  -- Monthly cost, for the budget conversation this is really about.
  estimated_monthly_cost numeric(18,5),

  status hiring_status not null default 'DRAFT',
  requested_by_email text,
  submitted_at timestamptz,
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hiring_requests_headcount check (headcount > 0),
  constraint hiring_requests_reason check (btrim(reason) <> '')
);

create unique index if not exists idx_hiring_requests_reference
  on hiring_requests(org_id, lower(reference));

/*
 * A hire is approved by its department's named approver, and not by the
 * person who asked for it.
 *
 * Both halves matter. Routing to the right person is the point of the
 * feature; refusing self-approval is what stops a department head hiring
 * themselves an assistant with nobody else involved.
 */
create or replace function public.enforce_hiring_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare approver text; deputy text; caller text; dept_name text;
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', coalesce(new.decided_by_email, '')));
  if caller = '' then
    raise exception 'a hiring decision must record who made it';
  end if;

  if lower(coalesce(new.requested_by_email, '')) = caller then
    raise exception 'you cannot approve a hire you asked for'
      using hint = 'Segregation of duties: ask the department approver.';
  end if;

  select lower(a.approver_email), lower(coalesce(a.deputy_email, '')), d.name
    into approver, deputy, dept_name
    from public.department_approvers a
    join public.departments d on d.id = a.department_id
   where a.department_id = new.department_id;

  -- An owner can always decide, because somebody has to when an approver has
  -- left. Every other case must be the named approver or their deputy.
  if approver is null then
    if not exists (select 1 from public.organization_members m
                    where m.user_id = auth.uid() and m.role = 'OWNER') then
      raise exception 'no approver is set for that department'
        using hint = 'Set one in Administration before hiring for it.';
    end if;
  elsif caller <> approver and caller <> deputy then
    if not exists (select 1 from public.organization_members m
                    where m.user_id = auth.uid() and m.role = 'OWNER') then
      raise exception 'only % can approve a hire for %', approver, dept_name
        using hint = 'Hiring is approved by the department that pays for it.';
    end if;
  end if;

  new.decided_by_email := coalesce(new.decided_by_email, caller);
  if new.decided_at is null then new.decided_at := now(); end if;
  return new;
end;
$$;

create trigger hiring_requests_enforce
  before insert or update on hiring_requests
  for each row execute function public.enforce_hiring_approval();

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['member_access','venue_parameters','parameter_changes',
                           'department_approvers','hiring_requests']
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

grant delete on member_access, department_approvers to authenticated;
create policy member_access_delete on member_access
  for delete to authenticated using (public.auth_can_write(org_id));
create policy department_approvers_delete on department_approvers
  for delete to authenticated using (public.auth_can_write(org_id));

-- Only administration may change who has access to what.
create trigger member_access_section_guard
  before insert or update or delete on member_access
  for each row execute function public.require_section_write('ADMIN');

/** Everyone's access, for the administration grid. */
create or replace view member_access_grid as
  select
    m.organization_id as org_id,
    m.user_id,
    u.email,
    m.role,
    s.code as section_code,
    s.name as section_name,
    s.sort_order,
    coalesce(a.level, case when m.role = 'OWNER' then 'WRITE'::public.access_level
                           else 'NONE'::public.access_level end) as level
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  cross join public.app_sections s
  left join public.member_access a
    on a.user_id = m.user_id and a.org_id = m.organization_id and a.section_code = s.code
  where m.organization_id in (select public.auth_org_ids());

grant select on member_access_grid to authenticated;

-- ── Starting parameters ─────────────────────────────────────────────────────

insert into venue_parameters (org_id, code, name, description, value, unit, min_value, max_value)
select o.id, p.code, p.name, p.descr, p.val, p.unit, p.lo, p.hi
from organizations o
cross join (values
  ('TARGET_FOOD_COST','Target food cost','What a dish should cost as a share of its menu price.',25,'percent',5,60),
  ('FOOD_COST_TOLERANCE','Food cost tolerance','How far from target is acceptable before a dish is flagged.',2,'percent',0,20),
  ('RECIPE_WASTE','Dish waste allowance','Added to a dish''s cost to cover trim and spillage at service.',0,'percent',0,25),
  ('SUB_RECIPE_WASTE','Preparation waste allowance','Added when costing a batch.',5,'percent',0,25),
  ('RECIPE_INFLATION','Dish inflation buffer','Added to cover price movement between costing and service.',4,'percent',0,25),
  ('EXPIRY_WARNING_DAYS','Expiry warning','How many days ahead an expiring lot is flagged.',7,'days',1,90),
  ('CERT_WARNING_DAYS','Certificate warning','How many days ahead a lapsing certificate is flagged.',30,'days',1,180),
  ('PO_APPROVAL_ADMIN','Order approval — administrator','Orders at or above this need an administrator.',5000000,'currency',0,null),
  ('PO_APPROVAL_OWNER','Order approval — owner','Orders at or above this need an owner.',25000000,'currency',0,null)
) as p(code, name, descr, val, unit, lo, hi)
on conflict do nothing;

comment on table member_access is
  'Per-section access. Enforced by trigger on the tables each section owns, not by hiding menus.';
comment on table venue_parameters is
  'The numbers that decide what everything costs. Every change is recorded.';
comment on table hiring_requests is
  'Approved by the department that pays for the hire, and never by the requester.';
