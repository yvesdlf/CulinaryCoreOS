-- ---------------------------------------------------------------------------
-- The floor can report, check and clean from the staff portal (0084)
-- ---------------------------------------------------------------------------
-- Real portal users: employees with a confirmed login who are not members of
-- the venue. The fixtures' staff@ is a member set to NONE, which is a
-- different thing, so two are made here — a porter, and T-4 the room
-- attendant given a login of their own.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into employees (id, org_id, employee_number, first_name, last_name, work_email, employment_status)
values ('b0000000-0000-4000-8000-0000000000e1', :'demo', 'T-PORT', 'Pat', 'Porter',
        'porter@test.local', 'ACTIVE');
-- Confirmed at creation, so sign-up links each to their record (0078).
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at)
values ('a0000000-0000-0000-0000-0000000000b1', 'porter@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
       ('a0000000-0000-0000-0000-0000000000b2', 'attendant@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
       ('a0000000-0000-0000-0000-0000000000b3', 'stranger@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now());

-- A fridge log with limits, a second venue with a request type of its own, and
-- room 900 on the attendant's sheet today (T-4 is rostered today).
insert into haccp_forms (id, org_id, code, section, title, fields)
values ('b0000000-0000-4000-8000-0000000000f2', :'demo', 'T-FRIDGE', 'Cold chain', 'T-Fridge log',
        '[{"label": "Fridge 2", "type": "number", "unit": "°C", "min": 0, "max": 5}]');
insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-0000000000ee', 'T-Other Venue', 't-other-venue');
insert into housekeeping_tasks (id, org_id, room_id, kind, task_date, assigned_to, standard_minutes)
select 'b0000000-0000-4000-8000-0000000000d9', :'demo',
       (select id from rooms where room_number = '900' and org_id = :'demo'),
       'DEPARTURE', current_date,
       (select id from employees where employee_number = 'T-4' and org_id = :'demo'), 30;

select id as other_type from request_types
 where org_id = 'b0000000-0000-4000-8000-0000000000ee' limit 1 \gset

set local role authenticated;

select '── portal: who may use the doors ─────────────────────────────────';

select t.act_as('a0000000-0000-0000-0000-0000000000b3', 'stranger@test.local');
select t.expect_refused($$select public.raise_my_request(
    (select id from request_types limit 1), 'T-hello')$$,
  'somebody with no staff record cannot raise a request', 'staff of the venue');

select t.act_as('a0000000-0000-0000-0000-0000000000b1', 'porter@test.local');
select t.expect_value($$select (public.auth_employee_id() is not null
                             and not exists (select 1 from organization_members
                                              where user_id = auth.uid()))::text$$,
  'the porter is an employee and not a member: a real portal user', 'true');

select '── portal: reporting a fault ─────────────────────────────────────';

select t.expect_value($$select (count(*) > 0)::text from my_request_types$$,
  'the porter sees the kinds of request the venue takes', 'true');
select t.expect_ok($$select public.raise_my_request(
    (select id from my_request_types order by name limit 1),
    'T-Fridge 2 is leaking', 'Water under the door since this morning')$$,
  'and can raise one');
select t.expect_value($$select (reference is not null)::text || ' ' || title from my_requests$$,
  'which gets a number and shows on their list', 'true T-Fridge 2 is leaking');
select t.expect_value($$select count(*)::text from requests$$,
  'without the porter being able to read the requests table itself', '0');
select t.expect_refused(format($$select public.raise_my_request(%L, 'T-x')$$, :'other_type'),
  'nor raise a request in another venue', 'not one this venue takes');

select '── portal: a HACCP check, with the breach decided by the form ───';

select t.expect_value($$select (count(*) > 0)::text from my_haccp_forms where code = 'T-FRIDGE'$$,
  'the porter sees the venue''s checks', 'true');
select t.expect_value($$select (public.record_my_check(
    'b0000000-0000-4000-8000-0000000000f2', '{"Fridge 2": "3"}') ->> 'breach')$$,
  'a reading inside the limits is recorded as fine', 'false');
select t.expect_refused($$select public.record_my_check(
    'b0000000-0000-4000-8000-0000000000f2', '{"Fridge 2": "9"}')$$,
  'a reading outside them cannot be filed without saying what was done',
  'above its limit of 5');
select t.expect_value($$select public.record_my_check(
    'b0000000-0000-4000-8000-0000000000f2', '{"Fridge 2": "9"}',
    p_corrective_action => 'Moved stock to fridge 1, called maintenance') ->> 'detail'$$,
  'with an action it is recorded as a breach, in words',
  'Fridge 2 read 9 °C, above its limit of 5 °C');
select t.expect_value($$select count(*)::text || '/' || count(*) filter (where breach) from my_checks_today$$,
  'both checks are on the porter''s list for today', '2/1');
select t.expect_value($$select count(*)::text from haccp_records$$,
  'and the records table itself stays closed to them', '0');

select '── portal: cleaning and inspecting a room ───────────────────────';

select t.expect_refused($$select public.start_my_room('b0000000-0000-4000-8000-0000000000d9')$$,
  'the porter cannot start a room on somebody else''s sheet', 'not on your sheet');

select t.act_as('a0000000-0000-0000-0000-0000000000b2', 'attendant@test.local');
select t.expect_value($$select count(*)::text from my_rooms$$,
  'the attendant sees the room on their sheet', '1');
select t.expect_ok($$select public.start_my_room('b0000000-0000-4000-8000-0000000000d9')$$,
  'starts it');
select t.expect_value($$select status::text || ' ' || room_state::text from my_rooms$$,
  'and the task and room are both in progress', 'IN_PROGRESS IN_PROGRESS');
select t.expect_value($$select (public.finish_my_room('b0000000-0000-4000-8000-0000000000d9')
                               ->> 'room_released')$$,
  'finishes it, and the room is released', 'true');
select t.expect_value($$select status::text || ' ' || room_state::text from my_rooms$$,
  'done, and clean', 'DONE CLEAN');
select t.expect_refused($$select public.inspect_room('b0000000-0000-4000-8000-0000000000d9', true)$$,
  'but cannot pass their own room', 'cannot inspect a room you cleaned');

select t.act_as('a0000000-0000-0000-0000-0000000000b1', 'porter@test.local');
select t.expect_value($$select count(*)::text from rooms_to_inspect$$,
  'somebody else sees it waiting to be inspected', '1');
select t.expect_refused($$select public.inspect_room('b0000000-0000-4000-8000-0000000000d9', false)$$,
  'a failed inspection has to say what is wrong', 'must say what is wrong');
select t.expect_ok($$select public.inspect_room('b0000000-0000-4000-8000-0000000000d9', true, 9)$$,
  'and can pass it');
reset role;
select t.expect_value($$
  select t.status::text || ' ' || r.state::text
    from housekeeping_tasks t join rooms r on r.id = t.room_id
   where t.id = 'b0000000-0000-4000-8000-0000000000d9'$$,
  'which moves the task and the room to inspected', 'INSPECTED INSPECTED');

rollback;

select '── portal: a blocked room still counts the work ─────────────────';

/*
 * An urgent job open on the room: the release rule refuses CLEAN. The
 * attendant's work is still recorded as done, the room stays as it was, and
 * the job is named in the answer.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at)
values ('a0000000-0000-0000-0000-0000000000b2', 'attendant@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now());
insert into housekeeping_tasks (id, org_id, room_id, kind, task_date, assigned_to, standard_minutes)
select 'b0000000-0000-4000-8000-0000000000d8', :'demo',
       (select id from rooms where room_number = '900' and org_id = :'demo'),
       'DEPARTURE', current_date,
       (select id from employees where employee_number = 'T-4' and org_id = :'demo'), 30;
insert into work_orders (org_id, title, location_id, cost_centre_id, priority, source, raised_by_email)
select :'demo', 'T-leaking tap', location_id,
       (select id from cost_centres where org_id = :'demo' and code = 'KITCHEN'),
       'HIGH', 'REACTIVE', 'reporter@test.local'
  from rooms where room_number = '900' and org_id = :'demo';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-0000000000b2', 'attendant@test.local');
select t.expect_value($$select (public.finish_my_room('b0000000-0000-4000-8000-0000000000d8')
                               ->> 'reason') ~ 'T-leaking tap'$$::text,
  'the job blocking the room is named', 'true');
select t.expect_value($$select status::text || ' ' || room_state::text from my_rooms$$,
  'the work is done, the room is not released', 'DONE DIRTY');
rollback;
