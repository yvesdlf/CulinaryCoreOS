-- ---------------------------------------------------------------------------
-- Erasing a person without erasing the records the law says to keep (0080)
-- ---------------------------------------------------------------------------
-- Deleting an employee used to cascade through their working time, leave,
-- pay and HR cases — records a venue must keep — while leaving their email
-- copied into dozens of other tables, untouched. Wrong in both directions.
--
-- Now a person is anonymised, by an owner, once, with a record of it; the
-- statutory rows stay and stop saying who they were about. GDPR Art. 17(3)(b)
-- is why the rows stay; Art. 5(1)(e) is why the name does not.
-- ---------------------------------------------------------------------------

select '── erasure: statutory records outlive a deleted employee ────────';

select t.expect_value($$
  select coalesce(string_agg(c.conrelid::regclass::text, ', ' order by 1), '')
    from pg_constraint c
   where c.confrelid = 'public.employees'::regclass
     and c.contype = 'f'
     and c.conrelid in ('public.time_entries'::regclass, 'public.leave_requests'::regclass,
                        'public.pay_rates'::regclass, 'public.hr_cases'::regclass)
     and c.confdeltype <> 'r'$$,
  'working time, leave, pay and HR cases do not vanish with the employee', '');

begin;

insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at, recorded_by_email)
select org_id, id, now() - interval '9 hours', now() - interval '1 hour', 'staff@test.local'
  from employees where employee_number = 'T-5'
   and org_id = (select id from organizations where name = 'Demo Kitchen');
insert into employee_private (employee_id, org_id, national_id, bank_account)
select id, org_id, 'T-ID-123', 'T-IBAN-456' from employees
 where employee_number = 'T-5'
   and org_id = (select id from organizations where name = 'Demo Kitchen');

select t.expect_fail($$delete from employees where employee_number = 'T-5'$$,
  'an employee with working time on record cannot be deleted');

-- Passed as a value, as the API passes it: the function switches triggers
-- off on the tables it touches, which Postgres refuses while the calling
-- statement is itself reading one of them.
select id as t5 from employees
 where employee_number = 'T-5'
   and org_id = (select id from organizations where name = 'Demo Kitchen') \gset

select '── erasure: anonymising is the owner''s, once, on the record ──────';

set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_fail(format($$select public.anonymise_person(%L, 'T-DSR-1')$$, :'t5'),
  'a chef cannot anonymise anybody');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_fail(format($$select public.anonymise_person(%L, '')$$, :'t5'),
  'nor can an owner without a request reference to answer for it');
select t.expect_ok(format($$select public.anonymise_person(%L, 'T-DSR-1')$$, :'t5'),
  'an owner can, citing the request');

reset role;

select t.expect_value($$
  select (first_name <> 'Self' and work_email is null and user_id is null)::text
    from employees where employee_number = 'T-5'$$,
  'the record no longer says who it was', 'true');
select t.expect_value($$
  select count(*)::text from employee_private p
    join employees e on e.id = p.employee_id where e.employee_number = 'T-5'$$,
  'their identity documents and bank account are gone', '0');
select t.expect_value($$
  select count(*)::text from time_entries t
    join employees e on e.id = t.employee_id where e.employee_number = 'T-5'$$,
  'their working time is still on record', '1');

/*
 * Every column named *_email in every table, asked whether it still holds the
 * address. Iterated rather than listed: a table added next year with a new
 * `*_email` copy is covered the day it exists.
 */
select t.expect_value($$
  with candidates as materialized (
    select c.table_name, c.column_name
      from information_schema.columns c
      join pg_class k on k.relname = c.table_name
                     and k.relnamespace = 'public'::regnamespace and k.relkind = 'r'
     where c.table_schema = 'public' and c.column_name like '%\_email')
  select coalesce(string_agg(c.table_name || '.' || c.column_name, ', '), '')
    from candidates c
   where (xpath('/row/n/text()', query_to_xml(
            format('select count(*) as n from public.%I where lower(%I) = %L',
                   c.table_name, c.column_name, 'staff@test.local'),
            false, true, '')))[1]::text::int > 0$$,
  'and their address is no longer copied anywhere', '');

select t.expect_value($$
  select coalesce(string_agg(distinct c.relname, ', '), '')
    from pg_trigger g join pg_class c on c.oid = g.tgrelid
   where c.relnamespace = 'public'::regnamespace
     and not g.tgisinternal and g.tgenabled = 'D'$$,
  'every guard it switched off to do that is switched back on', '');

select t.expect_value($$
  select count(*)::text from privacy_actions where request_ref = 'T-DSR-1'$$,
  'the anonymisation is itself on record', '1');

select '── erasure: a sick note can be deleted, by an owner, on record ──';

insert into leave_attachments (org_id, leave_request_id, file_path, file_name, content_type)
select l.org_id, l.id, l.org_id || '/T-note.pdf', 'T-note.pdf', 'application/pdf'
  from leave_requests l join employees e on e.id = l.employee_id
 where e.employee_number = 'T-3';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_fail($$select public.delete_sick_note(
    (select id from leave_attachments where file_name = 'T-note.pdf'), 'T-DSR-2')$$,
  'a chef cannot delete a sick note');
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_ok($$select public.delete_sick_note(
    (select id from leave_attachments where file_name = 'T-note.pdf'), 'T-DSR-2')$$,
  'an owner can, citing the request');
reset role;
select t.expect_value($$
  select (select count(*) from leave_attachments where file_name = 'T-note.pdf')
      || '/' || (select count(*) from storage_deletions where path like '%/T-note.pdf' and deleted_at is null)
      || '/' || (select count(*) from privacy_actions where request_ref = 'T-DSR-2')$$,
  'the row is gone, the file is queued for the storage job, and it is on record', '0/1/1');

select t.expect_value($$
  select (has_table_privilege('authenticated', 'public.privacy_actions', 'update')
       or has_table_privilege('authenticated', 'public.privacy_actions', 'delete'))::text$$,
  'and that record cannot be edited or removed', 'false');

rollback;
