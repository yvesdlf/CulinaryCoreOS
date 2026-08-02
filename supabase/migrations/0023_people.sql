-- ---------------------------------------------------------------------------
-- People — employees, org structure, leave, certifications
-- ---------------------------------------------------------------------------
-- The HR brief is emphatic about one thing before any feature: an employee
-- record is not an ordinary row. It holds data that is restricted by law, and
-- a "single employee profile" that everybody can read is the failure mode, not
-- the goal.
--
-- So this migration takes three positions and enforces them in the database:
--
--   Restricted data is separated, not just labelled. Bank details, national
--   identifiers, pay and dates of birth live in their own table with their own
--   policy, so a manager reading a roster cannot reach them by widening a
--   select. A column marked "confidential" in a comment is not a control.
--
--   Self-approval is refused. Nobody approves their own leave, whatever their
--   role. The purchasing module already proved the pattern and it matters more
--   here, where the person approving is often the person's own manager and
--   sometimes the person themself.
--
--   Payroll is not calculated here. The brief is explicit that payroll tax,
--   statutory filing and payment belong to a specialist provider. What this
--   holds is what the venue owns: who works here, when they work, what they
--   are qualified to do, and what leave they have taken.
-- ---------------------------------------------------------------------------

create type employment_status as enum (
  'APPLICANT', 'OFFER', 'PROBATION', 'ACTIVE',
  'SUSPENDED', 'NOTICE', 'RESIGNED', 'TERMINATED', 'ARCHIVED'
);

create type employment_type as enum (
  'FULL_TIME', 'PART_TIME', 'CASUAL', 'FIXED_TERM', 'CONTRACTOR', 'INTERN'
);

-- ── Organisation structure ──────────────────────────────────────────────────

