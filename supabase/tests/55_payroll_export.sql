-- ---------------------------------------------------------------------------
-- A payroll file that cannot pay somebody twice (0114)
-- ---------------------------------------------------------------------------
-- Two things are proved here and they are not the same kind of thing.
--
-- The first is a defect. `attendance` applied an approved time correction and
-- `labour_cost_daily` did not, so somebody whose four-hour punch was
-- corrected to eight showed eight hours worked and was costed for four. Time
-- becomes pay, and a correction that is accepted and then quietly ignored is
-- the same failure as a punch that can be quietly edited.
--
-- The second is a control. The catastrophic failure in a payroll export is
-- not a wrong figure, it is a repeated one: a fortnight paid twice costs the
-- venue the fortnight and is very hard to claw back. So an exported period
-- refuses to be exported again, and the refusal names the run and the date.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on)
values ('b0000000-0000-4000-8000-000000550001', :'demo', 'T-PR1',
        'Pat', 'Payroll', current_date - 400);

-- `set_by_email` is enforced: a pay rate must record who set it, which is
-- the same rule the ledgers follow and for the same reason.
insert into pay_rates (org_id, employee_id, basis, amount, effective_from,
                       set_by_email)
values (:'demo', 'b0000000-0000-4000-8000-000000550001', 'HOURLY', 50000,
        current_date - 400, 'gm@test.local');

/*
 * Four hours on the clock. The correction below takes it to eight, which is
 * the figure that must reach the file.
 */
insert into time_entries (id, org_id, employee_id, clock_in_at, clock_out_at,
                          break_minutes, recorded_by_email)
values ('b0000000-0000-4000-8000-000000550010', :'demo',
        'b0000000-0000-4000-8000-000000550001',
        (current_date - 5 + time '09:00') at time zone 'UTC',
        (current_date - 5 + time '13:00') at time zone 'UTC',
        0, 'seed@test.local');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a correction that reaches the pay figure' as "──";

select t.expect_value($$
  select hours::text from labour_cost_daily
   where employee_id = 'b0000000-0000-4000-8000-000000550001'
     and on_date = current_date - 5$$,
  'four hours on the clock', '4.000');

select t.expect_rows($$
  insert into time_corrections
    (org_id, time_entry_id, corrected_clock_out_at, reason, status,
     requested_by_email, decided_by_email, decided_at)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000550010',
          (current_date - 5 + time '17:00') at time zone 'UTC',
          'forgot to clock out at the end of the shift', 'APPROVED',
          'pat@test.local', 'gm@test.local', now())$$,
  'the clock-out is corrected to five in the afternoon, and approved', 1);

/*
 * The assertion the defect hid behind. `attendance` has always moved with an
 * approved correction; before 0114 `labour_cost_daily` did not, so this read
 * 4.000 while the attendance screen said eight — and the eight was right.
 */
select t.expect_value($$
  select hours::text from labour_cost_daily
   where employee_id = 'b0000000-0000-4000-8000-000000550001'
     and on_date = current_date - 5$$,
  'and the pay figure moves with it, as attendance always did', '8.000');

select t.expect_value($$
  select cost::text from labour_cost_daily
   where employee_id = 'b0000000-0000-4000-8000-000000550001'
     and on_date = current_date - 5$$,
  'eight hours at fifty thousand', '400000.00');

select t.expect_value($$
  select hours_were_corrected::text from labour_cost_daily
   where employee_id = 'b0000000-0000-4000-8000-000000550001'
     and on_date = current_date - 5$$,
  'and the day says it was corrected rather than hiding it', 'true');

select '── an open punch is not a day of no work' as "──";

select t.fixture($$
  insert into time_entries (org_id, employee_id, clock_in_at, break_minutes,
                            recorded_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000550001',
          (current_date - 4 + time '09:00') at time zone 'UTC',
          0, 'seed@test.local')$$);

/*
 * Null hours, not zero. Somebody clocked in; a zero would say they worked a
 * shift of no length, and a payroll line reading zero hours for a day
 * somebody was in the building is how an underpayment gets signed off.
 */
select t.expect_value($$
  select coalesce(hours::text, 'unknown') from time_entries_effective
   where employee_id = 'b0000000-0000-4000-8000-000000550001'
     and still_open$$,
  'an open punch has no hours at all, rather than none', 'unknown');

