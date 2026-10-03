-- ---------------------------------------------------------------------------
-- What came in (0065)
-- ---------------------------------------------------------------------------
-- The platform has known what everything cost since its first migration and
-- has never known what anything earned, so every figure it produces has been
-- one side of a subtraction. These are the checks on the other side.
--
-- The one most worth having is the channel one. A venue that reads only the
-- till is wrong by whatever the delivery platforms took, in both directions at
-- once: the customer paid more than the venue banked, and which of those two a
-- report means decides whether a menu looks profitable. So gross and net are
-- separate columns and neither is called "the revenue".
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── takings: a venue starts with somewhere to put them ───────────';

select t.expect_value($$
  select count(*)::text from organizations o
   where not exists (select 1 from revenue_channels c where c.org_id = o.id)$$,
  'every venue has channels (seed_revenue_channels, through the registry)', '0');

select '── takings: gross, commission and what was actually kept ────────';

select t.expect_rows($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount, covers)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date - 1, 12000000, 80
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'yesterday through the till', 1);

select t.expect_value($$
  select net_amount::text from daily_takings where on_date = current_date - 1
     and channel_id = (select id from revenue_channels where code='TILL'
            and org_id=(select id from organizations where name='Demo Kitchen'))$$,
  'with nothing withheld, the venue kept all of it', '12000000.00000');

select t.expect_rows($$
  insert into daily_takings
    (business_unit_id, channel_id, on_date, gross_amount, commission_amount, covers)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='DELIVERY' and org_id=o.id),
         current_date - 1, 4000000, 800000, 25
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and the same day through a delivery platform that kept a fifth', 1);

/*
 * The whole argument for the channel column. A venue reading only the till
 * under-reports the day by four million; a venue summing gross across channels
 * over-reports what it banked by eight hundred thousand. Both figures are here
 * and neither is named "revenue".
 */
select t.expect_value($$
  select sum(gross_amount)::text from daily_takings where on_date = current_date - 1$$,
  'the customers paid sixteen million', '16000000.00000');
select t.expect_value($$
  select sum(net_amount)::text from daily_takings where on_date = current_date - 1$$,
  'and the venue kept fifteen million two', '15200000.00000');

/*
 * Asked of the view as well as the table, and that pair is not belt and
 * braces. The first draft of this file asserted only the table, so rewriting
 * `revenue_daily` to report gross as net — the exact mistake the channel
 * column exists to prevent — turned nothing red. A generated column is proof
 * about the column; the report is a separate thing that can disagree with it.
 */
select t.expect_value($$
  select sum(net_amount)::text from revenue_daily where on_date = current_date - 1$$,
  'and the report says the same, rather than quietly reporting the gross',
  '15200000.00000');
select t.expect_value($$
  select net_amount::text from revenue_daily
   where on_date = current_date - 1 and channel_code='DELIVERY'$$,
  'with the platform''s share off the delivery line in particular', '3200000.00000');

select t.expect_fail($$
  insert into daily_takings
    (business_unit_id, channel_id, on_date, gross_amount, commission_amount)
  select (select id from business_units where code='BAR' and org_id=o.id),
         (select id from revenue_channels where code='DELIVERY' and org_id=o.id),
         current_date - 1, 100000, 200000
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'a channel cannot withhold more than the customer paid');

select '── takings: one figure per unit per channel per day ─────────────';

select t.expect_fail($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date - 1, 999
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'the same day through the same channel cannot be entered twice');

-- The bar is a different unit, so it is a different figure, not a duplicate.
select t.expect_rows($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount, covers)
  select (select id from business_units where code='BAR' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date - 1, 5000000, 80
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'but the bar has its own takings for the same evening', 1);

select '── takings: tomorrow has not happened ───────────────────────────';

/*
 * Cheap to type by accident — a date picker a month out — and expensive to
 * find, because the figure is plausible and sits in a period nobody is looking
 * at yet.
 */
select t.expect_fail($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date + 1, 1000000
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'takings cannot be recorded for a day that has not happened');

select '── takings: spend per cover, and the day nobody counted ─────────';

select t.expect_value($$
  select spend_per_cover::text from revenue_daily
   where on_date = current_date - 1 and channel_code='TILL'
     and business_unit_code='KITCHEN'$$,
  'eighty covers into twelve million is a hundred and fifty thousand', '150000.00');

