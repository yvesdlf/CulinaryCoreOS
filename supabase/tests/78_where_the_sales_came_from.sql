-- ---------------------------------------------------------------------------
-- Where the sales came from (0139)
-- ---------------------------------------------------------------------------
-- `sales_by_channel` groups the venue's takings by channel over a range. What
-- it has to get right, each seeded so a wrong version answers differently:
--
--   The range is a range. A channel's total is the days inside it; a day
--   outside must not be in the sum.
--
--   Average spend is net over covers, weighted — not the mean of each day's
--   average. The till below is built so the two differ (10,000 weighted vs
--   16,667 naive).
--
--   Commission percent is of gross, share is of net, and the shares across
--   the channels add to a hundred. The delivery line gives up a quarter to
--   commission, which is the figure the report exists to make visible.
--
--   One venue, the one the reader is in.
--
-- net_amount is a generated column (gross minus commission), so the numbers
-- here are exact. Seeded on a test outlet dated near the run.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into business_units (id, org_id, code, name) values
  ('b0000000-0000-4000-8000-000000780001', :'demo', 'ZS1', 'T78 outlet');

insert into revenue_channels (id, org_id, code, name, kind) values
  ('b0000000-0000-4000-8000-000000780050', :'demo', 'ZSA', 'T78 till', 'DINE_IN'),
  ('b0000000-0000-4000-8000-000000780051', :'demo', 'ZSB', 'T78 delivery', 'DELIVERY');

-- Till: two days in range (no commission), one day outside it.
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   commission_amount, source, recorded_by_email, note) values
  (:'demo', 'b0000000-0000-4000-8000-000000780001',
   'b0000000-0000-4000-8000-000000780050', current_date - 300, 300000, 10,
   null, 'SAMPLE', 'x@test.local', 'T-78'),
  (:'demo', 'b0000000-0000-4000-8000-000000780001',
   'b0000000-0000-4000-8000-000000780050', current_date - 298, 100000, 30,
   null, 'SAMPLE', 'x@test.local', 'T-78'),
  -- Outside the window the assertions use.
  (:'demo', 'b0000000-0000-4000-8000-000000780001',
   'b0000000-0000-4000-8000-000000780050', current_date - 340, 999999, 99,
   null, 'SAMPLE', 'x@test.local', 'T-78'),
  -- Delivery: one day in range, a quarter of gross taken in commission.
  (:'demo', 'b0000000-0000-4000-8000-000000780001',
   'b0000000-0000-4000-8000-000000780051', current_date - 300, 200000, 5,
   50000, 'SAMPLE', 'x@test.local', 'T-78');

select '── sales: the period is the sheet''s own ───────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_refused($$
  select * from public.sales_by_channel(null, current_date)$$,
  'a sales report with no period is refused', 'needs a period');

select t.expect_refused($$
  select * from public.sales_by_channel(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select '── sales: summed over the range, the day outside left out ──────';

select t.expect_value($$
  select net::text from public.sales_by_channel(current_date - 300, current_date - 298)
   where channel_code = 'ZSA'$$,
  'the till is 300000 + 100000, not the 999999 day outside the window',
  '400000.00000');

select t.expect_value($$
  select covers::text from public.sales_by_channel(current_date - 300, current_date - 298)
   where channel_code = 'ZSA'$$,
  'and its covers are the two days in range', '40');

select '── sales: average spend is weighted, not the mean of means ─────';

select t.expect_value($$
  select avg_spend::text from public.sales_by_channel(current_date - 300, current_date - 298)
   where channel_code = 'ZSA'$$,
  'net over covers (400000/40 = 10000), not (30000+3333)/2 = 16667',
  '10000.00');

select '── sales: commission is of gross, share is of net ─────────────';

select t.expect_value($$
  select commission_percent::text from public.sales_by_channel(
    current_date - 300, current_date - 298) where channel_code = 'ZSB'$$,
  'the delivery platform took a quarter of gross: 50000/200000', '25.0');

select t.expect_value($$
  select commission_percent::text from public.sales_by_channel(
    current_date - 300, current_date - 298) where channel_code = 'ZSA'$$,
  'and the till took none, which reads as 0.0 not blank', '0.0');

select t.expect_value($$
  select share_of_net::text from public.sales_by_channel(
    current_date - 300, current_date - 298) where channel_code = 'ZSB'$$,
  'delivery is 150000 of 550000 net = 27.3% of what the venue kept', '27.3');

select t.expect_value($$
  select round(sum(share_of_net))::text from public.sales_by_channel(
    current_date - 300, current_date - 298) where channel_code in ('ZSA','ZSB')$$,
  'and the channels'' shares add to a hundred', '100');

select '── sales: one venue, the one the reader is in ─────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000780', 'T-78 Other Venue', 't78-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000780',
        'a0000000-0000-0000-0000-000000000001', 'OWNER');
insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000780',
       'a0000000-0000-0000-0000-000000000001', code, 'WRITE' from app_sections;
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000001', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000781',
        'e0000000-0000-4000-8000-000000000780', 'ZO8', 'Other outlet');
insert into revenue_channels (id, org_id, code, name, kind)
values ('e0000000-0000-4000-8000-000000000782',
        'e0000000-0000-4000-8000-000000000780', 'ZOB', 'Other till', 'DINE_IN');
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   source, recorded_by_email, note)
values ('e0000000-0000-4000-8000-000000000780',
        'e0000000-0000-4000-8000-000000000781',
        'e0000000-0000-4000-8000-000000000782',
        current_date - 300, 777000, 70, 'SAMPLE', 'x@test.local', 'T-78-other');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from public.sales_by_channel(current_date - 300, current_date - 298)
   where channel_code = 'ZOB'$$,
  'the other venue''s channel is not in this venue''s sales', '0');

select '── sales: who may read any of it ───────────────────────────────';

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.sales_by_channel(date,date)', 'execute')::text$$,
  'a signed-out caller is not granted it at all', 'false');

rollback;