select '── the run' as "──";

select t.expect_value(
  'select (public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 7, current_date - 1) is not null)::text',
  'a run is built as a draft', 'true');

select t.expect_value($$
  select hours::text || ' at ' || rate::text || ' = ' || gross::text
    from payroll_lines
   where employee_id = 'b0000000-0000-4000-8000-000000550001'$$,
  'carrying the corrected hours onto the line', '8.000 at 50000.00000 = 400000.00000');

select t.expect_value($$
  select corrections_applied::text from payroll_lines
   where employee_id = 'b0000000-0000-4000-8000-000000550001'$$,
  'and saying on the line that a correction is behind the figure', '1');

select t.expect_value($$
  select employee_name from payroll_lines
   where employee_id = 'b0000000-0000-4000-8000-000000550001'$$,
  'the name is copied onto the line, not joined — a file is a record of what was sent',
  'Pat Payroll');

select t.expect_value($$
  select status::text from payroll_runs order by built_at desc limit 1$$,
  'built and sent are different acts, so it starts as a draft', 'DRAFT');

select '── a period cannot be paid twice' as "──";

select t.expect_value($$
  select public.export_payroll_run(
    (select id from payroll_runs order by built_at desc limit 1))::text$$,
  'exporting it sends one line', '1');

/*
 * The control this file exists for. Overlapping by a single day is enough:
 * that day is in both files and gets paid twice.
 */
select t.expect_refused(
  'select public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 2, current_date + 5)',
  'a period overlapping an exported one is refused',
  'would be paid twice');

select t.expect_refused(
  'select public.export_payroll_run((select id from payroll_runs where status = ''EXPORTED'' limit 1))',
  'and an exported run cannot be exported a second time',
  'already exported');

select t.expect_value($$
  select count(*)::text from payroll_runs$$,
  'and nothing new was built', '1');

select '── a re-run says why' as "──";

select t.expect_refused(
  'select public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 7, current_date - 1, ' ||
  '(select id from payroll_runs where status = ''EXPORTED'' limit 1), null)',
  'superseding a run without a reason is refused',
  'say why');

select t.expect_value(
  'select (public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 7, current_date - 1, ' ||
  '(select id from payroll_runs where status = ''EXPORTED'' limit 1), ' ||
  '''the rate was wrong for the whole fortnight'') is not null)::text',
  'with a reason, the period can be run again', 'true');

select t.expect_value($$
  select public.export_payroll_run(
    (select id from payroll_runs where status = 'DRAFT' limit 1))::text$$,
  'and exported', '1');

/*
 * The earlier run is marked, not deleted. A file was sent to a bureau and no
 * amount of tidying up in here unsends it.
 */
select t.expect_value($$
  select string_agg(status::text, ',' order by status::text) from payroll_runs$$,
  'both runs stay on the record, one of them superseded', 'EXPORTED,SUPERSEDED');

select t.expect_value($$
  select reason from payroll_runs where status = 'EXPORTED'$$,
  'under the reason it was run again', 'the rate was wrong for the whole fortnight');

select '── nothing to send' as "──";

select t.expect_value(
  'select (public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 300, current_date - 290) is not null)::text',
  'a period nobody worked still builds', 'true');
select t.expect_refused($$
  select public.export_payroll_run(
    (select id from payroll_runs where status = 'DRAFT' limit 1))$$,
  'but exporting an empty file is refused rather than sent',
  'nothing to export');

select '── who may run payroll' as "──";

select t.expect_guarded('payroll_runs', 'PAY');
select t.expect_value($$
  select count(*)::text from section_read_rules
   where table_name in ('payroll_runs', 'payroll_lines')$$,
  'both are registered in the read-rules registry', '2');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_refused(
  'select public.build_payroll_run(' || quote_literal(:'demo') ||
  '::uuid, current_date - 60, current_date - 50)',
  'somebody with no Pay access builds nothing',
  -- 0116 made the message name the scope, because the commonest reason to
  -- hit it is now a head of department who holds Pay on one unit.
  'Pay access across the venue');
select t.expect_value($$
  select count(*)::text from payroll_lines$$,
  'nor reads anybody''s wages', '0');

reset role;
rollback;
