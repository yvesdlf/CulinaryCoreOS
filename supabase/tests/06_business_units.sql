-- ---------------------------------------------------------------------------
-- Business units (0058)
-- ---------------------------------------------------------------------------
-- The migration that merged `departments` and `cost_centres` moved twelve
-- foreign keys and turned both old names into views. Three kinds of thing can
-- go wrong with that and only the first is obvious:
--
--   the merge did not merge          — a department and a cost centre with the
--                                      same code ended up as two units, and
--                                      the seam is still there under a new
--                                      name
--   a reference was left behind      — a row whose unit used to be known now
--                                      points at nothing, which reads as "no
--                                      unit set" rather than as an error
--   the compatibility view is a hole — `departments` is writable, and a shim
--                                      that writes round the section guard
--                                      would hand away the whole tree
--
-- So the assertions below read the outcome rather than the absence of an
-- error, and the ones about who may write are run as somebody, not as the
-- console.
-- ---------------------------------------------------------------------------
begin;

/*
 * The row-visibility checks further down need `set role authenticated`,
 * because psql connects as `postgres`, who bypasses row-level security — and
 * every other file in this directory therefore proves its rules through
 * triggers rather than through policies. Granting schema `t` to that role is
 * what lets the harness functions still be called once the role has changed.
 * It is granted inside the transaction and goes away with the rollback.
 */
-- (the grant that makes this possible is in _harness.sql)

select '── units: the two trees are one ─────────────────────────────────';

-- Both old names still answer, and every row in each resolves to a unit. A
-- department left behind would read as an empty join, not as a failure.
select t.expect_value($$select count(*)::text from departments d
  where not exists (select 1 from business_units b where b.id = d.id)$$,
  'no department is left without a unit', '0');
select t.expect_value($$select count(*)::text from cost_centres c
  where not exists (select 1 from business_units b where b.id = c.id)$$,
  'no cost centre is left without a unit', '0');

-- The point of the exercise: the kitchen department and the kitchen cost
-- centre are the same row, not two rows that agree.
select t.expect_value($$select (d.id = c.id)::text
  from departments d join cost_centres c on lower(c.code) = lower(d.code)
 where d.code = 'KITCHEN'
   and d.org_id = (select id from organizations where name='Demo Kitchen' limit 1)$$,
  'the kitchen department and the kitchen cost centre are one row', 'true');

-- The column that used to hold the two trees together now points at the row
-- itself, so the joins in 0037 and 0040 that read it still resolve.
select t.expect_value($$select count(*)::text from departments
  where cost_centre_id is distinct from id$$,
  'a unit is its own cost centre, on every row', '0');

select '── units: nothing lost its unit in the move ─────────────────────';

/*
 * Eleven tables carry the new column. A row that had a unit and now has none
 * is the expensive failure here, because it looks like a row nobody costed
 * rather than like a migration that dropped something.
 */
select t.expect_value($$
  select sum(n)::text from (
    select count(*) n from requisitions    where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from purchase_orders where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from budgets         where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from locations       where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from work_orders     where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from meters          where cost_centre_id is not null and business_unit_id is null
    union all select count(*) from job_roles       where department_id  is not null and business_unit_id is null
    union all select count(*) from employees       where department_id  is not null and business_unit_id is null
    union all select count(*) from shifts          where department_id  is not null and business_unit_id is null
    union all select count(*) from department_approvers where department_id is not null and business_unit_id is null
    union all select count(*) from hiring_requests where department_id  is not null and business_unit_id is null
  ) x$$,
  'no row kept a legacy unit and lost the new one', '0');

-- And the reverse: a unit named on the new column that no unit answers to.
select t.expect_value($$
  select count(*)::text from locations l
   where l.business_unit_id is not null
     and not exists (select 1 from business_units b where b.id = l.business_unit_id)$$,
  'and none points at a unit that does not exist', '0');

select '── units: the question the two trees could not answer ───────────';

/*
 * "What did the bar spend on staff" needed `shifts` and `purchase_orders` to
 * meet, and they had nowhere to. This is that join, with rows in it.
 */
