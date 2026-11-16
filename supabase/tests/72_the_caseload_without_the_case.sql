-- ---------------------------------------------------------------------------
-- The caseload, without the case (0133)
-- ---------------------------------------------------------------------------
-- This report has a different access shape from the three before it, and the
-- difference is the thing most worth testing.
--
-- Production, Maintenance and Housekeeping are section-gated: hold the
-- section and you see everything in it. `hr_cases` is not in
-- `section_read_rules` at all — it is governed by `can_see_case`, which is a
-- participant by user id or by email, or the organisation's owner. So the
-- result is *intrinsically partial*, and two readers with identical sections
-- correctly see different reports.
--
-- Four things this file exists to prevent:
--
--   A reader seeing a case they are not on. The obvious one, and the one RLS
--   already handles — asserted anyway, because the failure is a disclosure
--   rather than a wrong number.
--
--   A partial report that does not say it is partial. `reader_sees_all` is
--   true only for an owner. Without it, a head of department reading "three
--   open cases" when eleven exist would take it for the venue's caseload,
--   and would be right to: nothing on the page would say otherwise.
--
--   Names, summaries, detail or outcome text appearing in the result. Not
--   because the reader may not see them — they may, or the case would not be
--   in the result — but because this exports to four file formats that leave
--   the system, and access control does not travel with a spreadsheet. That
--   is a judgement rather than a rule the schema enforces, so it is pinned
--   by a structural check here: the day somebody adds `employee_name`, this
--   goes red and they have to argue with the comment above it.
--
--   A case closed with nothing recorded about what was decided going
--   unnoticed. It is the commonest failure in any case system, because the
--   work feels finished when the conversation ends.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as emp from employees where employee_number = 'T-1' and org_id = :'demo' \gset

/*
 * Four cases. chef@ is a participant on three of them and not on B, which
 * is the whole point of B.
 */
insert into hr_cases
  (id, org_id, employee_id, reference, kind, status, summary, detail,
   outcome, opened_by_email, opened_on, closed_on, updated_at)
values
  ('e0000000-0000-4000-8000-000000000741', :'demo', :'emp', 'T-72-A',
   'CONDUCT', 'OPEN', 'Test case A', null, null, 'super@test.local',
   current_date - 40, null, now() - interval '20 days'),

  -- chef@ is not on this one.
  ('e0000000-0000-4000-8000-000000000742', :'demo', :'emp', 'T-72-B',
   'GRIEVANCE', 'OPEN', 'Test case B', null, null, 'super@test.local',
   current_date - 40, null, now() - interval '2 days'),

  ('e0000000-0000-4000-8000-000000000743', :'demo', :'emp', 'T-72-C',
   'PERFORMANCE', 'RESOLVED', 'Test case C', null, null, 'super@test.local',
   current_date - 30, current_date - 5, now() - interval '5 days'),

  ('e0000000-0000-4000-8000-000000000744', :'demo', :'emp', 'T-72-D',
   'INVESTIGATION', 'ESCALATED', 'Test case D', null, null, 'super@test.local',
   current_date - 10, null, now() - interval '1 day');

insert into hr_case_participants (case_id, email, role)
values
  ('e0000000-0000-4000-8000-000000000741', 'chef@test.local', 'HR'),
  ('e0000000-0000-4000-8000-000000000741', 'super@test.local', 'OPENER'),
  ('e0000000-0000-4000-8000-000000000742', 'super@test.local', 'OPENER'),
  ('e0000000-0000-4000-8000-000000000743', 'chef@test.local', 'HR'),
  ('e0000000-0000-4000-8000-000000000743', 'super@test.local', 'OPENER'),
  -- D has nobody but chef@: invisible to every other head of department.
  ('e0000000-0000-4000-8000-000000000744', 'chef@test.local', 'OPENER');

select '── HR cases: the period is the report''s own ────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.hr_cases_report(null, current_date)$$,
  'an HR case report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.hr_cases_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select '── HR cases: who sees what, and whether it says so ─────────────';

/*
 * Three of the four. B is the one chef@ is not a participant on, and chef@
 * holds WRITE on every section — so this is `can_see_case` doing the work
 * and nothing else.
 */
select t.expect_value($$
  select count(*)::text from public.hr_cases_report(
    current_date - 60, current_date) where reference like 'T-72-%'$$,
  'a reader sees the cases they are on and not the one they are not', '3');

select t.expect_rows($$
  select 1 from public.hr_cases_report(current_date - 60, current_date)
   where reference = 'T-72-B'$$,
  'the case they are not a participant on is simply absent', 0);

/*
 * And the report says that it is partial. This is the assertion that stops
 * "3 open cases" being read as the venue's caseload at a meeting.
 */
select t.expect_value($$
  select (bool_or(reader_sees_all))::text from public.hr_cases_report(
    current_date - 60, current_date) where reference like 'T-72-%'$$,
  'and every row of a partial report says it is partial', 'false');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from public.hr_cases_report(
    current_date - 60, current_date) where reference like 'T-72-%'$$,
  'an owner reaches every case, which is `can_see_case`''s one exception', '4');

