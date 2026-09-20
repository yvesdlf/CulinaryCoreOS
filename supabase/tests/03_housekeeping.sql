-- ---------------------------------------------------------------------------
-- Housekeeping (0056)
-- ---------------------------------------------------------------------------
-- The capacity rule is the one worth guarding hardest. A sheet nobody can
-- finish is the reason rooms get signed clean without being cleaned, and every
-- control after that assumes the room was actually cleaned.
-- ---------------------------------------------------------------------------
begin;
select '── housekeeping: who may be given a room ────────────────────────';

select t.expect_fail($$
  insert into housekeeping_tasks (org_id, room_id, kind, standard_minutes, assigned_to)
  select o.id,(select id from rooms where room_number='900'),'DEPARTURE',110,
         (select id from employees where employee_number='T-2')
    from organizations o where o.name='Demo Kitchen'$$,
  'somebody not rostered today cannot be given a room');

select t.expect_fail($$
  insert into housekeeping_tasks (org_id, room_id, kind, task_date, standard_minutes, assigned_to)
  select o.id,(select id from rooms where room_number='900'),'DEPARTURE', current_date+3, 110,
         (select id from employees where employee_number='T-3')
    from organizations o where o.name='Demo Kitchen'$$,
  'somebody rostered but on approved leave cannot be given a room');

select t.expect_ok($$
  insert into housekeeping_tasks (org_id, room_id, kind, standard_minutes, assigned_to)
  select o.id,(select id from rooms where room_number='900'),'DEPARTURE',110,
         (select id from employees where employee_number='T-4')
    from organizations o where o.name='Demo Kitchen'$$,
  'the rostered attendant can be, at 110 of 420 minutes');

-- 420 rostered minutes, 110 already used. A 400 minute job does not fit.
select t.expect_fail($$
  insert into housekeeping_tasks (org_id, location_id, kind, standard_minutes, assigned_to)
  select o.id,(select id from locations where code='T-PLANT'),'PUBLIC_AREA',400,
         (select id from employees where employee_number='T-4')
    from organizations o where o.name='Demo Kitchen'$$,
  'a sheet cannot exceed the attendant''s rostered minutes');

select '── housekeeping: inspecting ─────────────────────────────────────';
select t.expect_ok($$
  update housekeeping_tasks set status='DONE', finished_at=now(), actual_minutes=115
   where room_id=(select id from rooms where room_number='900')$$,
  'the attendant marks the room done');

select t.expect_fail($$
  insert into housekeeping_inspections (org_id, task_id, inspector_email, passed, score)
  select o.id,(select id from housekeeping_tasks
                where room_id=(select id from rooms where room_number='900')),
         'attendant@test.local', true, 95
    from organizations o where o.name='Demo Kitchen'$$,
  'the attendant cannot inspect the room they cleaned');

select t.expect_fail($$
  insert into housekeeping_inspections (org_id, task_id, inspector_email, passed, findings)
  select o.id,(select id from housekeeping_tasks
                where room_id=(select id from rooms where room_number='900')),
         'supervisor@test.local', false, null
    from organizations o where o.name='Demo Kitchen'$$,
  'a failed inspection must say what is wrong');

select t.expect_ok($$
  insert into housekeeping_inspections (org_id, task_id, inspector_email, passed, score)
  select o.id,(select id from housekeeping_tasks
                where room_id=(select id from rooms where room_number='900')),
         'supervisor@test.local', true, 95
    from organizations o where o.name='Demo Kitchen'$$,
  'a supervisor can inspect it');
select t.expect_value($$select state::text from rooms where room_number='900'$$,
  'and the room becomes sellable by itself', 'INSPECTED');

select '── housekeeping: engineering holds the room ─────────────────────';
select t.expect_ok($$
  update rooms set state='DIRTY' where room_number='900'$$,
  'put the room back to dirty');
select t.expect_ok($$
  insert into work_orders (org_id, title, location_id, priority, raised_by_email)
  select o.id,'T-ac-fault',(select location_id from rooms where room_number='900'),
         'HIGH','fo@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'raise a high priority fault against that room');
select t.expect_fail($$
  update rooms set state='CLEAN' where room_number='900'$$,
  'the room cannot be released clean while the fault is open');
select t.expect_ok($$
  update rooms set state='OUT_OF_SERVICE',
         out_of_service_reason='Air conditioning' where room_number='900'$$,
  'it can be taken out of service instead');
select t.expect_fail($$
  update rooms set state='OUT_OF_SERVICE', out_of_service_reason=null
   where room_number='900'$$,
  'out of service must say why');

select '── housekeeping: lost property ──────────────────────────────────';
select t.expect_ok($$
  insert into lost_property (org_id, description, found_in_room_id, found_by_employee_id)
  select o.id,'T-ring',(select id from rooms where room_number='900'),
         (select id from employees where employee_number='T-4')
    from organizations o where o.name='Demo Kitchen'$$,
  'an item is booked in');
select t.expect_value($$select (hold_until = current_date + 90)::text from lost_property where description='T-ring'$$,
  'and held for ninety days', 'true');
select t.expect_fail($$
  update lost_property set status='DISPOSED', released_by_email='sup@test.local'
   where description='T-ring'$$,
  'it cannot be disposed of inside the hold without a reason');
select t.expect_fail($$
  update lost_property set status='RETURNED', released_by_email='sup@test.local'
   where description='T-ring'$$,
  'a return must name who it went to');
select t.expect_rows($$
  update lost_property set status='RETURNED', released_to='Mrs A, passport 1234',
         released_by_email='sup@test.local' where description='T-ring'$$,
  'a return that names the claimant is recorded', 1);
rollback;