select t.expect_rows($$
  update shifts set business_unit_id =
    (select id from business_units where code='KITCHEN'
      and org_id=(select id from organizations where name='Demo Kitchen' limit 1))
   where employee_id in (select id from employees where employee_number in ('T-1','T-4'))$$,
  'put the two rostered shifts in the kitchen', 2);

select t.expect_value($$
  select b.code from business_units b
    join shifts s on s.business_unit_id = b.id
   where s.employee_id = (select id from employees where employee_number='T-1')
   limit 1$$,
  'and labour now joins to a unit by itself', 'KITCHEN');

-- The legacy column followed, which is what keeps the reference builders and
-- the unmigrated screens working. "The write was allowed" is not "the write
-- happened to both columns".
select t.expect_value($$
  select (department_id = business_unit_id)::text from shifts
   where employee_id = (select id from employees where employee_number='T-1') limit 1$$,
  'and the old column was carried with it', 'true');

-- Driving the old column instead moves the new one, so a screen that has not
-- been migrated is not writing a row nobody can cost.
select t.expect_rows($$
  update meters set cost_centre_id =
    (select id from business_units where code='BAR'
      and org_id=(select id from organizations where name='Demo Kitchen' limit 1))
   where code='T-ELEC'$$,
  'move the test meter by its old column', 1);
select t.expect_value($$select b.code from business_units b
  join meters m on m.business_unit_id = b.id where m.code='T-ELEC'$$,
  'and the new column followed the old one', 'BAR');

select '── units: a document still gets the unit''s number ───────────────';

/*
 * `assign_reference` reads the legacy column, and the trigger that fills it
 * from the new one has to fire first. Triggers of the same timing fire in
 * name order, so this is a test of a trigger's *name* as much as its body —
 * and the failure it guards against is silent: a perfectly good unit gets
 * WO-ENG- or PO-GEN- and the number stops meaning anything.
 */
select t.expect_rows($$
  insert into work_orders (org_id, title, business_unit_id, raised_by_email)
  select o.id, 'T-numbered',
         (select id from business_units where code='KITCHEN' and org_id=o.id),
         'reporter@test.local'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'raise a work order naming only the new column', 1);
select t.expect_value($$select left(reference, 7) from work_orders where title='T-numbered'$$,
  'and it is numbered for the kitchen, not the fallback', 'WO-KIT-');

select '── units: the tree cannot eat itself ────────────────────────────';

select t.expect_fail($$
  update business_units set parent_id = id
   where code='T-ENG'$$,
  'a unit cannot be its own parent');

-- The expensive case, and the reason 0055's comment says to walk up: the
-- cheap check catches A -> A and misses A -> B -> A, which hangs every
-- recursive query on the tree rather than erroring.
select t.expect_rows($$
  update business_units set parent_id =
    (select id from business_units where code='KITCHEN'
      and org_id=(select id from organizations where name='Demo Kitchen' limit 1))
   where code='T-ENG'$$,
  'put the test unit under the kitchen', 1);
select t.expect_fail($$
  update business_units set parent_id =
    (select id from business_units where code='T-ENG')
   where code='KITCHEN'
     and org_id=(select id from organizations where name='Demo Kitchen' limit 1)$$,
  'and the kitchen cannot then be put under it');
-- Refused is not the same as unchanged. The kitchen is still a root.
select t.expect_value($$select (parent_id is null)::text from business_units
  where code='KITCHEN'
    and org_id=(select id from organizations where name='Demo Kitchen' limit 1)$$,
  'and the kitchen is still where it was', 'true');

/*
 * A chain that goes on for ever is a tree nobody can render and a recursive
 * query nobody can bound. Thirteen levels are built first — one-letter
 * suffixes, because the prefix index would refuse XA01 and XA02 for sharing
 * three characters — and the fourteenth is the one that must be refused.
 *
 * Built by a bare DO rather than inside the harness, so that a chain that
 * failed to build takes the transaction down and is seen, instead of leaving
 * the refusal below to pass against twelve levels that are not there.
 */
