-- ---------------------------------------------------------------------------
-- What broke, and what was never checked (0131)
-- ---------------------------------------------------------------------------
-- The maintenance report mixes two kinds of number in one row on purpose —
-- `raised` and `completed` are of the period, `still_open`, `overdue` and the
-- plan columns are as of today — so most of what can go wrong here is one
-- definition quietly leaking into the other.
--
-- Four things this file exists to prevent:
--
--   A job raised before the period and finished inside it going uncounted.
--   That is the commonest shape of real maintenance work, and a report that
--   only counted jobs raised in its own window would show a quiet month
--   every time the previous one was busy.
--
--   An open job ageing out of the report. `still_open` is deliberately not
--   period-filtered: a job raised in March and still open in November
--   belongs on November's agenda more than on March's, and the one that has
--   been open longest is the one nobody is looking at.
--
--   Downtime counted on an unfinished job. An open job's downtime is still
--   accruing and is not a figure yet. Adding it to the month would understate
--   the month and nothing would ever go back and correct it.
--
--   A statutory check reading as in-date when it is not, or the reverse. The
--   due date is `last_completed_on + interval_days` with "never done" meaning
--   "due now" — 0055's formula, repeated in 0131 rather than improved,
--   because two derivations is how a screen and a report come to disagree
--   about whether the venue is in breach.
--
-- Fixtures are parked three hundred days back: the demo seed covers the last
-- ninety and `_fixtures.sql` plants an asset, a plan and an open job on
-- today. Counts on this venue's *own* assets are exact; the row for work
-- against no asset aggregates every such job in the venue, including the
-- seed's, so it is asserted by shape rather than by number.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into assets (id, org_id, code, name, category, criticality, status)
values
  ('e0000000-0000-4000-8000-000000000701', :'demo', 'T-70-A',
   'Test asset A', 'HVAC', 'CRITICAL', 'IN_SERVICE'),
  ('e0000000-0000-4000-8000-000000000702', :'demo', 'T-70-B',
   'Test asset B', 'COOKING', 'IMPORTANT', 'IN_SERVICE'),
  ('e0000000-0000-4000-8000-000000000703', :'demo', 'T-70-C',
   'Test asset C', 'PLUMBING', 'ROUTINE', 'OUT_OF_SERVICE'),
  -- Nothing ever happens to D. It must not be in the report.
  ('e0000000-0000-4000-8000-000000000704', :'demo', 'T-70-D',
   'Test asset D', 'GENERAL', 'ROUTINE', 'IN_SERVICE');

/*
 * A's statutory check was last done two hundred days ago on a ninety-day
 * interval, so it is a hundred and ten days past. B's was done last week.
 * C has a plan that has never been done at all, which 0055 calls due today
 * rather than overdue — asserted below, because it is the boundary somebody
 * will one day "fix" into an off-by-one.
 */
insert into maintenance_plans
  (org_id, asset_id, code, title, interval_days, estimated_minutes,
   statutory, active, last_completed_on)
values
  (:'demo', 'e0000000-0000-4000-8000-000000000701', 'T-70-PM-A',
   'Statutory service A', 90, 240, true, true, current_date - 200),
  (:'demo', 'e0000000-0000-4000-8000-000000000702', 'T-70-PM-B',
   'Routine service B', 90, 120, false, true, current_date - 7),
  (:'demo', 'e0000000-0000-4000-8000-000000000703', 'T-70-PM-C',
   'Never done C', 90, 60, false, true, null);

/*
 * Five jobs on B, one per shape the report has to get right.
 *
 *   1  raised and finished inside the period
 *   2  raised *before* the period and finished inside it
 *   3  finished inside the period and never verified
 *   4  raised long before the period and still open, past its date
 *   5  raised inside the period and cancelled
 */
insert into work_orders
  (id, org_id, title, asset_id, source, priority, status,
   raised_by_email, raised_at, due_by,
   completed_at, completed_by_email, completion_note,
   verified_at, verified_by_email, cancelled_reason,
   downtime_minutes, labour_minutes)
