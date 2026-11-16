-- ---------------------------------------------------------------------------
-- The rooms that were cleaned, and the ones nobody checked (0132)
-- ---------------------------------------------------------------------------
-- Four things this file exists to prevent, three of which the first version
-- of the function got wrong and one of which it could not have got right.
--
--   A room out of service disappearing. It has no tasks *because* it is out
--   of service, so joining to the sheet drops it — and drops it silently,
--   which is how a room stays off the market for five weeks with nobody
--   raising it at a meeting. The first version inner-joined and the concern
--   for it was unreachable code.
--
--   An unfinished task's allowance counting towards the time taken. A task
--   still in progress has no actual minutes; adding its standard would make
--   the day with half the rooms outstanding read as the most efficient day of
--   the week, and it would read that way every week.
--
--   "Cleaned" and "checked" being treated as the same thing. 0056 moves a
--   task to INSPECTED on a pass and to REJECTED on a failure, so a task
--   sitting in DONE is one nobody has looked at. A week of them is a
--   supervisor who stopped inspecting and nothing else says so.
--
--   Another venue's floors arriving in this venue's sheet. Row-level
--   security permits them, so only the explicit scope stops it.
--
-- The rule that nobody may inspect a room they cleaned is enforced by trigger
-- in 0056 and so is deliberately *not* tested here: there is no such row for
-- a report to find, and asserting on a state the database cannot reach would
-- be theatre. `_fixtures.sql` plants a room on today and the demo seed covers
-- the last four weeks, so these fixtures sit three hundred days back.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as emp_a from employees where employee_number = 'T-1' and org_id = :'demo' \gset
select id as emp_b from employees where employee_number = 'T-4' and org_id = :'demo' \gset

/* A guest room is a location in this schema — `rooms.location_id` is unique. */
insert into locations (id, org_id, code, name, kind)
values
  ('e0000000-0000-4000-8000-000000000711', :'demo', 'T-71-LA', 'Test room A', 'GUEST_ROOM'),
  ('e0000000-0000-4000-8000-000000000712', :'demo', 'T-71-LB', 'Test room B', 'GUEST_ROOM'),
  ('e0000000-0000-4000-8000-000000000713', :'demo', 'T-71-LC', 'Test room C', 'GUEST_ROOM');

insert into rooms (id, org_id, location_id, room_number, floor, state,
                   occupancy, out_of_service_reason, state_changed_at)
values
  ('e0000000-0000-4000-8000-000000000721', :'demo',
   'e0000000-0000-4000-8000-000000000711', 'T-71-A', '9', 'DIRTY',
   'DEPARTURE', null, now() - interval '5 days'),
  -- Out of service, and no work at all. It must still be in the report.
  ('e0000000-0000-4000-8000-000000000722', :'demo',
   'e0000000-0000-4000-8000-000000000712', 'T-71-B', '9', 'OUT_OF_SERVICE',
   'VACANT', 'Shower pump failed', now() - interval '12 days'),
  -- In service, no work. It must not be.
  ('e0000000-0000-4000-8000-000000000723', :'demo',
   'e0000000-0000-4000-8000-000000000713', 'T-71-C', '9', 'CLEAN',
   'VACANT', null, now());

/*
 * 0056 refuses housekeeping work to anybody without a PUBLISHED shift that
 * day, so the rota comes before the sheet. Two people, so `attendants` is
 * two and not an artefact of there only being one.
 */
/*
 * `state_changed_at` is set by trigger on insert, so the ages have to be
 * written afterwards — the same reason `seed_housekeeping.sql` applies them
 * last. Setting it in the INSERT above looks like it works and silently does
 * not, and every "for n days" figure then reads nought.
 */
update rooms set state_changed_at = now() - interval '12 days'
 where id = 'e0000000-0000-4000-8000-000000000722';
update rooms set state_changed_at = now() - interval '5 days'
 where id = 'e0000000-0000-4000-8000-000000000721';

