-- ---------------------------------------------------------------------------
-- A section set to NONE is not readable either (0079)
-- ---------------------------------------------------------------------------
-- 0036 promised that what somebody can reach is granted explicitly, and that
-- a hidden page is not a control. It enforced that for writes only. Every
-- read policy was "member of the venue", so somebody set to NONE on People
-- read performance reviews, exit notes, sick-note file names and leave notes
-- by calling the API, and a VIEWER read the takings and the contracts.
--
-- `section_read_rules` says, for every guarded table, which section its rows
-- belong to — or why the table is shared reference data every member reads.
-- These checks iterate it, so a table added later is checked the day it is.
-- ---------------------------------------------------------------------------

select '── section reads: every guarded table is classified ───────────────';

/*
 * The write guard already names a section for each of these tables. A new
 * one that is neither gated nor deliberately shared fails here.
 */
select t.expect_value($$
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_trigger g join pg_class c on c.oid = g.tgrelid
   where g.tgname = c.relname || '_section_guard'
     and c.relname <> 'requests'
     and not exists (select 1 from section_read_rules r where r.table_name = c.relname)$$,
  'every table with a section guard has a read rule or a reason it is shared', '');

select t.expect_value($$
  select coalesce(string_agg(r.table_name, ', ' order by r.table_name), '')
    from section_read_rules r
   where r.section_code is not null
     and exists (select 1 from pg_policy p
                  where p.polrelid = ('public.' || r.table_name)::regclass
                    and p.polcmd in ('r', '*')
                    and pg_get_expr(p.polqual, p.polrelid) ~ 'auth_org_ids\(\)'
                    and pg_get_expr(p.polqual, p.polrelid) !~ 'can_read_section\(')$$,
  'and no gated table is still readable on membership alone', '');

select '── section reads: NONE means none ────────────────────────────────';

begin;
set local role authenticated;

/*
 * nobody@ is a CHEF in the venue with every section set to NONE (fixtures).
 * Before 0079 a member like that read every one of these tables in full.
 * `query_to_xml` runs each count as the caller, so RLS applies.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select coalesce(string_agg(r.table_name, ', ' order by r.table_name), '')
    from section_read_rules r
   where r.section_code is not null
     and (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I', r.table_name),
                             false, true, '')))[1]::text::int > 0$$,
  'somebody with no section access reads nothing from any gated table', '');

select t.expect_value($$select count(*)::text from leave_requests$$,
  'not even approved leave', '0');

/*
 * The other half: a fix that hid everything from everybody would pass the
 * check above. chef@ holds WRITE everywhere and still reads the same rows.
 */
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select (count(*) > 0)::text from leave_requests$$,
  'somebody with People access still reads leave', 'true');
select t.expect_value($$select (count(*) > 0)::text from work_orders$$,
  'and somebody with Maintenance access, work orders', 'true');

/*
 * Shared reference data stays shared: the catalogue, the staff directory
 * and the venue's units are what every other section's screens are built on.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select (count(*) > 0)::text from products$$,
  'somebody with no section access still sees the catalogue other screens need', 'true');
select t.expect_value($$select (count(*) > 0)::text from member_access
                          where user_id = auth.uid()$$,
  'and their own access grid, so the app knows what to show them', 'true');
select t.expect_value($$select count(*)::text from member_access
                          where user_id <> auth.uid()$$,
  'but not everybody else''s', '0');

/*
 * The staff portal's own policies are untouched: staff@ has NONE everywhere
 * and is employee T-5.
 */
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_value($$select (count(*) >= 1)::text from employees where id = auth_employee_id()$$,
  'an employee still reads their own record through the portal', 'true');

rollback;
