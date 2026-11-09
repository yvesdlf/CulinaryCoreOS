-- ---------------------------------------------------------------------------
-- A named participant can read the case they are party to
-- ---------------------------------------------------------------------------
-- `31_the_four_defects.sql` proves the refusal direction: a colleague who is
-- not a participant sees nothing. Nothing proved the other direction, and a
-- gate tested in one direction only is half a gate — `can_see_case` returning
-- false for everybody would pass every check in that file.
--
-- The part that actually needed covering is the second branch:
--
--     p.user_id = auth.uid()
--     or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
--
-- Somebody added to a case before they have an account is matched on email
-- alone, lowercased on both sides. That is the path a grievance against a
-- manager takes — the person raising it is named, often by whoever typed
-- their address — and none of it was exercised: not the email branch, not the
-- case folding, not what `coalesce(..., '')` does when there is no email on
-- the token at all.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees
 where employee_number = 'T-5' and org_id = :'demo' \gset

-- Two cases, so "can read" can be told apart from "can read everything".
insert into hr_cases (id, org_id, employee_id, reference, kind, status,
                      summary, detail, opened_by_email)
values ('b0000000-0000-4000-8000-000000640001', :'demo', :'t5', 'T-CASE-64A',
        'GRIEVANCE', 'OPEN', 'T-the case the chef is party to',
        'Detail the chef is entitled to see.', 'owner@test.local'),
       ('b0000000-0000-4000-8000-000000640002', :'demo', :'t5', 'T-CASE-64B',
        'CONDUCT', 'OPEN', 'T-the case the chef is not party to',
        'Detail the chef is not entitled to see.', 'owner@test.local');

select '── a participant named by account reads their case ──────────────';

insert into hr_case_participants (org_id, case_id, user_id, email, role)
values (:'demo', 'b0000000-0000-4000-8000-000000640001',
        'a0000000-0000-0000-0000-000000000002', 'chef@test.local', 'PARTICIPANT');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * The chef is not an owner, so the owner exception in `can_see_case` cannot
 * be what lets them through. If it were, this would pass for the wrong reason
 * and keep passing after the participant branch was deleted.
 */
select t.expect_value($$
  select role::text from organization_members
   where user_id = 'a0000000-0000-0000-0000-000000000002'
     and organization_id = (select id from organizations where name='Demo Kitchen')$$,
  'the reader is a chef, not an owner', 'CHEF');

select t.expect_value($$
  select summary from hr_cases where reference = 'T-CASE-64A'$$,
  'a participant reads the case they are named on',
  'T-the case the chef is party to');

select t.expect_value($$
  select count(*)::text from hr_cases where reference = 'T-CASE-64B'$$,
  'and not the one they are not', '0');

select '── named by address alone, before they have an account ──────────';

/*
 * `user_id` null is the ordinary case, not an edge: a case is opened and the
 * people party to it are typed in by address, which is all the person opening
 * it knows. If only the `user_id` branch worked, every one of those people
 * would be locked out of their own grievance and the screen would show them
 * an empty list rather than an error.
 */
reset role;
select t.act_as_nobody();
update hr_case_participants set user_id = null
 where case_id = 'b0000000-0000-4000-8000-000000640001';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from hr_cases where reference = 'T-CASE-64A'$$,
  'a participant with no account yet is matched on their address', '1');

select '── and the address is matched without regard to case ────────────';

/*
 * Both sides are lowercased in `can_see_case`, which is the right call and
 * the sort of thing that gets simplified away by somebody who reads
 * `lower(p.email) = lower(...)` as redundant. Addresses are typed by hand
 * into a form, and "Chef@Test.Local" is what a phone's keyboard produces.
 */
reset role;
select t.act_as_nobody();
update hr_case_participants set email = 'Chef@Test.Local'
 where case_id = 'b0000000-0000-4000-8000-000000640001';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from hr_cases where reference = 'T-CASE-64A'$$,
  'an address capitalised differently still reaches its owner', '1');

select '── a token with no address matches nobody ──────────────────────';

/*
 * This is where the missing half of the test found something. The branch read
 *
 *     lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
 *
 * so a token with no email claim became the empty string, and a participant
 * row with an empty email compared equal to it: two parties matched because
 * neither of them was anybody. 0124 made both sides `nullif(..., '')`, and
 * null is not equal to null.
 *
 * Two assertions, because the fix has two halves and either alone leaves the
 * other open: the row can no longer be written, and it would not match even
 * if it were.
 */
reset role;
select t.act_as_nobody();

select t.expect_refused($$
  update hr_case_participants set email = ''
   where case_id = 'b0000000-0000-4000-8000-000000640001'$$,
  'a participant row cannot hold a blank address',
  'hr_case_participants_email_is_an_address');

/*
 * And now the function on its own, with the constraint deliberately out of
 * the way.
 *
 * The constraint alone would close this, which is exactly why the function
 * has to be tested without it: otherwise the second layer is never exercised
 * and nobody finds out it stopped working. Dropping it here is safe — the
 * whole file is one transaction and rolls back — and it is the only way to
 * produce the row the function must refuse.
 */
alter table hr_case_participants
  drop constraint hr_case_participants_email_is_an_address;

update hr_case_participants set email = '', user_id = null
 where case_id = 'b0000000-0000-4000-8000-000000640001';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','a0000000-0000-0000-0000-000000000003',
                    'role','authenticated')::text, true);

select t.expect_value($$
  select count(*)::text from hr_cases where reference = 'T-CASE-64A'$$,
  'and even then, a token with no address matches no blank participant', '0');

select '── and the reach ends when the participant does ─────────────────';

reset role;
select t.act_as_nobody();
delete from hr_case_participants
 where case_id = 'b0000000-0000-4000-8000-000000640001';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from hr_cases where reference = 'T-CASE-64A'$$,
  'removing somebody from a case removes the case from them', '0');

rollback;
