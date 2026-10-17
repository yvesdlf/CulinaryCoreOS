-- ---------------------------------------------------------------------------
-- An incident is recorded once, and not everybody sees it (0104)
-- ---------------------------------------------------------------------------
-- Three rules: an allergen incident names its allergen, a closed one has an
-- action and an owner, and a health incident is not readable by whoever
-- happens to hold Hygiene.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees where employee_number = 'T-5' and org_id = :'demo' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── an allergen incident names its allergen' as "──";

select t.expect_refused($$
  insert into incidents (org_id, kind, summary)
  values ((select id from organizations where name='Demo Kitchen'),
          'ALLERGEN', 'T-Guest reacted to the special')$$,
  'recording one without saying which allergen is refused',
  'which allergen');

select t.expect_rows($$
  insert into incidents (id, org_id, kind, severity, summary, allergens, guest_name)
  values ('b0000000-0000-4000-8000-0000000b0001',
          (select id from organizations where name='Demo Kitchen'),
          'ALLERGEN', 'SERIOUS', 'T-Guest reacted to the special',
          array['EU14_PEANUTS'], 'T-Guest')$$,
  'naming it, it records', 1);
select t.expect_value($$select reported_by_email from incidents
                         where id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'against whoever reported it, from the session', 'chef@test.local');

/*
 * Severity drives who is told rather than a separate flag, because two
 * fields that must agree eventually disagree.
 */
reset role;
select t.expect_value($$select count(*)::text from notifications
                         where entity_id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'and a serious one tells somebody without being asked to', '1');

select '── closing one takes an action and an owner' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  update incidents set status = 'CLOSED'
   where id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'closing it with nothing done is refused', 'what was done');
select t.expect_refused($$
  update incidents set status = 'CLOSED', action_taken = 'Comped the table'
   where id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'and with no owner', 'without an owner');
select t.expect_rows($$
  update incidents set status = 'CLOSED',
         action_taken = 'Comped the table; the special was re-labelled.',
         owner_employee_id = (select id from employees where employee_number='T-5')
   where id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'with both, it closes', 1);
select t.expect_value($$select closed_by_email from incidents
                         where id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'recorded against whoever closed it', 'chef@test.local');

select t.expect_value($$select (still_open = false and dish is null)::text
                          from allergen_incidents
                         where incident_id = 'b0000000-0000-4000-8000-0000000b0001'$$,
  'and it reads as a closed allergen incident', 'true');

select '── a health incident is not a hygiene matter' as "──";

reset role;
insert into incidents (id, org_id, kind, severity, summary, employee_id)
values ('b0000000-0000-4000-8000-0000000b0002', :'demo', 'INJURY', 'MODERATE',
        'T-Burn on the pass', :'t5');

/*
 * nobody@ holds NONE everywhere, so they see nothing either way. The
 * distinction that matters is between somebody with Hygiene and somebody
 * with People: an injury is GDPR Article 9 health data and does not become
 * readable because a person can sign off a fridge check.
 */
reset role;
select t.act_as_nobody();   -- reset role keeps the JWT; the guards read it
delete from member_access
 where user_id = 'a0000000-0000-0000-0000-000000000003'
   and section_code in ('HYGIENE', 'PEOPLE');
insert into member_access (org_id, user_id, section_code, level)
values ((select id from organizations where name='Demo Kitchen'),
        'a0000000-0000-0000-0000-000000000003', 'HYGIENE', 'WRITE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from incidents where kind = 'ALLERGEN'$$,
  'somebody with Hygiene reads an allergen incident', '1');
select t.expect_value($$select count(*)::text from incidents where kind = 'INJURY'$$,
  'and does not read an injury, which is health data', '0');

reset role;
select t.act_as_nobody();
insert into member_access (org_id, user_id, section_code, level)
values ((select id from organizations where name='Demo Kitchen'),
        'a0000000-0000-0000-0000-000000000003', 'PEOPLE', 'READ')
on conflict (org_id, user_id, section_code) where business_unit_id is null
  do update set level = 'READ';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from incidents where kind = 'INJURY'$$,
  'somebody with People does', '1');

/*
 * And the person it happened to can read their own, which is the whole
 * reason a staff portal exists.
 */
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_value($$select count(*)::text from incidents where kind = 'INJURY'$$,
  'and so can the person it happened to, holding nothing at all', '1');

reset role;
select t.expect_guarded('incidents', 'HYGIENE');

rollback;