values
  ('e0000000-0000-4000-8000-000000000711', :'demo', 'T-70 job one',
   'e0000000-0000-4000-8000-000000000702', 'REACTIVE', 'NORMAL', 'VERIFIED',
   'raiser@test.local',
   ((current_date - 305)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 300,
   ((current_date - 302)::timestamp + interval '9 hours') at time zone 'UTC',
   'tech@test.local', 'Replaced the seal.',
   ((current_date - 301)::timestamp + interval '9 hours') at time zone 'UTC',
   'super@test.local', null, 60, 120),

  ('e0000000-0000-4000-8000-000000000712', :'demo', 'T-70 job two',
   'e0000000-0000-4000-8000-000000000702', 'REACTIVE', 'NORMAL', 'VERIFIED',
   'raiser@test.local',
   ((current_date - 320)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 310,
   ((current_date - 300)::timestamp + interval '9 hours') at time zone 'UTC',
   'tech@test.local', 'Part arrived at last.',
   ((current_date - 299)::timestamp + interval '9 hours') at time zone 'UTC',
   'super@test.local', null, 30, 90),

  ('e0000000-0000-4000-8000-000000000713', :'demo', 'T-70 job three',
   'e0000000-0000-4000-8000-000000000702', 'REACTIVE', 'NORMAL', 'COMPLETED',
   'raiser@test.local',
   ((current_date - 303)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 298,
   ((current_date - 301)::timestamp + interval '9 hours') at time zone 'UTC',
   'tech@test.local', 'Tightened and ran on test.',
   null, null, null, 45, 60),

  /*
   * Job four carries downtime while still open, which is the realistic case
   * — the asset went down when it was raised and has been down since — and
   * the only reason the downtime assertion below means anything. The first
   * version left it null, so summing every job gave the same 135 as summing
   * the finished ones and the check passed against a function that counted
   * both. 999 because no finished job is near it: if it ever leaks into the
   * total, the number says so rather than merely differing.
   */
  ('e0000000-0000-4000-8000-000000000714', :'demo', 'T-70 job four',
   'e0000000-0000-4000-8000-000000000702', 'REACTIVE', 'HIGH', 'OPEN',
   'raiser@test.local',
   ((current_date - 400)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 390,
   null, null, null, null, null, null, 999, null),

  ('e0000000-0000-4000-8000-000000000715', :'demo', 'T-70 job five',
   'e0000000-0000-4000-8000-000000000702', 'REACTIVE', 'LOW', 'CANCELLED',
   'raiser@test.local',
   ((current_date - 300)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 295,
   null, null, null, null, null,
   'Raised twice; the other job covers it.', null, null),

  -- And one against no asset at all.
  ('e0000000-0000-4000-8000-000000000716', :'demo', 'T-70 corridor leak',
   null, 'REACTIVE', 'NORMAL', 'OPEN',
   'raiser@test.local',
   ((current_date - 304)::timestamp + interval '9 hours') at time zone 'UTC',
   current_date - 299,
   null, null, null, null, null, null, null, null);

select '── maintenance: the period is the report''s own ──────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.maintenance_report(null, current_date)$$,
  'a maintenance report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.maintenance_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

/*
 * The fixture loaded. Every count below is of a subset; without this they
 * would all be empty and all agree. `_harness.sql`'s third false-pass mode.
 */
select t.expect_value($$
  select count(*)::text from public.maintenance_report(
    current_date - 310, current_date - 295)
   where asset_code like 'T-70-%'$$,
  'three of the four test assets are in the report', '3');

select t.expect_rows($$
  select 1 from public.maintenance_report(
    current_date - 310, current_date - 295)
   where asset_code = 'T-70-D'$$,
  'and the one with no work, no overdue plan and in service is not', 0);

select '── maintenance: period figures against today''s state ───────────';

/*
 * Raised counts jobs one, three and five. Job two was raised before the
 * window and job four long before it.
 */
select t.expect_value($$
  select raised::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'raised counts only jobs raised inside the period', '3');

/*
 * Completed counts jobs one, two and three — including job two, which was
 * raised a fortnight before the period opened. This is the assertion that
 * fails if the function ever filters work orders on `raised_at` alone.
 */
select t.expect_value($$
  select completed::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'completed counts a job raised before the period and finished inside it', '3');

select t.expect_value($$
  select still_open::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'still open is today''s state, so a job from long before the period counts',
  '1');

select t.expect_value($$
  select oldest_open_days::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'and is aged from today rather than from the period', '400');

select t.expect_value($$
  select overdue::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'overdue is an open job past its date, not a closed one', '1');

select '── maintenance: what is counted on completion ───────────────────';

/*
 * 60 + 30 + 45, from jobs one, two and three. Job four is open with no
 * downtime recorded and job five was cancelled. If an open job's downtime
 * ever started counting, this is the number that moves.
 */
select t.expect_value($$
  select downtime_minutes::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'downtime is summed over the jobs that finished in the period', '135');

select t.expect_value($$
  select completed_not_verified::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-B'$$,
  'a job completed and never verified is counted as such', '1');

select t.expect_value($$
  select (concerns @> array['1 completed and never verified'])::text
    from public.maintenance_report(current_date - 310, current_date - 295)
   where asset_code = 'T-70-B'$$,
  'and said in words', 'true');

select '── maintenance: the programme on paper ──────────────────────────';

select t.expect_value($$
  select statutory_overdue::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-A'$$,
  'a statutory check past its interval is overdue', '1');

select t.expect_value($$
  select array_to_string(concerns, '; ') from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-A'$$,
  'and is the only thing that asset has to say',
  '1 statutory check is overdue');

/*
 * The boundary, written down so nobody tidies it away.
 *
 * 0055 reads a plan that has never been completed as due *today*, not
 * overdue — `coalesce(last_completed_on, current_date - interval) + interval`
 * is exactly `current_date`. C is therefore in the report for being out of
 * service and not for its plan.
 */
select t.expect_value($$
  select plans_overdue::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-C'$$,
  'a plan that has never been done is due today, not overdue', '0');

select t.expect_value($$
  select array_to_string(concerns, '; ') from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-C'$$,
  'and an asset out of service is in the report for that alone',
  'out of service');

select t.expect_value($$
  select (concerns @> array[
    'it has a maintenance plan, and every job this period was reactive'])::text
    from public.maintenance_report(current_date - 310, current_date - 295)
   where asset_code = 'T-70-B'$$,
  'a plan that exists while every job was reactive is said out loud', 'true');

select '── maintenance: work against no asset ───────────────────────────';

/*
 * Asserted by shape, not by number: this row aggregates every asset-less job
 * in the venue, and the demo seed plants several.
 */
select t.expect_value($$
  select (count(*) = 1)::text from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_id is null$$,
  'work against no asset is one row rather than many', 'true');

select t.expect_value($$
  select (concerns @> array['raised against no asset'])::text
    from public.maintenance_report(current_date - 310, current_date - 295)
   where asset_id is null$$,
  'and says so rather than appearing as a nameless asset', 'true');

select '── maintenance: one venue, the one the reader is in ─────────────';

/*
 * A second venue with plant of its own, which chef@ also belongs to.
 *
 * Row-level security permits every one of its rows, so without an explicit
 * scope the two registers merge into one agenda and their downtime is added
 * together — and no access test in this suite would object, because nothing
 * was read that should not have been.
 *
 * `active_org_id` is set explicitly: adding a second membership can change
 * which venue the fallback picks, and the test would then be asserting the
 * ordering rule rather than the scope.
 */
reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000700', 'T-70 Other Venue', 't70-other');

insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000700',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');

insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000700',
       'a0000000-0000-0000-0000-000000000002', code, 'WRITE'
  from app_sections;

insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;

insert into assets (id, org_id, code, name, category, criticality, status)
values ('e0000000-0000-4000-8000-000000000705',
        'e0000000-0000-4000-8000-000000000700', 'T-70-E',
        'Other venue asset', 'HVAC', 'CRITICAL', 'OUT_OF_SERVICE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  select 1 from public.maintenance_report(
    current_date - 310, current_date - 295) where asset_code = 'T-70-E'$$,
  'the other venue''s plant is not on this venue''s agenda', 0);

/*
 * The control on the control: the reader can read that asset perfectly well,
 * so its absence above is the scope and not an access refusal.
 */
select t.expect_rows($$
  select 1 from public.assets where code = 'T-70-E'$$,
  'even though the reader can see that asset perfectly well', 1);

/*
 * The other half of the same scope, which the check above cannot reach.
 *
 * Only assets of this venue are listed, so another venue's *asset-attributed*
 * work would have nowhere to appear even unscoped. Its asset-less work is a
 * different matter: that row is one aggregate over the whole table, and a
 * missing scope — or a missing bracket around the three OR branches in
 * `relevant` — would fold the other venue's jobs into it silently.
 *
 * Asserted through `oldest_open_days` rather than a count, because the row
 * aggregates every asset-less job in this venue including the demo seed's,
 * and no count here is stable. Nothing in this venue is anywhere near five
 * thousand days old, so if that number appears it came from somewhere it
 * should not have.
 */
reset role;
select t.act_as_nobody();

insert into work_orders
  (org_id, title, asset_id, source, priority, status, raised_by_email, raised_at)
values ('e0000000-0000-4000-8000-000000000700', 'T-70 other venue corridor',
        null, 'REACTIVE', 'NORMAL', 'OPEN', 'raiser@test.local',
        ((current_date - 5000)::timestamp + interval '9 hours') at time zone 'UTC');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select (coalesce(oldest_open_days, 0) < 5000)::text
    from public.maintenance_report(current_date - 310, current_date - 295)
   where asset_id is null$$,
  'nor is its asset-less work folded into this venue''s no-asset row', 'true');

select '── maintenance: who may read any of it ──────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_rows($$
  select 1 from public.maintenance_report(
    current_date - 310, current_date - 295)$$,
  'a reader with no Maintenance access sees no maintenance at all', 0);

/*
 * Asserted as a privilege rather than by calling as `anon`: RLS would hide
 * the rows anyway, so an empty result proves nothing about the grant.
 */
select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.maintenance_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
