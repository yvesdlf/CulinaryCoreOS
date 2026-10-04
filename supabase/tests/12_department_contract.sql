-- ---------------------------------------------------------------------------
-- Adding a department is filling in a form (PLAN.md Part C)
-- ---------------------------------------------------------------------------
-- Part C makes a claim and then says how to find out it is wrong:
--
--   "Adding Security, a bakery or a second café should be filling in a form.
--    If it needs a programmer, the design is wrong. [...] If any of those turns
--    out to need a migration, Part C is wrong — and it is better to find that
--    out at department three than at department eight."
--
-- This file is that test, and it is the only kind of test that can settle a
-- claim about *design*: it adds Security to the venue the way a screen would,
-- as one row, and then exercises every bullet on Part C's list. Not one line
-- of DDL anywhere below. If a bullet needs a migration, the assertion for it
-- fails here rather than being discovered by whoever is adding department
-- eight.
--
-- What this deliberately does not assert: the two Part C items that are
-- honestly not built yet — a tile on the overview screen, and the one front
-- door for cross-department requests, which the roadmap puts in Stage 3. They
-- are named at the bottom as the gaps they are, rather than quietly left out
-- so the file reads greener than the platform is.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── contract: the department is one row ──────────────────────────';

/*
 * Everything below hangs off this. Written through the ordinary table with an
 * ordinary session, so it is the same write the screen makes and the same
 * guards apply.
 */
select t.expect_rows($$
  insert into business_units (org_id, code, name, approval_threshold)
  select id, 'SECURITY', 'Security', 5000000
    from organizations where name='Demo Kitchen' limit 1$$,
  'Security is created as data, with its own approval threshold', 1);

select t.expect_value($$
  select unit_code(code) from business_units where code='SECURITY'$$,
  'and it has its own document prefix without anybody choosing one', 'SEC');

select '── contract: its own document numbers ───────────────────────────';

/*
 * `WO-SEC-260919-001` for Security's first job today, which is Part C's own
 * example. The prefix comes off the unit, so a department that did not exist
 * when the numbering was written still numbers correctly.
 */
select t.expect_rows($$
  insert into work_orders (org_id, title, business_unit_id, raised_by_email, priority)
  select o.id, 'T-SEC gate light out',
         (select id from business_units where code='SECURITY' and org_id=o.id),
         'chef@test.local', 'NORMAL'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'Security raises a job of its own', 1);

select t.expect_value($$
  select left(reference, 7) from work_orders where title='T-SEC gate light out'$$,
  'numbered for Security, not for a fallback', 'WO-SEC-');

select '── contract: its own money ──────────────────────────────────────';

