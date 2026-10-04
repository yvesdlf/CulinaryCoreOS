-- ---------------------------------------------------------------------------
-- The part that actually sends (0070)
-- ---------------------------------------------------------------------------
-- Gap 13. The queue has been filling since 0031 and nothing has ever changed a
-- PENDING row to anything else.
--
-- What is testable here is the worker, which is most of what makes an outbox
-- work: claiming before attempting, backing off, respecting quiet hours, and
-- never sending the same thing twice. What is **not** testable here is a
-- message arriving in somebody's inbox, because that needs a provider account
-- and a key this platform does not have. The file says which is which rather
-- than letting a screen of passes imply the second.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * One channel with somewhere to send and one with nowhere, which is the state
 * of a venue halfway through being set up.
 *
 * Two kinds rather than two of a kind: `message_channels` is unique on
 * (org_id, kind), so a venue has at most one email channel. The constraint is
 * right — two email channels means every notification sent twice — and it is
 * also why the configured and unconfigured cases here are EMAIL and WHATSAPP.
 * The channels seeded by `seed_tax_and_channels` are updated rather than added
 * to, for the same reason.
 */
select t.fixture($$
  update message_channels set name='T-configured', enabled=true,
         config='{"endpoint":"http://127.0.0.1:54321/rest/v1/","auth_header":"Bearer t-not-a-real-key","default_recipient":"ops@test.local"}'::jsonb,
         quiet_from=null, quiet_to=null
   where kind='EMAIL'
     and org_id=(select id from organizations where name='Demo Kitchen') $$);
select t.fixture($$
  update message_channels set name='T-unconfigured', enabled=true,
         config='{"default_recipient":"nowhere@test.local"}'::jsonb,
         quiet_from=null, quiet_to=null
   where kind='WHATSAPP'
     and org_id=(select id from organizations where name='Demo Kitchen') $$);

select '── outbox: a notification still fills the queue ─────────────────';

select t.expect_rows($$
  insert into notifications (org_id, kind, subject, body)
  select o.id, 'ORDER_SENT', 'T-order 1', 'T-please deliver'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'raising a notification', 1);

select t.expect_value($$
  select count(*)::text from message_deliveries d
   join message_channels c on c.id = d.channel_id
  where c.name like 'T-%' and d.status in ('PENDING','SKIPPED')$$,
  'queues one delivery per enabled channel, as it has since 0031', '2');

select '── outbox: nowhere to send is waiting, not failing ──────────────';

/*
 * The state of every venue that has not been given a provider, including this
 * project's own. Burning an attempt on it would exhaust the retries before
 * anybody had configured anything.
 */
select t.expect_value($$
  select attempt_delivery(d.id) from message_deliveries d
   join message_channels c on c.id = d.channel_id
  where c.name='T-unconfigured'$$,
  'an unconfigured channel reports that it is waiting on setup',
  'waiting: no endpoint configured for this channel');

select t.expect_value($$
  select status || ':' || attempts::text from message_deliveries d
   join message_channels c on c.id = d.channel_id
  where c.name='T-unconfigured'$$,
  'and burns no attempt doing it', 'PENDING:0');

select t.expect_value($$
  select waiting_on_setup::text from outbox_health where channel_name='T-unconfigured'$$,
  'the health view counts it apart from a real backlog', '1');

select '── outbox: claiming, so nothing is sent twice ───────────────────';

select t.expect_value($$
  select count(*)::text from drain_outbox(now())
   where destination = 'ops@test.local'$$,
  'the first pass picks up the configured channel''s message', '1');

select t.expect_value($$
  select attempts::text from message_deliveries d
   join message_channels c on c.id = d.channel_id
  where c.name='T-configured'$$,
  'and attempts it once', '1');

/*
 * The failure mode nobody forgives. A second pass must not hand the same
 * message over again while the first is still in flight.
 */
select t.expect_value($$
  select count(*)::text from drain_outbox(now())
   where destination = 'ops@test.local'$$,
  'a second pass does not send it again', '0');

select '── outbox: quiet hours, including the ones that cross midnight ──';

/*
 * `quiet_from`/`quiet_to` have been columns since 0031 and nothing read them.
 * The window a venue actually wants crosses midnight, which is the case that
 * reads as "no quiet hours at all" if it is got wrong — and as "silent for
 * nineteen hours a day" if it is got wrong the other way.
 */
select t.expect_rows($$
  update message_channels set quiet_from='22:00', quiet_to='07:00'
   where name='T-configured'$$,
  'the configured channel goes quiet overnight', 1);

select t.expect_value($$
  select channel_may_speak(
    (select id from message_channels where name='T-configured'),
    (current_date + time '23:30') at time zone 'UTC')::text$$,
  'half past eleven at night is inside the quiet window', 'false');
select t.expect_value($$
  select channel_may_speak(
    (select id from message_channels where name='T-configured'),
    (current_date + time '03:00') at time zone 'UTC')::text$$,
  'and so is three in the morning, on the other side of midnight', 'false');
select t.expect_value($$
  select channel_may_speak(
    (select id from message_channels where name='T-configured'),
    (current_date + time '09:00') at time zone 'UTC')::text$$,
  'nine in the morning is not', 'true');

