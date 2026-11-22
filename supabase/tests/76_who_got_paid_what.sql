-- ---------------------------------------------------------------------------
-- Who got paid what, over a period you choose (0137)
-- ---------------------------------------------------------------------------
-- `payroll_report` rolls `labour_cost_daily` up per person over a range. Five
-- things it has to get right, and each is seeded so a wrong implementation
-- gives a different, visible answer:
--
--   The range is a range. Hours and cost are the sum of the days inside it;
--   a shift outside must not be in the total. A narrower window proves the
--   day it does not reach is left out.
--
--   The effective hourly is cost over hours worked, not a rate read off one
--   day. The kitchen employee below is paid 40,000 for the first shift and
--   50,000 for the second (a raise landed between them), so the true
--   effective rate over the range is 45,000 — a number neither day's rate
--   equals, which a function that just echoed "the rate" could never produce.
--
--   One row per person, gated. `labour_cost_daily` is already filtered to the
--   outlets whose Pay the caller may read, so the roll-up inherits it: a head
--   of department holding Pay on the kitchen sees the kitchen's wage and not
--   front of house's, and somebody holding Pay nowhere sees no wages at all.
--
--   One venue, the one the reader is in. A reader who also owns another venue
--   must get this venue's payroll, not both summed.
--
--   No signed-out caller holds it.
--
-- Employees, rates and clock-ins are seeded here on test units dated near the
-- run, so neither the demo seed nor the other fixtures fall in the window.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into business_units (id, org_id, code, name) values
  ('b0000000-0000-4000-8000-000000760001', :'demo', 'ZK7', 'T76 Kitchen'),
  ('b0000000-0000-4000-8000-000000760002', :'demo', 'ZF7', 'T76 Front');

insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on, business_unit_id) values
  ('b0000000-0000-4000-8000-000000760010', :'demo', 'T76-K1', 'Dewa', 'Kitchen',
   current_date - 300, 'b0000000-0000-4000-8000-000000760001'),
  ('b0000000-0000-4000-8000-000000760011', :'demo', 'T76-F1', 'Wayan', 'Front',
   current_date - 300, 'b0000000-0000-4000-8000-000000760002');

-- The kitchen employee got a raise between the two shifts: 40,000 then 50,000.
insert into pay_rates (org_id, employee_id, basis, amount, effective_from,
                       set_by_email) values
  (:'demo', 'b0000000-0000-4000-8000-000000760010', 'HOURLY', 40000,
   current_date - 300, 'gm@test.local'),
  (:'demo', 'b0000000-0000-4000-8000-000000760010', 'HOURLY', 50000,
   current_date - 2, 'gm@test.local'),
  (:'demo', 'b0000000-0000-4000-8000-000000760011', 'HOURLY', 40000,
   current_date - 300, 'gm@test.local');

-- Kitchen: an 8h shift three days back (at 40,000) and another one day back
-- (at 50,000). Front of house: one 8h shift one day back.
insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at,
                          break_minutes, recorded_by_email) values
  (:'demo', 'b0000000-0000-4000-8000-000000760010',
   (current_date - 3 + time '09:00') at time zone 'UTC',
   (current_date - 3 + time '17:00') at time zone 'UTC', 0, 'seed@test.local'),
  (:'demo', 'b0000000-0000-4000-8000-000000760010',
   (current_date - 1 + time '09:00') at time zone 'UTC',
   (current_date - 1 + time '17:00') at time zone 'UTC', 0, 'seed@test.local'),
  (:'demo', 'b0000000-0000-4000-8000-000000760011',
   (current_date - 1 + time '09:00') at time zone 'UTC',
   (current_date - 1 + time '17:00') at time zone 'UTC', 0, 'seed@test.local');

select '── payroll: the period is the sheet''s own ──────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_refused($$
  select * from public.payroll_report(null, current_date)$$,
  'a payroll report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.payroll_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select '── payroll: hours and cost are summed over the range ───────────';

