-- ---------------------------------------------------------------------------
-- What an hour of work costs (0064)
-- ---------------------------------------------------------------------------
-- This is the most sensitive table in the schema, and the only one narrowed on
-- *read* rather than on write. The checks are in that order: who may look,
-- before what the numbers say.
--
-- The rule most worth proving is the one that is cheapest to get wrong and
-- most expensive to discover: last month stays calculated at last month's
-- rate. A system that recalculates a closed period when somebody types a rise
-- does it silently, and the figure still looks like money.
-- ---------------------------------------------------------------------------

begin;

select '── pay: nobody has it by default ────────────────────────────────';

/*
 * `seed_member_access` grants an ADMIN every section. That was right for every
 * section that existed when it was written and is wrong for this one, so 0064
 * carves out exactly one and leaves the rest of the rule alone.
 *
 * Asked by creating a member, not by counting the table. The fixtures hand
 * chef@test.local WRITE on every section by selecting from `app_sections`, so
 * a count would be counting the fixtures' own grant and reporting it as a
 * default — a test passing, or in this case failing, for the wrong reason.
 */
select t.fixture($$
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values ('a0000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'newjoiner@test.local','x', now(), now(), now()) $$);
select t.fixture($$
  insert into organization_members (organization_id, user_id, role)
  select id, 'a0000000-0000-0000-0000-00000000000a', 'ADMIN'
    from organizations where name='Demo Kitchen' limit 1 $$);

select t.expect_value($$
  select count(*)::text from member_access
   where user_id='a0000000-0000-0000-0000-00000000000a' and level <> 'NONE'$$,
  'a new administrator is granted most of the platform',
  (select (count(*) - 1)::text from app_sections));
select t.expect_value($$
  select count(*)::text from member_access
   where user_id='a0000000-0000-0000-0000-00000000000a' and section_code='PAY'$$,
  'and Pay is the one section they are not', '0');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 50000, current_date - 60
    from employees where employee_number='T-1'$$,
  'somebody without the grant cannot set a rate');

select '── pay: a rate is a period ──────────────────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 50000, current_date - 60
    from employees where employee_number='T-1'$$,
  'an hourly rate from two months ago', 1);
select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 60000, current_date - 10
    from employees where employee_number='T-1'$$,
  'and a rise ten days ago', 1);

select t.expect_value($$
  select amount::text from pay_rate_on(
    (select id from employees where employee_number='T-1'), current_date - 30)$$,
  'a day before the rise costs the old rate', '50000.00000');
select t.expect_value($$
  select amount::text from pay_rate_on(
    (select id from employees where employee_number='T-1'), current_date - 1)$$,
  'and a day after it costs the new one', '60000.00000');

-- The whole point. A rise does not reach backwards.
select t.expect_value($$
  select count(*)::text from pay_rate_on(
    (select id from employees where employee_number='T-1'), current_date - 90)$$,
  'and a day before any rate was set costs nothing — not zero, nothing', '0');

select t.expect_fail($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 70000, current_date - 10
    from employees where employee_number='T-1'$$,
  'two rates cannot start on the same day');

select '── pay: a rate in force does not move ───────────────────────────';

/*
 * The rule that makes "last month stays calculated at last month's rate" true
 * by construction rather than by everybody being careful.
 */
select t.expect_fail($$
  update pay_rates set amount = 999999
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date - 60$$,
  'a rate that has been in force cannot be edited');
select t.expect_value($$
  select amount::text from pay_rates
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date - 60$$,
  'and the figure is unchanged afterwards', '50000.00000');

select t.expect_fail($$
  delete from pay_rates
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date - 60$$,
  'nor deleted');

-- A rate that has not taken effect is a plan, and a plan may be corrected.
select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 65000, current_date + 30
    from employees where employee_number='T-1'$$,
  'a rate starting next month', 1);
select t.expect_rows($$
  update pay_rates set amount = 66000
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date + 30$$,
  'can be corrected, because nothing has been costed with it', 1);
select t.expect_value($$
  select amount::text from pay_rates
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date + 30$$,
  'and the correction is actually there', '66000.00000');