insert into shifts (org_id, employee_id, starts_at, ends_at, status, notes)
select :'demo', e.id,
       ((current_date - 305)::timestamp + interval '8 hours') at time zone 'UTC',
       ((current_date - 305)::timestamp + interval '16 hours') at time zone 'UTC',
       'PUBLISHED', 'T-71'
  from (values (:'emp_a'::uuid), (:'emp_b'::uuid)) as e(id);

/*
 * Four tasks on A.
 *
 *   1  cleaned and passed      → INSPECTED by the trigger
 *   2  cleaned and failed      → REJECTED by the trigger
 *   3  cleaned, never looked at → stays DONE
 *   4  never started            → PENDING, with a standard of 999
 *
 * The 999 is the whole point of task four. No other task is near it, so if
 * an unfinished allowance ever leaks into the time taken, the number says so
 * rather than merely differing.
 */
insert into housekeeping_tasks
  (id, org_id, room_id, location_id, kind, task_date, assigned_to, assigned_at,
   standard_minutes, status, started_at, finished_at, actual_minutes)
values
  ('e0000000-0000-4000-8000-000000000731', :'demo',
   'e0000000-0000-4000-8000-000000000721', null, 'DEPARTURE', current_date - 305,
   :'emp_a', ((current_date - 305)::timestamp + interval '8 hours') at time zone 'UTC',
   30, 'DONE',
   ((current_date - 305)::timestamp + interval '9 hours') at time zone 'UTC',
   ((current_date - 305)::timestamp + interval '10 hours') at time zone 'UTC', 30),

  ('e0000000-0000-4000-8000-000000000732', :'demo',
   'e0000000-0000-4000-8000-000000000721', null, 'STAYOVER', current_date - 305,
   :'emp_b', ((current_date - 305)::timestamp + interval '8 hours') at time zone 'UTC',
   30, 'DONE',
   ((current_date - 305)::timestamp + interval '11 hours') at time zone 'UTC',
   ((current_date - 305)::timestamp + interval '12 hours') at time zone 'UTC', 45),

  ('e0000000-0000-4000-8000-000000000733', :'demo',
   'e0000000-0000-4000-8000-000000000721', null, 'TURNDOWN', current_date - 304,
   null, null, 20, 'DONE',
   ((current_date - 304)::timestamp + interval '18 hours') at time zone 'UTC',
   ((current_date - 304)::timestamp + interval '19 hours') at time zone 'UTC', 25),

  ('e0000000-0000-4000-8000-000000000734', :'demo',
   'e0000000-0000-4000-8000-000000000721', null, 'DEEP_CLEAN', current_date - 303,
   null, null, 999, 'PENDING', null, null, null),

  -- And work against a place rather than a room. The location goes in on the
  -- insert, not afterwards: `housekeeping_tasks_target` requires one or the
  -- other at the moment the row is written.
  ('e0000000-0000-4000-8000-000000000735', :'demo', null,
   (select id from public.locations where org_id = :'demo' and code = 'PUB'),
   'PUBLIC_AREA',
   current_date - 302, null, null, 45, 'DONE',
   ((current_date - 302)::timestamp + interval '14 hours') at time zone 'UTC',
   ((current_date - 302)::timestamp + interval '15 hours') at time zone 'UTC', 50);

/*
 * The inspections, which move the tasks. Inspected by somebody who did not
 * clean the room — 0056 refuses otherwise, and that refusal is the reason
 * this report never has to check for it.
 */
insert into housekeeping_inspections
  (org_id, task_id, inspector_email, passed, score, findings, inspected_at)
values
  (:'demo', 'e0000000-0000-4000-8000-000000000731', 'super@test.local',
   true, 94, null,
   ((current_date - 305)::timestamp + interval '13 hours') at time zone 'UTC'),
  (:'demo', 'e0000000-0000-4000-8000-000000000732', 'super@test.local',
   false, 58, 'Bathroom glass marked and the bin not emptied.',
   ((current_date - 305)::timestamp + interval '14 hours') at time zone 'UTC');

select '── housekeeping: the period is the report''s own ────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.housekeeping_report(null, current_date)$$,
  'a housekeeping report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.housekeeping_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

