-- ---------------------------------------------------------------------------
-- Hygiene is not only the kitchen's (0072)
-- ---------------------------------------------------------------------------
-- Gap 24. Two halves, and the second is the one that changes behaviour:
--
--   A form belongs to a department, so "what am I behind on" stops answering
--   with the kitchen's fridge temperatures.
--
--   A failed check opens a request by itself. Every venue that has failed an
--   inspection has a record of a breach nobody acted on, and the reason is
--   always the same: the person who found it was also the person who had to
--   remember to walk round and say so.
--
-- The rule most worth proving is that it opens exactly one. A record edited
-- twice must not raise two, and a breach that is later corrected must not
-- raise a second for the same fridge.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── hygiene: nothing that exists today changed ───────────────────';

/*
 * Every form in every venue has no department, which is what they all meant
 * before this migration. A compliance migration that silently narrowed them
 * would hide paperwork a venue is legally required to keep doing.
 */
select t.expect_value($$
  select count(*)::text from haccp_forms where business_unit_id is not null$$,
  'no form was given a department by the migration', '0');

select t.expect_value($$
  select count(distinct unit_code)::text from hygiene_by_unit
   where form_code = '1.1' and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'and a venue-wide form is listed under every department, because it is everybody''s',
  (select count(*)::text from business_units
    where active and org_id=(select id from organizations where name='Demo Kitchen')));

select '── hygiene: a department''s own form ─────────────────────────────';

select t.fixture($$
  insert into haccp_forms (org_id, code, section, title, frequency, is_ccp, fields,
                           business_unit_id, raises_job)
  select o.id, 'T-BAR.1', 'Bar', 'T-Glasswasher rinse temperature', 'DAILY', true,
         '[{"label":"Rinse °C","type":"number"}]'::jsonb,
         (select id from business_units where code='BAR' and org_id=o.id), true
    from organizations o where o.name='Demo Kitchen' limit 1 $$);

select t.expect_value($$
  select count(*)::text from hygiene_by_unit
   where form_code='T-BAR.1' and unit_code='BAR'$$,
  'the bar has a form of its own', '1');
select t.expect_value($$
  select count(*)::text from hygiene_by_unit
   where form_code='T-BAR.1' and unit_code='KITCHEN'$$,
  'and the kitchen is not behind on it', '0');

select '── hygiene: a record belongs to its form''s department ───────────';

select t.expect_rows($$
  insert into haccp_records (form_id, covers_date, values, completed_by_email)
  select id, current_date, '{"Rinse °C": 82}'::jsonb, 'chef@test.local'
    from haccp_forms where code='T-BAR.1'$$,
  'a clean check is recorded', 1);

select t.expect_value($$
  select b.code from haccp_records r join business_units b on b.id = r.business_unit_id
   where r.form_id = (select id from haccp_forms where code='T-BAR.1')$$,
  'and is filed under the bar, from the form rather than the client', 'BAR');

select t.expect_value($$
  select count(*)::text from haccp_records
   where form_id=(select id from haccp_forms where code='T-BAR.1')
     and raised_request_id is not null$$,
  'a check that passed opens nothing', '0');

select '── hygiene: a failed check opens a request by itself ────────────';

select t.expect_rows($$
  insert into haccp_records (form_id, covers_date, values, breach, breach_detail,
                             corrective_action, completed_by_email)
  select id, current_date - 1, '{"Rinse °C": 54}'::jsonb, true,
         'T-rinse never got above 54', 'T-glasses rewashed in the kitchen',
         'chef@test.local'
    from haccp_forms where code='T-BAR.1'$$,
  'a check that failed is recorded', 1);

select t.expect_value($$
  select (raised_request_id is not null)::text from haccp_records
   where breach_detail='T-rinse never got above 54'$$,
  'and a request is opened without anybody walking round', 'true');

select t.expect_value($$
  select left(title, 15) from requests
   where id=(select raised_request_id from haccp_records
              where breach_detail='T-rinse never got above 54')$$,
  'naming what failed', 'Hygiene breach:');

select t.expect_value($$
  select priority::text from requests
   where id=(select raised_request_id from haccp_records
              where breach_detail='T-rinse never got above 54')$$,
  'at high priority, because a hygiene breach is not a suggestion', 'HIGH');

select t.expect_value($$
  select raised_from_unit from request_board
   where id=(select raised_request_id from haccp_records
              where breach_detail='T-rinse never got above 54')$$,
  'and it says which department found it', 'Bar');

-- The detail travels with it. A request saying "a check failed" and nothing
-- else sends somebody to find the paperwork before they can start.
select t.expect_value($$
  select (detail like '%T-rinse never got above 54%'
          and detail like '%T-glasses rewashed in the kitchen%')::text
    from requests
   where id=(select raised_request_id from haccp_records
              where breach_detail='T-rinse never got above 54')$$,
  'carrying what failed and what was done at the time', 'true');

select '── hygiene: exactly one request, however often it is edited ─────';

select t.expect_rows($$
  update haccp_records set corrective_action='T-engineer called as well'
   where breach_detail='T-rinse never got above 54'$$,
  'the record is edited afterwards', 1);
select t.expect_value($$
  select count(*)::text from requests where title like 'Hygiene breach%'$$,
  'and no second request is opened for the same failure', '1');

select t.expect_rows($$
  update haccp_records set verified_by_email='chef@test.local', verified_at=now()
   where breach_detail='T-rinse never got above 54'$$,
  'nor when it is verified', 1);
select t.expect_value($$
  select count(*)::text from requests where title like 'Hygiene breach%'$$,
  'still one', '1');

select '── hygiene: a form that raises nothing, raises nothing ──────────';

/*
 * The default, and what every form in every venue is. Turning this on is a
 * decision a venue makes per form, not one this migration makes for them.
 */
select t.expect_rows($$
  insert into haccp_records (form_id, covers_date, values, breach, breach_detail,
                             corrective_action, completed_by_email)
  select id, current_date, '{"Cleaned and checked":"no"}'::jsonb, true,
         'T-not done', 'T-rescheduled for the morning', 'chef@test.local'
    from haccp_forms where code='1.1'
      and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'a breach on a form nobody set to raise jobs', 1);
select t.expect_value($$
  select coalesce(raised_request_id::text, 'none') from haccp_records
   where breach_detail='T-not done'$$,
  'opens nothing, because that is the venue''s decision to make', 'none');

-- And the view says so, which is the point: a breach nobody was told about is
-- the finding, not an absence.
select t.expect_value($$
  select breaches_nobody_was_told_about::text from hygiene_by_unit
   where form_code='1.1' and unit_code='KITCHEN'$$,
  'and the board counts it as a breach nobody was told about', '1');

rollback;
