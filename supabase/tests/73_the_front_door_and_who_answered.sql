-- ---------------------------------------------------------------------------
-- The front door, and how long it took anybody to answer it (0134)
-- ---------------------------------------------------------------------------
-- Four things this file exists to prevent.
--
--   The two kinds of lateness being merged. `answered_late` is history — it
--   was answered, after the promise had gone, and nobody can change that.
--   `overdue_now` is a list of people still waiting. Adding them together
--   produces a number that is neither, and the one figure somebody can act on
--   disappears into a post-mortem.
--
--   A request against a type that promises nothing being counted as answered
--   on time. `respond_within_hours` is nullable, so `respond_by` can be null,
--   and `respond_by < now()` is false for it — which is correct arithmetic
--   and a false conclusion. It is not on time; there is no time.
--
--   Time-to-answer measured from the wrong instant. The first version of this
--   function averaged from midnight of the day a request was raised rather
--   than from `created_at`, so every afternoon request carried eleven or
--   twelve invented hours and a two-hour promise showed a sixteen-hour
--   average while only two of thirteen were late. The two figures
--   contradicted each other on the same row.
--
--   A section creeping in. `requests_read` is `org_id in auth_org_ids()` and
--   nothing else — no section, no unit. That is what "one front door" means:
--   a request only the receiving department can see is a request that quietly
--   becomes that department's problem to admit to. It is asserted here with a
--   reader who holds NONE on every section, because the day somebody adds a
--   gate "for tidiness" this is what should stop them.
--
-- `respond_by` is written by trigger from `now()` (0067), so these fixtures
-- correct it afterwards — the same thing `seed_requests.sql` has to do, and
-- for the same reason: without it a backdated request carries a promise
-- expiring tomorrow and nothing is ever late.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as unit from business_units where org_id = :'demo' and code = 'ADMIN' \gset

insert into request_types
  (id, org_id, code, name, to_unit_id, default_priority, respond_within_hours, active)
values
  ('e0000000-0000-4000-8000-000000000751', :'demo', 'T-73-FAST',
   'Test type with a promise', :'unit', 'NORMAL', 2, true),
  -- The catch-all somebody never set a target on.
  ('e0000000-0000-4000-8000-000000000752', :'demo', 'T-73-NONE',
   'Test type with no promise', :'unit', 'NORMAL', null, true);

/*
 * Five requests, each the one shape the report has to get right.
 *
 *   1  raised and answered inside the promise
 *   2  raised and answered, but after it had gone      → answered_late
 *   3  raised, never answered, promise gone            → overdue_now
 *   4  raised *before* the period and still open       → still_open only
 *   5  against the type that promises nothing          → neither
 *
 * Raised at 14:00 on purpose. Measuring from midnight instead of from
 * `created_at` adds exactly fourteen hours to each, which is what makes the
 * average assertion below able to fail.
 */
insert into requests
  (id, org_id, request_type_id, raised_by_email, title, status,
   acknowledged_at, resolved_at, created_at)
values
  ('e0000000-0000-4000-8000-000000000761', :'demo',
   'e0000000-0000-4000-8000-000000000751', 'raiser@test.local',
   'T-73 one', 'RESOLVED',
   ((current_date - 10)::timestamp + interval '15 hours') at time zone 'UTC',
   ((current_date - 10)::timestamp + interval '18 hours') at time zone 'UTC',
   ((current_date - 10)::timestamp + interval '14 hours') at time zone 'UTC'),

  ('e0000000-0000-4000-8000-000000000762', :'demo',
   'e0000000-0000-4000-8000-000000000751', 'raiser@test.local',
   'T-73 two', 'RESOLVED',
   ((current_date - 9)::timestamp + interval '34 hours') at time zone 'UTC',
   ((current_date - 9)::timestamp + interval '40 hours') at time zone 'UTC',
   ((current_date - 9)::timestamp + interval '14 hours') at time zone 'UTC'),

  ('e0000000-0000-4000-8000-000000000763', :'demo',
   'e0000000-0000-4000-8000-000000000751', 'raiser@test.local',
   'T-73 three', 'NEW', null, null,
   ((current_date - 8)::timestamp + interval '14 hours') at time zone 'UTC'),

  ('e0000000-0000-4000-8000-000000000764', :'demo',
   'e0000000-0000-4000-8000-000000000751', 'raiser@test.local',
   'T-73 four', 'NEW', null, null,
   ((current_date - 40)::timestamp + interval '14 hours') at time zone 'UTC'),

  ('e0000000-0000-4000-8000-000000000765', :'demo',
   'e0000000-0000-4000-8000-000000000752', 'raiser@test.local',
   'T-73 five', 'NEW', null, null,
   ((current_date - 7)::timestamp + interval '14 hours') at time zone 'UTC');

/*
 * The promise, rewritten from when each was raised. 0067 computes it from
 * `now()` at insert, so without this every one of them would have until
 * tomorrow and none could be late.
 */
update requests q
   set respond_by = q.created_at + make_interval(hours => t.respond_within_hours)
  from request_types t
 where t.id = q.request_type_id
   and q.id::text like 'e0000000-0000-4000-8000-0000000007%'
   and t.respond_within_hours is not null;

update requests set respond_by = null
 where request_type_id = 'e0000000-0000-4000-8000-000000000752';

select '── requests: the period is the report''s own ────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.requests_report(null, current_date)$$,
  'a requests report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.requests_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select t.expect_value($$
  select count(*)::text from public.requests_report(
    current_date - 14, current_date) where type_code like 'T-73-%'$$,
  'both test types are in the report', '2');