/* The fixture loaded: every count below is of a subset. */
select t.expect_value($$
  select count(*)::text from public.housekeeping_report(
    current_date - 310, current_date - 295)
   where room_number like 'T-71-%'$$,
  'the worked room and the one out of service are both in the report', '2');

select '── housekeeping: a room with no work can still be the point ────';

select t.expect_value($$
  select array_to_string(concerns, '; ') from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-B'$$,
  'a room out of service is listed although it has no tasks at all',
  'out of service 12 days — Shower pump failed');

select t.expect_value($$
  select tasks::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-B'$$,
  'with nought rather than null in the columns it has nothing for', '0');

select t.expect_rows($$
  select 1 from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-C'$$,
  'but a room in service with no work is not listed at all', 0);

select '── housekeeping: minutes come only from finished work ──────────';

/*
 * 30 + 30 + 20 from the three finished tasks. Task four is PENDING with an
 * allowance of 999 and must contribute nothing. If this ever reads 1079 the
 * filter has gone and every week will look efficient.
 */
select t.expect_value($$
  select standard_minutes::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'the time allowed is summed over the tasks that recorded an actual', '80');

select t.expect_value($$
  select actual_minutes::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'and so is the time taken', '100');

select t.expect_value($$
  select unfinished::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'the unfinished task is still counted, just not costed', '1');

select '── housekeeping: cleaned is not the same as checked ────────────';

select t.expect_value($$
  select awaiting_inspection::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'a clean nobody inspected is counted as such', '1');

select t.expect_value($$
  select rejected::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'and a failed inspection sent its room back to be done again', '1');

select t.expect_value($$
  select inspections_failed::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'the failure itself is counted once', '1');

select t.expect_value($$
  select inspections::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'against two inspections in all', '2');

select t.expect_value($$
  select (concerns @> array['1 clean nobody has inspected'])::text
    from public.housekeeping_report(current_date - 310, current_date - 295)
   where room_number = 'T-71-A'$$,
  'and the room says it in words', 'true');

select t.expect_value($$
  select attendants::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-A'$$,
  'two people worked the room, counted once each', '2');

select '── housekeeping: work against a place, not a room ──────────────';

select t.expect_value($$
  select (count(*) = 1)::text from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_id is null$$,
  'work against a place is one row rather than many', 'true');

select t.expect_value($$
  select (concerns @> array['not a room — public areas and linen'])::text
    from public.housekeeping_report(current_date - 310, current_date - 295)
   where room_id is null$$,
  'and says so rather than appearing as a room with no number', 'true');

select '── housekeeping: one venue, the one the reader is in ───────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000710', 'T-71 Other Venue', 't71-other');

insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000710',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');

insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000710',
       'a0000000-0000-0000-0000-000000000002', code, 'WRITE'
  from app_sections;

insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;

insert into locations (id, org_id, code, name, kind)
values ('e0000000-0000-4000-8000-000000000714',
        'e0000000-0000-4000-8000-000000000710', 'T-71-LD', 'Other room', 'GUEST_ROOM');

insert into rooms (org_id, location_id, room_number, state, occupancy,
                   out_of_service_reason)
values ('e0000000-0000-4000-8000-000000000710',
        'e0000000-0000-4000-8000-000000000714', 'T-71-D', 'OUT_OF_SERVICE',
        'VACANT', 'Another venue''s problem');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  select 1 from public.housekeeping_report(
    current_date - 310, current_date - 295) where room_number = 'T-71-D'$$,
  'the other venue''s floors are not in this venue''s sheet', 0);

select t.expect_rows($$
  select 1 from public.rooms where room_number = 'T-71-D'$$,
  'even though the reader can see that room perfectly well', 1);

select '── housekeeping: who may read any of it ────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_rows($$
  select 1 from public.housekeeping_report(
    current_date - 310, current_date - 295)$$,
  'a reader with no Housekeeping access sees no housekeeping at all', 0);

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.housekeeping_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