create table if not exists departments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  -- Where this department's labour is charged. Reuses the purchasing cost
  -- centres rather than inventing a second hierarchy.
  cost_centre_id uuid references cost_centres(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_departments_code
  on departments(org_id, lower(code));

create table if not exists job_roles (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  department_id uuid references departments(id) on delete set null,
  -- 1 is the most junior. Used for reporting lines and progression, not pay.
  level integer not null default 1,
  -- What somebody must hold to work this role. Checked before scheduling.
  required_certifications text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_job_roles_title
  on job_roles(org_id, lower(title));

-- ── Employees ───────────────────────────────────────────────────────────────

create table if not exists employees (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Deliberately nullable. An employee may have no login — most kitchen staff
  -- will not — and a login may exist without being an employee. The brief
  -- calls these different entities and they are.
  user_id uuid,

  employee_number text not null,
  first_name text not null,
  last_name text not null,
  -- Work contact only. Personal contact details are restricted; see below.
  work_email text,
  work_phone text,

  department_id uuid references departments(id) on delete set null,
  job_role_id uuid references job_roles(id) on delete set null,
  manager_id uuid references employees(id) on delete set null,

  employment_status employment_status not null default 'ACTIVE',
  employment_type employment_type not null default 'FULL_TIME',
  started_on date,
  probation_ends_on date,
  ended_on date,

  -- Contracted hours a week, for overtime and leave accrual.
  contracted_hours_per_week numeric(6,2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create unique index if not exists idx_employees_number
  on employees(org_id, lower(employee_number));
create index if not exists idx_employees_manager on employees(manager_id);
create index if not exists idx_employees_status on employees(org_id, employment_status);

/*
 * Restricted personal data, in its own table.
 *
 * Separation rather than a column comment. A manager reading a roster joins
 * `employees`; nothing they can write reaches this table, because the policy
 * on it is narrower. Bank and tax identifiers are the fields that turn an HR
 * leak into a fraud, so they are the ones kept furthest away.
 */
create table if not exists employee_private (
  employee_id uuid primary key references employees(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,

  date_of_birth date,
  personal_email text,
  personal_phone text,
  home_address text,
  national_id text,
  tax_id text,
  bank_account text,
  emergency_contact_name text,
  emergency_contact_phone text,

  updated_at timestamptz not null default now()
);

-- ── Certifications ──────────────────────────────────────────────────────────
-- Food-safety and allergen training is a legal requirement under Regulation
-- 852/2004 Annex II Chapter XII, and an expired certificate is exactly as much
-- of a problem as an expired ingredient.

create table if not exists employee_certifications (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  kind text not null,          -- FOOD_SAFETY_L2, ALLERGEN, HACCP, FIRST_AID...
  reference text,
  issued_on date,
  expires_on date,
  document_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_certifications_expiry
  on employee_certifications(org_id, expires_on);

-- ── Leave ───────────────────────────────────────────────────────────────────

create type leave_status as enum (
  'DRAFT', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'TAKEN'
);

create table if not exists leave_types (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  paid boolean not null default true,
  -- Days accrued a year for a full-time employee; pro-rated by contract.
  annual_entitlement_days numeric(6,2),
  -- How many unused days may cross into the next year. Null means no limit.
  max_carryover_days numeric(6,2),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_leave_types_code
  on leave_types(org_id, lower(code));

create table if not exists leave_requests (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete restrict,

  starts_on date not null,
  ends_on date not null,
  -- Held rather than derived, because a half day and a public holiday in the
  -- middle both change the answer and both are decided when it is requested.
  days numeric(6,2) not null,
  note text,

  status leave_status not null default 'REQUESTED',
  requested_by uuid,
  requested_by_email text,
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leave_requests_dates check (ends_on >= starts_on),
  constraint leave_requests_days check (days > 0)
);

create index if not exists idx_leave_requests_employee
  on leave_requests(employee_id, starts_on);
create index if not exists idx_leave_requests_status
  on leave_requests(org_id, status, starts_on);

/*
 * Nobody approves their own leave.
 *
 * The purchasing module proved the pattern; it matters more here, because the
 * approver is often the person's own manager and occasionally the person
 * themself. Enforced by trigger so it holds regardless of which screen or
 * script is asking.
 */
create or replace function public.enforce_leave_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email text;
  subject_user uuid;
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;
  if new.decided_by is null and new.decided_by_email is null then
    raise exception 'a leave decision must record who made it';
  end if;

  select e.user_id into subject_user from public.employees e where e.id = new.employee_id;
  select new.requested_by_email into requester_email;

  if (subject_user is not null and new.decided_by is not null and subject_user = new.decided_by)
     or (requester_email is not null and new.decided_by_email is not null
         and lower(requester_email) = lower(new.decided_by_email))
  then
    raise exception 'leave cannot be approved by the person who requested it'
      using hint = 'Segregation of duties: ask a manager to decide.';
  end if;

  if new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger leave_requests_enforce_approval
  before insert or update on leave_requests
  for each row execute function public.enforce_leave_approval();

-- ── Tenancy and access ──────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['departments','job_roles','employees','employee_certifications',
                           'leave_types','leave_requests']
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
    execute format(
      'create policy %1$s_delete on %1$I for delete to authenticated
         using (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

create or replace function public.set_employee_private_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  select e.org_id into parent_org from public.employees e where e.id = new.employee_id;
  if parent_org is null then
    raise exception 'employee not found';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger employee_private_set_org before insert on employee_private
  for each row execute function public.set_employee_private_org_id();

alter table employee_private enable row level security;

/*
 * Restricted data: readable only by OWNER and ADMIN, or by the person it
 * describes.
 *
 * This is narrower than every other policy in the system on purpose. A CHEF
 * with write access to recipes and stock has no business reading a colleague's
 * bank account, and the ordinary org-wide read policy would have let them.
 */
create policy employee_private_read on employee_private
  for select to authenticated
  using (
    org_id in (select public.auth_org_ids())
    and (
      exists (
        select 1 from public.organization_members m
         where m.organization_id = employee_private.org_id
           and m.user_id = auth.uid()
           and m.role in ('OWNER', 'ADMIN')
      )
      or exists (
        select 1 from public.employees e
         where e.id = employee_private.employee_id
           and e.user_id = auth.uid()
      )
    )
  );

create policy employee_private_write on employee_private
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = employee_private.org_id
         and m.user_id = auth.uid()
         and m.role in ('OWNER', 'ADMIN')
    )
  );

create policy employee_private_update on employee_private
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = employee_private.org_id
         and m.user_id = auth.uid()
         and m.role in ('OWNER', 'ADMIN')
    )
  );

grant select, insert, update on employee_private to authenticated;
-- No delete: an employment record is retained for a statutory period, and
-- removing the personal part of it is a data-retention decision with its own
-- process, not a button.

comment on table employee_private is
  'Restricted personal data. Separate table with a narrower policy than employees.';
comment on table employees is
  'Workforce profile. May exist without a login, and a login may exist without being an employee.';

-- ── Starting data ───────────────────────────────────────────────────────────

insert into departments (org_id, code, name, cost_centre_id)
select o.id, d.code, d.name, c.id
from organizations o
cross join (values ('KITCHEN','Kitchen'), ('BAR','Bar'), ('SERVICE','Service'), ('ADMIN','Administration')) as d(code,name)
left join cost_centres c on c.org_id = o.id and c.code = d.code
on conflict do nothing;

insert into leave_types (org_id, code, name, paid, annual_entitlement_days, max_carryover_days)
select o.id, t.code, t.name, t.paid, t.days, t.carry
from organizations o
cross join (values
  ('ANNUAL','Annual leave',true,20,5),
  ('SICK','Sick leave',true,null,null),
  ('UNPAID','Unpaid leave',false,null,null),
  ('PARENTAL','Parental leave',true,null,null),
  ('LIEU','Time off in lieu',true,null,null)
) as t(code,name,paid,days,carry)
on conflict do nothing;
