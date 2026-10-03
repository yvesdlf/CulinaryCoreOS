-- ---------------------------------------------------------------------------
-- A grant that reaches one business unit (0062)
-- ---------------------------------------------------------------------------
-- Gap 6. The claim this file has to make true is the one on the roadmap: "this
-- person manages the kitchen's staff and nothing else."
--
-- The three ways it could be wrong, in order of how badly:
--
--   The scoped grant reaches rows it should not. That is the breach, and it is
--   the only one anybody would call a bug.
--
--   The scoped grant reaches nothing, because the arithmetic reads the row's
--   unit wrongly. That reads to whoever was granted it as the platform being
--   broken, and to whoever granted it as the job being done.
--
--   An *existing* grant changed meaning. Every grant in every live venue has a
--   null unit, and a migration that quietly narrowed them would lock people
--   out of their own work with no message and no record. Asserted first.
-- ---------------------------------------------------------------------------

begin;

select '── access by unit: nothing that exists today changed ────────────';

/*
 * `nobody@test.local` has one WRITE grant from the fixtures and it is
 * unscoped. If this migration had given existing grants a unit, this is where
 * it would show.
 */
select t.expect_value($$
  select count(*)::text from member_access where business_unit_id is not null$$,
  'no grant anywhere was given a unit by the migration', '0');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
-- Five fixture employees, spread across units and none. One UPDATE reaching
-- all five is the assertion: a migration that had narrowed existing grants
-- would reach fewer, and `expect_rows` is counting precisely so that a
-- partial reach is a failure rather than a pass.
select t.expect_rows($$
  update employees set first_name='Still'
   where employee_number like 'T-%'$$,
  'and somebody with an unscoped grant still writes every unit''s rows', 5);

select '── access by unit: which sections can be scoped ─────────────────';

/*
 * Derived from the guards actually attached, not from a list. Four sections
 * guard tables that carry a unit.
 */
select t.expect_value($$
  select string_agg(code, ',' order by code) from app_sections where scopes_by_unit$$,
  'the scopable sections come from the catalogue',
  'MAINTENANCE,PARAMETERS,PEOPLE,PURCHASING,REVENUE');

/*
 * Administration is not on that list, and the reason is worth its own
 * assertion rather than being implied by the one above.
 *
 * `member_access` carries a `business_unit_id` and is guarded by ADMIN, so the
 * derivation in 0062 put Administration on the list the next time anything
 * re-ran it — which 0065 did. The column means something different there: on a
 * work order it says where the row lives, on a grant it says what the grant is
 * about. Reading the second as the first delegates permission-granting by
 * department, so somebody holding Administration for the kitchen could write
 * kitchen-scoped grants in every section, including one for themselves.
 */
select t.expect_value($$
  select scopes_by_unit::text from app_sections where code='ADMIN'$$,
  'Administration is never scopable, whatever the catalogue looks like', 'false');
select t.expect_fail($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'ADMIN', 'WRITE',
         (select id from business_units where code='T-ENG' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'so nobody can be made an administrator of one department');

select t.expect_value($$
  select scopes_by_unit::text from app_sections where code='RECIPES'$$,
  'and a section whose tables have no unit cannot be scoped', 'false');

select '── access by unit: a grant that would mean nothing is refused ───';

/*
 * Accepted, meaningless, and then refusing every write is a permission that
 * reads as granted and behaves as revoked. Refused at the point it is written
 * instead, with the reason.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_fail($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'RECIPES', 'WRITE',
         (select id from business_units where code='T-ENG' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'a Recipes grant cannot be limited to one unit');

select t.expect_fail($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'WRITE',
         (select b.id from business_units b join organizations o2 on o2.id=b.org_id
           where o2.name <> 'Demo Kitchen' limit 1)
    from organizations o where o.name='Demo Kitchen'$$,
  'nor name another venue''s unit');

select '── access by unit: the kitchen''s staff and nobody else ─────────';

/*
 * The whole point, built from nothing: a person with no access at all, given
 * WRITE on People for one unit only.
 */
-- The fixtures give this user a NONE row for every section, so there is one
-- to clear. NONE and absent mean the same thing: the table holds grants and
-- never denials, which is why `set_section_access` deletes rather than stores.
select t.expect_rows($$
  delete from member_access
   where user_id='a0000000-0000-0000-0000-000000000003'
     and section_code='PEOPLE'$$,
  'clear whatever People access this person had', 1);

select t.expect_rows($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'WRITE',
         (select id from business_units where code='T-ENG' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'grant WRITE on People for one unit only', 1);

-- Two employees: one in the granted unit, one in another.
select t.expect_rows($$
  update employees set business_unit_id=(select id from business_units where code='T-ENG'
     and org_id=(select id from organizations where name='Demo Kitchen'))
   where employee_number='T-1'$$,
  'put one employee in the granted unit', 1);
select t.expect_rows($$
  update employees set business_unit_id=(select id from business_units where code='KITCHEN'
     and org_id=(select id from organizations where name='Demo Kitchen'))
   where employee_number='T-2'$$,
  'and another somewhere else', 1);

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_rows($$
  update employees set first_name='Granted' where employee_number='T-1'$$,
  'the scoped grant writes a row in its own unit', 1);
select t.expect_value($$
  select first_name from employees where employee_number='T-1'$$,
  'and the change is actually there', 'Granted');

select t.expect_fail($$
  update employees set first_name='Reached' where employee_number='T-2'$$,
  'and is refused a row in another unit');
-- Read back. An UPDATE refused by a policy rather than a trigger matches zero
-- rows and raises nothing, which reads as a pass — the first false pass in
-- _harness.sql. The name is the assertion.
select t.expect_value($$
  select first_name from employees where employee_number='T-2'$$,
  'which is why the other row is read back, not assumed', 'Still');

select '── access by unit: a row belonging to no unit is not reached ────';

/*
 * The narrow reading. An employee with no unit is not the kitchen's, and
 * treating a blank column as "everybody's" would make leaving a field empty
 * the way round a scoped grant.
 */
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  update employees set business_unit_id=null where employee_number='T-2'$$,
  'take the unit off the other employee', 1);
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  update employees set first_name='Unscoped' where employee_number='T-2'$$,
  'a row with no unit is not reachable by a unit-scoped grant');