-- And it cannot be dragged into the past to take effect retrospectively.
select t.expect_fail($$
  update pay_rates set effective_from = current_date - 5
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date + 30$$,
  'but it cannot be moved to a date that has already passed');

select '── pay: the rate records who set it ─────────────────────────────';

select t.expect_value($$
  select set_by_email from pay_rates
   where employee_id=(select id from employees where employee_number='T-1')
     and effective_from = current_date - 10$$,
  'the rise is filed under the person who typed it', 'owner@test.local');

select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from, set_by_email)
  select id, 'HOURLY', 55000, current_date - 5, 'somebody.else@test.local'
    from employees where employee_number='T-2'$$,
  'a rate claiming a different author is accepted', 1);
select t.expect_value($$
  select set_by_email from pay_rates
   where employee_id=(select id from employees where employee_number='T-2')$$,
  'and filed under the caller anyway — 0054, in a table where it matters more',
  'owner@test.local');

select '── pay: a rate belongs to its own venue ─────────────────────────';

select t.expect_value($$
  select count(*)::text from pay_rates p
   join employees e on e.id = p.employee_id
  where p.org_id <> e.org_id$$,
  'the venue comes from the employee, never from the client', '0');

select '── pay: hours times rate ────────────────────────────────────────';

/*
 * One clocked shift, eight hours less a thirty-minute break, at the rate in
 * force that day. Checked rather than assumed, because every number on the
 * labour report is this calculation.
 */
select t.expect_rows($$
  insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at, break_minutes)
  select o.id, (select id from employees where employee_number='T-1'),
         (current_date - 20 + time '09:00') at time zone 'UTC',
         (current_date - 20 + time '17:00') at time zone 'UTC',
         30
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'somebody worked a shift twenty days ago', 1);

select t.expect_value($$
  select hours::text from labour_cost_daily
   where employee_id=(select id from employees where employee_number='T-1')
     and on_date = current_date - 20$$,
  'seven and a half hours after the break', '7.500');
select t.expect_value($$
  select cost::text from labour_cost_daily
   where employee_id=(select id from employees where employee_number='T-1')
     and on_date = current_date - 20$$,
  'at the rate in force then, not the rate in force now', '375000.00');

select '── pay: a salary costs the same whether they worked or not ──────';

/*
 * Collapsing a salary into an hourly equivalent is wrong on exactly the days
 * anybody cares about — a quiet Tuesday, a closure — and the error is
 * invisible because the figure still looks like money.
 */
-- Fixed dates, not `current_date - n`. A salary is divided by the days in its
-- own month, so an assertion written against "today minus sixty" says
-- something different in February from in August.
select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'MONTHLY', 31000000, date '2026-01-01'
    from employees where employee_number='T-3'$$,
  'a salaried employee', 1);
select t.expect_rows($$
  insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at, break_minutes)
  select o.id, (select id from employees where employee_number='T-3'),
         (date '2026-01-10' + time '09:00') at time zone 'UTC',
         (date '2026-01-10' + time '10:00') at time zone 'UTC',
         0
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'who turned up for one hour in a 31-day month', 1);
select t.expect_value($$
  select cost::text from labour_cost_daily
   where employee_id=(select id from employees where employee_number='T-3')
     and on_date = date '2026-01-10'$$,
  'and costs a day of salary, not an hour of it', '1000000.00');

select '── pay: nobody without the grant sees a figure ──────────────────';

/*
 * Narrowed on read, which is unlike every other table here. Asked as
 * `authenticated` because the suite's own connection owns these tables and is
 * exempt from row-level security — see _harness.sql.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$select count(*)::text from pay_rates$$,
  'somebody with no Pay grant sees no rates at all', '0');
select t.expect_value($$select count(*)::text from labour_cost_daily$$,
  'and no labour cost either, which would difference back to a rate', '0');

-- The insider sees them, so the two lines above are testing a refusal rather
-- than an empty table. Without this pair the whole section passes against no
-- data at all, which is the third false pass in _harness.sql.
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$select count(*)::text from pay_rates$$,
  'the owner sees every one, so the refusal above was a refusal', '5');

reset role;

rollback;
