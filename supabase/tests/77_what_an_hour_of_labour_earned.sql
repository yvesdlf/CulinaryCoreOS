-- ---------------------------------------------------------------------------
-- What an hour of labour earned (0138)
-- ---------------------------------------------------------------------------
-- `labour_productivity` divides an outlet's takings and covers by the hours
-- clocked against it, and counts the heads those hours were spread across.
-- The things it has to get right, each seeded so a wrong version answers
-- differently:
--
--   Per hour is per hour. Covers over labour hours, on fixtures built so the
--   ratio is a round number no other denominator (heads, days, cost) hits.
--
--   Nothing to divide by is null, not zero. An outlet that took money with
--   nobody clocked on has no productivity to report — per-hour must come back
--   null, never a zero that reads as "worked an hour for nothing" and never a
--   division error.
--
--   The head count is the distinct people, not the shifts.
--
--   The range is a range, and the venue is the reader's own.
--
-- Takings, employees, rates and clock-ins are seeded here on test units dated
-- near the run so neither the demo seed nor the other fixtures fall in it.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into business_units (id, org_id, code, name) values
  ('b0000000-0000-4000-8000-000000770001', :'demo', 'ZP1', 'T77 Busy outlet'),
  ('b0000000-0000-4000-8000-000000770002', :'demo', 'ZQ2', 'T77 Quiet outlet');

insert into revenue_channels (id, org_id, code, name, kind) values
  ('b0000000-0000-4000-8000-000000770050', :'demo', 'ZT7', 'T77 till', 'DINE_IN');

-- Busy outlet: two dates in the range (covers 32 each) and one outside it.
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   source, recorded_by_email, note) values
  (:'demo', 'b0000000-0000-4000-8000-000000770001',
   'b0000000-0000-4000-8000-000000770050', current_date - 3, 4000000, 32,
   'SAMPLE', 'x@test.local', 'T-77'),
  (:'demo', 'b0000000-0000-4000-8000-000000770001',
   'b0000000-0000-4000-8000-000000770050', current_date - 1, 4000000, 32,
   'SAMPLE', 'x@test.local', 'T-77'),
  (:'demo', 'b0000000-0000-4000-8000-000000770001',
   'b0000000-0000-4000-8000-000000770050', current_date - 40, 9000000, 90,
   'SAMPLE', 'x@test.local', 'T-77'),
  -- Quiet outlet: takings, but nobody ever clocked on.
  (:'demo', 'b0000000-0000-4000-8000-000000770002',
   'b0000000-0000-4000-8000-000000770050', current_date - 3, 2000000, 20,
   'SAMPLE', 'x@test.local', 'T-77');

-- Two people in the busy outlet, each an 8h shift on both in-range dates
-- (= 32 labour hours), plus one out-of-range shift that must not be counted.
insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on, business_unit_id) values
  ('b0000000-0000-4000-8000-000000770010', :'demo', 'T77-1', 'Ayu', 'One',
   current_date - 300, 'b0000000-0000-4000-8000-000000770001'),
  ('b0000000-0000-4000-8000-000000770011', :'demo', 'T77-2', 'Eka', 'Two',
   current_date - 300, 'b0000000-0000-4000-8000-000000770001');

insert into pay_rates (org_id, employee_id, basis, amount, effective_from,
                       set_by_email)
select :'demo', e.id, 'HOURLY', 50000, current_date - 300, 'gm@test.local'
  from employees e where e.employee_number in ('T77-1', 'T77-2');

insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at,
                          break_minutes, recorded_by_email)
select :'demo', e.id, g.ci, g.co, 0, 'seed@test.local'
  from employees e
  cross join (values
    ((current_date - 3 + time '09:00') at time zone 'UTC',
     (current_date - 3 + time '17:00') at time zone 'UTC'),
    ((current_date - 1 + time '09:00') at time zone 'UTC',
     (current_date - 1 + time '17:00') at time zone 'UTC'),
    -- Outside the window the assertions use.
    ((current_date - 40 + time '09:00') at time zone 'UTC',
     (current_date - 40 + time '17:00') at time zone 'UTC')
  ) g(ci, co)
 where e.employee_number in ('T77-1', 'T77-2');

select '── productivity: the period is the sheet''s own ────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_refused($$
  select * from public.labour_productivity(null, current_date)$$,
  'a productivity report with no period is refused', 'needs a period');

select t.expect_refused($$
  select * from public.labour_productivity(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select '── productivity: per hour is per hour, over the range ──────────';

select t.expect_value($$
  select labour_hours::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZP1'$$,
  'the out-of-range shift is not in the hours: 2 people * 8h * 2 days',
  '32.000');

select t.expect_value($$
  select covers_per_hour::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZP1'$$,
  'covers over hours: 64 covers / 32 hours, not over heads or days', '2.00');

select t.expect_value($$
  select people::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZP1'$$,
  'the head count is the two distinct people, not the four shifts', '2');

select t.expect_value($$
  select (revenue_per_hour > 0)::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZP1'$$,
  'and revenue per hour is a real figure where hours were worked', 'true');

select '── productivity: nothing to divide by is null, not zero ────────';

select t.expect_value($$
  select coalesce(revenue_per_hour::text, 'null')
    from public.labour_productivity(current_date - 3, current_date - 1)
   where unit_code = 'ZQ2'$$,
  'the outlet that took money with nobody clocked on has null per-hour',
  'null');

select t.expect_value($$
  select people::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZQ2'$$,
  'and no heads, rather than an error dividing by them', '0');

select '── productivity: one venue, the one the reader is in ───────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000770', 'T-77 Other Venue', 't77-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000770',
        'a0000000-0000-0000-0000-000000000001', 'OWNER');
insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000770',
       'a0000000-0000-0000-0000-000000000001', code, 'WRITE' from app_sections;
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000001', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000771',
        'e0000000-0000-4000-8000-000000000770', 'ZO3', 'Other outlet');
insert into revenue_channels (id, org_id, code, name, kind)
values ('e0000000-0000-4000-8000-000000000772',
        'e0000000-0000-4000-8000-000000000770', 'ZO7', 'Other till', 'DINE_IN');
insert into daily_takings
  (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
   source, recorded_by_email, note)
values ('e0000000-0000-4000-8000-000000000770',
        'e0000000-0000-4000-8000-000000000771',
        'e0000000-0000-4000-8000-000000000772',
        current_date - 3, 7000000, 70, 'SAMPLE', 'x@test.local', 'T-77-other');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from public.labour_productivity(
    current_date - 3, current_date - 1) where unit_code = 'ZO3'$$,
  'the other venue''s outlet is not in this venue''s productivity', '0');

select '── productivity: who may read any of it ────────────────────────';

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.labour_productivity(date,date)', 'execute')::text$$,
  'a signed-out caller is not granted it at all', 'false');

rollback;
