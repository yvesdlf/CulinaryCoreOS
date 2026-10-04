-- ---------------------------------------------------------------------------
-- Chasing what nobody answers (0068)
-- ---------------------------------------------------------------------------
-- Gap 15. The thing being tested is a clock, so the clock is a parameter: a
-- sweep that reads `now()` cannot be tested across the boundary it exists to
-- detect, and this one has three — the promise, the second step, and the top
-- of the tree.
--
-- The rule most worth proving is the one that decides whether anybody keeps
-- reading the messages: a request is chased once per period it has been
-- ignored, not once per sweep. A sweep running every minute that notified
-- every minute would teach its recipient to filter the sender, which is worse
-- than never chasing at all.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * A two-level tree, because the point of escalating is that it goes somewhere
 * else the second time. T-OPS sits above T-SUB, each with its own manager.
 */
select t.fixture($$
  insert into business_units (org_id, code, name, manager_employee_id)
  select o.id, 'T-OPS', 'T-Operations',
         (select id from employees where employee_number='T-1')
    from organizations o where o.name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into business_units (org_id, code, name, parent_id, manager_employee_id)
  select o.id, 'T-SUB', 'T-Night team',
         (select id from business_units where code='T-OPS'
           and org_id=o.id),
         (select id from employees where employee_number='T-2')
    from organizations o where o.name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into request_types (org_id, code, name, to_unit_id, respond_within_hours)
  select o.id, 'T-NIGHT', 'T-Night issue',
         (select id from business_units where code='T-SUB' and org_id=o.id), 4
    from organizations o where o.name='Demo Kitchen' limit 1 $$);

select '── escalation: the chain is the tree, upwards ───────────────────';

select t.expect_value($$
  select string_agg(unit_name, ' -> ' order by step) from escalation_chain(
    (select id from business_units where code='T-SUB'
      and org_id=(select id from organizations where name='Demo Kitchen')))$$,
  'the night team first, then operations above it', 'T-Night team -> T-Operations');

select t.expect_value($$
  select manager_email from escalation_chain(
    (select id from business_units where code='T-SUB'
      and org_id=(select id from organizations where name='Demo Kitchen')))
   where step = 1$$,
  'and the first step is the unit''s own manager', 'uncert@test.local');

select '── escalation: nothing is chased before it is late ──────────────';

select t.expect_rows($$
  insert into requests (request_type_id, title, created_at)
  select id, 'T-fridge alarm at 2am', now() - interval '1 hour'
    from request_types where code='T-NIGHT'$$,
  'something raised an hour ago, promised within four', 1);

-- `respond_by` is set from the type at insert, so it is four hours from the
-- moment of insert rather than from `created_at`; the sweep is asked about a
-- moment before it.
select t.expect_value($$
  select count(*)::text from chase_unanswered_requests(now() + interval '1 hour')$$,
  'is not chased an hour later, because nothing was promised by then', '0');

select '── escalation: and is chased once it is ─────────────────────────';

select t.expect_value($$
  select told_email from chase_unanswered_requests(now() + interval '5 hours')$$,
  'five hours in, the night team''s manager is told', 'uncert@test.local');

select t.expect_value($$
  select escalation_level::text from requests where title='T-fridge alarm at 2am'$$,
  'and the request records that it has been chased once', '1');

-- The request has not been answered. Saying it has, because a timer fired,
-- would be the system speaking on behalf of somebody who never saw it.
select t.expect_value($$
  select status::text from requests where title='T-fridge alarm at 2am'$$,
  'it is still unanswered, because escalating is telling rather than deciding',
  'NEW');

select '── escalation: not chased again for the same delay ──────────────';

select t.expect_value($$
  select count(*)::text from chase_unanswered_requests(now() + interval '5 hours')$$,
  'a second sweep at the same moment chases nothing', '0');
select t.expect_value($$
  select count(*)::text from chase_unanswered_requests(now() + interval '6 hours')$$,
  'nor one an hour later, which has earned no further step', '0');

select '── escalation: a longer silence goes further up the tree ────────';

/*
 * Promised in four hours and ignored for thirteen has earned three steps. The
 * second step is the parent unit's manager — which is the whole reason the
 * tree exists, and the first thing in this schema to read `parent_id`.
 */
select t.expect_value($$
  select told_email from chase_unanswered_requests(now() + interval '13 hours')$$,
  'thirteen hours in, the manager above is told instead', 'cert@test.local');
select t.expect_value($$
  select escalation_level::text from requests where title='T-fridge alarm at 2am'$$,
  'and the level is the number of periods ignored, not the number of sweeps', '3');

select '── escalation: every chase is on the record ─────────────────────';

select t.expect_value($$
  select count(*)::text from request_events e
   join requests r on r.id = e.request_id
  where r.title='T-fridge alarm at 2am'
    and e.note like 'Nobody has answered this%'$$,
  'two chases, two entries in the ledger', '2');

select t.expect_value($$
  select count(*)::text from notifications
   where kind='REQUEST_UNANSWERED' and entity_type='REQUEST'$$,
  'and two notifications were raised', '2');

select '── escalation: a department with no manager is a finding ────────';

/*
 * `manager_employee_id` has been on `business_units` since 0058 and this is
 * its first reader. A venue that has never named a manager must not have its
 * requests escalate into silence without anybody being told that is what
 * happened.
 */
select t.fixture($$
  insert into business_units (org_id, code, name)
  select o.id, 'T-ORPH', 'T-Nobody in charge'
    from organizations o where o.name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into request_types (org_id, code, name, to_unit_id, respond_within_hours)
  select o.id, 'T-ORPHREQ', 'T-Orphan issue',
         (select id from business_units where code='T-ORPH' and org_id=o.id), 2
    from organizations o where o.name='Demo Kitchen' limit 1 $$);
select t.expect_rows($$
  insert into requests (request_type_id, title)
  select id, 'T-nobody to tell' from request_types where code='T-ORPHREQ'$$,
  'something raised against a department with no manager named', 1);

select t.expect_value($$
  select count(*)::text from chase_unanswered_requests(now() + interval '3 hours')
   where reference like 'RQ-%' and told_email is null$$,
  'is still chased, and the sweep reports that there was nobody to tell', '1');
select t.expect_value($$
  select count(*)::text from request_events e
   join requests r on r.id = e.request_id
  where r.title='T-nobody to tell'
    and e.note like '%no manager named%'$$,
  'and the ledger says so rather than recording a message nobody got', '1');

select '── escalation: nobody signed in can run it ──────────────────────';

/*
 * It reads every venue's overdue requests on purpose, which is right for a job
 * with no session and wrong for anybody with one.
 */
set local role authenticated;
select t.expect_fail($$select * from chase_unanswered_requests(now())$$,
  'the sweep is not somebody''s to run');
reset role;

rollback;