do $tree$
declare p uuid; i integer; org uuid;
begin
  select id into org from public.organizations where name='Demo Kitchen' limit 1;
  for i in 1 .. 13 loop
    insert into public.business_units (org_id, code, name, parent_id)
    values (org, 'X' || chr(64 + i), 'Level ' || i, p)
    returning id into p;
  end loop;
end $tree$;

select t.expect_value($$select count(*)::text from business_units where code like 'X_'$$,
  'thirteen nested units were accepted', '13');
select t.expect_fail($$
  insert into business_units (org_id, code, name, parent_id)
  select org_id, 'XZ', 'Level 14', id from business_units where code='XM'$$,
  'and the fourteenth is refused as too deep to be real');

select '── units: one venue''s unit is not another''s to use ─────────────';

/*
 * A second venue, because a tenancy rule tested against a subquery that
 * returns nothing is not tested at all — the UPDATE sets the column to null,
 * the rule has no reason to object, and the check reports a pass it never
 * earned. `supabase db reset` leaves exactly one organisation, so the other
 * one has to be made here.
 */
do $other$
declare other_org uuid;
begin
  delete from public.organizations where slug = 't-other-venue';
  insert into public.organizations (name, slug)
  values ('T-Other venue', 't-other-venue')
  returning id into other_org;
  insert into public.employees
    (org_id, employee_number, first_name, last_name, employment_status)
  values (other_org, 'T-9', 'Other', 'Person', 'ACTIVE');
end $other$;

select t.expect_value($$select count(*)::text from business_units
  where org_id = (select id from organizations where slug='t-other-venue')$$,
  'the second venue was seeded units of its own', '4');

select t.expect_fail($$
  update business_units set parent_id =
    (select id from business_units where code='KITCHEN'
      and org_id = (select id from organizations where slug='t-other-venue'))
   where code='T-ENG'$$,
  'a unit cannot sit under another organisation''s unit');
select t.expect_value($$select (parent_id is not null)::text from business_units
  where code='T-ENG'$$,
  'and it still has the parent it had', 'true');

select t.expect_fail($$
  update business_units set manager_employee_id =
    (select id from employees where employee_number='T-9')
   where code='T-ENG'$$,
  'a unit cannot be run by somebody else''s employee');

-- The same rule one table down. The foreign key says the unit exists; it does
-- not say it belongs to this venue, and org_id on the row would still read
-- correctly.
select t.expect_fail($$
  update locations set business_unit_id =
    (select id from business_units where code='KITCHEN'
      and org_id = (select id from organizations where slug='t-other-venue'))
   where code='T-PLANT'$$,
  'a location cannot be charged to another organisation''s unit');

select '── units: the code is the document prefix ───────────────────────';

/*
 * `unit_code()` takes three characters, so two codes that agree on the first
 * three issue numbers that claim to be the same unit's. Once a supplier holds
 * them the ambiguity cannot be undone, so it is refused at creation.
 */
select t.expect_fail($$
  insert into business_units (org_id, code, name)
  select id, 'KITCHENETTE', 'Second kitchen' from organizations
   where name='Demo Kitchen' limit 1$$,
  'two units cannot share a reference prefix');

-- Refused rather than folded to upper case: a trigger that quietly corrects
-- what it did not refuse is one of the three false passes in _harness.sql.
select t.expect_fail($$
  insert into business_units (org_id, code, name)
  select id, 'pastry', 'Pastry' from organizations where name='Demo Kitchen' limit 1$$,
  'a lower-case code is refused, not corrected');
select t.expect_value($$select count(*)::text from business_units
  where lower(code) = 'pastry'$$,
  'and no unit was created either way', '0');

select t.expect_value($$select data_type from information_schema.columns
  where table_name='business_units' and column_name='approval_threshold'$$,
  'the approval threshold is decimal, not a float', 'numeric');

select '── units: starting data comes from a function ───────────────────';