select '── requests: raised is of the period, open is of today ─────────';

/*
 * Three of the four on this type. Request four was raised forty days ago and
 * is outside the window.
 */
select t.expect_value($$
  select raised::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'raised counts only what came in during the period', '3');

/*
 * But four of them are still open as of today — and request four is one of
 * them. `still_open` is not period-filtered, for the same reason the
 * maintenance report's is not: an unanswered request from last month is more
 * this month's problem than last month's.
 */
select t.expect_value($$
  select still_open::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'and still open is today''s state, whatever the window', '2');

select t.expect_value($$
  select oldest_open_days::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'aged from today, so the oldest is the one from before the period', '40');

select '── requests: the two kinds of lateness stay apart ──────────────';

/*
 * Request two was answered thirty-four hours after a two-hour promise. It is
 * history: it is late, and it is not waiting for anybody.
 */
select t.expect_value($$
  select answered_late::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'answered after the promise had gone is counted as answered, and late', '1');

/*
 * Requests three and four have never been answered and both promises went
 * long ago. They are the ones somebody can still do something about — four
 * especially, which has been waiting forty days.
 *
 * Two, against one `answered_late`. The sets are disjoint and the counts
 * differ, which is what proves they are not the same figure: a function that
 * merged them would have to report three here.
 */
select t.expect_value($$
  select overdue_now::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'still waiting past the promise is counted separately, and is not the same thing',
  '2');

select t.expect_value($$
  select never_acknowledged::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'two are open and unanswered; only one of them had a promise to miss', '2');

select t.expect_value($$
  select (concerns @> array['2 still waiting past the time somebody promised'])::text
    from public.requests_report(current_date - 14, current_date)
   where type_code = 'T-73-FAST'$$,
  'and the ones still waiting are what the row says first', 'true');

select '── requests: measured from when it was raised ──────────────────';

/*
 * Both were raised at 14:00. One was answered at 15:00 the same day — one
 * hour — and the other at 10:00 the next morning, twenty hours later. The
 * average is 10.5.
 *
 * Measured from midnight of the raised day instead — the bug this replaces —
 * each gains those fourteen hours and the answer becomes 24.5. Nothing else
 * on this row is near either number, so the check cannot pass by
 * coincidence, and the 14:00 raise times exist only to make that true.
 */
select t.expect_value($$
  select avg_hours_to_acknowledge::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-FAST'$$,
  'time to answer runs from when it was raised, not from midnight', '10.5');

select '── requests: a type that promises nothing ──────────────────────';

select t.expect_value($$
  select no_promise::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-NONE'$$,
  'a request against a type with no target is counted as having none', '1');

/*
 * And is not quietly on time. `respond_by < now()` is false for a null, which
 * is correct arithmetic and the wrong conclusion: it is not within its
 * promise, there is no promise.
 */
select t.expect_value($$
  select (overdue_now + answered_late)::text from public.requests_report(
    current_date - 14, current_date) where type_code = 'T-73-NONE'$$,
  'it is neither late nor on time, because there is nothing to be late against',
  '0');

select t.expect_value($$
  select (concerns @> array[
    'this type promises no answer by any time, so nothing here can be late or chased'])::text
    from public.requests_report(current_date - 14, current_date)
   where type_code = 'T-73-NONE'$$,
  'and the gap in the configuration is named rather than left silent', 'true');

select '── requests: one front door means everybody ────────────────────';

/*
 * nobody@ holds NONE on every section in the venue. They still see the whole
 * report, because `requests_read` has no section in it. If this ever returns
 * nothing, somebody has added a gate and the front door has become a set of
 * side doors.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select count(*)::text from public.requests_report(
    current_date - 14, current_date) where type_code like 'T-73-%'$$,
  'a member with no section access at all still sees every request', '2');

select '── requests: one venue, and who may call it ────────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000750', 'T-73 Other Venue', 't73-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000750',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000753',
        'e0000000-0000-4000-8000-000000000750', 'OTHR', 'Other unit');
insert into request_types
  (id, org_id, code, name, to_unit_id, respond_within_hours, active)
values ('e0000000-0000-4000-8000-000000000754',
        'e0000000-0000-4000-8000-000000000750', 'T-73-OTHER',
        'Another venue''s type', 'e0000000-0000-4000-8000-000000000753', 4, true);
insert into requests
  (org_id, request_type_id, raised_by_email, title, status, created_at)
values ('e0000000-0000-4000-8000-000000000750',
        'e0000000-0000-4000-8000-000000000754', 'raiser@test.local',
        'T-73 other venue', 'NEW',
        ((current_date - 2)::timestamp + interval '14 hours') at time zone 'UTC');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * This one is pinned as a pair, and it is worth knowing which.
 *
 * 0134 filters the venue twice — once on `requests` in the CTE and once on
 * `request_types` in the final join — and either alone is sufficient,
 * because a request can only point at a type in its own organisation.
 * Removing *one* of them therefore changes nothing and this check stays
 * green; it only goes red when both are gone.
 *
 * So a future reader who deletes one as redundant will not be caught here.
 * They are both kept anyway: the cost is a line, and the failure they
 * prevent is one venue's front door appearing in another's report.
 */
select t.expect_rows($$
  select 1 from public.requests_report(current_date - 14, current_date)
   where type_code = 'T-73-OTHER'$$,
  'the other venue''s front door is not in this venue''s report', 0);

select t.expect_rows($$
  select 1 from public.requests where title = 'T-73 other venue'$$,
  'even though the reader can see that request perfectly well', 1);

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.requests_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