select t.expect_value($$
  select (bool_and(reader_sees_all))::text from public.hr_cases_report(
    current_date - 60, current_date) where reference like 'T-72-%'$$,
  'and their report says it is the whole caseload', 'true');

select '── HR cases: what the sheet refuses to carry ───────────────────';

/*
 * The privacy decision, pinned structurally rather than by inspection.
 *
 * `has_outcome` is a boolean and is allowed: "was anything written down" is
 * the finding. `outcome` itself is the text and is not.
 */
select t.expect_value($$
  select (count(*) = 0)::text
    from unnest((select p.proargnames from pg_catalog.pg_proc p
                  where p.oid = 'public.hr_cases_report(date,date)'::regprocedure)) as n
   where n in ('summary', 'detail', 'outcome', 'employee_id',
               'employee_name', 'employee_number', 'opened_by_email')$$,
  'the report carries no name, summary, detail or outcome text', 'true');

select t.expect_value($$
  select (count(*) = 1)::text
    from unnest((select p.proargnames from pg_catalog.pg_proc p
                  where p.oid = 'public.hr_cases_report(date,date)'::regprocedure)) as n
   where n = 'has_outcome'$$,
  'only whether an outcome was recorded at all', 'true');

select '── HR cases: the findings ──────────────────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select (concerns @> array['closed with no outcome recorded'])::text
    from public.hr_cases_report(current_date - 60, current_date)
   where reference = 'T-72-C'$$,
  'a case closed with nothing recorded about it says so', 'true');

select t.expect_value($$
  select has_outcome::text from public.hr_cases_report(
    current_date - 60, current_date) where reference = 'T-72-C'$$,
  'and the flag agrees with the concern', 'false');

select t.expect_value($$
  select array_to_string(concerns, '; ') from public.hr_cases_report(
    current_date - 60, current_date) where reference = 'T-72-A'$$,
  'a case open beyond a month says how long, and how long since it moved',
  'open 40 days; nothing changed on it for 20 days');

select t.expect_value($$
  select (concerns @> array['escalated'])::text
    from public.hr_cases_report(current_date - 60, current_date)
   where reference = 'T-72-D'$$,
  'an escalated case is called escalated', 'true');

/*
 * D has one participant. That is not a tidiness problem: nobody but its
 * author and the owner can reach it, so if its author leaves it becomes
 * invisible to the people who would otherwise pick it up.
 */
select t.expect_value($$
  select (concerns @> array['only one person can see it'])::text
    from public.hr_cases_report(current_date - 60, current_date)
   where reference = 'T-72-D'$$,
  'and a case only one person can reach says that too', 'true');

select t.expect_value($$
  select participants::text from public.hr_cases_report(
    current_date - 60, current_date) where reference = 'T-72-A'$$,
  'participants are counted, since the list is the access control', '2');

select '── HR cases: a closed case leaves the window ───────────────────';

/*
 * C closed five days ago and is in a window that reaches back sixty days. A
 * window that starts after it closed must not contain it — while A, still
 * open, stays regardless. That pair is what proves the period rule rather
 * than a single check that would pass on a function ignoring dates entirely.
 */
select t.expect_rows($$
  select 1 from public.hr_cases_report(current_date - 3, current_date)
   where reference = 'T-72-C'$$,
  'a case closed before the period began is out of it', 0);

select t.expect_rows($$
  select 1 from public.hr_cases_report(current_date - 3, current_date)
   where reference = 'T-72-A'$$,
  'but one still open is in it whatever the window', 1);

select '── HR cases: one venue, and who may call it ────────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000740', 'T-72 Other Venue', 't72-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000740',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into employees (org_id, employee_number, first_name, last_name,
                       employment_status)
values ('e0000000-0000-4000-8000-000000000740', 'T-72-E', 'Other', 'Person', 'ACTIVE');
insert into hr_cases
  (org_id, employee_id, reference, kind, status, summary, opened_by_email, opened_on)
select 'e0000000-0000-4000-8000-000000000740', e.id, 'T-72-OTHER', 'CONDUCT',
       'OPEN', 'Another venue''s case', 'super@test.local', current_date - 5
  from employees e where e.employee_number = 'T-72-E';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * chef@ is an OWNER of the other venue, so `can_see_case` would let them
 * through on every one of its cases. Only the explicit venue scope keeps it
 * out of this venue's sheet — and note it would also have flipped
 * `reader_sees_all` on, which is the more dangerous half.
 */
select t.expect_rows($$
  select 1 from public.hr_cases_report(current_date - 60, current_date)
   where reference = 'T-72-OTHER'$$,
  'the other venue''s caseload is not in this venue''s report', 0);

select t.expect_rows($$
  select 1 from public.hr_cases where reference = 'T-72-OTHER'$$,
  'even though the reader can see that case perfectly well', 1);

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_rows($$
  select 1 from public.hr_cases_report(current_date - 60, current_date)
   where reference like 'T-72-%'$$,
  'a reader on none of the cases sees none of them', 0);

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.hr_cases_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
