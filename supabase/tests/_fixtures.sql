-- ---------------------------------------------------------------------------
-- A known venue, for every test to work against
-- ---------------------------------------------------------------------------
-- Created with no session, so the section guards stand down — `auth.uid()` is
-- null, which the guard reads as a migration or an administrator at the
-- console. The tests then sign in as somebody and find the guards waiting.
--
-- Every insert goes through t.fixture(), which isolates it. A fixture that
-- fails on an enum value used to abort the whole run and leave a screenful of
-- assertions reporting success without having executed.
-- ---------------------------------------------------------------------------

/*
 * Re-runnable, and tidy afterwards.
 *
 * The same cleanup runs here and again from `run.sh` when the last file is
 * done — see `_teardown.sql` for why the second one matters.
 */
\ir _teardown.sql

select coalesce(string_agg(f, E'\n'), '') as fixture_problems from (
  select t.fixture($$
    insert into auth.users (id, email, instance_id, aud, role) values
      ('a0000000-0000-0000-0000-000000000001','owner@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
      ('a0000000-0000-0000-0000-000000000002','chef@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
      ('a0000000-0000-0000-0000-000000000003','nobody@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
      ('a0000000-0000-0000-0000-000000000004','staff@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated')
  $$) as f
  -- Repointed, not inserted: the sign-up trigger has already made each of
  -- them the owner of an organisation of their own.
  union all select t.fixture($$
    delete from organization_members where user_id::text like 'a0000000-%' $$)
  union all select t.fixture($$
    insert into organization_members (organization_id, user_id, role)
    select (select id from organizations where name = 'Demo Kitchen' limit 1), u, r::org_role
      from (values ('a0000000-0000-0000-0000-000000000001'::uuid,'OWNER'),
                   ('a0000000-0000-0000-0000-000000000002'::uuid,'CHEF'),
                   ('a0000000-0000-0000-0000-000000000003'::uuid,'CHEF'),
                   ('a0000000-0000-0000-0000-000000000004'::uuid,'CHEF')) as x(u,r) $$)
  /*
   * nobody@ and staff@ are granted nothing; chef@ is granted everything.
   *
   * staff@ matters: joining an organisation seeds a CHEF with WRITE on every
   * section, so a portal user left at the default is quietly an HR manager.
   * A room attendant has no section access at all — everything they can do
   * comes from the self-service policies, which is exactly what the
   * self-service tests need to be testing.
   */
  union all select t.fixture($$
    insert into member_access (org_id, user_id, section_code, level)
    select (select id from organizations where name='Demo Kitchen' limit 1),
           u, code, 'NONE'
      from app_sections,
           (values ('a0000000-0000-0000-0000-000000000003'::uuid),
                   ('a0000000-0000-0000-0000-000000000004'::uuid)) as x(u)
    on conflict (org_id, user_id, section_code) where business_unit_id is null
      do update set level='NONE' $$)
  union all select t.fixture($$
    insert into member_access (org_id, user_id, section_code, level)
    select (select id from organizations where name='Demo Kitchen' limit 1),
           'a0000000-0000-0000-0000-000000000002', code, 'WRITE' from app_sections
    on conflict (org_id, user_id, section_code) where business_unit_id is null
      do update set level='WRITE' $$)

  union all select t.fixture($$
    insert into departments (org_id, code, name)
    select id,'T-ENG','Test engineering' from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into job_roles (org_id, title, required_certifications)
    select id,'Test electrician', array['ELECTRICAL'] from organizations where name='Demo Kitchen' limit 1 $$)

  -- Four people: certified, uncertified, on leave, and an attendant.
  union all select t.fixture($$
    insert into employees (org_id, user_id, employee_number, first_name, last_name,
                           work_email, employment_status)
    select o.id, u, n, f, l, e, 'ACTIVE'
      from organizations o
      cross join (values (null::uuid,'T-1','Certified','Technician','cert@test.local'),
              (null::uuid,'T-2','Uncertified','Technician','uncert@test.local'),
              (null::uuid,'T-3','OnLeave','Technician','onleave@test.local'),
              (null::uuid,'T-4','Room','Attendant','attendant@test.local'),
              ('a0000000-0000-0000-0000-000000000004'::uuid,'T-5','Self','Service','staff@test.local')
      ) as x(u,n,f,l,e)
     where o.name='Demo Kitchen' $$)
  union all select t.fixture($$
    insert into employee_certifications (org_id, employee_id, kind, expires_on)
    select (select id from organizations where name='Demo Kitchen' limit 1), e.id, 'ELECTRICAL', current_date + 365
      from employees e where e.employee_number='T-1' $$)

  -- Rostered today: the technician and the attendant. 420 working minutes.
  union all select t.fixture($$
    insert into shifts (org_id, employee_id, starts_at, ends_at, break_minutes, status)
    select (select id from organizations where name='Demo Kitchen' limit 1), e.id,
           (current_date + time '08:00') at time zone 'UTC',
           (current_date + time '16:00') at time zone 'UTC', 60, 'PUBLISHED'
      from employees e where e.employee_number in ('T-1','T-4') $$)
  -- Rostered in three days, then given leave for that day: the only order in
  -- which "rostered and on leave" can exist, because the rota refuses the other.
  union all select t.fixture($$
    insert into shifts (org_id, employee_id, starts_at, ends_at, break_minutes, status)
    select (select id from organizations where name='Demo Kitchen' limit 1), e.id,
           (current_date + 3 + time '08:00') at time zone 'UTC',
           (current_date + 3 + time '16:00') at time zone 'UTC', 60, 'PUBLISHED'
      from employees e where e.employee_number='T-3' $$)
  union all select t.fixture($$
    insert into leave_requests (org_id, employee_id, leave_type_id, starts_on, ends_on,
                                status, days, decided_by_email)
    select (select id from organizations where name='Demo Kitchen' limit 1), e.id,
           (select id from leave_types where org_id=e.org_id limit 1),
           current_date + 3, current_date + 4, 'APPROVED', 2, 'hr@test.local'
      from employees e where e.employee_number='T-3' $$)

  union all select t.fixture($$
    insert into locations (org_id, code, name, kind, cost_centre_id)
    select id,'T-PLANT','Test plant room','PLANT',
           (select id from cost_centres where org_id=organizations.id and code='KITCHEN')
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into locations (org_id, code, name, kind)
    select id,'T-R900','Test room 900','GUEST_ROOM' from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into assets (org_id, code, name, category, location_id, criticality,
                        required_certifications, purchase_cost)
    select id,'T-CH','Test chiller','HVAC',
           (select id from locations where org_id=organizations.id and code='T-PLANT'),
           'CRITICAL', array['ELECTRICAL'], 100000000 from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into maintenance_plans (org_id, asset_id, code, title, interval_days,
                                   estimated_minutes, statutory, required_certifications)
    select id,(select id from assets where org_id=organizations.id and code='T-CH'),
           'T-PM','Test statutory service',90,240,true,array['ELECTRICAL']
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into meters (org_id, code, name, unit, cumulative, cost_per_unit)
    select id,'T-ELEC','Test meter','KWH',true,1650 from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into rooms (org_id, location_id, room_type_id, room_number, state, occupancy)
    select id,(select id from locations where org_id=organizations.id and code='T-R900'),
           (select id from room_types where org_id=organizations.id and code='VILLA'),
           '900','DIRTY','DEPARTURE' from organizations where name='Demo Kitchen' limit 1 $$)
  -- Rows for the tables whose rules would otherwise be tested against
  -- nothing. An UPDATE matching zero rows raises nothing, and reads as a pass.
  union all select t.fixture($$
    insert into work_orders (org_id, title, asset_id, location_id, cost_centre_id,
                             priority, source, plan_id, raised_by_email, due_by)
    select id,'T-job',(select id from assets where code='T-CH'),
           (select id from locations where code='T-PLANT'),
           (select id from cost_centres where org_id=organizations.id and code='KITCHEN'),
           'HIGH','PLANNED',(select id from maintenance_plans where code='T-PM'),
           'reporter@test.local', current_date + 3
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into department_approvers (org_id, department_id, approver_email)
    select id,(select id from departments where code='T-ENG'),'boss@test.local'
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into checklist_templates (org_id, kind, category, title)
    select id,'ONBOARDING','PAPERWORK','T-checklist'
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into training_courses (org_id, code, title)
    select id,'T-COURSE','Test course'
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into quiz_questions (org_id, course_id, prompt, options, correct_index)
    select id,(select id from training_courses where code='T-COURSE'),
           'T-question', array['a','b'], 1
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into observation_checklists (org_id, employee_id, course_id,
                                        observer_email, overall_met)
    select id,(select id from employees where employee_number='T-1'),
           (select id from training_courses where code='T-COURSE'),
           'boss@test.local', false
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into employee_exits (employee_id, org_id, reason, last_working_day)
    select (select id from employees where employee_number='T-2'), id,
           'RESIGNED', current_date + 30
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into organization_invitations (organization_id, email, role, invited_by_email)
    select id,'invitee@test.local','CHEF','owner@test.local'
      from organizations where name='Demo Kitchen' limit 1 $$)

  /*
   * Production: three ingredients, two preparations and a lot.
   *
   * Its own catalogue rather than the seeded one. `seed.sql` is demo data and
   * AGENTS.md says demo data is never required for correctness, so a control
   * test that asserts "200 g of flour" against a seeded recipe somebody edits
   * next month is a test that goes red for the wrong reason.
   *
   * Three ingredients because the variance report has three different things
   * to say: T-flour appears on both sides, T-salt on the recipe side only, and
   * T-oil in the ledger only.
   */
  union all select t.fixture($$
    insert into products (org_id, category, name, pack_unit, units_per_pack,
                          total_qty, total_unit, gross_price_per_unit, par_level)
    select o.id, 'Dry Goods', x.n, 'bag', 1000, 1000, x.u, x.price, 500
      from organizations o
      cross join (values ('T-flour','g',10),('T-salt','g',4),('T-oil','ml',20)) as x(n,u,price)
     where o.name='Demo Kitchen' $$)
  union all select t.fixture($$
    insert into sub_recipes (org_id, name, batch_yield_qty, batch_yield_unit)
    select id,'T-prep',1000,'g' from organizations where name='Demo Kitchen' limit 1 $$)
  -- A preparation nobody gave a yield. Recording a batch of it is refused,
  -- because there is no quantity it made and nothing to derive usage from.
  union all select t.fixture($$
    insert into sub_recipes (org_id, name)
    select id,'T-prep-no-yield' from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into sub_recipe_lines (sub_recipe_id, line_number, product_id,
                                  nett_qty, nett_unit, ref_percent, gross_qty, gross_unit)
    select (select id from sub_recipes where name='T-prep'), x.n,
           (select id from products where name=x.p), x.q, x.u, 0, x.q, x.u
      from (values (1,'T-flour',100,'g'),(2,'T-salt',5,'g')) as x(n,p,q,u) $$)
  union all select t.fixture($$
    insert into recipes (org_id, name) select id,'T-dish'
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into production_plans (org_id, planned_for, service, note, created_by_email)
    select id, current_date, 'DINNER', 'T-plan', 'chef@test.local'
      from organizations where name='Demo Kitchen' limit 1 $$)
  union all select t.fixture($$
    insert into production_plan_lines (plan_id, recipe_id, covers)
    select (select id from production_plans where note='T-plan'),
           (select id from recipes where name='T-dish'), 20 $$)
  union all select t.fixture($$
    insert into stock_lots (org_id, product_id, lot_code, received_on)
    select o.id,(select id from products where name='T-flour'),'T-LOT',current_date
      from organizations o where o.name='Demo Kitchen' $$)
  -- Something on the shelf to consume. A usage movement against an empty
  -- product would still be accepted, but a ledger that goes negative makes
  -- every later figure read as a bug rather than as the test's doing.
  union all select t.fixture($$
    insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost, reason, lot_id)
    select o.id,(select id from products where name='T-flour'),'RECEIPT',5000,'g',10,'T-opening',
           (select id from stock_lots where lot_code='T-LOT')
      from organizations o where o.name='Demo Kitchen' $$)
) x where f is not null;
