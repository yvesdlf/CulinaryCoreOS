-- ---------------------------------------------------------------------------
-- A forecast somebody can argue with (0107)
-- ---------------------------------------------------------------------------
-- The check most worth having here is the channel one, and it is worth having
-- because the first draft of `build_sales_forecast` got it wrong.
--
-- `daily_takings` is one row per channel per day. Averaging the rows averages
-- *channels*: a Tuesday selling through the till and through a delivery app
-- counts as two half-Tuesdays, and a unit that opened a second channel part
-- way through the sample appears to have halved its covers. The arithmetic is
-- plausible either way — 80 is a perfectly believable number of covers — so
-- nothing on screen would have said anything was wrong.
--
-- Hence the sample below has a second channel on exactly one of the three
-- sampled days. Per-day aggregation gives 106.67 covers from three days;
-- per-row averaging gives 80 from four. One assertion separates them.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

-- A unit of this file's own. Venue-wide assertions in this suite have gone red
-- twice because another file, or a demo click, wrote real takings into the
-- seeded outlets.
insert into business_units (id, org_id, code, name)
-- Codes that differ in their first three letters: `unit_code` takes a
-- three-character prefix and `idx_business_units_prefix` is unique on it, so
-- T-FCU and T-FCU2 are the same outlet as far as the venue tree is concerned.
values ('b0000000-0000-4000-8000-0000000f0001', :'demo', 'T-ALPHA', 'T-Forecast outlet'),
       ('b0000000-0000-4000-8000-0000000f0002', :'demo', 'T-BETA', 'T-Forecast quiet outlet');

/*
 * A fixed date rather than one relative to today, so the sample days are the
 * same weekday by construction (minus 7, 14 and 21) and the file does not
 * behave differently depending on which day of the week CI runs on.
 */
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   recorded_by_email)
select :'demo', 'b0000000-0000-4000-8000-0000000f0001',
       (select id from revenue_channels where code = 'TILL' and org_id = :'demo'),
       d.on_date, d.gross, d.covers, 'seed@test.local'
  from (values (date '2026-03-03', 10000000, 100),
               (date '2026-02-24',  8000000,  80),
               (date '2026-02-17', 12000000, 120),
               -- A different weekday, which must not enter the sample at all.
               (date '2026-03-04', 99000000, 500)) as d(on_date, gross, covers);

/*
 * staff@ gets Revenue on the quiet outlet and nothing else, for the
 * unit-scoping check at the foot of the file. Written here, as the owner,
 * because `reset role` does not clear `request.jwt.claims`: done down there it
 * ran as staff@ themself and was refused for want of Administration.
 */
insert into member_access (org_id, user_id, section_code, level, business_unit_id)
values (:'demo', 'a0000000-0000-0000-0000-000000000004', 'REVENUE', 'WRITE',
        'b0000000-0000-4000-8000-0000000f0002');

select '── the registries, asked as the owner' as "──";

/*
 * `organization_seeders` has its grants revoked and row-level security with no
 * policy, so these two are asked before the role switch rather than after.
 */
select t.expect_value($$
  select count(*)::text from organization_seeders
   where function_name = 'seed_forecast_parameter'$$,
  'the sample size is seeded through the registry, not a migration body', '1');

select t.expect_value($$
  select value::text from venue_parameters
   where code = 'FORECAST_WEEKS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and every existing venue already has it', '6.00000');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── the sample is the same weekday, and only that weekday' as "──";

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0001')::text$$,
  'one forecast is written', '1');

select t.expect_value($$
  select covers::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and it averages the three same-weekday days, ignoring the Wednesday',
  '100.00');

select t.expect_value($$
  select samples_used::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'from three days of evidence, which it says', '3');

select t.expect_value($$
  select net_sales::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and the net average too', '10000000.00000');

select '── a second channel is more of that day, not another day' as "──";

/*
 * The assertion this file exists for. 20 extra covers through a delivery app
 * on one of the three sampled days.
 *
 *   per-day  (120 + 80 + 120) / 3 = 106.67 from 3 days   ← correct
 *   per-row  (100 + 20 + 80 + 120) / 4 =  80 from 4 rows ← the first draft
 */
select t.fixture($$
  insert into daily_takings
    (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
     recorded_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-0000000f0001',
          (select id from revenue_channels where code='DELIVERY'
             and org_id=(select id from organizations where name='Demo Kitchen')),
          date '2026-03-03', 2000000, 20, 'seed@test.local')$$);

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0001')::text$$,
  'the forecast is rebuilt', '1');

select t.expect_value($$
  select covers::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'the delivery covers add to their day rather than diluting the average',
  '106.67');

select t.expect_value($$
  select samples_used::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and it is still three days, not four rows', '3');

select '── a bank holiday is not a normal Tuesday' as "──";

select t.fixture($$
  insert into public_holidays (org_id, name, holiday_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'T-Forecast holiday', date '2026-02-17')$$);

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0001')::text$$,
  'rebuilt with the holiday excluded', '1');

select t.expect_value($$
  select samples_used::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'the holiday leaves the sample', '2');