select t.expect_value($$
  select hours::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-K1'$$,
  'both of the kitchen shifts in the range are counted', '16.000');

select t.expect_value($$
  select labour_cost::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-K1'$$,
  'at the rate in force on each day: 8h*40000 + 8h*50000', '720000.00');

select t.expect_value($$
  select days_worked::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-K1'$$,
  'two distinct days were worked', '2');

select t.expect_value($$
  select hours::text from public.payroll_report(current_date - 3, current_date - 3)
   where employee_number = 'T76-K1'$$,
  'a narrower window excludes the shift it does not reach', '8.000');

select '── payroll: effective hourly is cost over hours, not a day''s rate ──';

select t.expect_value($$
  select avg_hourly::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-K1'$$,
  'the effective rate is 720000/16 = 45000, neither day''s rate alone',
  '45000.00');

select '── payroll: one row per person, gated to the reader''s outlets ──';

select t.expect_value($$
  select count(*)::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number in ('T76-K1', 'T76-F1')$$,
  'the venue-wide holder sees both of this fixture''s employees', '2');

/*
 * chef@ is given everything by the fixtures, so its unscoped Pay is revoked
 * first and replaced with Pay on the kitchen alone — otherwise the gating
 * check below would pass for the wrong reason.
 */
reset role;
select t.act_as_nobody();
delete from member_access
 where user_id = 'a0000000-0000-0000-0000-000000000002'
   and section_code = 'PAY';
insert into member_access (org_id, user_id, section_code, level, business_unit_id)
values (:'demo', 'a0000000-0000-0000-0000-000000000002', 'PAY', 'READ',
        'b0000000-0000-4000-8000-000000760001');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from public.payroll_report(current_date - 3, current_date - 1)$$,
  'a head of department over the kitchen sees exactly one line', '1');

select t.expect_value($$
  select employee_name from public.payroll_report(current_date - 3, current_date - 1)$$,
  'and it is their own department''s', 'Dewa Kitchen');

select t.expect_value($$
  select count(*)::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-F1'$$,
  'front of house''s wage is not theirs to read', '0');

select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_value($$
  select count(*)::text from public.payroll_report(current_date - 3, current_date - 1)$$,
  'somebody holding Pay nowhere reads no wages', '0');

select '── payroll: one venue, the one the reader is in ────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000760', 'T-76 Other Venue', 't76-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000760',
        'a0000000-0000-0000-0000-000000000001', 'OWNER');
insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000760',
       'a0000000-0000-0000-0000-000000000001', code, 'WRITE' from app_sections;
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000001', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000761',
        'e0000000-0000-4000-8000-000000000760', 'OK', 'Other kitchen');
insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on, business_unit_id)
values ('e0000000-0000-4000-8000-000000000762',
        'e0000000-0000-4000-8000-000000000760', 'T76-O1', 'Other', 'Cook',
        current_date - 300, 'e0000000-0000-4000-8000-000000000761');
insert into pay_rates (org_id, employee_id, basis, amount, effective_from,
                       set_by_email)
values ('e0000000-0000-4000-8000-000000000760',
        'e0000000-0000-4000-8000-000000000762', 'HOURLY', 99000,
        current_date - 300, 'gm@test.local');
insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at,
                          break_minutes, recorded_by_email)
values ('e0000000-0000-4000-8000-000000000760',
        'e0000000-0000-4000-8000-000000000762',
        (current_date - 1 + time '09:00') at time zone 'UTC',
        (current_date - 1 + time '17:00') at time zone 'UTC', 0, 'seed@test.local');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from public.payroll_report(current_date - 3, current_date - 1)
   where employee_number = 'T76-O1'$$,
  'the other venue''s employee is not in this venue''s payroll', '0');

select '── payroll: who may read any of it ─────────────────────────────';

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.payroll_report(date,date)', 'execute')::text$$,
  'a signed-out caller is not granted it at all', 'false');

rollback;
