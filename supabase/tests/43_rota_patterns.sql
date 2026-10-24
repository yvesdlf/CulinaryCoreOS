-- ---------------------------------------------------------------------------
-- A rota is built from a pattern (0101)
-- ---------------------------------------------------------------------------
-- The two rules worth proving: a generated week is a draft, so the rota's
-- existing checks still run when somebody publishes it; and an approved
-- swap moves the shift through `shifts`, so those same checks run on the
-- person who ends up working rather than being stepped around.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t1 from employees where employee_number = 'T-1' and org_id = :'demo' \gset
select id as t2 from employees where employee_number = 'T-2' and org_id = :'demo' \gset

select '── a pattern drafts a week' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into shift_templates (org_id, name, weekday, starts_at_time, ends_at_time, headcount)
  values ((select id from organizations where name='Demo Kitchen'),
          'T-Monday lunch', 1, time '10:00', time '16:00', 2)$$,
  'a pattern is recorded', 1);
select t.expect_rows($$
  insert into shift_templates (org_id, name, weekday, starts_at_time, ends_at_time)
  values ((select id from organizations where name='Demo Kitchen'),
          'T-Monday night', 1, time '22:00', time '04:00')$$,
  'including one that crosses midnight', 1);

select t.expect_value($$select generate_rota_week(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-11-02')::text$$,
  'generating a week makes a shift per head', '3');

reset role;
select t.expect_value($$select count(*)::text from shifts
                         where notes like 'From the T-Monday lunch pattern'$$,
  'two for the lunch pattern', '2');

/*
 * Drafts, never published. enforce_shift_rules only runs its certificate
 * and employment checks on a PUBLISHED shift, so generating published
 * shifts with nobody on them would create a way onto a rota with none of
 * the checks the rota has.
 */
select t.expect_value($$select (bool_and(status = 'DRAFT') and bool_and(employee_id is null))::text
                          from shifts where notes like 'From the T-%'$$,
  'all of them drafts with nobody on them, so the rota''s own checks still run',
  'true');

select t.expect_value($$select (max(ends_at) > max(starts_at))::text from shifts
                         where notes = 'From the T-Monday night pattern'$$,
  'and the night shift ends after it starts', 'true');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select generate_rota_week(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-11-02')::text$$,
  'running it twice does not double the week', '0');

select '── somebody can say when they cannot work' as "──";

select t.expect_rows($$
  insert into staff_availability (employee_id, weekday, available, note)
  values ((select id from employees where employee_number='T-1'), 2, false, 'college')$$,
  'a repeating unavailability is recorded', 1);
select t.expect_refused($$
  insert into staff_availability (employee_id, weekday, on_date, available)
  values ((select id from employees where employee_number='T-1'), 2, current_date, false)$$,
  'but not one that is both a weekday and a date', 'staff_availability_when');

-- 2026-11-03 is a Tuesday.
select t.expect_value($$select is_available(
    (select id from employees where employee_number='T-1'),
    timestamptz '2026-11-03 10:00+00', timestamptz '2026-11-03 16:00+00')::text$$,
  'so they are not available that Tuesday', 'false');
select t.expect_value($$select is_available(
    (select id from employees where employee_number='T-1'),
    timestamptz '2026-11-04 10:00+00', timestamptz '2026-11-04 16:00+00')::text$$,
  'and are on the Wednesday', 'true');

/*
 * A specific date beats the repeating rule, because "I cannot work
 * Tuesdays, but I can this Tuesday" is a thing people say and it is the
 * later, more deliberate statement.
 */
select t.expect_rows($$
  insert into staff_availability (employee_id, on_date, available)
  values ((select id from employees where employee_number='T-1'), date '2026-11-03', true)$$,
  'a specific date can override the pattern', 1);
select t.expect_value($$select is_available(
    (select id from employees where employee_number='T-1'),
    timestamptz '2026-11-03 10:00+00', timestamptz '2026-11-03 16:00+00')::text$$,
  'and does', 'true');

select t.expect_value($$select is_available(
    (select id from employees where employee_number='T-2'),
    timestamptz '2026-11-03 10:00+00', timestamptz '2026-11-03 16:00+00')::text$$,
  'somebody who has said nothing is available', 'true');

select '── a swap goes through the rota, not around it' as "──";

reset role;
insert into shifts (id, org_id, employee_id, starts_at, ends_at, status)
values ('b0000000-0000-4000-8000-000000080001', :'demo', :'t1',
        timestamptz '2026-11-05 10:00+00', timestamptz '2026-11-05 16:00+00', 'PUBLISHED');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into shift_swap_requests (shift_id, from_employee_id, reason)
  values ('b0000000-0000-4000-8000-000000080001',
          (select id from employees where employee_number='T-1'), 'family')$$,
  'somebody offers their shift', 1);
select t.expect_refused($$
  update shift_swap_requests set status = 'ACCEPTED'
   where shift_id = 'b0000000-0000-4000-8000-000000080001'$$,
  'and it cannot be accepted before anybody has offered to take it',
  'nobody has offered');

select t.expect_rows($$
  update shift_swap_requests
     set to_employee_id = (select id from employees where employee_number='T-2'),
         status = 'ACCEPTED'
   where shift_id = 'b0000000-0000-4000-8000-000000080001'$$,
  'somebody takes it', 1);
select t.expect_rows($$
  update shift_swap_requests set status = 'APPROVED'
   where shift_id = 'b0000000-0000-4000-8000-000000080001'$$,
  'and a manager approves it', 1);

reset role;
select t.expect_value($$select (employee_id = (select id from employees where employee_number='T-2'))::text
                          from shifts where id = 'b0000000-0000-4000-8000-000000080001'$$,
  'the shift now belongs to the person who took it', 'true');
select t.expect_value($$select (notes like '%Swapped%')::text from shifts
                         where id = 'b0000000-0000-4000-8000-000000080001'$$,
  'and says so', 'true');

select t.expect_refused($$
  insert into shift_swap_requests (shift_id, from_employee_id, to_employee_id)
  values ('b0000000-0000-4000-8000-000000080001',
          (select id from employees where employee_number='T-1'),
          (select id from employees where employee_number='T-1'))$$,
  'nobody swaps with themselves', 'shift_swap_not_self');

select '── rostering over a stated unavailability is noted, not refused' as "──";

reset role;
insert into shifts (id, org_id, employee_id, starts_at, ends_at, status)
values ('b0000000-0000-4000-8000-000000080002', :'demo', :'t2',
        timestamptz '2026-11-10 10:00+00', timestamptz '2026-11-10 16:00+00', 'DRAFT');
insert into staff_availability (employee_id, on_date, available)
values (:'t2', date '2026-11-10', false);
update shifts set status = 'PUBLISHED' where id = 'b0000000-0000-4000-8000-000000080002';

select t.expect_value($$select (notes like '%against stated availability%')::text
                          from shifts where id = 'b0000000-0000-4000-8000-000000080002'$$,
  'the clash is on the record, and the manager still made it', 'true');

select t.expect_guarded('shift_templates', 'PEOPLE');

rollback;