select t.expect_rows($$
  insert into budgets (org_id, business_unit_id, name, period_start, period_end, amount)
  select o.id, (select id from business_units where code='SECURITY' and org_id=o.id),
         'T-SEC budget', date_trunc('year', current_date)::date,
         (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
         120000000
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'Security gets a budget of its own', 1);

-- It *is* the cost centre, not a copy of one. The compatibility view proves
-- the two trees really are one row: the money side can see it under its own
-- name without anybody having created a second record.
select t.expect_value($$
  select name from cost_centres where code='SECURITY'$$,
  'and the money side sees it without a second record being made', 'Security');

select t.expect_rows($$
  insert into requisitions (org_id, business_unit_id, justification, requested_by_email)
  select o.id, (select id from business_units where code='SECURITY' and org_id=o.id),
         'T-SEC torches', 'chef@test.local'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and can raise a requisition through the ordinary chain', 1);
select t.expect_value($$
  select left(reference, 8) from requisitions where justification='T-SEC torches'$$,
  'which is numbered for Security too', 'REQ-SEC-');

select '── contract: its people ────────────────────────────────────────';

select t.expect_rows($$
  insert into employees (org_id, employee_number, first_name, last_name,
                         business_unit_id, employment_status, started_on)
  select o.id, 'T-SEC1', 'Night', 'Porter',
         (select id from business_units where code='SECURITY' and org_id=o.id),
         'ACTIVE', current_date - 30
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'somebody works for Security', 1);

select t.expect_rows($$
  insert into shifts (org_id, employee_id, business_unit_id, starts_at, ends_at, status)
  select o.id, (select id from employees where employee_number='T-SEC1'),
         (select id from business_units where code='SECURITY' and org_id=o.id),
         (current_date + 1 + time '22:00') at time zone 'UTC',
         (current_date + 2 + time '06:00') at time zone 'UTC',
         'DRAFT'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and is rostered on Security''s rota', 1);

-- The manning view is the one every department reports through. A department
-- it had never heard of has to appear in it without being added to a list.
select t.expect_value($$
  select count(*)::text from employees e
   join business_units b on b.id = e.business_unit_id
  where b.code='SECURITY'$$,
  'Security''s headcount is answerable', '1');

select '── contract: the places it looks after ──────────────────────────';

select t.expect_rows($$
  insert into locations (org_id, code, name, kind, business_unit_id)
  select o.id, 'T-SEC-GATE', 'T-Main gate', 'PUBLIC_AREA',
         (select id from business_units where code='SECURITY' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'Security owns a place', 1);

select t.expect_rows($$
  insert into assets (org_id, code, name, location_id)
  select o.id, 'T-SEC-CAM', 'T-Gate camera',
         (select id from locations where code='T-SEC-GATE')
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'with a piece of equipment in it — CCTV, as Part C''s table says', 1);

select '── contract: permissions can be limited to it ───────────────────';

/*
 * The capability added in 0062, exercised against a department that did not
 * exist when it was written. This is the bullet most likely to have needed a
 * code change, because it is the one that involves a list of what can be
 * scoped — and that list is computed, so Security is on it by arriving.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  delete from member_access
   where user_id='a0000000-0000-0000-0000-000000000003' and section_code='MAINTENANCE'$$,
  'clear the test user''s Maintenance access', 1);
select t.expect_rows($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'MAINTENANCE', 'WRITE',
         (select id from business_units where code='SECURITY' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'grant Maintenance for Security alone', 1);

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_rows($$
  update work_orders set detail='T-seen to'
   where title='T-SEC gate light out'$$,
  'and that person works Security''s jobs', 1);
select t.expect_fail($$
  insert into work_orders (org_id, title, raised_by_email)
  select id, 'T-SEC overreach', 'nobody@test.local'
    from organizations where name='Demo Kitchen' limit 1$$,
  'and is refused a job belonging to no unit');

select '── contract: its own compliance forms ───────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into haccp_forms (org_id, code, section, title, frequency, is_ccp, fields)
  select id, 'T-SEC.1', 'Security', 'T-Patrol log', 'DAILY', false,
         '[{"label":"Round","type":"text"},{"label":"All secure","type":"yes_no"}]'::jsonb
    from organizations where name='Demo Kitchen' limit 1$$,
  'Security''s own paperwork is a form, not a feature', 1);

select '── contract: it can ask other departments, and be asked ─────────';

/*
 * This was a GAP assertion until 0066, written so that the day the front door
 * was built the line would fail and somebody would have to come and delete it.
 * That is what happened, and these are what replaced it.
 *
 * Security is the department created three sections above, as one row. Nothing
 * here was written with Security in mind.
 */
select t.expect_rows($$
  insert into request_types (org_id, code, name, to_unit_id, default_priority,
                             respond_within_hours)
  select o.id, 'T-SECINC', 'T-Security incident',
         (select id from business_units where code='SECURITY' and org_id=o.id),
         'HIGH', 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'Security defines its own kind of request, as a row', 1);

select t.expect_rows($$
  insert into requests (request_type_id, title, detail)
  select id, 'T-SEC door left open', 'Back of house, by the bins'
    from request_types where code='T-SECINC'$$,
  'and somebody raises one against it', 1);

select t.expect_value($$
  select left(reference, 7) from requests where title='T-SEC door left open'$$,
  'numbered for Security, like every other document it owns', 'RQ-SEC-');

select t.expect_value($$
  select unanswered_count::text from request_load where unit_code='SECURITY'$$,
  'and it appears on Security''s own load, which is what a tile reads', '1');

-- The other direction: Security asking somebody else for something.
select t.expect_rows($$
  insert into requests (request_type_id, title, raised_from_unit_id)
  select rt.id, 'T-SEC torch batteries',
         (select id from business_units where code='SECURITY' and org_id=rt.org_id)
    from request_types rt
   where rt.code='SUPPLY'
     and rt.org_id=(select id from organizations where name='Demo Kitchen')$$,
  'Security asks another department for something', 1);
select t.expect_value($$
  select raised_from_unit from request_board where title='T-SEC torch batteries'$$,
  'and the board says which department is asking', 'Security');

select '── contract: what is NOT yet true ───────────────────────────────';

/*
 * One of Part C's bullets is still not built, and saying so here is cheaper
 * than this file reading greener than the platform is.
 *
 * "A tile on the overview screen" — `request_load` is the row such a tile
 * would read and it exists, but the dashboard is still per-section rather than
 * per-unit. Asserted as a gap, the same way 05_people.sql asserts the leave
 * one, so that the day it is built this line fails.
 */
select t.expect_value($$
  select count(*)::text from information_schema.views
   where table_schema='public' and table_name='unit_overview'$$,
  'GAP: the overview screen is still per-section, not per-department', '0');

rollback;