select '── access by unit: a row cannot be moved in or out of the grant ─';

/*
 * The escape this file was written to close, and it took the check to see
 * which way round it ran.
 *
 * Checking only the unit the row is moving *to* authorises a kitchen manager
 * to pull every one of the bar's employees into the kitchen, one row at a
 * time, each move perfectly permitted. Checking only the unit it is moving
 * *from* is the mirror image. Moving a record between departments is an act in
 * two departments, so the guard asks about both.
 */
select t.expect_fail($$
  update employees
     set business_unit_id=(select id from business_units where code='T-ENG'
     and org_id=(select id from organizations where name='Demo Kitchen'))
   where employee_number='T-2'$$,
  'an unreachable row cannot be dragged into the granted unit');
select t.expect_value($$
  select coalesce((select code from business_units where id=e.business_unit_id), 'none')
    from employees e where e.employee_number='T-2'$$,
  'and it is still where it was', 'none');

select t.expect_fail($$
  update employees set business_unit_id=null where employee_number='T-1'$$,
  'nor can one of the granted unit''s own be pushed out of it');
select t.expect_value($$
  select code from business_units
   where id=(select business_unit_id from employees where employee_number='T-1')$$,
  'and that one is still where it was too', 'T-ENG');

select '── access by unit: two grants stack, and the wider one wins ─────';

/*
 * A narrow grant must never take away access somebody already had. The person
 * now holds READ on People across the venue and WRITE for one unit.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  insert into member_access (org_id, user_id, section_code, level)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'READ'
    from organizations o where o.name='Demo Kitchen'$$,
  'add an unscoped READ beside the scoped WRITE', 1);

/*
  * Asked as the person the grants are about. Asked as the owner — which the
  * insert above has to be — every answer is WRITE and the pair proves nothing,
  * which is a test passing for the wrong reason.
  */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$
  select auth_section_level('PEOPLE',
    (select id from organizations where name='Demo Kitchen'),
    (select id from business_units where code='T-ENG'
      and org_id=(select id from organizations where name='Demo Kitchen')))::text$$,
  'the granted unit still answers WRITE, not READ', 'WRITE');
select t.expect_value($$
  select auth_section_level('PEOPLE',
    (select id from organizations where name='Demo Kitchen'),
    null::uuid)::text$$,
  'and everywhere else answers READ rather than nothing', 'READ');

select '── access by unit: one grant per person per section per unit ────';

select t.expect_fail($$
  insert into member_access (org_id, user_id, section_code, level)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'WRITE'
    from organizations o where o.name='Demo Kitchen'$$,
  'a second unscoped grant in the same section is refused');
select t.expect_fail($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'READ',
         (select id from business_units where code='T-ENG' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'and so is a second grant for a unit already granted');

select '── access by unit: writing one is still an administrator''s job ─';

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  select set_section_access('a0000000-0000-0000-0000-000000000003', 'PURCHASING', 'WRITE')$$,
  'somebody without Administration cannot grant themselves a section');
-- The fixtures leave a NONE row for every section, so the question is not
-- whether a row exists but whether it now says WRITE. A count would have
-- passed against a row that had just been escalated in place.
select t.expect_value($$
  select level::text from member_access
   where user_id='a0000000-0000-0000-0000-000000000003' and section_code='PURCHASING'
     and business_unit_id is null$$,
  'and the level is still NONE afterwards', 'NONE');

select '── access by unit: the owner is not scopable ────────────────────';

/*
 * A venue that can limit its own owner to one department is a venue that can
 * lock itself out of its own books. The OWNER branch answers before the grant
 * table is consulted at all.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select auth_section_level('PEOPLE',
    (select id from organizations where name='Demo Kitchen'),
    (select id from business_units where code='KITCHEN'
      and org_id=(select id from organizations where name='Demo Kitchen')))::text$$,
  'an owner has WRITE in a unit they were never granted', 'WRITE');

rollback;
