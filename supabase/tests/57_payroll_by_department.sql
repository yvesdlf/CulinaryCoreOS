-- ---------------------------------------------------------------------------
-- A head of department sees their own department (0116)
-- ---------------------------------------------------------------------------
-- The assertion this file exists for is the negative one. It is easy to
-- write a rule that shows the executive chef the kitchen's wages and much
-- easier than it looks to write one that also shows them front of house —
-- `can_read_section` without a unit matches only unscoped grants, and the
-- obvious fixes for that go too far in one direction or the other.
--
-- So both directions are asserted, for the same person, in the same run: the
-- kitchen's line is visible and front of house's is not, and neither answer
-- is allowed to be an accident of there being nothing to see.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into business_units (id, org_id, code, name) values
  ('b0000000-0000-4000-8000-000000570001', :'demo', 'T-KITCH', 'T-Kitchen'),
  ('b0000000-0000-4000-8000-000000570002', :'demo', 'T-FRONT', 'T-Front of house');

insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on, business_unit_id) values
  ('b0000000-0000-4000-8000-000000570010', :'demo', 'T-DK1', 'Ketut', 'Cook',
   current_date - 300, 'b0000000-0000-4000-8000-000000570001'),
  ('b0000000-0000-4000-8000-000000570011', :'demo', 'T-DF1', 'Wayan', 'Waiter',
   current_date - 300, 'b0000000-0000-4000-8000-000000570002'),
  -- Filed under no department at all, which is the case that decides whether
  -- "unassigned" reads as nobody's or as everybody's.
  ('b0000000-0000-4000-8000-000000570012', :'demo', 'T-DX1', 'Nyoman', 'Nowhere',
   current_date - 300, null);

insert into pay_rates (org_id, employee_id, basis, amount, effective_from,
                       set_by_email)
select :'demo', e.id, 'HOURLY', 40000, current_date - 300, 'gm@test.local'
  from employees e where e.employee_number in ('T-DK1', 'T-DF1', 'T-DX1');

insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at,
                          break_minutes, recorded_by_email)
select :'demo', e.id,
       (current_date - 3 + time '09:00') at time zone 'UTC',
       (current_date - 3 + time '17:00') at time zone 'UTC',
       0, 'seed@test.local'
  from employees e where e.employee_number in ('T-DK1', 'T-DF1', 'T-DX1');

/*
 * Three readers.
 *
 *   owner@  holds Pay across the venue — the general manager, HR or finance.
 *   chef@   holds Pay on the kitchen and nothing else — a head of department.
 *   staff@  holds Pay nowhere.
 *
 * chef@ is given everything by the fixtures, so its unscoped Pay is revoked
 * first: a head of department who also holds the venue-wide grant would pass
 * every check below for the wrong reason.
 */
delete from member_access
 where user_id = 'a0000000-0000-0000-0000-000000000002'
   and section_code = 'PAY';
insert into member_access (org_id, user_id, section_code, level, business_unit_id)
values (:'demo', 'a0000000-0000-0000-0000-000000000002', 'PAY', 'READ',
        'b0000000-0000-4000-8000-000000570001');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select '── the run is built by somebody who can see all of it' as "──";

select t.expect_value(
  'select (public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 7, current_date - 1) is not null)::text',
  'the venue-wide holder builds the run', 'true');

select t.expect_value($$
  select count(*)::text from payroll_lines$$,
  'with a line for each of the three', '3');

select t.expect_value($$
  select business_unit_code from payroll_lines
   where employee_number = 'T-DK1'$$,
  'and the unit on the line', 'T-KITCH');

select '── a head of department sees their own' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from payroll_runs$$,
  'they can see that the run exists at all', '1');

select t.expect_value($$
  select employee_name from payroll_lines$$,
  'and exactly one line: their own department''s', 'Ketut Cook');

/*
 * The assertion the file exists for. Front of house is in this run, it has a
 * wage on it, and the executive chef must not be able to read it.
 */
select t.expect_value($$
  select count(*)::text from payroll_lines
   where employee_number = 'T-DF1'$$,
  'front of house is not theirs to read', '0');

/*
 * Nor is the person filed under no department. "Unassigned" reads as
 * nobody's rather than as everybody's — the other way round, one unassigned
 * employee would be visible to every head of department in the venue.
 */
select t.expect_value($$
  select count(*)::text from payroll_lines
   where employee_number = 'T-DX1'$$,
  'and neither is the employee in no department', '0');

select t.expect_value($$
  select gross::text from payroll_lines$$,
  'the wage they can see is a real one, not an empty row', '320000.00000');

select '── and knows that is what they are seeing' as "──";

/*
 * A partial view that does not say it is partial reads as the whole venue,
 * and a head of department signing off a total they think is complete is the
 * failure this prevents.
 */
select t.expect_value($$
  select sees_whole_venue::text || ': ' || array_to_string(units_visible, ',')
    from my_pay_scope$$,
  'the screen can say which departments it is showing', 'false: T-Kitchen');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select sees_whole_venue::text from my_pay_scope$$,
  'and that the venue-wide holder is seeing all of it', 'true');

select t.expect_value($$
  select count(*)::text from payroll_lines$$,
  'who still sees every line', '3');

select '── and the rates behind those wages' as "──";

/*
 * `pay_rates` is guarded by Pay too, and its policy was organisation-wide.
 * Left alone it would have shown a head of department their team's payroll
 * lines and none of the rates behind them — a permission that reads as given
 * and behaves as refused on half the section, which is the thing 0062 is
 * about.
 */
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$
  select count(*)::text from pay_rates$$,
  'the head of department sees their own department''s rates', '1');

select t.expect_value($$
  select count(*)::text from pay_rates r
    join employees e on e.id = r.employee_id
   where e.employee_number = 'T-DF1'$$,
  'and not front of house''s', '0');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select count(*)::text from pay_rates$$,
  'while the venue-wide holder sees all three', '3');
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a head of department does not run payroll' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * A run covers every employee, including the ones this person cannot see.
 * Somebody who cannot read the whole file must not be the one who sends it.
 */
select t.expect_refused(
  'select public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 60, current_date - 50)',
  'building a run needs Pay across the venue, not one department',
  'across the venue');

select t.expect_refused(
  'select public.export_payroll_run((select id from payroll_runs limit 1))',
  'and so does sending one', 'edit access to Pay');

select '── the daily figure follows the same rule' as "──";

select t.expect_value($$
  select count(distinct employee_id)::text from labour_cost_daily
   where on_date = current_date - 3$$,
  'a head of department sees their own department''s labour cost', '1');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select count(distinct employee_id)::text from labour_cost_daily
   where on_date = current_date - 3$$,
  'and the venue-wide holder sees all three', '3');

select '── Pay nowhere is still nothing' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_value($$
  select count(*)::text from payroll_lines$$,
  'somebody with no Pay access reads no wages', '0');
select t.expect_value($$
  select count(*)::text from payroll_runs$$,
  'nor even that a run happened', '0');

reset role;
rollback;
