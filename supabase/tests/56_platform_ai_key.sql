-- ---------------------------------------------------------------------------
-- A platform key that cannot run away (0115)
-- ---------------------------------------------------------------------------
-- The assistant has been bring-your-own-key only, which costs the platform
-- nothing and serves nobody who has no provider account. This is the other
-- half, and the half that can go expensively wrong.
--
-- The control worth proving is not "the key is hidden" — the key is not in
-- this database at all, it is an edge function secret. It is that one venue
-- in a retry loop cannot bill the platform for all of them. A cap the
-- browser enforces is not a cap, so the allowance is checked by the same
-- function that records the attempt, and both the permission and the refusal
-- land in the ledger.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── not set up means not allowed' as "──";

/*
 * Opt in, not opt out. A venue that was switched on by default would be
 * spending somebody else's money before anybody looked, and the platform's
 * bill would be a function of how many venues forgot.
 */
select t.expect_value(
  'select allowed::text || '': '' || reason from public.claim_ai_call(' ||
  quote_literal(:'demo') || '::uuid, ''gemini'', ''recipe-import'')',
  'a venue nobody set up cannot touch the platform key',
  'false: this venue is not set up to use the platform key');

/*
 * The refusal is on the record. "We stopped you" and "nothing happened" look
 * identical in a ledger that only writes successes, and the first question
 * when the assistant goes quiet is which of the two it was.
 */
reset role;
select t.expect_value($$
  select outcome || ': ' || refused_reason from ai_usage
   order by occurred_at desc limit 1$$,
  'and the refusal is written down, not just raised',
  'REFUSED: this venue is not set up to use the platform key');

select '── an allowance, and the end of it' as "──";

/*
 * Set with the owner connection, deliberately: there is no write policy for
 * a venue on its own allowance, because it is a commercial agreement rather
 * than a setting. A venue that could raise its own limit has no limit.
 */
select t.fixture($$
  insert into ai_allowances (org_id, platform_key_allowed,
                             monthly_request_limit, monthly_token_limit,
                             price_per_1k_tokens, currency)
  values ((select id from organizations where name='Demo Kitchen'),
          true, 2, 1000, 0.0005, 'USD')$$);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value(
  'select allowed::text from public.claim_ai_call(' || quote_literal(:'demo') ||
  '::uuid, ''gemini'', ''recipe-import'')',
  'with an allowance the call is claimed', 'true');

select t.expect_value($$
  select public.record_ai_usage(
    (select id from ai_usage where outcome = 'CLAIMED'
      order by occurred_at desc limit 1),
    'gemini-2.0-flash', 300, 200)::text$$,
  'and what it used is recorded afterwards', '');

/*
 * Charged from what the provider reported, not from an estimate. Five
 * hundred tokens at $0.0005 per thousand is a quarter of a thousandth of a
 * dollar, and a meter that rounds that away disagrees with the invoice by
 * the end of the month.
 */
select t.expect_value($$
  select charged_amount::text from ai_usage
   where outcome = 'OK' order by occurred_at desc limit 1$$,
  'at the price the venue was quoted', '0.000250');

select t.expect_value($$
  select requests_used::text || ' used, ' || requests_left::text || ' left'
    from ai_usage_this_month
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'the meter moves', '1 used, 1 left');

select '── the cap holds' as "──";

select t.fixture($$
  select public.record_ai_usage(
    (select claim_id from public.claim_ai_call(
      (select id from organizations where name='Demo Kitchen'),
      'gemini', 'recipe-import')),
    'gemini-2.0-flash', 300, 200)$$);

select t.expect_value(
  'select allowed::text || '': '' || reason from public.claim_ai_call(' ||
  quote_literal(:'demo') || '::uuid, ''gemini'', ''recipe-import'')',
  'the third call is refused, because two was the allowance',
  'false: this venue has used its 2 assistant requests for the month');

select t.expect_value($$
  select requests_left::text from ai_usage_this_month
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and nothing is left', '0');

/*
 * The refusal did not quietly consume anything either. A cap that charges
 * for the call it refused is worse than no cap.
 */
reset role;
select t.expect_value($$
  select coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)), 0)::text
    from ai_usage where outcome = 'REFUSED'$$,
  'a refused call costs nothing', '0');

select '── the ledger is append-only' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  update ai_usage set output_tokens = 1 where outcome = 'OK'$$,
  'a line an invoice is built from cannot be edited', 'append-only|denied');
select t.expect_refused($$delete from ai_usage where outcome = 'OK'$$,
  'nor deleted', 'append-only|denied');

select '── a venue cannot raise its own limit' as "──";

select t.expect_fail($$
  update ai_allowances set monthly_request_limit = 100000
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'an allowance is an agreement, not a setting');

reset role;
select t.expect_value($$
  select monthly_request_limit::text from ai_allowances
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and it is still two', '2');

select '── your own key is not metered at all' as "──";

/*
 * The whole point of bring-your-own-key is that the bill is the venue's. A
 * platform allowance that also capped a key the platform does not pay for
 * would be charging rent on somebody else's spending.
 */
select t.expect_value($$
  select count(*)::text from ai_usage where key_source = 'OWN_KEY'$$,
  'nothing records a call made on the venue''s own key', '0');

rollback;
