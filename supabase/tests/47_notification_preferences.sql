-- ---------------------------------------------------------------------------
-- A person chooses what reaches them, except when it cannot wait (0105)
-- ---------------------------------------------------------------------------
-- Three rules: saying nothing means the venue's behaviour rather than
-- silence, the most specific preference wins, and some kinds ignore all of
-- it.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

select '── the rules reached every venue' as "──";

select t.expect_value($$select always_deliver::text from notification_kind_rules
                         where org_id = (select id from organizations where name='Demo Kitchen')
                           and kind = 'REQUEST_UNANSWERED'$$,
  'an already-escalated request ignores quiet hours', 'true');
select t.expect_value($$select always_deliver::text from notification_kind_rules
                         where org_id = (select id from organizations where name='Demo Kitchen')
                           and kind = 'INVOICE_ON_HOLD'$$,
  'an invoice on hold does not', 'false');

select '── saying nothing means the venue''s behaviour' as "──";

/*
 * Defaulting to silence is how a notification system ends up delivering
 * nothing to anybody, and the first thing it fails to deliver is the thing
 * that mattered.
 */
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL')::text$$,
  'somebody who has never opened the settings still gets things', 'true');

select '── and the most specific preference wins' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into notification_preferences (org_id, user_id, enabled)
  values ((select id from organizations where name='Demo Kitchen'),
          'a0000000-0000-0000-0000-000000000002', false)$$,
  'a blanket mute is recorded', 1);
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL')::text$$,
  'and silences everything', 'false');

select t.expect_rows($$
  insert into notification_preferences (org_id, user_id, kind, enabled)
  values ((select id from organizations where name='Demo Kitchen'),
          'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', true)$$,
  'an exception for one kind is recorded', 1);
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL')::text$$,
  'nothing except orders is expressible, and beats the blanket rule', 'true');
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'LEAVE_DECIDED', 'EMAIL')::text$$,
  'while everything else stays silent', 'false');

select t.expect_refused($$
  insert into notification_preferences (org_id, user_id, kind, enabled)
  values ((select id from organizations where name='Demo Kitchen'),
          'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', false)$$,
  'one preference per person per kind', 'idx_notification_preferences_kind');

select '── quiet hours, across midnight' as "──";

reset role;
select t.act_as_nobody();
delete from notification_preferences
 where user_id = 'a0000000-0000-0000-0000-000000000002';
update organizations set timezone = 'UTC' where id = :'demo';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into notification_preferences (org_id, user_id, quiet_from, quiet_to)
  values ((select id from organizations where name='Demo Kitchen'),
          'a0000000-0000-0000-0000-000000000002', time '22:00', time '07:00')$$,
  'ten at night until seven in the morning', 1);

select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL',
    timestamptz '2026-06-01 03:00+00')::text$$,
  'three in the morning is inside a window that wraps midnight', 'false');
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL',
    timestamptz '2026-06-01 23:30+00')::text$$,
  'and so is half past eleven at night', 'false');
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'ORDER_SENT', 'EMAIL',
    timestamptz '2026-06-01 12:00+00')::text$$,
  'midday is not', 'true');

/*
 * The one that matters. A muted phone and a regulator asking why nobody
 * acted is the outcome this rule exists to prevent.
 */
select t.expect_value($$select wants_notification(
    (select id from organizations where name='Demo Kitchen'),
    'a0000000-0000-0000-0000-000000000002', 'REQUEST_UNANSWERED', 'EMAIL',
    timestamptz '2026-06-01 03:00+00')::text$$,
  'but an already-escalated request still reaches them at three', 'true');

select '── a preference is the person''s own' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from notification_preferences$$,
  'somebody else does not read it', '0');
select t.expect_refused($$
  insert into notification_preferences (org_id, user_id, enabled)
  values ((select id from organizations where name='Demo Kitchen'),
          'a0000000-0000-0000-0000-000000000002', false)$$,
  'nor quietly mutes it for them', 'row-level security|denied');

reset role;
rollback;
