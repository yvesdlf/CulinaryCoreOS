-- ---------------------------------------------------------------------------
-- The section grid (0036, 0045, 0057)
-- ---------------------------------------------------------------------------
-- A section is the outer gate on every write worth arguing about. These are
-- the tables migration 0057 found outside it — four of which, when the audit
-- ran, could be written by somebody granted nothing at all, with consequences
-- ranging from rewriting an exam answer to blanking the certification list
-- that the rota and work-order assignment both read.
-- ---------------------------------------------------------------------------
begin;
select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');

select '── access: a user granted nothing ────────────────────────────────';
select t.expect_value($$select public.auth_section_level('PEOPLE')::text$$,
  'is NONE on People, not some default', 'NONE');

select t.expect_fail($$update products set name=name where true$$,
  'cannot edit products (Recipes)');
select t.expect_fail($$update work_orders set title='hacked' where title='T-job'$$,
  'cannot edit work orders (Maintenance)');
select t.expect_fail($$update rooms set state='CLEAN' where room_number='900'$$,
  'cannot edit rooms (Housekeeping)');

select '── access: the tables the grid used to miss ─────────────────────';
select t.expect_fail($$update job_roles set required_certifications='{}' where title='Test electrician'$$,
  'cannot blank the certification list the rota reads');
select t.expect_value($$select array_to_string(required_certifications,',') from job_roles where title='Test electrician'$$,
  'and the list is still there afterwards', 'ELECTRICAL');
select t.expect_fail($$update leave_types set annual_entitlement_days=99 where true$$,
  'cannot rewrite everybody''s leave entitlement');
select t.expect_fail($$update departments set name='x' where code='T-ENG'$$,
  'cannot rename a department');
select t.expect_fail($$update quiz_questions set correct_index=0 where prompt='T-question'$$,
  'cannot edit an exam answer');
select t.expect_value($$select correct_index::text from quiz_questions where prompt='T-question'$$,
  'and the answer is unchanged afterwards', '1');
select t.expect_fail($$update department_approvers set approver_email='nobody@test.local'
  where approver_email='boss@test.local'$$,
  'cannot appoint themselves an approver');
select t.expect_fail($$update organization_invitations set role='OWNER'
  where email='invitee@test.local'$$,
  'cannot upgrade an invitation');
select t.expect_fail($$update checklist_templates set title='x' where title='T-checklist'$$,
  'cannot edit the onboarding checklist');
select t.expect_fail($$update observation_checklists set overall_met=true
  where observer_email='boss@test.local'$$,
  'cannot mark a practical as passed');
select t.expect_fail($$update employee_exits set exit_notes='x'
  where employee_id=(select id from employees where employee_number='T-2')$$,
  'cannot edit an exit record');
-- No cheap fixture: a hiring request needs a department, a role and a
-- reference. The wiring is what goes missing, so the wiring is what is checked.
select t.expect_guarded('hiring_requests','PEOPLE');
select t.expect_guarded('message_deliveries','MESSAGING');
select t.expect_guarded('rfq_suppliers','PURCHASING');
select t.expect_guarded('collection_recipes','RECIPES');

select '── access: the ledgers do not move ──────────────────────────────';
select t.expect_value($$select has_table_privilege('authenticated','parameter_changes','UPDATE')::text$$,
  'nobody may edit the parameter audit trail', 'false');
select t.expect_value($$select has_table_privilege('authenticated','work_order_events','UPDATE')::text$$,
  'nobody may edit work order history', 'false');
select t.expect_value($$select has_table_privilege('authenticated','room_state_events','DELETE')::text$$,
  'nobody may delete room history', 'false');
select t.expect_value($$select has_table_privilege('authenticated','stock_movements','UPDATE')::text$$,
  'nobody may edit a stock movement', 'false');
select t.expect_value($$select has_table_privilege('authenticated','housekeeping_inspections','UPDATE')::text$$,
  'nobody may edit an inspection', 'false');
select t.expect_value($$select has_table_privilege('anon','products','SELECT')::text$$,
  'a signed-out visitor reads nothing', 'false');
select t.expect_value($$select has_table_privilege('authenticated','products','TRUNCATE')::text$$,
  'no TRUNCATE, which row-level security cannot filter', 'false');

select '── access: somebody granted everything can still work ───────────';
select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_rows($$update job_roles set level=level where title='Test electrician'$$,
  'a user with People access can edit a job role', 1);
rollback;
