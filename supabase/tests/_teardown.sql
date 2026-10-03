-- ---------------------------------------------------------------------------
-- Put the venue back the way the suite found it
-- ---------------------------------------------------------------------------
-- Run twice: by `_fixtures.sql` before it builds anything, so the suite can be
-- run twice on a laptop, and by `run.sh` after the last assertion, so it is.
--
-- The second one is why this is a file of its own. Fixtures persist for the
-- length of a run by design — each numbered file rolls back its own work, but
-- the venue the files share has to outlive them. What nobody had noticed is
-- that it also outlived the *run*: a `T-dish` recipe, a `T-prep` preparation
-- and a `T-flour` product sat in the seeded venue afterwards, and the next
-- thing to look at that database saw six recipes where the baseline said five.
--
-- Found by seven desktop visual tests going red on a branch that changed no
-- component and no stylesheet. The screenshots were right and the database was
-- dirty — which is the more dangerous way round, because the suite that dirtied
-- it reported 254 checks all passing on its way out.
--
-- Everything the fixtures create is prefixed T- or belongs to a test user.
-- Deleted in dependency order, child rows first.
-- ---------------------------------------------------------------------------

-- Production, before the catalogue rows it hangs off.
delete from stock_movements where product_id in (select id from products where name like 'T-%');
delete from stock_lots where lot_code = 'T-LOT';
delete from production_records where sub_recipe_id in (select id from sub_recipes where name like 'T-%');
delete from production_plans where note = 'T-plan';
delete from sub_recipe_lines where sub_recipe_id in (select id from sub_recipes where name like 'T-%');
delete from sub_recipes where name like 'T-%';
delete from recipe_lines where recipe_id in (select id from recipes where name like 'T-%');
delete from recipes where name like 'T-%';
delete from products where name like 'T-%';
delete from meter_readings where meter_id in (select id from meters where code='T-ELEC');
delete from housekeeping_inspections where task_id in (
  select id from housekeeping_tasks where room_id in (select id from rooms where room_number='900'));
delete from housekeeping_tasks where room_id in (select id from rooms where room_number='900');
delete from work_orders where title like 'T-%' or plan_id in (select id from maintenance_plans where code='T-PM');
delete from rooms where room_number='900';
delete from maintenance_plans where code='T-PM';
delete from meters where code='T-ELEC';
delete from assets where code='T-CH';
delete from locations where code in ('T-PLANT','T-R900');
delete from leave_requests where employee_id in (select id from employees where employee_number like 'T-%');
delete from shifts where employee_id in (select id from employees where employee_number like 'T-%');
delete from employee_certifications where employee_id in (select id from employees where employee_number like 'T-%');
delete from employees where employee_number like 'T-%';
delete from observation_checklists where course_id in (select id from training_courses where code='T-COURSE');
delete from quiz_questions where course_id in (select id from training_courses where code='T-COURSE');
delete from training_courses where code='T-COURSE';
delete from checklist_templates where title='T-checklist';
delete from department_approvers where department_id in (select id from departments where code='T-ENG');
delete from employee_exits where employee_id in (select id from employees where employee_number like 'T-%');
delete from organization_invitations where email='invitee@test.local';
delete from job_roles where title='Test electrician';
delete from departments where code='T-ENG';
delete from member_access where user_id::text like 'a0000000-%';
delete from organization_members where user_id::text like 'a0000000-%';
delete from auth.users where id::text like 'a0000000-%';
-- `on_auth_user_created` gives every new sign-up an organisation of its own.
-- The test users therefore arrive in four separate tenants, which is correct
-- behaviour and useless here, so the invented ones are removed and the
-- membership is repointed at the venue that holds the data.
delete from organizations where name in ('owner','chef','nobody','staff');
