-- ---------------------------------------------------------------------------
-- Choosing which venue you are in (0118)
-- ---------------------------------------------------------------------------
-- The assertion that matters is not that the switch works. It is that the
-- switch reaches `set_org_id()`.
--
-- A switcher built in the client — a dropdown filtering what is shown — would
-- pass every test anybody thought to write about the screen, and every write
-- would still land in the venue the database picked. So this writes a row
-- after switching and checks which venue it went to.
--
-- The second is revocation. The preference outlives the membership that
-- justified it, and a stale pointer into an organisation somebody has been
-- removed from is the worst possible shape for one.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into organizations (id, name, slug) values
  ('b0000000-0000-4000-8000-000000590001', 'T-Second Venue', 't-second-venue');

/*
 * chef@ works at both. The fixtures already make them a member of the demo
 * venue; this adds the second, created later so the default order has a
 * reason to prefer the first.
 */
insert into organization_members (organization_id, user_id, role)
values ('b0000000-0000-4000-8000-000000590001',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');

insert into member_access (org_id, user_id, section_code, level)
select 'b0000000-0000-4000-8000-000000590001',
       'a0000000-0000-0000-0000-000000000002', code, 'WRITE'
  from app_sections;

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── both venues are offered, one of them active' as "──";

select t.expect_value($$
  select count(*)::text from my_venues$$,
  'somebody at two venues is shown two', '2');

select t.expect_value($$
  select name from my_venues where is_active$$,
  'and exactly one is marked active', 'Demo Kitchen');

select '── switching reaches the trigger, not just the screen' as "──";

select t.expect_value($$
  select name from organizations
   where id = public.set_active_org('b0000000-0000-4000-8000-000000590001')$$,
  'switching returns the venue now in force', 'T-Second Venue');

/*
 * The assertion this file exists for. `set_org_id()` stamps new rows from
 * `auth_default_org_id()`, so a switcher that only filtered the screen would
 * leave this row in the first venue — and nothing on screen would say so.
 */
select t.expect_rows($$
  insert into venue_parameters (code, name, description, value, unit)
  values ('T-SWITCH-PROOF', 'T-Switch proof',
          'Written after switching venues.', 1, 'x')$$,
  'a row written after the switch', 1);

select t.expect_value($$
  select o.name from venue_parameters p
    join organizations o on o.id = p.org_id
   where p.code = 'T-SWITCH-PROOF'$$,
  'lands in the venue that was switched to, not the one the database picked',
  'T-Second Venue');

select '── switching back' as "──";

select t.expect_value($$
  select name from organizations
   where id = public.set_active_org(
     (select id from organizations where name = 'Demo Kitchen'))$$,
  'and back again', 'Demo Kitchen');

select t.expect_value($$
  select name from my_venues where is_active$$,
  'the list agrees with the trigger about which is active', 'Demo Kitchen');

select '── a venue that is not yours' as "──";

select t.expect_refused($$
  select public.set_active_org('b0000000-0000-4000-8000-00000059dead')$$,
  'switching to a venue you are not a member of is refused',
  'not a member of that venue');

/*
 * Refused rather than stored-and-ignored. Both are safe, because the read
 * validates membership anyway — only one of them tells somebody their click
 * did nothing.
 */
select t.expect_value($$
  select name from my_venues where is_active$$,
  'and the active venue does not move', 'Demo Kitchen');

select '── a membership that goes away' as "──";

select t.fixture($$
  select public.set_active_org('b0000000-0000-4000-8000-000000590001')$$);
select t.expect_value($$
  select name from my_venues where is_active$$,
  'working at the second venue', 'T-Second Venue');

reset role;
/*
 * `act_as_nobody` before removing the membership, not just `reset role`.
 * Resetting the role leaves `request.jwt.claims` in place, so the guard that
 * refuses self-removal still sees chef@ as the actor and refuses — which is
 * the guard working, and nothing to do with what this file is testing.
 */
select t.act_as_nobody();
select t.fixture($$
  delete from organization_members
   where organization_id = 'b0000000-0000-4000-8000-000000590001'
     and user_id = 'a0000000-0000-0000-0000-000000000002'$$);
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * The preference row still names the second venue. Checking membership only
 * when the choice is made would leave this person writing into a venue they
 * have been removed from, with no cleanup job and a window as long as the
 * row lives.
 */
select t.expect_value($$
  select active_org_id::text from member_preferences
   where user_id = 'a0000000-0000-0000-0000-000000000002'$$,
  'the preference row still points at the venue they left',
  'b0000000-0000-4000-8000-000000590001');

select t.expect_value($$
  select o.name from organizations o
   where o.id = public.auth_default_org_id()$$,
  'and they are back in the venue they are actually a member of',
  'Demo Kitchen');

select t.expect_value($$
  select count(*)::text from my_venues$$,
  'with only that one offered', '1');

select '── nobody chooses for anybody else' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select count(*)::text from member_preferences$$,
  'one member cannot read another''s choice of venue', '0');

select t.expect_rows($$
  update member_preferences set active_org_id = null
   where user_id = 'a0000000-0000-0000-0000-000000000002'$$,
  'nor change it', 0);

reset role;
rollback;
