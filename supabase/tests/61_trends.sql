-- ---------------------------------------------------------------------------
-- A trend that says how much of each period is real (0120)
-- ---------------------------------------------------------------------------
-- Aggregating days into weeks is the easy half and nothing here tests it very
-- hard. The half worth proving is the one that stops a chart lying:
--
--   A month four days old holds a quarter of a month's revenue. Beside last
--   month's bar it reads as a collapse, somebody acts on it, and the figure
--   was never wrong — the comparison was. So every bucket says how many of
--   its days carried data and whether the period has finished, and both are
--   asserted here against periods built to be incomplete in each way.
--
-- The other is the percentages. A margin on no revenue is not nought per
-- cent, and a trend line that plotted zero would show a venue falling off a
-- cliff on a day it was closed.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into business_units (id, org_id, code, name) values
  ('b0000000-0000-4000-8000-000000610001', :'demo', 'T-TRND', 'T-Trend outlet'),
  ('b0000000-0000-4000-8000-000000610002', :'demo', 'T-OTHR', 'T-Other outlet');

/*
 * Two whole weeks and one that has only just started.
 *
 * The dates are anchored to the Monday of the current week so the buckets
 * line up with `date_trunc('week', ...)` whatever day the suite runs on —
 * a fixture pinned to literal dates would drift in and out of the right
 * bucket depending on the weekday.
 */
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   recorded_by_email)
select :'demo', 'b0000000-0000-4000-8000-000000610001',
       (select id from revenue_channels where code = 'TILL' and org_id = :'demo'),
       d::date, 1000000, 50, 'seed@test.local'
  from generate_series(
    date_trunc('week', current_date)::date - 14,
    date_trunc('week', current_date)::date - 1,
    interval '1 day') d;

-- One day only, in the week that is still running.
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   recorded_by_email)
values (:'demo', 'b0000000-0000-4000-8000-000000610001',
        (select id from revenue_channels where code = 'TILL'
          and org_id = :'demo'),
        date_trunc('week', current_date)::date, 300000, 10, 'seed@test.local');

-- A different outlet, so the unit filter has something to exclude.
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   recorded_by_email)
values (:'demo', 'b0000000-0000-4000-8000-000000610002',
        (select id from revenue_channels where code = 'TILL'
          and org_id = :'demo'),
        date_trunc('week', current_date)::date - 7, 9000000, 400,
        'seed@test.local');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select '── days add up into periods' as "──";

select t.expect_value($$
  select revenue_net::text from public.profit_trend(
    current_date - 30, current_date, 'week',
    'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date - 7$$,
  'a whole week is the sum of its seven days', '7000000.00000');

select t.expect_value($$
  select days_with_data::text || '/' || days_in_period::text
    from public.profit_trend(
      current_date - 30, current_date, 'week',
      'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date - 7$$,
  'and says it had all seven of them', '7/7');

select '── the period that has not finished' as "──";

/*
 * The assertion this file exists for. One day of trading in a week that is
 * still running: a third of a million against seven million the week before.
 * Drawn as a bar beside it that is a collapse; the two facts below are what
 * stop a screen reading it that way.
 */
select t.expect_value($$
  select is_open::text from public.profit_trend(
    current_date - 30, current_date, 'week',
    'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date$$,
  'the current week says it has not finished', 'true');

select t.expect_value($$
  select (days_with_data < days_in_period)::text from public.profit_trend(
    current_date - 30, current_date, 'week',
    'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date$$,
  'and that it holds fewer days than the period it covers', 'true');

select t.expect_value($$
  select (is_open or days_with_data = days_in_period)::text
    from public.profit_trend(
      current_date - 30, current_date, 'week',
      'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date - 14$$,
  'while a week that finished with every day in it claims neither', 'true');

select '── up or down comes with the row' as "──";

/*
 * A column rather than something a screen works out by looking at the row
 * above. A screen doing that arithmetic is a second place for it to be
 * wrong, and it does not know which buckets are comparable.
 */
select t.expect_value($$
  select previous_revenue_net::text from public.profit_trend(
    current_date - 30, current_date, 'week',
    'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date$$,
  'each period carries the one before it', '7000000.00000');

select t.expect_value($$
  select coalesce(previous_revenue_net::text, 'none')
    from public.profit_trend(
      current_date - 30, current_date, 'week',
      'b0000000-0000-4000-8000-000000610001')
   where period_start = date_trunc('week', current_date)::date - 14$$,
  'and the first period in the window has nothing before it', 'none');

select '── one outlet, not the venue' as "──";

select t.expect_value($$
  select revenue_net::text from public.profit_trend(
    current_date - 30, current_date, 'week',
    'b0000000-0000-4000-8000-000000610002')
   where period_start = date_trunc('week', current_date)::date - 7$$,
  'asking about one outlet excludes the others', '9000000.00000');

select '── a margin on no revenue is not nought per cent' as "──";

select t.fixture($$
  insert into business_units (id, org_id, code, name)
  values ('b0000000-0000-4000-8000-000000610003',
          (select id from organizations where name='Demo Kitchen'),
          'T-ZERO', 'T-Closed outlet')$$);
select t.fixture($$
  insert into daily_takings
    (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
     recorded_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000610003',
          (select id from revenue_channels where code='TILL'
             and org_id=(select id from organizations where name='Demo Kitchen')),
          date_trunc('week', current_date)::date - 7, 0, 0, 'seed@test.local')$$);

/*
 * A day the venue was closed. Plotting nought per cent would draw a cliff on
 * a day nothing happened — the margin is not zero, there is no margin.
 */
select t.expect_value($$
  select coalesce(gross_profit_percent::text, 'no percentage')
    from public.profit_trend(
      current_date - 30, current_date, 'week',
      'b0000000-0000-4000-8000-000000610003')$$,
  'a period with no revenue has no margin rather than a margin of nought',
  'no percentage');

select '── what it refuses to bucket by' as "──";

/*
 * `date_trunc` accepts 'microseconds' perfectly happily. A bucket per
 * microsecond over ten weeks is not a report.
 */
select t.expect_refused($$
  select * from public.profit_trend(
    current_date - 30, current_date, 'microseconds')$$,
  'a grain nobody meant is refused rather than attempted',
  'cannot be bucketed by');

select t.expect_ok($$
  select * from public.profit_trend(current_date - 400, current_date, 'month')$$,
  'months are fine');
select t.expect_ok($$
  select * from public.profit_trend(current_date - 400, current_date, 'quarter')$$,
  'and quarters');

select '── who may read it' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$
  select count(*)::text from public.profit_trend(
    current_date - 30, current_date, 'week')$$,
  'somebody with no Pay access trends nothing, because the daily view is theirs to see or not',
  '0');

reset role;
rollback;