-- The one thing quiet hours must not swallow.
select t.expect_value($$
  select channel_may_speak(
    (select id from message_channels where name='T-configured'),
    (current_date + time '03:00') at time zone 'UTC', true)::text$$,
  'and something urgent carries through anyway', 'true');

select '── outbox: a failure backs off rather than hammering ────────────';

select t.expect_value($$select delivery_backoff(1)::text$$,
  'the first retry is a minute later', '00:01:00');
select t.expect_value($$select delivery_backoff(4)::text$$,
  'the fifth is an hour later', '01:00:00');

/*
 * The quiet window set above is cleared first, and that is not tidying.
 *
 * Leaving it set made this section pass or fail depending on the hour the
 * suite was run: a backoff of six minutes crosses into 22:00–07:00 for nine
 * hours of the day, and the message was correctly held — by the rule the
 * previous section is about, not the one this section is about. A test that is
 * green in the afternoon and red at six in the morning is worse than no test,
 * because the first person to see it red will assume the clock rather than the
 * code.
 */
select t.expect_rows($$
  update message_channels set quiet_from=null, quiet_to=null
   where name='T-configured'$$,
  'quiet hours off, so this section is about backoff alone', 1);

select t.expect_rows($$
  update message_deliveries set status='PENDING', external_id=null, attempts=2,
         next_attempt_at = now() + interval '5 minutes'
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'a message that failed twice and is waiting five minutes', 1);
select t.expect_value($$
  select count(*)::text from drain_outbox(now())
   where destination='ops@test.local'$$,
  'is not picked up before its time', '0');
select t.expect_value($$
  select count(*)::text from drain_outbox(now() + interval '6 minutes')
   where destination='ops@test.local'$$,
  'and is picked up after it', '1');

select '── outbox: a request that never reached a server is a failure ───';

/*
 * The defect this file found, asserted so it cannot come back.
 *
 * `pg_net` answers two ways: a server that replied leaves a `status_code`, and
 * a request that never got there — no connection, DNS failure, timeout —
 * leaves only an `error_msg`. Reading the first and not the second made the
 * delivery look permanently in flight: PENDING with an `external_id`, so
 * nothing retried it and nothing reported it. Found by pointing a channel at
 * an address that does not answer, which is what a mistyped endpoint is.
 */
select t.expect_rows($$
  update message_deliveries set status='PENDING', external_id='999999999',
         attempts=1, next_attempt_at=null
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'a delivery waiting on a request id', 1);
select t.fixture($$
  insert into net._http_response (id, status_code, content, error_msg, created)
  values (999999999, null, null, 'Couldn''t connect to server', now()) $$);

select t.expect_value($$select reconcile_deliveries()::text$$,
  'the reconciler settles it rather than leaving it in flight', '1');
select t.expect_value($$
  select status || ': ' || last_error from message_deliveries
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'as a failure, with the reason kept',
  'PENDING: Couldn''t connect to server');
select t.expect_value($$
  select (next_attempt_at is not null)::text from message_deliveries
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'and backed off rather than retried immediately', 'true');

select '── outbox: a server that said yes is sent, and stays sent ───────';

select t.expect_rows($$
  update message_deliveries set status='PENDING', external_id='999999998',
         attempts=1, next_attempt_at=null, last_error=null
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'another delivery waiting on a request id', 1);
select t.fixture($$
  insert into net._http_response (id, status_code, content, created)
  values (999999998, 202, '{"id":"prov-123"}', now()) $$);

select t.expect_value($$select reconcile_deliveries()::text$$,
  'the reconciler settles it', '1');
select t.expect_value($$
  select status || ' ' || response_code::text from message_deliveries
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'a 202 is sent, not only a 200', 'SENT 202');

/*
 * The failure nobody forgives. A drain after a success must not hand the same
 * message over a second time, whatever else is in the queue.
 */
select t.expect_value($$
  select count(*)::text from drain_outbox(now() + interval '1 day')
   where destination='ops@test.local'$$,
  'and a later pass does not send it again', '0');
select t.expect_value($$
  select attempts::text from message_deliveries
   where channel_id = (select id from message_channels where name='T-configured')$$,
  'nor touch its count', '1');

select '── outbox: nobody signed in drains it ───────────────────────────';

set local role authenticated;
select t.expect_fail($$select * from drain_outbox(now())$$,
  'the outbox is not somebody''s to drain');
select t.expect_fail($$select attempt_delivery(gen_random_uuid())$$,
  'nor to send one message from');
reset role;

select '── outbox: what is NOT proved here ──────────────────────────────';

/*
 * Said as an assertion rather than as a comment, so it has to be deleted by
 * whoever makes it untrue.
 *
 * Nothing in this file causes a message to arrive anywhere. The last hop is an
 * HTTP call to a provider's send API and needs an account and a key the
 * platform does not have — the same blocker as deployment. Every venue in this
 * database has channels with no endpoint, which is what that state looks like.
 */
select t.expect_value($$
  select count(*)::text from message_channels
   where enabled and coalesce(config ->> 'endpoint', '') <> ''
     and name not like 'T-%'$$,
  'GAP: no real channel has a provider endpoint, so nothing has ever been sent', '0');

rollback;