/*
 * Seven migrations seeded with `insert ... select ... from organizations`,
 * which runs once over the organisations that exist at that moment — none, on
 * a database built from its own migrations. Every organisation here was
 * created by a sign-up after 0058 ran, so a venue with no units means the
 * trigger is not wired.
 */
select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from business_units b where b.org_id = o.id)$$,
  'every organisation has units, including the ones created by sign-up', '0');

select '── units: who may change the tree ───────────────────────────────';

select t.expect_guarded('business_units', 'PARAMETERS');

select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');

select t.expect_fail($$update business_units set name='Hacked' where code='T-ENG'$$,
  'a user granted nothing cannot rename a unit');
select t.expect_value($$select name from business_units where code='T-ENG'$$,
  'and the name is unchanged afterwards', 'Test engineering');
select t.expect_fail($$
  insert into business_units (org_id, code, name)
  select id,'T-NEW','Invented' from organizations where name='Demo Kitchen' limit 1$$,
  'nor create one');

/*
 * The compatibility views are the part worth being suspicious of. They are
 * writable, so if they wrote with their owner's rights they would be a way
 * round the section guard for the whole tree — and the guard is on
 * `business_units`, which the caller never names.
 */
select t.expect_fail($$update departments set name='Hacked' where code='T-ENG'$$,
  'nor rename it through the departments view');
select t.expect_fail($$update cost_centres set name='Hacked' where code='T-ENG'$$,
  'nor through the cost centres view');
select t.expect_value($$select name from business_units where code='T-ENG'$$,
  'and the unit still says what it said', 'Test engineering');

select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_rows($$update business_units set name='Renamed engineering'
  where code='T-ENG'$$,
  'somebody with Venue parameters can rename a unit', 1);
select t.expect_value($$select name from departments where code='T-ENG'$$,
  'and the old name reads the new value', 'Renamed engineering');

select '── units: the shim is not a second model ────────────────────────';

select t.act_as_nobody();

-- The fixtures create T-ENG by writing to the departments view, so this says
-- the write-through works at all. What it adds is that the row it created is
-- a unit and not a department-shaped thing beside one.
select t.expect_value($$select count(*)::text from business_units where code='T-ENG'$$,
  'a write to the departments view created exactly one unit', '1');

-- Refused, not ignored. Anybody passing a cost centre is working from the
-- two-tree model, and quietly dropping it would charge the labour somewhere
-- other than where they asked.
select t.expect_fail($$
  insert into departments (org_id, code, name, cost_centre_id)
  select id,'T-TWO','Two trees',
         (select id from business_units where code='BAR' and org_id=organizations.id)
    from organizations where name='Demo Kitchen' limit 1$$,
  'writing a department with a separate cost centre is refused');

select '── units: one venue''s tree is not another''s ────────────────────';

/*
 * Run as `authenticated` rather than as the console, because row-level
 * security is what is being tested and `postgres` bypasses it. Without this
 * the next three checks would read every organisation's rows and still look
 * like passes.
 */
set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');
select t.expect_value($$select count(distinct org_id)::text from business_units$$,
  'a member sees their own venue''s units and no others', '1');
select t.expect_value($$select count(distinct org_id)::text from cost_centres$$,
  'and the compatibility view is scoped the same way', '1');

-- Somebody with no membership at all. The views are the interesting case: a
-- view without `security_invoker` runs as its owner and returns everything.
select t.act_as('a0000000-0000-0000-0000-0000000000ff','outsider@test.local');
select t.expect_value($$select count(*)::text from business_units$$,
  'a user with no membership reads no units', '0');
select t.expect_value($$select count(*)::text from departments$$,
  'nor any departments through the view', '0');
select t.expect_value($$select count(*)::text from budget_positions$$,
  'nor any venue''s budget position', '0');

reset role;
select t.act_as_nobody();

select t.expect_value($$select has_table_privilege('anon','business_units','SELECT')::text$$,
  'a signed-out visitor reads nothing', 'false');
select t.expect_value($$select has_table_privilege('authenticated','business_units','TRUNCATE')::text$$,
  'no TRUNCATE, which row-level security cannot filter', 'false');

rollback;