select t.expect_rows($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TAKEAWAY' and org_id=o.id),
         current_date - 1, 900000
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'a day somebody recorded the money and not the covers', 1);
-- Nothing, not zero and not a division by nothing. "Nobody counted" and
-- "nobody came" are different days and a report that conflates them invents a
-- spend per head out of an empty field.
select t.expect_value($$
  select count(*)::text from revenue_daily
   where on_date = current_date - 1 and channel_code='TAKEAWAY'
     and spend_per_cover is not null$$,
  'has no spend per cover rather than a made-up one', '0');

select '── takings: a correction is kept ────────────────────────────────';

select t.expect_rows($$
  update daily_takings set gross_amount = 12500000
   where on_date = current_date - 1
     and channel_id = (select id from revenue_channels where code='TILL'
            and org_id=(select id from organizations where name='Demo Kitchen'))
     and business_unit_id = (select id from business_units where code='KITCHEN'
            and org_id=(select id from organizations where name='Demo Kitchen'))$$,
  'the closing figure was transposed and is corrected the next morning', 1);

select t.expect_value($$
  select was_gross::text || ' -> ' || now_gross::text from takings_changes
   order by changed_at desc limit 1$$,
  'and what it was is still on the record', '12000000.00000 -> 12500000.00000');
select t.expect_value($$
  select changed_by_email from takings_changes order by changed_at desc limit 1$$,
  'under the person who changed it', 'chef@test.local');

-- A note is not a figure. An audit trail that fills up with rows saying
-- nothing changed is one nobody reads.
select t.expect_rows($$
  update daily_takings set note = 'T-busy night'
   where on_date = current_date - 1
     and channel_id = (select id from revenue_channels where code='TILL'
            and org_id=(select id from organizations where name='Demo Kitchen'))
     and business_unit_id = (select id from business_units where code='KITCHEN'
            and org_id=(select id from organizations where name='Demo Kitchen'))$$,
  'adding a note', 1);
select t.expect_value($$select count(*)::text from takings_changes$$,
  'does not add a row saying the money is unchanged', '1');

select '── takings: whose day is it ─────────────────────────────────────';

select t.expect_value($$
  select count(*)::text from daily_takings t
   join business_units b on b.id = t.business_unit_id
  where t.org_id <> b.org_id$$,
  'the venue comes from the unit, never from the client', '0');

select t.expect_fail($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount)
  select (select id from business_units where code='KITCHEN'
           and org_id=(select id from organizations where name='Demo Kitchen')),
         (select c.id from revenue_channels c join organizations o2 on o2.id=c.org_id
           where o2.name <> 'Demo Kitchen' limit 1),
         current_date - 2, 100000$$,
  'and another venue''s channel cannot be used');

select '── takings: who may type them ───────────────────────────────────';

select t.expect_guarded('daily_takings', 'REVENUE');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date - 3, 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'somebody with no Revenue access records nothing');
select t.expect_value($$
  select count(*)::text from daily_takings where on_date = current_date - 3$$,
  'and no row was written', '0');

select '── takings: labour against revenue needs Pay ────────────────────';

/*
 * The figure Stage 2 exists to make possible, and the half of it that is
 * sensitive. A view that showed revenue with a null labour column would repeat
 * the mistake `labour_cost_daily` had to have fixed: a report that lists
 * everything and costs nothing reads as a fact rather than as a refusal.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from unit_labour_against_revenue$$,
  'without Pay there is no row at all, not a row with a blank in it', '0');

/*
 * The trail, asked as somebody the grants apply to.
 *
 * This started out above, asked on the suite's own connection, and passed as
 * "it was allowed" — `postgres` owns these tables and is exempt from both
 * row-level security and table grants, so a refusal that lives in a GRANT
 * cannot be proved there at all. 07_media.sql found the same thing about
 * policies. The rule is the same one every ledger in this schema follows: the
 * row is written by a trigger and edited by nobody.
 */
select t.expect_fail($$update takings_changes set now_gross = 1$$,
  'nobody signed in may edit the trail');
select t.expect_fail($$delete from takings_changes$$,
  'nor delete it');
select t.expect_fail($$
  insert into takings_changes (org_id, takings_id, now_gross)
  select org_id, id, 1 from daily_takings limit 1$$,
  'nor write a correction that never happened');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select count(*)::text from unit_labour_against_revenue
   where on_date = current_date - 1$$,
  'and with it, yesterday is there for the two units that traded', '2');
reset role;

rollback;
