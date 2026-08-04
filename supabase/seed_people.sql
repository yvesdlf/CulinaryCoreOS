-- ---------------------------------------------------------------------------
-- People: departments, roles, staff, and who approves a hire
-- ---------------------------------------------------------------------------
-- Until now the HR tables were only ever populated by hand during testing, so
-- rebuilding the database left every People screen empty and the hiring
-- approval chain — the thing the whole department_approvers table exists for —
-- impossible to demonstrate.
--
-- The four departments and their approvers are the ones the brief names: the
-- executive chef signs for the kitchen, the general manager for front of
-- house, the bar manager for the bar, the head housekeeper for housekeeping.
-- Each has a deputy, because otherwise hiring stops whenever one person takes
-- a holiday.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  d_kitchen uuid; d_foh uuid; d_bar uuid; d_house uuid;
  r record;
begin
  select id into org from public.organizations order by created_at limit 1;
  if org is null then
    raise notice 'no organization; run seed.sql first';
    return;
  end if;

  -- ── Departments ───────────────────────────────────────────────────────────
  -- The codes migration 0040 already defines, so this seed extends the
  -- venue's departments rather than creating a second Kitchen beside them.
  insert into public.departments (org_id, code, name) values
    (org, 'KITCHEN', 'Kitchen'),
    (org, 'SERVICE', 'Front of House'),
    (org, 'BAR',     'Bar'),
    (org, 'HSK',     'Housekeeping')
  -- Matching idx_departments_code from 0023, which is on lower(code): an
  -- ON CONFLICT target has to name the index's expression, not the column.
  on conflict (org_id, lower(code)) do update set name = excluded.name;

  select id into d_kitchen from public.departments where org_id=org and code='KITCHEN';
  select id into d_foh     from public.departments where org_id=org and code='SERVICE';
  select id into d_bar     from public.departments where org_id=org and code='BAR';
  select id into d_house   from public.departments where org_id=org and code='HSK';

  -- ── Roles ─────────────────────────────────────────────────────────────────
  -- Anyone handling open food needs current food-safety and allergen training
  -- under Regulation 852/2004 Annex II Chapter XII. The rota trigger refuses a
  -- shift without it, so the requirement is declared here rather than assumed.
  insert into public.job_roles (org_id, title, department_id, level, required_certifications) values
    (org, 'Executive Chef',    d_kitchen, 5, array['FOOD_SAFETY_L3','ALLERGEN','HACCP']),
    (org, 'Sous Chef',         d_kitchen, 4, array['FOOD_SAFETY_L3','ALLERGEN']),
    (org, 'Chef de Partie',    d_kitchen, 3, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Commis Chef',       d_kitchen, 2, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Kitchen Porter',    d_kitchen, 1, array['FOOD_SAFETY_L2']),
    (org, 'General Manager',   d_foh,     5, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Restaurant Manager',d_foh,     4, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Waiter',            d_foh,     2, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Bar Manager',       d_bar,     4, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Bartender',         d_bar,     2, array['FOOD_SAFETY_L2','ALLERGEN']),
    (org, 'Head Housekeeper',  d_house,   4, array[]::text[]),
    (org, 'Room Attendant',    d_house,   1, array[]::text[])
  on conflict do nothing;

  -- ── Staff ─────────────────────────────────────────────────────────────────
  insert into public.employees
    (org_id, employee_number, first_name, last_name, work_email, department_id,
     job_role_id, employment_status, employment_type, started_on, contracted_hours_per_week)
  select org, v.num, v.first, v.last, v.email, v.dept,
         (select id from public.job_roles j where j.org_id=org and j.title=v.role),
         v.status::public.employment_status, v.etype::public.employment_type,
         v.started, v.hours
  from (values
    ('E-001','Nyoman','Wirawan','chef@manuza.test',      d_kitchen,'Executive Chef',    'ACTIVE',   'FULL_TIME', date '2023-02-01', 45),
    ('E-002','Kadek', 'Suartana','sous@manuza.test',     d_kitchen,'Sous Chef',         'ACTIVE',   'FULL_TIME', date '2023-06-15', 45),
    ('E-003','Budi',  'Santoso', 'budi@manuza.test',     d_kitchen,'Chef de Partie',    'ACTIVE',   'FULL_TIME', date '2024-03-04', 40),
    ('E-004','Wayan', 'Astini',  'wayan@manuza.test',    d_kitchen,'Commis Chef',       'PROBATION','FULL_TIME', date '2026-06-01', 40),
    ('E-005','Ketut', 'Merta',   'ketut@manuza.test',    d_kitchen,'Kitchen Porter',    'ACTIVE',   'PART_TIME', date '2024-09-12', 24),
    ('E-006','Sarah', 'Lindqvist','gm@manuza.test',      d_foh,    'General Manager',   'ACTIVE',   'FULL_TIME', date '2022-11-01', 45),
    ('E-007','Putu',  'Ardana',  'putu@manuza.test',     d_foh,    'Restaurant Manager','ACTIVE',   'FULL_TIME', date '2023-08-20', 45),
    ('E-008','Made',  'Sukerti', 'made@manuza.test',     d_foh,    'Waiter',            'ACTIVE',   'FULL_TIME', date '2025-01-15', 40),
    ('E-009','Gede',  'Pramana', 'barmgr@manuza.test',   d_bar,    'Bar Manager',       'ACTIVE',   'FULL_TIME', date '2023-04-03', 45),
    ('E-010','Komang','Yudha',   'komang@manuza.test',   d_bar,    'Bartender',         'ACTIVE',   'FULL_TIME', date '2025-05-19', 40),
    ('E-011','Luh',   'Sriati',  'housekeep@manuza.test',d_house,  'Head Housekeeper',  'ACTIVE',   'FULL_TIME', date '2023-01-09', 45),
    ('E-012','Ni',    'Kartini', 'kartini@manuza.test',  d_house,  'Room Attendant',    'ACTIVE',   'PART_TIME', date '2025-10-01', 30)
  ) as v(num, first, last, email, dept, role, status, etype, started, hours)
  on conflict do nothing;

  -- Reporting lines: each department head manages their own department.
  for r in select code, head from (values
      ('KITCHEN','E-001'), ('SERVICE','E-006'), ('BAR','E-009'), ('HSK','E-011')
    ) as t(code, head)
  loop
    update public.employees e
       set manager_id = (select m.id from public.employees m
                          where m.org_id=org and m.employee_number=r.head)
     where e.org_id = org
       and e.department_id = (select d.id from public.departments d
                               where d.org_id=org and d.code=r.code)
       and e.employee_number <> r.head
       and e.manager_id is null;
  end loop;

  -- ── Certificates ──────────────────────────────────────────────────────────
  -- Current for everyone whose role needs one, except Budi: his food-safety
  -- certificate lapsed, which is what makes the rota refuse to roster him and
  -- the training module worth opening.
  insert into public.employee_certifications
    (org_id, employee_id, kind, reference, issued_on, expires_on)
  select org, e.id, k.kind,
         'CERT-' || e.employee_number || '-' || k.kind,
         current_date - interval '10 months',
         case when e.employee_number = 'E-003' and k.kind like 'FOOD_SAFETY%'
              then current_date - interval '3 weeks'   -- lapsed
              else current_date + interval '14 months'
         end
  from public.employees e
  join public.job_roles j on j.id = e.job_role_id
  cross join lateral unnest(j.required_certifications) as k(kind)
  where e.org_id = org
  on conflict do nothing;

  -- ── Who approves a hire ───────────────────────────────────────────────────
  insert into public.department_approvers (org_id, department_id, approver_email, deputy_email) values
    (org, d_kitchen, 'chef@manuza.test',      'sous@manuza.test'),
    (org, d_foh,     'gm@manuza.test',        'putu@manuza.test'),
    (org, d_bar,     'barmgr@manuza.test',    'gm@manuza.test'),
    (org, d_house,   'housekeep@manuza.test', 'gm@manuza.test')
  on conflict (department_id) do update
    set approver_email = excluded.approver_email,
        deputy_email   = excluded.deputy_email;

  raise notice 'seeded % departments, % roles, % employees, % approvers',
    (select count(*) from public.departments where org_id=org),
    (select count(*) from public.job_roles where org_id=org),
    (select count(*) from public.employees where org_id=org),
    (select count(*) from public.department_approvers where org_id=org);
end $$;
