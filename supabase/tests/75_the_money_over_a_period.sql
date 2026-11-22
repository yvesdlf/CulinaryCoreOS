-- ---------------------------------------------------------------------------
-- The money, over a period you choose (0136)
-- ---------------------------------------------------------------------------
-- `financial_summary` is the number a dashboard leads with: the venue P&L
-- summed over one range, which the front end asks for three times to build the
-- this-period / last-period / year-ago comparison. Four things it must get
-- right:
--
--   The range is a range. A day outside [from, to] must not be in the sum —
--   the obvious one, and the one a dashboard quietly gets wrong when "this
--   month" leaks a day of next month's lunch.
--
--   Average spend is net over covers, not the average of each day's average.
--   A quiet Tuesday and a full Saturday do not weigh the same, and a function
--   that averaged the per-day averages would say they did. The fixture below
--   is built so the two answers differ (15,000 weighted vs 16,667 naive), so
--   the check can tell them apart.
--
--   One venue, the one the reader is in. `unit_profit_daily` is shared across
--   a reader's venues; without the explicit scope a reader in two would get
--   both hotels' takings summed into one P&L.
--
--   No access, no figures. The function reads as the caller, and the sources
--   are gated on REVENUE, PAY and the recipe sections, so a reader without
--   them sees nothing rather than a venue's money.
--
-- Takings on default units and channels the org-creation trigger makes, dated
-- three hundred days back so neither the demo seed nor the other fixtures
-- share the window.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as bar from business_units where org_id = :'demo' and code = 'BAR' \gset
select id as till from revenue_channels where org_id = :'demo' and code = 'TILL' \gset

/*
 * Three days in the period and one outside it. Covers and gross are chosen so
 * the weighted average (600,000 / 40 = 15,000) is nowhere near the average of
 * the daily averages ((10,000 + 30,000 + 10,000) / 3 = 16,667).
 */
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   source, recorded_by_email, note)
values
  (:'demo', :'bar', :'till', current_date - 300, 100000, 10, 'SAMPLE', 'x@test.local', 'T-75'),
  (:'demo', :'bar', :'till', current_date - 299, 300000, 10, 'SAMPLE', 'x@test.local', 'T-75'),
  (:'demo', :'bar', :'till', current_date - 298, 200000, 20, 'SAMPLE', 'x@test.local', 'T-75'),
  -- Far outside the window the assertions use.
  (:'demo', :'bar', :'till', current_date - 500, 900000, 90, 'SAMPLE', 'x@test.local', 'T-75');

select '── financial summary: the period is the sheet''s own ────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.financial_summary(null, current_date)$$,
  'a financial summary with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.financial_summary(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select t.expect_value($$
  select net_revenue::text from public.financial_summary(
    current_date - 300, current_date - 298)$$,
  'net revenue is summed over the three days in the period', '600000.00000');

select t.expect_value($$
  select covers::text from public.financial_summary(
    current_date - 300, current_date - 298)$$,
  'and so are the covers', '40');

select t.expect_value($$
  select days_with_data::text from public.financial_summary(
    current_date - 300, current_date - 298)$$,
  'three distinct days had data', '3');

select t.expect_value($$
  select net_revenue::text from public.financial_summary(
    current_date - 300, current_date - 299)$$,
  'a narrower window excludes the day it does not reach', '400000.00000');

select '── financial summary: average spend is weighted, not averaged ──';

select t.expect_value($$
  select avg_spend::text from public.financial_summary(
    current_date - 300, current_date - 298)$$,
  'average spend is net over covers, not the mean of the daily means',
  '15000.00');

select '── financial summary: one venue ────────────────────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000750', 'T-75 Other Venue', 't75-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000750',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');
insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000750',
       'a0000000-0000-0000-0000-000000000002', code, 'WRITE' from app_sections;
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000751',
        'e0000000-0000-4000-8000-000000000750', 'OBAR', 'Other bar');
insert into revenue_channels (id, org_id, code, name, kind)
values ('e0000000-0000-4000-8000-000000000752',
        'e0000000-0000-4000-8000-000000000750', 'OTILL', 'Other till', 'DINE_IN');
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   source, recorded_by_email, note)
values ('e0000000-0000-4000-8000-000000000750',
        'e0000000-0000-4000-8000-000000000751',
        'e0000000-0000-4000-8000-000000000752',
        current_date - 300, 555000, 5, 'SAMPLE', 'x@test.local', 'T-75-other');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select net_revenue::text from public.financial_summary(
    current_date - 300, current_date - 298)$$,
  'the other venue''s takings are not in this venue''s summary', '600000.00000');

select t.expect_rows($$
  select 1 from public.daily_takings where note = 'T-75-other'$$,
  'even though the reader can see that venue''s takings directly', 1);

select '── financial summary: who may read any of it ───────────────────';

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.financial_summary(date,date)', 'execute')::text$$,
  'a signed-out caller is not granted it at all', 'false');

rollback;
