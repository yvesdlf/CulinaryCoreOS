-- ---------------------------------------------------------------------------
-- One screen, showing what you are responsible for (0074)
-- ---------------------------------------------------------------------------
-- Gap 33, and Part C's last open bullet.
--
-- The claim being tested is that there is no role written anywhere. An owner,
-- a head chef and somebody who may only see money all read the same view, and
-- what comes back differs because their grants differ. If that is true, a
-- venue that invents a Night Manager grants them what a night manager needs
-- and the screen is already right; if it is false, somebody is editing a
-- dashboard every time the venue reorganises.
--
-- The second rule is about the cost of that design: a null column means either
-- "nothing happened" or "not yours to see", and a screen that draws a zero for
-- the second is worse than one that draws nothing, because somebody will act
-- on the zero.
-- ---------------------------------------------------------------------------

begin;

select '── overview: a line per department, and one for the venue ───────';

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from unit_overview
   where org_id=(select id from organizations where name='Demo Kitchen')$$,
  'every open department has a line',
  (select count(*)::text from business_units
    where active and org_id=(select id from organizations where name='Demo Kitchen')));

select t.expect_value($$
  select count(*)::text from venue_overview$$,
  'and the venue has exactly one', '1');

select '── overview: the owner sees the money ───────────────────────────';

select t.expect_rows($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount, covers)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date, 250000, 60
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'the kitchen takes money today', 1);

select t.expect_value($$
  select revenue_today::text from unit_overview where unit_code='KITCHEN'$$,
  'the owner sees it on the kitchen''s tile', '250000.00000');
select t.expect_value($$
  select may_see_money::text || '/' || may_see_pay::text from unit_overview
   where unit_code='KITCHEN'$$,
  'and the tile says they are allowed to', 'true/true');

select '── overview: the same view, a different person, different answers ─';

/*
 * The whole claim. Nothing about this caller is written anywhere in the view;
 * they differ from the owner only in `member_access`.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select count(*)::text from unit_overview$$,
  'somebody granted nothing still sees the departments', 
  (select count(*)::text from business_units
    where active and org_id=(select id from organizations where name='Demo Kitchen')));

select t.expect_value($$
  select coalesce(revenue_today::text, 'hidden') from unit_overview where unit_code='KITCHEN'$$,
  'and no money at all', 'hidden');
select t.expect_value($$
  select may_see_money::text from unit_overview where unit_code='KITCHEN'$$,
  'with the tile saying why, rather than leaving a zero to be read as a fact',
  'false');

reset role;

select '── overview: granting Revenue changes what the same view says ───';

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  delete from member_access
   where user_id='a0000000-0000-0000-0000-000000000003' and section_code='REVENUE'$$,
  'clear whatever Revenue access this person had', 1);
select t.expect_rows($$
  insert into member_access (org_id, user_id, section_code, level, business_unit_id)
  select o.id, 'a0000000-0000-0000-0000-000000000003', 'REVENUE', 'READ',
         (select id from business_units where code='KITCHEN' and org_id=o.id)
    from organizations o where o.name='Demo Kitchen'$$,
  'grant them Revenue for the kitchen alone', 1);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select revenue_today::text from unit_overview where unit_code='KITCHEN'$$,
  'now they see the kitchen''s takings', '250000.00000');
select t.expect_value($$
  select coalesce(revenue_today::text, 'hidden') from unit_overview where unit_code='BAR'$$,
  'and still not the bar''s, from the same column of the same view', 'hidden');

-- Pay is a separate trust and was not granted with it.
select t.expect_value($$
  select coalesce(profit_today::text, 'hidden') from unit_overview where unit_code='KITCHEN'$$,
  'and no profit, because that is a different grant', 'hidden');

reset role;

select '── overview: what is waiting does not reset at midnight ─────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into requests (request_type_id, title, created_at)
  select id, 'T-overview unanswered', now() - interval '3 days'
    from request_types where code='FAULT'
      and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'something raised three days ago and never answered', 1);

select t.expect_value($$
  select requests_unanswered::text from unit_overview where unit_code='ADMIN'$$,
  'is still on the tile, because an unanswered request is not a daily figure', '1');

select t.expect_value($$
  select requests_unanswered::text from venue_overview$$,
  'and on the venue line', '1');

select '── overview: the venue line is asked, not summed ────────────────';

/*
 * A sum of the tiles would differ between two people looking at the same
 * venue, and the difference would read as a discrepancy rather than as a
 * permission. This asks the same question once at venue level.
 */
select t.expect_value($$
  select revenue_today::text from venue_overview$$,
  'the owner''s venue total is the venue''s takings', '250000.00000');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$
  select coalesce(revenue_today::text, 'hidden') from venue_overview$$,
  'and somebody with only the kitchen sees no venue total at all, rather than a partial one',
  'hidden');
reset role;

select '── overview: the figure about the platform itself ───────────────';

/*
 * A queue that is not draining means nobody is being told anything, and every
 * other number on this screen assumes somebody was.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select (messages_waiting >= 0)::text from venue_overview$$,
  'the venue line counts what is still in the outbox', 'true');

rollback;