select t.expect_value($$
  select covers::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and the figure is the average of what is left', '100.00');

select '── what the average cannot know' as "──";

select t.fixture($$
  insert into known_events (org_id, business_unit_id, on_date, name, covers_override)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-0000000f0001',
          date '2026-03-10', 'T-Wedding', 300)$$);

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0001')::text$$,
  'rebuilt with the wedding on it', '1');

select t.expect_value($$
  select covers::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'an override replaces the average outright', '300.00');

select t.expect_value($$
  select note from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and says why the figure is not the arithmetic', 'Adjusted for T-Wedding');

select t.fixture($$ delete from known_events where name = 'T-Wedding' $$);
select t.fixture($$
  insert into known_events (org_id, business_unit_id, on_date, name, covers_extra)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-0000000f0001',
          date '2026-03-10', 'T-Coach party', 50)$$);

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0001')::text$$,
  'rebuilt with a coach party instead', '1');

select t.expect_value($$
  select covers::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'extra covers are added to the average, not substituted for it', '150.00');

/*
 * "Ninety on top of a normal Tuesday" and "ninety instead of one" are
 * different bookings and only the person entering it knows which, so the
 * column cannot be allowed to mean both at once.
 */
select t.expect_refused($$
  insert into known_events (org_id, business_unit_id, on_date, name,
                            covers_override, covers_extra)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-0000000f0001',
          date '2026-03-11', 'T-Both at once', 300, 50)$$,
  'an event cannot both replace and add', 'known_events_one_way');

select t.expect_refused($$
  insert into known_events (org_id, on_date, name)
  values ((select id from organizations where name='Demo Kitchen'),
          date '2026-03-11', '   ')$$,
  'nor go unnamed', 'known_events_named');

select '── no evidence is not a confident zero' as "──";

select t.expect_value($$
  select public.build_sales_forecast(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-03-10', 'b0000000-0000-4000-8000-0000000f0002')::text$$,
  'an outlet with no trading history gets no forecast', '0');

select t.expect_value($$
  select count(*)::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0002'$$,
  'rather than a forecast of nothing', '0');

select '── how good it turned out to be' as "──";

select t.fixture($$
  update sales_forecasts set actual_covers = 120
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10' $$);

select t.expect_value($$
  select covers_error_percent::text from forecast_accuracy
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'the error is reported against what happened', '25.0');

select t.expect_value($$
  select thin_evidence::text from forecast_accuracy
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-10'$$,
  'and two days of evidence is flagged as thin', 'true');

select '── who may write one' as "──";

select t.expect_guarded('sales_forecasts', 'REVENUE');

select t.expect_value($$
  select count(*)::text from section_read_rules
   where table_name in ('sales_forecasts', 'known_events')$$,
  'both tables are registered in the read-rules registry', '2');

reset role;
select t.act_as_nobody();
set local role authenticated;

/*
 * The organisation is named by its id rather than looked up by name, and that
 * is not tidiness. `(select id from organizations where name='Demo Kitchen')`
 * is evaluated as the caller, and a caller with no membership cannot see the
 * row — so the subquery yields null, the function finds no business units to
 * consider, and it returns 0 without refusing anything. The first draft of
 * this check passed a null organisation and called the result a refusal it
 * never made: the first false pass in _harness.sql wearing a different hat.
 */
select t.expect_refused(
  'select public.build_sales_forecast(' || quote_literal(:'demo') ||
  '::uuid, date ''2026-03-17'', ''b0000000-0000-4000-8000-0000000f0001''::uuid)',
  'somebody with no Revenue access cannot build one',
  'edit access to Revenue');

/*
 * Unit-scoped, which is the half the first draft of this function got wrong
 * in both directions at once: it gated on the organisation, so a manager
 * holding one outlet was refused everywhere, and once past the gate it would
 * have written forecasts for outlets they hold nothing on.
 *
 * The two checks below refuse for different reasons, and it is worth saying
 * which, because they read identically on screen. staff@ is a member, so the
 * section guard on the table stops them — deleting the function's own check
 * leaves this one green. nobody@ has no JWT at all, and `require_section_write`
 * returns early in that case by design, so the function's check is the only
 * thing in front of them: with it removed, the check above goes red and a
 * forecast is written by nobody at all.
 */
select '── a grant on one outlet is a grant on one outlet' as "──";
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');

select t.expect_refused(
  'select public.build_sales_forecast(' || quote_literal(:'demo') ||
  '::uuid, date ''2026-03-17'', ''b0000000-0000-4000-8000-0000000f0001''::uuid)',
  'the outlet they hold nothing on is refused, not silently skipped',
  'edit access to Revenue');

select t.expect_value(
  'select public.build_sales_forecast(' || quote_literal(:'demo') ||
  '::uuid, date ''2026-03-17'', ''b0000000-0000-4000-8000-0000000f0002''::uuid)::text',
  'and the one they hold is theirs to forecast — with no history, nothing to write',
  '0');

select t.expect_value($$
  select count(*)::text from sales_forecasts
   where business_unit_id = 'b0000000-0000-4000-8000-0000000f0001'
     and forecast_for = date '2026-03-17'$$,
  'and nothing was written for it', '0');

reset role;
rollback;
